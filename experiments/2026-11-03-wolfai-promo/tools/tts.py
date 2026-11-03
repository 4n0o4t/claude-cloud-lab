"""逐句生成旁白音频，并把实际时长写进 voice manifest。

用法（从实验目录执行，需先按 README 建好 TTS 虚拟环境）：
    python tools/tts.py                                  # Kokoro（本地，默认）
    python tools/tts.py --engine gemini --voice Kore     # Gemini 3.8 Flash TTS，需要环境变量 GEMINI_API_KEY
    python tools/tts.py --voice zm_010 --force           # 换音色并全部重做

只重新生成“引擎 + 音色 + 语速/风格 + 文本”变了的句子。

输出（按引擎分开，互不覆盖）：
    public/voice/zh-CN[-gemini]/<id>.wav    24kHz 单声道（被 git 忽略，可随时重新生成）
    src/voice-manifest[.gemini].json        每句的时长与哈希（提交进 git，时间轴依赖它）
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_RATE = 24000

KOKORO_REPO = "hexgrad/Kokoro-82M-v1.1-zh"
GEMINI_MODEL = "gemini-3.8-flash-tts"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
DEFAULT_STYLE = "亲切、轻快的科普节目主持人，吐字清晰，语速适中，像在给朋友讲一个有趣的知识"

ENGINES = {
    "kokoro": {"voice": "zf_001", "out": "public/voice/zh-CN", "manifest": "src/voice-manifest.json"},
    "gemini": {"voice": "Kore", "out": "public/voice/zh-CN-gemini", "manifest": "src/voice-manifest.gemini.json"},
}


def line_hash(engine: str, voice: str, extra: str, text: str) -> str:
    return hashlib.sha256(f"{engine}|{voice}|{extra}|{text}".encode()).hexdigest()[:16]


class Kokoro:
    def __init__(self, voice: str, speed: float):
        from kokoro import KModel, KPipeline

        model = KModel(repo_id=KOKORO_REPO).eval()
        en = KPipeline(lang_code="a", repo_id=KOKORO_REPO, model=False)
        self.pipe = KPipeline(
            lang_code="z", repo_id=KOKORO_REPO, model=model, en_callable=lambda t: next(en(t)).phonemes
        )
        self.voice, self.speed = voice, speed

    def __call__(self, text: str) -> np.ndarray:
        return np.concatenate([r.audio.numpy() for r in self.pipe(text, voice=self.voice, speed=self.speed)])


class QuotaExceeded(Exception):
    pass


class Gemini:
    def __init__(self, voice: str, style: str):
        self.key = os.environ.get("GEMINI_API_KEY")
        if not self.key:
            raise SystemExit("缺少环境变量 GEMINI_API_KEY")
        self.voice, self.style = voice, style

    def __call__(self, text: str) -> np.ndarray:
        body = {
            "model": GEMINI_MODEL,
            "input": [
                {
                    "type": "user_input",
                    "content": [
                        {
                            "type": "text",
                            "text": text,
                            "annotations": [{"type": "speech_metadata", "style": self.style}],
                        }
                    ],
                }
            ],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": self.voice}]},
        }
        req = urllib.request.Request(
            GEMINI_URL,
            data=json.dumps(body).encode(),
            headers={"x-goog-api-key": self.key, "Content-Type": "application/json"},
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.load(resp)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and int(e.headers.get("retry-after", "0")) > 120:
                    raise QuotaExceeded(e.read().decode()[:300]) from e  # 日配额用完，重试无意义
                if attempt == 3:
                    raise
                print(f"  重试 {attempt + 1}：HTTP {e.code}")
                time.sleep(2 ** (attempt + 1))
            except Exception as e:  # 网络抖动时退避重试
                if attempt == 3:
                    raise
                print(f"  重试 {attempt + 1}：{type(e).__name__}")
                time.sleep(2 ** (attempt + 1))
        audio = [
            c
            for s in data["steps"]
            if s["type"] == "model_output"
            for c in s["content"]
            if c["type"] == "audio"
        ][-1]
        wav, sr = sf.read(io.BytesIO(base64.b64decode(audio["data"])), dtype="float32")
        if sr != SAMPLE_RATE:
            raise SystemExit(f"意外的采样率 {sr}")
        return wav if wav.ndim == 1 else wav.mean(axis=1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=ENGINES, default="kokoro")
    ap.add_argument("--narration", default="narration/zh-CN.json")
    ap.add_argument("--voice", help="音色，默认 kokoro=zf_001，gemini=Kore")
    ap.add_argument("--speed", type=float, default=1.0, help="仅 kokoro")
    ap.add_argument("--style", default=DEFAULT_STYLE, help="仅 gemini：整体演绎风格")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    cfg = ENGINES[args.engine]
    voice = args.voice or cfg["voice"]
    extra = str(args.speed) if args.engine == "kokoro" else args.style
    lines = json.loads((ROOT / args.narration).read_text(encoding="utf-8"))
    out_dir = ROOT / cfg["out"]
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / cfg["manifest"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    old = manifest.get("lines", {})

    todo = []
    for line in lines:
        h = line_hash(args.engine, voice, extra, line["speak"])
        wav = out_dir / f"{line['id']}.wav"
        if args.force or old.get(line["id"], {}).get("hash") != h or not wav.exists():
            todo.append((line, h, wav))

    done, quota_msg = 0, ""
    if todo:
        synth = Kokoro(voice, args.speed) if args.engine == "kokoro" else Gemini(voice, args.style)
        for line, h, wav in todo:
            try:
                audio = synth(line["speak"])
            except QuotaExceeded as e:
                quota_msg = str(e)
                break
            peak = float(np.max(np.abs(audio))) or 1.0
            audio = audio / peak * 0.89  # 峰值约 -1 dBFS，句与句音量一致
            sf.write(wav, audio, SAMPLE_RATE, subtype="PCM_16")
            old[line["id"]] = {"durationMs": round(len(audio) / SAMPLE_RATE * 1000), "hash": h}
            print(f"生成 {line['id']}: {old[line['id']]['durationMs']} ms")
            done += 1
            save(manifest_path, args, voice, old, lines)  # 每句落盘，中途失败也不丢

    save(manifest_path, args, voice, old, lines)
    if quota_msg:
        raise SystemExit(f"配额用完，已保存已生成的句子，剩余 {len(todo) - done} 句下次再跑：{quota_msg}")


def save(manifest_path, args, voice, old, lines) -> None:
    ids = {line["id"] for line in lines}
    manifest = {
        "engine": args.engine,
        "model": KOKORO_REPO if args.engine == "kokoro" else GEMINI_MODEL,
        "voice": voice,
        **({"speed": args.speed} if args.engine == "kokoro" else {"style": args.style}),
        "lines": {k: v for k, v in old.items() if k in ids},
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(v["durationMs"] for v in manifest["lines"].values()) / 1000
    print(f"manifest：共 {len(manifest['lines'])}/{len(ids)} 句，旁白总长 {total:.1f} 秒")


if __name__ == "__main__":
    main()
