# 月夜狼人杀产品宣传片

- 日期：2026-11-03
- 状态：完成（等所有者看片反馈）
- 分支：`claude/bold-bell-wrvw3m`

## 问题

用 Remotion 给一个真实的前端项目做产品宣传片，可行吗？对象是所有者的 [wolfai-killer](https://github.com/Dr-Ai-0018/wolfai-killer)（月夜狼人杀：FastAPI + Vue 3 的 AI 狼人杀）。画面要用真实运行的界面，而不是示意动画。

## 方法

1. **跑起真实产品**
   - 只读克隆 `redesign` 分支 `88c41e7`（2026-11-02）。注意 `main` 停在 5 月，是旧版界面。
   - 后端用 Python 3.12 虚拟环境按 `requirements.txt` 安装，前端用 `npm ci` 加 Vite。两边都放在容器本地，不改所有者的仓库。
2. **剧本局代替真模型**（`tools/mock_llm.py`）
   - 项目走 OpenAI Responses API 的流式接口（`/v1/responses`，SSE，读 `response.completed`）。AI 调用失败时会显式记 `llm_failure`，不会随机兜底，所以没有模型就推进不了对局。
   - 这里写了一个本地假接口，按提示词类型（守卫、狼刀、查验、解药、毒药、发言、投票、遗言）返回剧本里的回答。
   - 身份通过上帝模式接口实时查询，夜数读引擎状态，所以座位随机也能用。
   - 发言会根据场上已有的发言选台词（没人起跳、一边起跳、两边对跳）。
   - 剧情：第 1 夜狼刀守卫、守卫守预言家、女巫救人，平安夜。第 1 天预言家报查杀，被查杀的狼悍跳，好人 4 比 2 投出这只狼。第 2 夜狼刀预言家、女巫毒死另一只狼，好人获胜。
   - 真实的引擎、日志、前端照常运行，只有台词是预设的；片尾注明了这一点。
3. **录屏**（`tools/record.mjs`）
   - Playwright 用 1920×1080 的 `recordVideo` 录四段：完整一局（旁观视角）、首页滑到“二十种身份”、开局页选“标准六人局”、卷宗复盘页。
   - 对局录制时同时记下每条日志出现的秒数（`marks.json`），剪辑时用来对齐。
4. **合成**（Remotion 4.0.540，`src/Promo.tsx`）
   - 9 幕，旁白时长驱动时间轴（`src/timeline.ts`，相邻幕交叉淡化 10 帧）。
   - 每幕是一到四个录屏镜头（`@remotion/media` 的 `Video` 配合 `trimBefore` 和 `playbackRate`），加缓慢推镜。
   - 章节式字幕呼应界面的“CHAPTER · I”排版：Noto Serif SC，墨黑、骨白、暗金、血红。
   - 开场是逐字浮现的问句，片尾是血月、标题和仓库地址。
5. **声音**
   - 旁白用 Kokoro-82M-v1.1-zh 的男声 `zm_010`，语速 1.05，9 句共 36.6 秒。`tools/tts.py` 从上一个实验复制而来。
   - 配乐 `tools/bgm.py` 改成 Dm、B♭、Gm、A 的小调铺底，旁白期间自动压低。

## 复现

```bash
# 0. 准备 wolfai-killer（容器本地，只读克隆）
WK=~/wolfai-killer; PY=$(realpath ../../temp)/wolf-venv/bin/python
git clone -b redesign https://github.com/Dr-Ai-0018/wolfai-killer $WK
uv venv -p 3.12 ../../temp/wolf-venv && VIRTUAL_ENV=../../temp/wolf-venv uv pip install -r $WK/backend/requirements.txt
(cd $WK/frontend && npm ci)
# 把后端网关指向本地假接口（只改本地副本，别提交到 wolfai-killer）
sed -i 's#https://api.awz707.com/v1#http://127.0.0.1:8900/v1#g' $WK/backend/config.yaml

# 1. 启动三个服务（各开一个终端；假接口只依赖后端已装的 fastapi / uvicorn / httpx）
(cd $WK/backend && WEREWOLF_API_KEY=mock WEREWOLF_API_FALLBACK_SECONDARY_KEY=mock WEREWOLF_ADMIN_PASSWORD=demo $PY app.py)  # :8101
(cd $WK/frontend && npx vite --port 3000)
$PY tools/mock_llm.py --delay 1.6   # :8900；1.6 秒让旁观页 2.5 秒一次的轮询跟得上

# 2. 录屏 → 转码
node tools/record.mjs ../../temp/wolf-rec
bash tools/prepare-rec.sh ../../temp/wolf-rec

# 3. 旁白与配乐（TTS 虚拟环境见 tools/requirements-tts.txt）
python tools/tts.py --voice zm_010 --speed 1.05
python tools/bgm.py

# 4. 渲染（云端容器复用预装 headless Chromium）
npm ci
export REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
npm run render   # → ../../temp/wolfai-promo.mp4
```

**素材时间点**：座位每局随机分配，谁第几秒发言会变。`src/Promo.tsx` 里 `SHOTS` 的秒数对应成片那次录像，记在 `tools/rec-marks.json`。重新录制后要按新的 `marks.json` 调整；画面比日志晚约 0.5 到 1 秒出现。

## 结果

- 成片 `temp/wolfai-promo.mp4`：1920×1080 H.264 加 AAC，41.6 秒，1249 帧。全分辨率渲染 1 分 46 秒（纯 2D 加视频，无 WebGL），半分辨率草稿 1 分 18 秒。
- 音量：平均 -19.9 dB，峰值 -0.6 dB，无削波。
- 抽帧自检：
  - 半分辨率草稿 16 帧，加 3 张全分辨率单帧，修了三处：开场标红误伤“凑不齐人”的“人”；身份墙那幕字幕压住页面自带标题；交叉淡化时前后两幕字幕叠在一起，改为下一幕淡入前先收掉字幕。
  - 成片再抽 20 帧复查，未见问题。
- 旁白回听：Whisper 转写有“想→将”“胜负→政府”“AI→爱爱”“悍跳→旱跳”等差异。直接检查 Kokoro 的 g2p 输出，读音都正确（xiang3、sheng4 fu4、cha2 sha1、han4 tiao4，AI 读作字母 A、I），属于 ASR 误识别。没有经过人耳试听。
- 录屏脚本独立复跑一次（`temp/wolf-rec-verify/`）：四段都录成，剧本局照样打到好人获胜。
- 顺带发现 wolfai-killer 的一个小问题：旁观者（无席位）走 2.5 秒一次的 HTTP 轮询，这条路径不设置 `godModeEnabled`，所以即使开局开了上帝模式，旁观页也没有“上帝”按钮。WebSocket 首帧里才带 `god_mode_enabled`，旁观者没有 WebSocket。这次因此全程用旁观视角录制。

## 结论

- 结论：
  - 用“真实界面录屏，加 Remotion 做镜头、字幕和声音”给前端项目做宣传片很顺，比纯程序化画面省事得多，而且一看就是真产品。
  - 最费心的是让产品自己演出一局好戏。依赖 LLM 的产品，可以用一个按提示词分类的假接口导演剧情，节奏可控、零费用、可重复。
- 可信度与局限：
  - 台词是预设剧本，不代表真实模型的发言水平，片尾已注明。
  - 录屏是 Playwright 的 VP8 编码（约 0.8 Mbps）。暗色静态界面看着清楚，但推镜放大到 1.5 倍时文字略软。
  - 旁白未经人耳试听。
- 后续（未做，按需）：
  - 用 `deviceScaleFactor: 2` 录屏或改用截图序列，让放大镜头更锐；
  - 接真模型录一局真实对局；
  - 做竖版 9:16；
  - 加按词的字幕；
  - 把上面的旁观者上帝按钮问题报给所有者的仓库。
