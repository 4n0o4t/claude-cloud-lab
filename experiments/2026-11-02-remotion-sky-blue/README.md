# Remotion 科普短片：天空为什么是蓝色的（含 AI 配音）

- 日期：2026-11-02
- 状态：完成
- 分支：`claude/bold-bell-wrvw3m`

## 问题

在云端容器里，用 Remotion（React 程序化视频）从零做一支科普短片，看 Agent 驱动的 Remotion 工作流实际手感如何：搭建成本、渲染速度、能踩到哪些坑。第二轮加上 AI 配音，验证“旁白时长驱动时间轴”的做法。

## 方法

- 工具：Remotion 4.0.540（`remotion`、`@remotion/cli` 精确锁版本）、React 19、TypeScript、`@fontsource/noto-sans-sc`（中文字体随工程打包，不依赖系统字体）。
- 规格：1920×1080，30fps。第一轮无配音、50 秒；第二轮加配音后约 87 秒（时长由旁白决定）。
- 画面全部由代码绘制（SVG + CSS），没有任何图片、视频素材。
- 6 幕：

| 幕 | 内容 |
| --- | --- |
| Hook | 标题、飘动的云 |
| WhiteLight | 白光经棱镜分成七色，标注波长 |
| Scattering | 蓝/红光波撞上分子，蓝光向四周散射；柱状图展示 (700/450)⁴ ≈ 5.9 倍 |
| WhyNotViolet | 为什么不是紫色：三条原因卡片 |
| Sunset | 太阳从天顶落到地平线，光路穿过大气变长，蓝色粒子沿途散逸，天色变橙 |
| Outro | 总结 |

- 所有动画都是 `useCurrentFrame()` 的纯函数，随机分布用 Remotion 的确定性 `random(seed)`。
- 中文字体分片按 unicode-range 加载，`Root.tsx` 用 `delayRender` 等全部字形加载完再渲染，避免掉字。

### AI 配音（第二轮）

- TTS：[Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)（Apache-2.0，82M 参数，CPU 推理），音色 `zf_001`，语速 1.1。无需任何 API Key。
- 数据流：

```text
narration/zh-CN.json        每句一个稳定 id：scene、at（最早起始帧）、speak（朗读文本）、caption（字幕，可为 null）
        │  tools/tts.py     逐句合成；按“模型+音色+语速+文本”哈希缓存，只重做改过的句子；峰值归一到约 -1 dBFS
        ▼
public/voice/zh-CN/<id>.wav （git 忽略，可重新生成）
src/voice-manifest.json     每句 durationMs（提交，时间轴依赖它）
        │  src/timeline.ts  每句从 max(at, 上一句结束+8 帧) 开始；每幕时长 = max(画面最短时长, 最后一句结束+28 帧)
        ▼
场景的关键动画挂在 beat 上（如“瑞利散射”这句开始时切柱状图、“第一/第二/第三”时逐张出卡片、“傍晚”时太阳开始下落）
```

- 音频用 `@remotion/media` 的 `<Audio>`，每句放在自己的 `<Sequence>` 里。

## 复现

```bash
# 从本目录执行
npm ci
# 生成旁白（需要 TTS 虚拟环境，见 tools/requirements-tts.txt 顶部注释）
source ../../temp/tts-venv/bin/activate && npm run tts
npm run typecheck
npm run studio          # 浏览器里预览、拖时间轴
# 云端容器可复用预装的 headless Chromium，不设置则 Remotion 自动下载浏览器
export REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
npm run render          # 输出到仓库根目录 temp/sky-blue.mp4（被 git 忽略）
```

成片与旁白 wav 都不提交进 git；需要时按上面命令重新生成。换音色：`python tools/tts.py --voice zm_010 --speed 1.1 --force`。

## 结果

- 4 核云端容器上，整片渲染约 1 分 45 秒，输出 H.264 1920×1080 30fps、50.0 秒、约 8.6 MB（`ffprobe` 核验）。
- 从空目录到第一版成片约 20 分钟；之后每轮“改代码 → 渲染 → 抽关键帧检查”约 2 分钟。
- 关键帧自检（ffmpeg 抽 12 帧拼成 contact sheet）抓到的问题，共迭代 4 轮渲染：
  1. **SVG 被背景盖住**：场景里先放 `AbsoluteFill` 天空、再放普通流 `<svg>`，绝对定位元素会画在普通流元素之上，导致云、棱镜、日落图全部不可见。修复：所有图层 SVG 设 `position: absolute`。这是最值得记住的坑——类型检查和渲染都不会报错，只有看画面才发现。
  2. 转场黑场 30 帧偏长，改为首尾各 8 帧。
  3. 光谱标签与光线重叠、贴边；调整布局。
  4. 正午太阳出画/压标题、傍晚太阳落进大气层内；改为太阳始终放在大气层外缘之外。
  5. 字幕“几乎被散射光”有歧义，改为“散射殆尽”。
- 第二轮（配音）：
  - 14 句旁白，Kokoro 在 CPU 上每句约 3–4 秒生成（首次加载模型约 30 秒）。语速 1.0 时旁白共 81.6 秒，调到 1.1 后 76.8 秒；整片 87.2 秒（`ffprobe`：H.264 + AAC 48kHz 立体声），渲染约 2 分 40 秒。
  - Python 端按同样规则算出的总时长 87.17 秒与成片一致，说明两边时间轴逻辑对齐。
  - 音量：`volumedetect` 平均 -19.6 dB、峰值 -0.9 dB，无削波。
  - **ASR 回听自检**：用 faster-whisper `small` 把成片音轨转写回文字，与脚本逐句比对，14 句时间戳都落在计算的 beat 上。差异 4 处：“瑞利→锐利”“殆尽→带进”是同音字；“正午→正乌”“红橙→红尘”经查 Kokoro 的 g2p 拼音（`zheng4 wu3`、`cheng2`）是正确的，判定为 ASR 误听，不改。
  - 关键帧按 beat 时间点抽取，确认画面动作与台词同步。
  - 坑：faster-whisper 搭配新版 PyAV 时 `decode_audio` 报 `metadata_errors` 参数错误，改为用 soundfile 读成 numpy 数组再传入。
  - 音质与自然度**未经人耳评估**：Agent 无法试听，只能用 ASR 转写确认“念对了字”，好不好听待所有者反馈。
- `--browser-executable` 需要指向 `chrome-headless-shell-linux64/chrome-headless-shell`，路径写错时 Remotion 直接报错，不会回退。

## 结论

- 结论：Remotion 在云端容器里开箱可用；加上开源 TTS 后，“旁白脚本 → 逐句音频 → 时长 manifest → 时间轴”整条链在无 GPU、无 API Key 的条件下跑通，改一句旁白只需重做那一句并自动顺延后续画面。Agent 写“确定性的 React 画面 + 时间轴表”很顺手，和泰坦尼克号实验里“状态是时间的纯函数”是同一种思路。真正的质量关卡是**看关键帧**（4 个视觉 bug 都是类型检查和渲染无法发现的）和**ASR 回听**（Agent 自己听不到声音，用转写比对代替）。
- 可信度与局限：只做了纯矢量画面的短片，配音只验证了文字准确与时间对齐，没有人耳评估音质；没有试商业 TTS（ElevenLabs 等）对比、BGM、词级字幕高亮、真实录屏素材、`@remotion/transitions` 等官方包，也没试 Remotion 官方 Agent Skills。科普内容为常识性物理知识，“约 6 倍”按 (700/450)⁴ 计算。
- 后续：可选方向——BGM 与旁白闪避（ducking）；用 whisper 词级时间戳做逐字高亮字幕；用 `@remotion/transitions` 替代手写淡入淡出；做 9:16 竖版布局；把关键帧 contact sheet 做成 `npm run qa` 脚本。
