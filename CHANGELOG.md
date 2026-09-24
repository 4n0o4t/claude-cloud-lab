# Changelog

本文件记录仓库层面值得回看的变更；单个实验的细节写在各自目录的 README。

格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

### Added

- 借鉴 AWZ Workflow 初始化仓库基线：`AGENTS.md` / `CLAUDE.md` 规则入口、`docs/` 状态与决策、guides、模板、`.gitignore`、`.gitattributes`、`.editorconfig`、`.env.example`、MIT License。
- `experiments/` 目录约定与实验模板。
- `projects/` 长期子项目目录约定与子项目模板；`scripts/check.sh` 检查每个实验和子项目目录都有 README（#2）。
- `scripts/check.sh` 仓库卫生检查：必需文件、禁止跟踪路径、疑似 secret、Markdown 相对链接、shell 语法。
- GitHub Actions `check` 工作流：每个 PR 与合并进 `main` 时自动运行 `scripts/check.sh`。
