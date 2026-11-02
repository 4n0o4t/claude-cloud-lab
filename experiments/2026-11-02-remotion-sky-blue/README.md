# Remotion 科普短片：天空为什么是蓝色的

- 日期：2026-11-02
- 状态：完成
- 分支：`claude/bold-bell-wrvw3m`

## 问题

在云端容器里，用 Remotion（React 程序化视频）从零做一支科普短片，看 Agent 驱动的 Remotion 工作流实际手感如何：搭建成本、渲染速度、能踩到哪些坑。

## 方法

- 工具：Remotion 4.0.540（`remotion`、`@remotion/cli` 精确锁版本）、React 19、TypeScript、`@fontsource/noto-sans-sc`（中文字体随工程打包，不依赖系统字体）。
- 规格：1920×1080，30fps，1500 帧 = 50 秒，无配音，烧入字幕代替旁白。
- 画面全部由代码绘制（SVG + CSS），没有任何图片、视频素材。
- 6 幕，时间轴集中在 `src/Root.tsx` 的 `TIMELINE`：

| 幕 | 帧区间 | 内容 |
| --- | --- | --- |
| Hook | 0–150 | 标题、飘动的云 |
| WhiteLight | 150–420 | 白光经棱镜分成七色，标注波长 |
| Scattering | 420–780 | 蓝/红光波撞上分子，蓝光向四周散射；柱状图展示 (700/450)⁴ ≈ 5.9 倍 |
| WhyNotViolet | 780–1050 | 为什么不是紫色：三条原因卡片 |
| Sunset | 1050–1350 | 太阳从天顶落到地平线，光路穿过大气变长，蓝色粒子沿途散逸，天色变橙 |
| Outro | 1350–1500 | 总结 |

- 所有动画都是 `useCurrentFrame()` 的纯函数，随机分布用 Remotion 的确定性 `random(seed)`。
- 中文字体分片按 unicode-range 加载，`Root.tsx` 用 `delayRender` 等全部字形加载完再渲染，避免掉字。

## 复现

```bash
# 从本目录执行
npm ci
npm run typecheck
npm run studio          # 浏览器里预览、拖时间轴
# 云端容器可复用预装的 headless Chromium，不设置则 Remotion 自动下载浏览器
export REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
npm run render          # 输出到仓库根目录 temp/sky-blue.mp4（被 git 忽略）
```

成片不提交进 git；需要时按上面命令重新生成。

## 结果

- 4 核云端容器上，整片渲染约 1 分 45 秒，输出 H.264 1920×1080 30fps、50.0 秒、约 8.6 MB（`ffprobe` 核验）。
- 从空目录到第一版成片约 20 分钟；之后每轮“改代码 → 渲染 → 抽关键帧检查”约 2 分钟。
- 关键帧自检（ffmpeg 抽 12 帧拼成 contact sheet）抓到的问题，共迭代 4 轮渲染：
  1. **SVG 被背景盖住**：场景里先放 `AbsoluteFill` 天空、再放普通流 `<svg>`，绝对定位元素会画在普通流元素之上，导致云、棱镜、日落图全部不可见。修复：所有图层 SVG 设 `position: absolute`。这是最值得记住的坑——类型检查和渲染都不会报错，只有看画面才发现。
  2. 转场黑场 30 帧偏长，改为首尾各 8 帧。
  3. 光谱标签与光线重叠、贴边；调整布局。
  4. 正午太阳出画/压标题、傍晚太阳落进大气层内；改为太阳始终放在大气层外缘之外。
  5. 字幕“几乎被散射光”有歧义，改为“散射殆尽”。
- `--browser-executable` 需要指向 `chrome-headless-shell-linux64/chrome-headless-shell`，路径写错时 Remotion 直接报错，不会回退。

## 结论

- 结论：Remotion 在云端容器里开箱可用，Agent 写“确定性的 React 画面 + 时间轴表”很顺手，和泰坦尼克号实验里“状态是时间的纯函数”是同一种思路。真正的质量关卡是**看关键帧**——本次 4 个视觉 bug 都是类型检查和渲染无法发现的。
- 可信度与局限：只做了无声、纯矢量画面的短片；没有试配音（TTS）、字幕时间轴对齐、真实录屏素材、`@remotion/transitions` 等官方包，也没试 Remotion 官方 Agent Skills。科普内容为常识性物理知识，“约 6 倍”按 (700/450)⁴ 计算。
- 后续：可选方向——加 TTS 旁白并让旁白时长驱动时间轴；用 `@remotion/transitions` 替代手写淡入淡出；做 9:16 竖版布局；把关键帧 contact sheet 做成 `npm run qa` 脚本。
