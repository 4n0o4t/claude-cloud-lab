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

没有找到的：**“Kimi K3 复刻 iOS 系统”的原始出处。** Kimi K3 官方博客和新闻页都没有这个案例。能找到的最接近的内容有两个：

- 开发者用 Kimi K3 复刻 iOS 18 风格天气组件的实测（[80aj](https://www.80aj.com/2026/07/18/kimi3-ios-weather-component/)）；
- 一个标题为 “Kimi Code Agent Swarm built an entire app end to end” 的视频。

在拿到原帖或仓库之前，本文不引用这个案例的任何细节。

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
