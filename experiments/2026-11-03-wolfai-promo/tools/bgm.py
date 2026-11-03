"""合成一段氛围背景音乐（无外部素材，无版权问题）。

Dm – B♭ – Gm – A 四个和弦（小调，月夜悬疑感），每个 11 秒，交叉淡化；每个音由几条轻微失谐的正弦叠加，
左右声道失谐不同制造宽度，再加一个简单的反馈延迟当混响。完全确定性。

用法（从实验目录执行，只依赖 numpy + soundfile）：
    python tools/bgm.py                # 输出 public/bgm/ambient.wav（被 git 忽略）
"""

from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48000
CHORD_SEC = 11.0
ROOT = Path(__file__).resolve().parent.parent

# MIDI 音高
CHORDS = [
    [38, 50, 53, 57],  # Dm
    [34, 50, 53, 58],  # B♭
    [43, 50, 55, 58],  # Gm
    [45, 49, 52, 57],  # A（大三和弦，回到 Dm 前的张力）
]


def midi_hz(m: int) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def pad_note(hz: float, n: int, detune_cents: float) -> np.ndarray:
    t = np.arange(n) / SR
    out = np.zeros(n)
    for c, amp in [(-detune_cents, 0.5), (0.0, 1.0), (detune_cents, 0.5)]:
        f = hz * 2 ** (c / 1200)
        out += amp * (np.sin(2 * np.pi * f * t) + 0.18 * np.sin(2 * np.pi * 2 * f * t) + 0.06 * np.sin(2 * np.pi * 3 * f * t))
    return out


def main() -> None:
    seg = int(CHORD_SEC * SR)
    fade = int(2.0 * SR)
    total = seg * len(CHORDS) + fade
    stereo = np.zeros((total, 2))
    env = np.ones(seg + fade)
    env[:fade] = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
    env[-fade:] = np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    for i, chord in enumerate(CHORDS):
        start = i * seg
        for ch, det in enumerate([6.0, 9.0]):
            s = sum(pad_note(midi_hz(m), seg + fade, det) * (1.4 if m < 50 else 1.0) for m in chord)
            stereo[start : start + seg + fade, ch] += s * env
    # 缓慢呼吸感
    t = np.arange(total) / SR
    stereo *= (0.85 + 0.15 * np.sin(2 * np.pi * t / 9.0))[:, None]
    # 简单反馈延迟当混响（左右错开）
    for ch, d in enumerate([0.37, 0.41]):
        delay = int(d * SR)
        y = stereo[:, ch].copy()
        for k in range(1, 5):
            y[delay * k :] += stereo[: -delay * k, ch] * (0.35**k)
        stereo[:, ch] = y
    stereo /= np.max(np.abs(stereo))
    stereo *= 0.5  # 约 -6 dBFS，留给旁白
    out = ROOT / "public/bgm/ambient.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, stereo.astype(np.float32), SR, subtype="PCM_16")
    print(f"写出 {out.relative_to(ROOT)}，{total / SR:.1f} 秒")


if __name__ == "__main__":
    main()
