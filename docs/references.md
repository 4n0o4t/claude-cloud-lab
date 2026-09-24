# 项目背景与参考资料

本文件是新会话理解仓库的稳定上下文入口。它不是任务日志；无法从代码、配置、命令输出或用户确认中证实的内容，要标为“待确认”。

## 项目背景

- 项目是什么：Claude 在 Claude Code 云端会话中独立维护的实验仓库
- 主要使用者：Claude（维护者）与仓库所有者（提出任务、决定合并）
- 解决的问题：为实验、原型和小工具提供一个跨会话延续的地方
- 主要技术栈：无固定技术栈；各实验按需选择，在自己目录内声明
- 核心入口：`AGENTS.md`、`docs/status.md`、`experiments/`
- 运行环境：Claude Code 云端临时容器（见下方环境基线）

## 开发环境基线

只记录会影响命令、文本语义和验证结果的事实。环境变化时重新探测并更新“最后核验”。

| 项目 | 已验证事实 | 证据或探测命令 | 最后核验 |
| --- | --- | --- | --- |
| OS / 架构 | Ubuntu 24.04.4 LTS，Linux 6.18，x86_64 | `uname -srm`、`/etc/os-release` | 2026-09-24 |
| 主 shell | GNU bash 5.2.21 | `bash --version` | 2026-09-24 |
| 文本编码 / 行尾 | UTF-8，LF（`.gitattributes`、`.editorconfig` 约束） | 仓库配置 | 2026-09-24 |
| Git | 2.43.0；身份由环境预配置；remote `origin` → `4n0o4t/claude-cloud-lab` | `git --version`、`git remote -v` | 2026-09-24 |
| Python | 3.11.15；`uv` 0.8.17 可用 | `python3 --version`、`uv --version` | 2026-09-24 |
| Node | v22.22.2；`pnpm` 10.33.0、`npm` 10.9.7 可用 | `node --version` 等 | 2026-09-24 |
| 常用 CLI | `rg` 14.1.0、`jq` 1.7 可用；`shellcheck` 不可用 | `command -v` | 2026-09-24 |
| 浏览器 | 预装 Chromium，Playwright 已配置（`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`），不要 `playwright install` | 环境说明 | 2026-09-24 |
| 网络 | 出站 HTTPS 经代理；受限时先查环境文档与代理状态 | 环境说明 | 2026-09-24 |
| 验证入口 | `bash scripts/check.sh` | README | 2026-09-24 |

## 默认选择

沿用 AWZ Workflow 的默认值：

- Python 优先 `uv`，必要时回退 `python -m venv`；Node 优先 `pnpm`，必要时回退 `npm`。
- 不预先生成 `pyproject.toml`、`package.json`、Docker、CI；实验真实需要时在其目录内生成。
- 默认 MIT 协议；默认分支 `main`。

## 目标与非目标

目标：

- 每个实验可独立理解、复现，结论写进仓库。
- 新会话能在几分钟内从 status 恢复上下文。

当前非目标：

- 多 Agent 协作流程、owner 表、协作 ledger。
- 成为完整脚手架、CI 平台或文档站。

## 资料清单

| 名称 | 类型 | 位置或 URL | 用途 | License | 最后核验 |
| --- | --- | --- | --- | --- | --- |
| AWZ Workflow | 工作流基线 | <https://github.com/Dr-Ai-0018/awz-workflow>（v0.3.0，commit `bdeb796`） | 本仓库初始化结构、guide 与模板的来源 | MIT，© 2026 AWZ Workflow contributors（见 `NOTICE`） | 2026-09-24 |
| Claude Code memory | 官方文档 | <https://code.claude.com/docs/en/memory> | `CLAUDE.md` 导入语义 | — | 2026-09-24 |
| Keep a Changelog | 规范 | <https://keepachangelog.com/> | `CHANGELOG.md` 格式 | — | 2026-09-24 |
