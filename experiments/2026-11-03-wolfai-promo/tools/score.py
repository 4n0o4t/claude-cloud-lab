"""第二版配乐：按 src/cues.json 的节拍表合成一段 100 BPM 的预告片配乐（纯 numpy，无外部素材）。

结构（单位：拍）：
  hook    0-12  心跳鼓 + 低音铺底，制造悬念
  roles  12-24  每两拍一下底鼓 + 轻踩镲
  night  24-32  半速，钟表滴答
  day    32-44  四拍底鼓 + 太鼓 + 小调琶音，最满
  vote   44-52  军鼓滚奏加速 + 噪声上扬，推向判决
  verdict 52-56 冲击后只留大调铺底（好人赢）
  archive/outro 56-72 回落，片尾一记重音后自然衰减
另外在 impacts / whooshes / ticks 处放冲击、呼啸和点击音，和画面卡点一一对应。

用法（实验目录下）：python tools/score.py   → public/bgm/score.wav（被 git 忽略）
"""

import json
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48000
ROOT = Path(__file__).resolve().parent.parent
CUES = json.loads((ROOT / "src/cues.json").read_text())
BEAT = 60 / CUES["bpm"]
TOTAL = (CUES["beats"] + CUES["tail"]) * BEAT
N = int(TOTAL * SR)
rng = np.random.default_rng(7)


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def at(beat: float) -> int:
    return int(beat * BEAT * SR)


def add(buf: np.ndarray, sig: np.ndarray, beat: float, gain: float = 1.0, pan: float = 0.0) -> None:
    i = at(beat)
    j = min(N, i + len(sig))
    if i >= N:
        return
    s = sig[: j - i] * gain
    buf[i:j, 0] += s * (1 - max(0, pan))
    buf[i:j, 1] += s * (1 + min(0, pan))


def env_exp(n: int, tau: float) -> np.ndarray:
    return np.exp(-np.arange(n) / SR / tau)


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # 一阶低通，够用
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


# ---------- 音色 ----------


def kick(n=int(0.5 * SR)) -> np.ndarray:
    t = np.arange(n) / SR
    f = 42 + 110 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.16)


def taiko(n=int(0.9 * SR)) -> np.ndarray:
    t = np.arange(n) / SR
    f = 70 + 60 * np.exp(-t / 0.05)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.28)
    skin = lowpass(rng.standard_normal(n), 900) * env_exp(n, 0.05) * 2.5
    return body + skin


def hat(n=int(0.08 * SR)) -> np.ndarray:
    x = rng.standard_normal(n)
    x = x - lowpass(x, 6000)
    return x * env_exp(n, 0.018)


def snare(n=int(0.25 * SR)) -> np.ndarray:
    t = np.arange(n) / SR
    noise = (rng.standard_normal(n) - lowpass(rng.standard_normal(n), 1500)) * env_exp(n, 0.07)
    tone = np.sin(2 * np.pi * 190 * t) * env_exp(n, 0.05)
    return noise * 0.8 + tone * 0.5


def tick(n=int(0.05 * SR)) -> np.ndarray:
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 2400 * t) * env_exp(n, 0.008)


def impact(n=int(4.0 * SR)) -> np.ndarray:
    t = np.arange(n) / SR
    f = 28 + 70 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.9)
    crash = lowpass(rng.standard_normal(n), 3000) * env_exp(n, 0.35) * 0.9
    return boom * 1.2 + crash


def whoosh(n=int(0.6 * SR)) -> np.ndarray:
    x = rng.standard_normal(n)
    e = np.sin(np.linspace(0, np.pi, n)) ** 3
    sweep = np.linspace(400, 5000, n)
    y = np.empty(n)
    acc = 0.0
    for i in range(n):  # 截止频率随时间升高的低通
        a = np.exp(-2 * np.pi * sweep[i] / SR)
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y * e * 3


def pad(notes: list[int], beats: float, bright: float = 0.18) -> np.ndarray:
    n = at(beats)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        for c, amp in [(-7, 0.5), (0, 1.0), (7, 0.5)]:
            f = hz(m) * 2 ** (c / 1200)
            out += amp * (np.sin(2 * np.pi * f * t) + bright * np.sin(4 * np.pi * f * t))
    fade = min(n // 3, int(1.2 * SR))
    e = np.ones(n)
    e[:fade] = np.linspace(0, 1, fade) ** 2
    e[-fade:] = np.linspace(1, 0, fade) ** 2
    return out * e / len(notes)


def pluck(m: int, n=int(0.45 * SR)) -> np.ndarray:
    t = np.arange(n) / SR
    f = hz(m)
    saw = 2 * ((t * f) % 1) - 1
    return lowpass(saw, 1800) * env_exp(n, 0.12)


# ---------- 编排 ----------


def main() -> None:
    mus = np.zeros((N, 2))
    fx = np.zeros((N, 2))
    S = CUES["sections"]
    Dm, Bb, Gm, A, D = [38, 50, 53, 57], [34, 50, 53, 58], [43, 50, 55, 58], [45, 49, 52, 57], [38, 50, 54, 57]

    # 铺底和声：每 4 拍换一个和弦
    prog = [Dm, Dm, Bb, Bb, Dm, Bb, Gm, A, Dm, Dm, Bb, A, Dm, Gm, D, D, Dm, Dm]
    for k, ch in enumerate(prog):
        b = k * 4
        if b >= CUES["beats"] + CUES["tail"]:
            break
        g = 0.35 if S["verdict"][0] <= b < S["verdict"][1] else 0.22
        add(mus, pad(ch, 5.0, 0.12 if b < 12 else 0.2), b, g)

    # 心跳（hook）
    for b in range(S["hook"][0], S["hook"][1], 2):
        add(mus, kick(), b, 0.7)
        add(mus, kick(), b + 0.33, 0.45)
    # roles + setup：两拍一下底鼓，八分音符踩镲
    for b in np.arange(S["roles"][0], S["setup"][1], 0.5):
        if b % 2 == 0:
            add(mus, kick(), b, 0.9)
        add(mus, hat(), b, 0.18 if b % 1 else 0.1, pan=0.3)
    # night：半速，滴答
    for b in np.arange(S["night"][0], S["night"][1], 1):
        add(mus, tick(), b, 0.25, pan=-0.4)
        if b % 4 == 0:
            add(mus, kick(), b, 0.8)
    # day：四拍底鼓 + 太鼓 + 琶音
    arp = [62, 65, 69, 65, 62, 65, 70, 65]
    for b in np.arange(S["day"][0], S["day"][1], 0.5):
        if b % 1 == 0:
            add(mus, kick(), b, 0.95)
        if b % 4 == 0:
            add(mus, taiko(), b, 0.7)
        add(mus, hat(), b, 0.16, pan=0.35)
        add(mus, pluck(arp[int(b * 2) % 8]), b, 0.22, pan=-0.25 if b % 1 else 0.25)
    # vote：底鼓 + 加速的军鼓滚奏 + 上扬噪声
    for b in np.arange(S["vote"][0], S["vote"][1], 1):
        add(mus, kick(), b, 0.95)
    roll = 0.0
    step = 0.5
    while S["vote"][0] + 4 + roll < S["vote"][1]:
        add(mus, snare(), S["vote"][0] + 4 + roll, 0.25 + 0.5 * roll / 4)
        roll += step
        step = max(0.125, step * 0.82)
    rn = at(4)
    riser = rng.standard_normal(rn) * np.linspace(0, 1, rn) ** 2
    add(mus, lowpass(riser, 2500) * 1.5, S["vote"][0] + 4, 0.5)
    # archive：轻琶音
    for b in np.arange(S["archive"][0], S["archive"][1], 0.5):
        add(mus, pluck([62, 66, 69, 74][int(b * 2) % 4]), b, 0.13)

    # 音效：冲击 / 呼啸 / 点击
    for b in CUES["impacts"]:
        add(fx, impact(), b, 0.9 if b not in (60,) else 1.1)
    for b in CUES["whooshes"]:
        add(fx, whoosh(), b - 0.5, 0.35)
    for b in CUES["ticks"]:
        add(fx, tick() + 0.3 * hat()[: int(0.05 * SR)], b, 0.3, pan=0.15)
    # 片尾最后一记
    add(fx, impact(), CUES["beats"] - 0.01, 0.6)

    # 简单延迟当空间感
    mix = mus + fx
    for ch, d in enumerate([0.31, 0.37]):
        delay = int(d * SR)
        y = mix[:, ch].copy()
        for k in range(1, 4):
            y[delay * k :] += mix[: -delay * k, ch] * (0.28**k)
        mix[:, ch] = y
    # 结尾淡出
    f = int(2.0 * SR)
    mix[-f:] *= np.linspace(1, 0, f)[:, None] ** 2
    # 软限幅到约 -1 dBFS
    mix /= np.max(np.abs(mix))
    mix = np.tanh(mix * 1.6) / np.tanh(1.6) * 0.89
    out = ROOT / "public/bgm/score.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, mix.astype(np.float32), SR, subtype="PCM_16")
    print(f"写出 {out.relative_to(ROOT)}，{TOTAL:.1f} 秒")


if __name__ == "__main__":
    main()
