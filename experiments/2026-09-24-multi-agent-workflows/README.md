# 从 AI 自组织大项目提炼多 Agent 工作流

- 日期：2026-09-24
- 状态：完成（调研与提炼）；候选规则待所有者决定是否采纳
- 分支：`claude/cloud-lab-xxzzta`

## 问题

泰坦尼克号短片、Kimi Agent Swarm 这类“AI 分工完成大项目”的案例里，哪些做法能抽象成本仓库可用的工作流和规则？哪些不适合我们？

## 方法

按证据强度分三层阅读：

1. **一手源码**：`projects/titanic-1912/source/src/`。这是唯一能直接读到的多 Agent 产物，结论全部来自代码本身。
2. **官方文档**：
   - [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)；
   - [Kimi Agent Swarm 帮助文档](https://github.com/MoonshotAI/kimi-help-center/blob/master/en-US/agent/swarm.md)。
3. **社区文章**：[契约式设计（contract-based design）](https://dev.to/akshatsoni26/contract-based-design-how-i-make-ai-agents-work-faster-without-breaking-each-other-1jn2)。

“Kimi 复刻苹果系统”案例：网络搜索没有找到出处，Kimi K3 官方博客和新闻页都没有提到。后来仓库所有者提供了作品地址 <https://macos27.kimi.page/> 和作者原帖，复刻的其实是 **macOS** 而不是 iOS。分析见下方 E 节。

## 结果

### A. 泰坦尼克号的协作骨架（源码中的事实）

| 做法 | 源码证据 |
| --- | --- |
| 契约先行 | `00_core.js` 写死世界约定：1 单位 = 1 米，+Y 向上，海平面 y = 0；船体局部坐标 +X 指船头、+Z 指右舷；罗盘方向映射。船体尺寸统一放在 `TT.CONST.SHIP`。`70_director.js` 注释引用 “see CONTRACT.md” |
| 一文件一 owner | 每个模块头注释标 `Owner: sky agent` / `ocean agent` / `ship agent` 等；共享部分（`00_core`、`10_story`、`90_main`）都标 `Owner: integration` |
| 单一共享状态 | `TT.S` 是故事时间 t 的纯函数，各模块每帧只读它 |
| 显式公开接口 | 例如 `45_props.js` 声明 “Public API: TT.props.iceberg, boatWorld(i, target), carpathia” |
| 插件式注册 | `TT.register(name, { order, init, update, resize })`：集成方只按 `order` 调生命周期，不关心模块内部 |
| 验证入口内建 | `TT.errors` 收集所有模块错误；URL 参数 `?t=…&freeze=1&debug=1&q=low&nowarm=1` 可以定格任意时刻 |
| 降级而不崩溃 | 乐器采样失败时退回合成乐器，字体失败时回退系统字体；`TT.emit` 对每个监听器单独 `try/catch` |
| 机械化集成 | HTML 模板用 `<!--HEAD-->` / `<!--BODY-->` 标出槽位，Three.js 的导入集中在 “template's import block” 里 |

### B. 官方与社区工作流要点

**Claude Code agent teams**：

- 结构：一个 lead 加若干 teammates，共享一份带依赖关系的任务列表，领取任务时用文件锁防止抢同一个。
- 规模建议：从 3–5 个 teammate 开始，每人 5–6 个任务。
- 官方原话要点：“两个 teammate 改同一个文件会互相覆盖”，所以要按文件划分所有权；新手先从 research / review 开始。
- 可以用 `TaskCompleted`、`TeammateIdle` 这类 hook 做质量门。
- token 成本随人数线性增长。
- 目前是实验功能，需要设置 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`。

**Kimi Agent Swarm**：

- 编排者按任务临时“雇佣”角色，不预设角色；上限 300 个子 agent、4,000 步。
- 每个子 agent 各记自己的“笔记本”（context sharding）。
- 训练时的奖励同时看三样：结果质量、真实并行度、子任务完成率。
- 官方明确说明它比普通任务消耗多得多的额度；最适合大范围检索、批量处理和长文写作。

**契约式设计**：

1. 先由一个 agent 读需求，产出每个组件的契约（输入、输出、边界）；
2. 多个 agent 按契约并行实现，彼此不直接依赖；
3. 最后由一个校验 agent 对照契约检查产出。

核心是让 agent 耦合到数据上，而不是耦合到彼此身上。

### C. 抽象出的共同模式

1. **契约先于并行**：共享约定（单位、坐标、命名）和接口在开工前写死，并行期间不改。
2. **所有权按文件切**：一个文件只归一个 agent；共享核心（入口、共享状态、配置）只归集成方。
3. **通过数据耦合，不通过对话耦合**：模块之间只经共享状态和显式 API 交互。
4. **验证入口先设计**：输出可确定、可定格、可采样，集成后才能快速验收。
5. **集成是独立角色**：最后必须有一步“对照契约核对”，而不是简单拼起来就算完。
6. **并行有成本**：只有子任务真正独立时才划算；两家官方文档都强调了额外的 token 和额度开销。

### D. 与本仓库的差异

- ADR 0001 删掉的是 AWZ 的**跨会话、多人**协作机制（owner 表、room ledger、handoff）。这里讨论的是**会话内**并行：由一个 lead（当前会话）派出短命的子 agent，会话结束就全部收回。两者不冲突，但重新引入“多 Agent”概念，应该用新的 ADR 写清楚这层关系。
- 本仓库多数任务规模很小，默认并行弊大于利。
- 云端会话可用 Agent 工具（subagent，可用 worktree 隔离）。agent teams 需要额外的实验开关，当前环境未确认启用。

### E. 案例二：macOS 27 网页复刻（Kimi 托管页面）

材料：仓库所有者提供的 <https://macos27.kimi.page/>。下载了 `index.html` 和打包后的 JS（约 2.4 MB）、CSS（约 84 KB），只放在被忽略的 `temp/macos27/` 里分析，不提交。

**怎么还原出结构的**：线上没有 sourcemap（`.map` 返回 404）。但每个 JSX 元素都带着 `"code-path":"src/…:行:列"` 属性（例如 `src/os/MacOS.tsx:183:29`），这很可能是平台为“点选定位源码”注入的。据此还原出 98 个 `.tsx` 源文件的路径。每个文件取出现过的最大行号相加，约 3.3 万行；这只是下限，不含纯 TS 的 store 和工具文件。

**技术栈**（打包产物中可以看到）：React 19.2.3、zustand（含 persist 中间件）、lucide 图标、Vite。

**目录即分工**：

```text
src/
├─ main.tsx, App.tsx
├─ os/MacOS.tsx                # 系统外壳：开机、锁屏、睡眠、关机状态
├─ os/components/              # 22 个外壳组件：Dock、MenuBar、WindowFrame、WindowManager、
│                              #   Spotlight、ControlCenter、NotificationCenter、MissionControl……
└─ apps/<分类>/<应用>/         # 约 45 个应用，一个应用一个目录
   ├─ communication/ facetime, mail, messages, phone, shared/
   ├─ internet/      safari（12 个文件 + sites/ 8 个仿站）, maps, stocks, weather
   ├─ media/         music, photos, photobooth, podcasts, quicktime, tv, voicememos
   ├─ productivity/  calendar, contacts, freeform, notes, reminders, stickies, textedit
   ├─ system/        settings（6 个文件）, terminal, appstore, activitymonitor, diskutility
   └─ utilities/     calculator, chess, clock, dictionary, games, home, news, preview
```

**应用之间的契约**：

| 契约 | 证据 |
| --- | --- |
| 统一应用注册表 | 37 条形如 `{ id, name, icon: { from, to, glyph }, component, defaultSize: { w, h } }` 的记录；外壳只认这个结构 |
| 每个应用独立的持久化命名空间 | zustand persist 的 `name: "macos27:app:<id>"`，带 `version` 和 `migrate`；共 32 个，互不共享状态 |
| 外壳与应用之间的事件频道 | `macos27:<app>:menu` / `nav` / `pane` 这类命名频道（menu 8 个、nav 11 个、pane 15 个） |
| 分类内共享 UI | `communication/shared/ui.tsx`、`media/utils.tsx`、`settings/shared.tsx`，共享范围限定在分类内部 |

**运行**：页面自身在容器 Chromium 里有证书问题（代理 CA 不受信任，按环境规则不关 TLS 校验），改为本地托管下载的副本，1440×900 截图。能看到菜单栏、Finder 窗口（侧栏、图标视图、状态栏）、日历、天气、股票小组件和完整 Dock，`pageerror` 为空。

**原帖与过程证据**（仓库所有者提供原帖链接后补充，数据通过 fxtwitter API 读取）：

- 作者 Max Weinbach（@mweinbach）。
- 2026-07-16 18:49 UTC 发帖（[原帖](https://x.com/mweinbach/status/2077827886149439547)）：“I asked a Kimi K3 Max agent swarm to recreate macOS 27 with real Liquid Glass and native apps in web browser and it's been going for 3 hours”。
- 同日 22:09 UTC 发[完成帖](https://x.com/mweinbach/status/2077878247920951400)：“It finally finished … Used 60% of my monthly Kimi usage on it”。
- **耗时**：媒体普遍报道“约 3 小时 20 分”，这是两条帖子的间隔；但第一条帖子发出时已经跑了 3 小时，总耗时应该在 6 小时以上。这是推断，没有精确的开始时间。
- **第一条帖子附带的运行截图**（手机上的 Kimi App，状态栏时间 2:48，与发帖时间 18:49 UTC 按美东时间吻合）：
  - 顶部显示 “Kimi K3 Swarm · Max”“Agent Swarm | 3 agents running”：**当时只有 3 个 agent 在运行**，不是几百个。
  - 主 agent 自己在做**集成补丁**：“Now applying all three integration patches (Spotlight providers, real-data widgets, real calendar boot alerts)”。步骤包括 “Patch search.ts and MacO…”“Rewire Calendar Reminders Stocks Widgets to R…”“Rewire widgets to real app…”“Apply Code Patches and Remove Demo Mail Blo…”。
  - 然后是**构建通过才提交**：“Integration patches built green. Committing, then waiting for the final three builders.”，步骤名是 “Commit Integration Fixes on Final-Build …”，随后显示 “Waiting for agent message”。

从截图可以读出的工作流：

1. 子 agent 被称为 **builder**，各自建模块；主 agent 负责集成，并通过消息等待 builder 交付。
2. **先占位、后接线**：模块先用演示数据（demo）独立做完；集成阶段由主 agent 把小组件、Spotlight 这些跨模块功能改接到真实的应用数据上，同时删掉演示占位。
3. **跨模块改动归主 agent**：Spotlight 的搜索来源、桌面小组件这类需要读多个应用数据的地方，由主 agent 亲自打补丁，而不是交给某个 builder。
4. **构建通过是提交的前提**，并且在一个 Final-Build 分支上用 git 提交。
5. 这张截图只是一个时刻，不代表全程的并发数；swarm 在整个过程中最多用了多少 agent，仍然未知。

**局限**：

- 打包产物本身没有多 agent 的痕迹。使用了 agent swarm 这一点来自作者本人的原帖和截图，具体分工只能从截图里的只言片语推断。
- 没有逐个试用 45 个应用。
- 行数统计是下限。

**对本调研的补充**：它把泰坦尼克号的“一文件一 owner”放大成了“**一目录一 owner**”；并且用“注册表 + 独立状态命名空间 + 命名事件频道”三件套，让几十个应用互不干扰。这种形态的项目最适合大规模并行：外壳由集成方负责，应用可以分给任意多个 agent。

## 结论

- 结论：泰坦尼克号的结构，和官方、社区给出的做法高度一致，都是“契约 + 文件所有权 + 共享状态 + 集成核对”。这套骨架可以直接借鉴；Kimi 那种数百 agent 的规模不适合本仓库。
- 可信度与局限：
  - 泰坦尼克号部分证据最强，直接读自源码；它“由多 Agent 编写”仍然只是根据注释的推断。
  - Kimi 部分只来自官方帮助文档，没有看到真实项目的产物。
  - iOS 复刻案例没有找到出处。
- 后续：见下方候选规则与试点。

### 候选规则（尚未采纳）

| # | 规则 |
| --- | --- |
| R1 | **触发条件**：任务能拆成 3 个以上独立、可按文件划分的块，且单会话难以装下时，才考虑并行；否则单会话完成 |
| R2 | **契约先行**：并行前在 `docs/plans/<日期>-<slug>.md` 写“契约”一节，包括共享约定、共享状态与接口签名、文件所有权表、禁止改动区 |
| R3 | **一文件一 owner**：共享核心只归 lead；子 agent 越界修改视为集成失败 |
| R4 | **子 agent 自检**：交付时附上自己跑过的验证命令和结果；lead 集成后再跑整体验证 |
| R5 | **验证入口进契约**：可确定、可定格的调试入口（类似 `?t=&freeze=1`）写进契约，作为验收手段 |
| R6 | **规模上限**：默认 2–4 个子 agent；子 agent 只拿契约和自己的任务，不拿完整对话 |
| R7 | **收口核对**：lead 按契约逐项核对接口和所有权有没有越界，再走常规的 `scripts/check.sh` 与 PR 流程 |
| R8 | **可插拔三件套**（来自 macOS 27）：模块数量多时，契约里固定注册表结构、每个模块独立的状态命名空间、命名事件频道，子 agent 只能通过这三者和外壳交互 |
| R9 | **所有权粒度可以放大到目录**：一个子 agent 负责一个目录；共享代码只能放在“分类内 shared”或外壳里，并且写明归属 |
| R10 | **先占位、后接线**（来自 macOS 27 原帖截图）：子 agent 对其他模块的依赖一律用契约里约定的占位数据；跨模块接线（搜索、小组件这类读多个模块数据的地方）留给 lead 在集成阶段统一完成，每轮集成构建通过才提交 |

可能的落地方式（普通 PR 与规则类 PR 分开）：

- 普通 PR：在 docs/guides 下新增 `multi-agent.md`，在 docs/templates 下新增契约模板 `contract.md`，并在 `docs/README.md` 的任务路由里加一行入口。
- 规则类 PR：新增 ADR 0003，说明“会话内并行”与 ADR 0001 的关系。需要人工合并。
- `AGENTS.md` 暂不加硬规则，试点验证后再决定。

### 试点建议

用“迷你版泰坦尼克号”做第一个试点：

1. lead 写契约：时间轴、共享状态 `S(t)`、坐标约定、文件所有权；
2. 3 个子 agent 分别写海面、船、声音；
3. lead 集成，定格几个时间点截图验收。

评估这几项：

- 契约够不够用；
- 集成时的返工量；
- 耗时和 token 开销；
- 与单会话直接写相比，哪个更好。
