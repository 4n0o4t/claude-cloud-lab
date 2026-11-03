# 月夜狼人杀产品宣传片

- 日期：2026-11-03
- 状态：第二版完成（第一版被所有者评为“很机械”，按社区做法重做；等反馈）
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

## 第二版：拆组件 + 3D + 卡点（`WolfTrailer`，默认）

### 为什么重做

所有者看了第一版的反馈是：“感觉很机械，就是单纯地放大每个页面，完全没有设计感。”这个判断是对的。第一版每一幕都是“整页录屏 + 缓慢推镜 + 底部字幕”，而这个界面本身暗、留白多，整页放大以后只剩一片黑和几行小字。

### 查了社区怎么做

社区里反复出现的做法（来源见下）：

1. **界面就是动画本身。** 不放整页，把界面拆成组件（卡片、按钮、面板），每个组件单独用弹簧动画进出。有的团队甚至不用录屏，在代码里重建那一块界面，好处是清晰、可重复、改文案不用重录。
2. **景深。** 屏幕做 3D 倾斜，面板分层浮在不同深度、视差移动，配阴影和虚化。
3. **动态字体当骨架。** 大字和产品画面交替出现，而不是一直挂在底部的字幕。
4. **转场有动机。** 比如甩镜、缩放模糊、遮罩揭示；点击触发下一拍。
5. **讲一个故事，不是逛一遍页面；剪辑卡在音乐节拍上。**

来源：[Remocn 产品演示视频构建记录](https://dev.to/remocn/how-to-make-a-product-demo-video-in-react-ief)、[remotion-beautiful-videos skill](https://skills.sh/norahe0304-art/remotion-video-skill/remotion-beautiful-videos)、[HeyGen oversized-cursor 规则](https://www.ui-skills.com/skills/heygen-com/oversized-cursor)、[Remotion 预告片设计指南](https://glama.ai/mcp/servers/@endlessblink/clean-cut-mcp/blob/13ec46d11f1e6e5f4987cd7f637c23abda34564d/docs/main-docs/REMOTION-TRAILER-COMPLETE-DESIGN-GUIDE.md)、[Floating Product Object](https://motion-guide.pages.dev/entry/floating-product-object)、[独立游戏预告片指南](https://autoae.online/blog/how-to-make-indie-game-launch-trailer-without-after-effects)。

### 做法

- **素材换成高清截图和项目原有美术**（`tools/capture.mjs`、`tools/prepare-assets.py`）：
  - 用 `deviceScaleFactor: 2` 跑一局剧本局，每出现新日志截一张 3840×2160 的整屏，同时抓身份卡、开局页、卷宗页。
  - 从截图里抠出“案卷概要”“座次名册”“民阵胜”幕布等组件。
  - 直接用 wolfai-killer 自带的 20 张石刻浮雕身份图、首页狼浮雕和站标。这些都放在 `public/assets/`，被 git 忽略，由脚本从所有者仓库生成，不进本仓库。
- **按音乐节拍写分镜**（`src/cues.json`）：100 BPM，一拍 18 帧，68 拍加 4 拍尾巴，共 43.2 秒。配乐和画面读同一张节拍表，冲击、呼啸、点击音和画面卡点一一对应。
- **9 幕**（`src/trailer/scenes.tsx`）：
  1. 开场：狼浮雕从暗处浮现，大字逐拍出现：“今夜 / 六个 AI / 围坐一桌 / 其中两个 / 是狼。”，最后一拍眼睛亮起，画面震动。
  2. 身份：20 张身份卡在 3D 纵深里迎面飞过，然后按拍发出本局 6 张，狼牌闪红，随后翻成卡背。
  3. 开局：开局页截图做成倾斜的 3D 屏幕，“案卷概要”和“座次名册”从屏幕里弹出来，浮在镜头前。
  4. 第一夜：重建界面同款的座位圆盘，做成伪 3D 圆桌，缓慢旋转。狼刀、守卫、解药、查验逐拍点亮：头像从座位升起，弧线连向目标，左侧同步出“实录”，最后落在“平安夜”。
  5. 白天：两段真实发言逐字打出，关键词上色。悍跳狼的预言家头像会偶尔闪回狼图。最后两张头像对峙，打出“对跳”。
  6. 投票：6 条投票连线逐拍画出，右侧计票条增长，然后是“4 : 2”和“5 号出局”，再接遗言。
  7. 揭晓：6 张牌依次翻开亮出真实身份，然后真实的“民阵胜”结算幕布落下。
  8. 卷宗：整页复盘截图在 3D 里滚过。
  9. 片尾：站标、标题、“月夜之审 · 谁人为狼”、仓库地址和声明。
- **全局质感**（`src/trailer/Trailer.tsx`、`kit.tsx`）：
  - 幕间用缩放模糊转场；
  - 冲击拍有画面抖动和闪白；
  - 叠加胶片颗粒和暗角。
- **声音**（`tools/score.py`）：
  - 这版不用旁白，改由大字带叙事。
  - 配乐按段落变化：开场是心跳鼓，身份段是底鼓加踩镲，夜里是钟表滴答，白天是太鼓加小调琶音，投票段军鼓滚奏加速，揭晓段转大调。
  - 纯 numpy 合成，无外部素材。

### 复现（先按下面第一版复现的第 0、1 步把三个服务跑起来）

```bash
node tools/capture.mjs ../../temp/wolf-cap                       # 高清截图，约 3 分钟
python tools/prepare-assets.py ../../temp/wolf-cap ~/wolfai-killer
python tools/score.py                                            # → public/bgm/score.wav
npm run render                                                   # → ../../temp/wolfai-trailer.mp4
```

座位每局随机。`src/trailer/scenes.tsx` 里的 `SEATS`、夜间行动和投票都写死成采集那一局的样子（记在 `tools/cap-index.json`），重新采集后要按新座次修改。裁切框按 2x 截图写死，界面改版后要重新量。

### 第二版结果

- 成片 `temp/wolfai-trailer.mp4`：1920×1080，43.2 秒，1296 帧，13.2 MB。全分辨率渲染 3 分 28 秒，半分辨率草稿 2 分钟。
- 音量：平均 -18.1 dB，峰值 -1.1 dB。
- 抽帧自检：草稿 18 帧，修了四处：开场狼图露出方形边缘，改成径向羽化；身份隧道收得太早，画面空了一拍；第一夜 6 号头像压住左侧实录，把圆桌右移；对跳时头像挡住副标，把头像拉开。成片又抽 7 帧复查。
- 未验证：配乐和卡点没有经过人耳试听，只按节拍表计算对齐。

## 第一版：录屏推镜 + 旁白（`WolfPromo`，留作对照）

### 复现

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

### 第一版结果

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
  - 第二版的教训：真实界面只是“素材”，不是“成片”。整页推镜看着就是录屏，要拆成组件、加景深、按节拍编排，再讲一个故事，才像宣传片。项目自带的美术（这里是 20 张身份图）是最有冲击力的素材，第一版完全没用上。
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
