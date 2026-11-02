"""逐句生成旁白音频，并把实际时长写进 voice manifest。

用法（从实验目录执行，需先按 README 建好 TTS 虚拟环境）：
    python tools/tts.py                      # 只重新生成文本或音色变了的句子
    python tools/tts.py --voice zm_010 --force

输出：
    public/voice/zh-CN/<id>.wav   24kHz 单声道（被 git 忽略，可随时重新生成）
    src/voice-manifest.json       每句的时长、文本哈希、模型与音色（提交进 git，时间轴依赖它）
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
REPO_ID = "hexgrad/Kokoro-82M-v1.1-zh"
SAMPLE_RATE = 24000


def text_hash(text: str, voice: str, speed: float) -> str:
    return hashlib.sha256(f"{REPO_ID}|{voice}|{speed}|{text}".encode()).hexdigest()[:16]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--narration", default="narration/zh-CN.json")
    ap.add_argument("--out", default="public/voice/zh-CN")
    ap.add_argument("--manifest", default="src/voice-manifest.json")
    ap.add_argument("--voice", default="zf_001")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    lines = json.loads((ROOT / args.narration).read_text(encoding="utf-8"))
    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / args.manifest
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    old = manifest.get("lines", {})

    todo = []
    for line in lines:
        h = text_hash(line["speak"], args.voice, args.speed)
        wav = out_dir / f"{line['id']}.wav"
        if args.force or old.get(line["id"], {}).get("hash") != h or not wav.exists():
            todo.append((line, h, wav))

    if todo:
        from kokoro import KModel, KPipeline

        model = KModel(repo_id=REPO_ID).eval()
        en = KPipeline(lang_code="a", repo_id=REPO_ID, model=False)
        pipe = KPipeline(
            lang_code="z", repo_id=REPO_ID, model=model, en_callable=lambda t: next(en(t)).phonemes
        )
        for line, h, wav in todo:
            audio = np.concatenate([r.audio.numpy() for r in pipe(line["speak"], voice=args.voice, speed=args.speed)])
            peak = float(np.max(np.abs(audio))) or 1.0
            audio = audio / peak * 0.89  # 峰值约 -1 dBFS，句与句音量一致
            sf.write(wav, audio, SAMPLE_RATE, subtype="PCM_16")
            old[line["id"]] = {"durationMs": round(len(audio) / SAMPLE_RATE * 1000), "hash": h}
            print(f"生成 {line['id']}: {old[line['id']]['durationMs']} ms")

    ids = {line["id"] for line in lines}
    manifest = {
        "model": REPO_ID,
        "voice": args.voice,
        "speed": args.speed,
        "lines": {k: v for k, v in old.items() if k in ids},
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(v["durationMs"] for v in manifest["lines"].values()) / 1000
    print(f"共 {len(manifest['lines'])} 句，旁白总长 {total:.1f} 秒，新生成 {len(todo)} 句")


if __name__ == "__main__":
    main()
