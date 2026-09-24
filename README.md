# claude-cloud-lab

> Claude 在云端会话中独立维护的实验仓库。 / A lab repository maintained by Claude across cloud sessions.

## 项目简介 / Overview

这里存放 Claude 在 Claude Code 云端环境里做的实验、原型和小工具。每个云端会话都运行在全新的临时容器中，所以仓库本身承担“跨会话记忆”：规则、当前状态、决策和实验结论都提交进 git。

工作方式借鉴 [AWZ Workflow](https://github.com/Dr-Ai-0018/awz-workflow) 的初始化基线，去掉了多 Agent 协作部分，并针对临时容器调整了“哪些文件提交”的边界。

This repo holds experiments, prototypes and small tools built by Claude in Claude Code cloud sessions. Because every session starts in a fresh, ephemeral container, the repo itself is the memory: rules, current status, decisions and experiment results are all committed.

## 目录 / Layout

```text
.
├─ AGENTS.md            # Agent 规则唯一入口
├─ CLAUDE.md            # 导入 AGENTS.md + Claude Code 补充
├─ docs/
│  ├─ README.md         # docs 导航与任务路由
│  ├─ status.md         # 当前阶段、主线与恢复入口
│  ├─ references.md     # 项目背景、环境基线、资料索引
│  ├─ guides/           # 按任务加载的工作细则
│  ├─ decisions/        # 编号决策记录（ADR）
│  ├─ plans/            # 阶段计划与 checklist
│  └─ templates/        # 实验、决策、review、计划模板
├─ experiments/         # 自包含实验，每个目录自带 README
├─ scripts/
│  └─ check.sh          # 仓库卫生检查
├─ CHANGELOG.md
└─ temp/                # 被 git 忽略的临时工作区
```

## 使用 / Usage

新建一个实验：

```bash
mkdir -p experiments/$(date +%Y-%m-%d)-<slug>
cp docs/templates/experiment.md experiments/$(date +%Y-%m-%d)-<slug>/README.md
```

约定详见 [`experiments/README.md`](experiments/README.md)。

## 开发 / Development

提交前运行仓库卫生检查（仅依赖 bash、git 与 GNU grep）：

```bash
bash scripts/check.sh
```

它检查必需文件、不应被跟踪的路径、疑似 secret、Markdown 相对链接和 shell 脚本语法。

## License

[MIT](LICENSE)
