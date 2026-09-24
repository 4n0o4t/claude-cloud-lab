# Three.js 泰坦尼克号动画拆解

- 日期：2026-09-24
- 状态：完成（第一轮阅读与运行验证）
- 分支：`claude/loving-cray-nspzwi`

## 问题

一个约 16,000 行、单个 HTML 文件的 Three.js 实时动画短片《Titanic, April 1912》是怎么组织起来的？仓库所有者的姐姐把它拆成了 Vite 工程，这份还原是否忠实、能否运行？

## 材料与版权说明

- 原始文件：单个 HTML（约 906 KB），由仓库所有者从群聊获得，**原作者与许可证未知**。
- 还原工程：仓库所有者的姐姐按原文件中的 `// ==== FILE: src/... ====` 标记拆成 Vite + Three.js 0.160.0 工程（zip 约 723 KB）。
- 两份文件都**没有提交**进本仓库，只放在被忽略的 `temp/titanic/` 中研究；本目录只记录 Claude 自己的分析。来源确认、得到授权之前不要提交原始代码或截图。
- 文件指纹（sha256 前 16 位）：原始 HTML `0fe5e9d0c46e1e9d`，还原 zip `cad4a16de915d1a3`。
- **更新（2026-09-24 稍晚）**：仓库所有者确认作者朋友已授权公开。原始 HTML 与还原工程（不含 `dist/`）已收录到 [`projects/titanic-1912/`](../../projects/titanic-1912/README.md)，重新下载的两份文件指纹与上面一致。

## 方法

1. 按 `FILE` 标记把原始 HTML 切成 12 段，逐段与还原工程 `src/*.js` 对比（忽略行尾 CRLF）。
2. 扫描外部请求与敏感 API：`eval`、`new Function`、cookie、`XMLHttpRequest`、`WebSocket`、`sendBeacon`。
3. 用 `python3 -m http.server` 托管还原工程自带的 `dist/`，在容器内无头 Chromium（Playwright 1.56，SwiftShader 软件 WebGL，960×540，`q=low`）里定格 8 个故事时间点截图，并读取 `TT.errors`。

## 复现

```bash
# 前提：把两份文件放进 temp/titanic/（原始 HTML 命名为 original.html，zip 解压出 titanic-source/）
cd temp/titanic
python3 -m http.server 8765 --bind 127.0.0.1 --directory titanic-source/dist &
# 浏览器打开：
#   http://127.0.0.1:8765/?autoplay=1&synth=1&nowarm=1&q=low&t=214&freeze=1
```

`t` 是故事秒数，`freeze=1` 定格。其他调试参数见还原工程 README。

## 结果

### 还原忠实度

| 模块 | 与原始片段的差异 |
| --- | --- |
| `10_story` … `90_main`（11 个） | 0 行 |
| `00_core` | 开头多出 Three.js 与 16 个 addons 的 `import`（原文件在前一个 `<script type="module">` 里），末尾多一行 `export { TT, THREE, ADDONS }` |

其余模块只在开头多了一行 `import { TT, THREE, ADDONS } from './00_core.js'`。结论：**这是纯粹的模块化拆分，没有改动任何逻辑**。

### 外部依赖与安全

- 网络请求只有三类：
  - Three.js 0.160.0 和 addons（jsDelivr CDN；还原工程的 `dist/` 已经把它打包进来）；
  - Google Fonts；
  - tonejs-instruments 的乐器采样 MP3（jsDelivr）。
- 采样加载失败时，自动退回合成乐器。
- 唯一的存储是 `localStorage` 里 `tt.` 前缀的播放设置；没有 eval、cookie、XHR 或 WebSocket。

### 运行

8 个时间点全部渲染成功，`TT.errors` 为空。唯一的控制台错误是 Google Fonts 在容器代理下证书不受信，字体按设计回退。

| t（秒） | 截图里实际看到的内容 |
| --- | --- |
| 10 | 银河下的片头标题 “TITANIC”，远处海平线上一艘亮灯的小船 |
| 40 | 灯火通明的甲板和烟囱近景，字幕 “2,224 passengers and crew are aboard.” |
| 75 | 冰山贴着右舷擦过的近景，左下角时间 “11:40 P.M.” |
| 140 | 甲板上方浮出马可尼无线电报单（1:40 a.m.，发往 All stations） |
| 185 | 远景：船头下沉，船头附近腾起水花和烟雾，船上的灯在海面拖出长条倒影 |
| 214 | 船尾竖直立在海面上，前景是救生艇，背景是银河 |
| 250 | 深海里下沉的船体剪影，右侧深度计显示 3,167 m |
| 275 | 粉色黎明，冰山、卡帕西亚号和漂浮的残骸，字幕 “… 705 people are saved.” |

### 结构要点

整部片子是一个 305 秒的时间轴，所有模块每帧都从同一个故事状态读数据：

- **`10_story`**：定义命名事件（撞击 74 s、断裂 195–201 s、船尾消失 221.5 s、黎明 262 s……）、12 个章节和字幕。
- **`TT.S`**：把故事状态写成时间 `t` 的**纯函数**。所以任意时刻都能直接跳转、定格，不需要从头播放。上面的截图方法就靠这一点。
- **全程程序化**：没有任何 3D 模型文件，船体、冰山、救生艇、海床都由代码生成。
  - 船在断裂点被分成船头、船尾两个刚体，各自按时间摆位。
  - 断口靠着色器 `discard` 逐渐“撕开”。
- **海面**：跟随相机的径向网格叠加 Gerstner 波，再加开尔文尾迹、平面反射，以及水下的 Snell 窗效果。
- **天空**：按 1912 年 4 月 15 日凌晨、沉船位置的真实星空摆放亮星和银河。
- **粒子**：烟、蒸汽、火箭、气泡等都是 GPU 实例化公告板，位置是 `(t - 出生时间)` 的解析函数。所以也能随意跳转。
- **声音全部实时生成**：
  - `55_score` 把原创配乐和公有领域赞美诗 “Nearer, My God, to Thee”（1856）写成音符数据；
  - `50_audio` 在 Web Audio 时钟上提前排好每个音，并生成混响。
- **镜头**：`70_director` 把每个镜头写成时间的函数，统一 2.39:1 宽银幕画幅，只在混乱场面加手持抖动。

### 它是怎么被做出来的

各模块头注释写着 `Owner: sky agent`、`ocean agent`、`ship agent`、`props agent`、`fx agent`、`director agent`、`ui agent`、`integration`，还引用了一个不在文件里的 `CONTRACT.md`，并提到 “the template's import block”。

据此推断：它很可能是**多个 AI Agent 分模块并行编写**，再由集成方按模板拼成单个 HTML。模块之间只通过共享命名空间 `TT`、`TT.register(name, …)` 和故事状态 `TT.S` 交互，这正是多 Agent 协作时常用的“契约 + 分工”结构。

## 结论

- 结论：
  - 还原工程忠实于原文件，可直接运行。
  - 原作是结构清晰的纯程序化实时短片，核心设计是“故事状态是时间的纯函数”。
- 可信度与局限：
  - 只在软件 WebGL、低画质下定格了 8 帧，没有完整播放 5 分钟，也没有在真实 GPU 上验证画质和性能。
  - 声音只从代码层面确认了机制，没有录音验证。
  - “多 Agent 编写”是根据注释做的推断。
- 后续：
  - ~~来源确认并获得许可后，再考虑把还原工程作为子项目收录。~~ 已完成，见 `projects/titanic-1912/`。
  - 可以挑一个模块（例如海面或星空）单独做小实验，复刻其中的技巧。
