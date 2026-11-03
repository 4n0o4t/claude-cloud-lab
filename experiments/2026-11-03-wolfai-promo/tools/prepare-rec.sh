#!/usr/bin/env bash
# 把 Playwright 录的 webm 转成 Remotion 用的 H.264 mp4，并截出开场背景图。
# 用法（实验目录下）：bash tools/prepare-rec.sh [录像目录，默认 ../../temp/wolf-rec]
set -euo pipefail
SRC=${1:-../../temp/wolf-rec}
mkdir -p public/rec
for n in game home setup detail; do
  ffmpeg -loglevel error -y -i "$SRC/$n.webm" -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -r 30 "public/rec/$n.mp4"
done
ffmpeg -loglevel error -y -ss 2 -i public/rec/home.mp4 -frames:v 1 public/rec/hook.png
ls -la public/rec
