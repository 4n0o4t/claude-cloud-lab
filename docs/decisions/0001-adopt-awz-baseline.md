# 0001. 借鉴 AWZ Workflow 初始化基线并按云端单人仓库裁剪

- 日期：2026-09-24
- 状态：accepted

## 背景

仓库所有者要求参考 [AWZ Workflow](https://github.com/Dr-Ai-0018/awz-workflow)（v0.3.0，commit `bdeb796`）的初始化结果搭建本仓库，并明确：不需要多人/多 Agent 协作，仓库由 Claude 全权负责。

实际运行 AWZ 的 `scripts/init-project.sh --mode new` 生成了参考产物，其中两类前提与本仓库不符：

1. AWZ 假设有持久的本机：`AGENTS.md`、`CLAUDE.md`、`docs/`、`temp/` 全部 git-ignored，只存在于开发者电脑上。本仓库运行在 Claude Code 云端**临时容器**里，ignored 文件会随容器回收消失。
2. AWZ 面向多 Agent 协作：owner 表、append-only room ledger、handoff、collaboration 策略，以及位于业务项目之外的机器级 Reference Library。

## 选项

1. 原样套用 AWZ 初始化结果。
2. 保留 AWZ 的规则体系、guide 和模板，按单人 + 临时容器裁剪。
3. 不借鉴，从零写一套。

## 决策

选择：方案 2。

保留：

- `AGENTS.md` 作为唯一规则入口，`CLAUDE.md` 通过 `@AGENTS.md` 导入；
- 探测 → 必要沉淀 → 主 checklist → 实现的启动顺序，以及语义边界收口；
- `status.md` 作为唯一可变状态源、`references`（环境基线 + 资料索引）；
- 验证分级（V0–V3）、review 优先级（P0–P3）、安全与阻塞规则；
- 代码架构与前端 guide；decision / review / plan 模板；
- `.gitignore`、`.env.example`、MIT License、`type: 中文概括` commit 风格。

调整：

- `AGENTS.md`、`CLAUDE.md`、`docs/` **提交进 git**，作为跨会话记忆；只有 `temp/` 保持 ignored。
- AWZ 的 `agent-room/` 子目录扁平化为 `docs/`：`status.md`、`references.md`、`guides/`、`decisions/`、`plans/`、`templates/`。
- `.claude/` 不整体忽略，只忽略 `settings.local.json`，以便日后提交项目级 `.claude/settings.json`（如 SessionStart hook）。
- commit 保留 Claude Code 的署名 trailer，而不是遵循 AWZ 的“禁止 AI attribution”。本仓库作者就是 Claude，如实署名更诚实；这也是云端会话的既定要求。
- 新增 `experiments/` 目录约定和 `scripts/check.sh`，把 AWZ “初始化后验证”的人工清单变成可执行检查。

移除：

- room ledger、owner 表、collaboration guide、handoff 模板（单一维护者；会话间交接由 `status.md` 承担）；
- Reference Library 与 `.awz/references.json`（没有持久本机可放外部 clone）；
- Windows 专用内容（Everything 文件搜索、PowerShell/BAT 入口）；
- release checklist 模板（仓库整体不发版，需要时再加）。

## 影响

- 正向影响：新会话能从已提交的 `AGENTS.md` → `status.md` 快速恢复；规则与 AWZ 保持同源，日后可对照上游更新。
- 风险：`docs/` 公开可见，不能写入任何私密信息——与 `.env` 规则一起由 `scripts/check.sh` 的 secret 扫描兜底。
- 后续还债：若仓库规模增长，再评估 CI、release checklist 与 AWZ 上游变更的同步方式。

## 验证方式

- `bash scripts/check.sh` 通过；
- `git status --short --ignored` 确认只有 `temp/` 等预期路径被忽略。
