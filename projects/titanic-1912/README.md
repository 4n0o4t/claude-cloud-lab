# Titanic, April 1912

> 一部约 5 分钟、纯 Three.js 程序化生成的泰坦尼克号沉没实时动画短片：原始单文件 HTML 与模块化还原工程。

- 状态：可用（收录存档，不做功能开发）
- 来源：由 [`experiments/2026-09-24-threejs-titanic`](../../experiments/2026-09-24-threejs-titanic/README.md) 毕业
- 关联 Issue：无（仓库所有者在会话中直接派发）

## 来源与授权

| 部分 | 路径 | 来源 |
| --- | --- | --- |
| 原始单文件 | `original/titanic.html` | 群聊分享的原始作品，逐字节未改动 |
| 还原工程 | `source/` | 仓库所有者的姐姐按原文件里的 `// ==== FILE: src/... ====` 标记拆成的 Vite 工程；`source/README.md` 是其原版说明 |

- **出处**：原作公开部署在 <https://titanic-opus-5-2.vercel.app/>，作者未知；群聊里的文件是朋友转发的副本。
- **收录决定（已定，不再追问）**：2026-09-24，仓库所有者决定保留收录，并把仓库转为私有，仅作个人学习研究。后续会话不再就授权问题追问所有者。
- **许可证**：原作者没有指定许可证。本目录内容**不适用**仓库根目录的 MIT License，版权归原作者。
- **不在本目录的第三方资源**：
  - Three.js 0.160.0（MIT，通过 npm 或 CDN 获取）；
  - Google Fonts；
  - tonejs-instruments 乐器采样（运行时从 jsDelivr 加载）。
- 配乐中的赞美诗 “Nearer, My God, to Thee”（1856）属于公有领域；源码注释声明配乐没有引用或模仿任何受版权保护的电影音乐。

文件指纹（sha256 前 16 位），与实验阶段研究的是同一份文件：

| 文件 | 指纹 |
| --- | --- |
| `original/titanic.html` | `0fe5e9d0c46e1e9d` |
| 还原工程原始 zip（未提交，含 `dist/`） | `cad4a16de915d1a3` |

原始 HTML 使用 CRLF 换行。`original/.gitattributes` 关掉了这个文件的换行归一化，所以检出后的文件与上表指纹逐字节一致。

## 用途

- 存档一部完成度很高的 WebGL 程序化短片，作为学习 Three.js、着色器、Web Audio 和“时间轴驱动”架构的参考样本。
- 这部片子怎么组织、怎么运行、为什么任意时刻都能跳转，分析见来源实验的 README。

## 运行

**原始单文件**：它需要通过 HTTP 托管（ES module 不支持 `file://`），并从 CDN 加载 Three.js：

```bash
# 从本目录执行
python3 -m http.server 8080 --directory original
# 打开 http://127.0.0.1:8080/titanic.html
```

**还原工程**：需要 Node.js 18 以上。

```bash
cd source
npm ci
npm run dev        # 开发服务器，默认 http://127.0.0.1:5173/
npm run build      # 生成 dist/（被 git 忽略）
npm run preview
```

常用 URL 参数，完整列表见 `source/README.md`：

| 参数 | 作用 |
| --- | --- |
| `?t=214&freeze=1` | 定格在故事第 214 秒 |
| `?autoplay=1&synth=1` | 不等开场点击直接播放，使用合成乐器 |
| `?q=low&nowarm=1` | 低画质，跳过着色器预热，适合软件 WebGL |
| `?hideui=1` | 隐藏界面覆盖层 |

## 验证

```bash
cd source && npm ci && npm run build
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
# 浏览器打开：
#   http://127.0.0.1:8765/?autoplay=1&synth=1&nowarm=1&q=low&t=214&freeze=1&hideui=1
# 预期：银河下竖立的船尾和前景救生艇，控制台里 TT.errors 为 []
```

2026-09-24 收录时的验证：

- 从提交的文件树（不含 `dist/`）干净复制出一份，`npm ci && npm run build` 成功。Vite 只提示单个 chunk 超过 500 kB。
- 容器内无头 Chromium（Playwright 1.56.1，SwiftShader 软件 WebGL，960×540）打开新构建的 `dist/`，定格 t=214，画面正常，`TT.errors` 为空。
- 更完整的 8 个时间点截图和逐模块对比记录在来源实验里。

## 结构

```text
.
├─ README.md               # 本文件：来源、授权、运行与验证
├─ original/
│  ├─ .gitattributes       # 关闭 titanic.html 的换行归一化
│  └─ titanic.html         # 原始单文件（约 906 KB，CRLF）
└─ source/                 # 还原的 Vite + Three.js 0.160.0 工程
   ├─ README.md            # 还原者的原版说明（英文）
   ├─ index.html
   ├─ package.json / package-lock.json
   └─ src/                 # 00_core … 90_main 共 12 个模块，外加 main.js 与 style.css
```

## 已知限制与后续

- 没有在真实 GPU 上验证画质和帧率，也没有完整播放 5 分钟、录音验证声音。
- 原作者署名待补充：作者希望如何署名、是否要附带具体许可证，确认后更新本 README。
- 可以从中挑单个技巧（Gerstner 波海面、可跳转的解析式粒子、真实星空）另开实验复刻。
