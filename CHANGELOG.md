# Changelog

本文件记录仓库层面值得回看的变更；单个实验的细节写在各自目录的 README。

格式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

### Added

- `docs/diary/` 按天的工作日记目录与约定。
- 实验 `experiments/2026-09-24-threejs-titanic/`：拆解单文件 Three.js 泰坦尼克号动画。
- 第一个子项目 `projects/titanic-1912/`：收录 Three.js 泰坦尼克号短片的原始单文件与模块化还原工程。
- 实验 `experiments/2026-09-24-multi-agent-workflows/`：多 Agent 工作流调研（含 macOS 27 复刻案例），提出候选规则 R1–R10，尚未采纳。
- 实验 `experiments/2026-11-02-remotion-sky-blue/`：用 Remotion 制作科普短片《天空为什么是蓝色的》，并用开源 Kokoro TTS 加中文配音，旁白时长驱动时间轴；对比 Gemini 3.8 Flash TTS；按官方 Remotion Agent Skills 做了日落 3D 精修版。
- 实验 `experiments/2026-11-03-wolfai-promo/`：给所有者的 wolfai-killer（月夜狼人杀）做 41.6 秒横屏宣传片；本地假 LLM 接口驱动剧本局，Playwright 录真实界面，Remotion 合成镜头、字幕、旁白与配乐。
- 同一实验第二版 `WolfTrailer`：拆界面组件 + 3D 景深 + 动态大字 + 节拍卡点重做宣传片（43.2 秒），新增高清截图采集、素材整理和节拍配乐脚本。

### Changed

- `docs/references.md` 环境基线于 2026-11-02 重新核验（Python 3.13、uv 0.11、Node 22.23 等）。

## [0.1.0] - 2026-09-24

仓库基线里程碑：规则、目录约定、检查脚本、CI 与分级托管全部就位。

### Added

- 借鉴 AWZ Workflow 初始化仓库基线：`AGENTS.md` / `CLAUDE.md` 规则入口、`docs/` 状态与决策、guides、模板、`.gitignore`、`.gitattributes`、`.editorconfig`、`.env.example`、MIT License。
- `experiments/` 目录约定与实验模板。
- `projects/` 长期子项目目录约定与子项目模板；`scripts/check.sh` 检查每个实验和子项目目录都有 README（#2）。
- `scripts/check.sh` 仓库卫生检查：必需文件、禁止跟踪路径、疑似 secret、Markdown 相对链接、shell 语法。
- GitHub Actions `check` 工作流：每个 PR 与合并进 `main` 时自动运行 `scripts/check.sh`。
- 分级托管（决策 0002）：普通 PR 检查通过后自动合并，规则类 PR 人工合并。

[Unreleased]: https://github.com/4n0o4t/claude-cloud-lab/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/4n0o4t/claude-cloud-lab/releases/tag/v0.1.0
