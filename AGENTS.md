# AGENTS.md

本仓库由 Claude 独立维护，工作方式借鉴 [AWZ Workflow](https://github.com/Dr-Ai-0018/awz-workflow)，并按“单一维护者 + 云端临时容器”的现实做了裁剪（原因见 `docs/decisions/0001-adopt-awz-baseline.md`）。本文件是 Agent 的唯一规则入口，只保留始终生效的硬规则；细则按任务读取，不要一次性加载全部文档。

## 首次进入

1. 读 `README.md`，确认仓库定位、目录约定和已验证命令。
2. 读 `docs/status.md`，确认当前阶段、主线、阻塞项、下一步和恢复指针。
3. 只读取 status 或当前任务指向的 decision、plan、guide 和实验目录；没有指针时不遍历历史材料。
4. 任务较大或不熟悉时，读 `docs/README.md` 的任务路由，按任务类型加载 guide。
5. 编辑前检查真实代码、`git status` 和现有验证入口，不从模板占位或旧记录猜现状。

## 硬规则

- 先理解再编辑；改动小步、可 review，不碰与任务无关的文件。
- 验证与风险成比例、focused-first：每次执行前说明它验证的具体风险；同一代码树、同一命令、同一环境已通过时不重复跑。
- 能运行真实验证就运行；无法验证时说明未验证项、原因和风险，不空口说“修好了”。
- 重要判断以当前代码、配置、命令输出和用户确认优先，不把旧记录当作现状。
- 跨多步骤任务先探测真实环境与入口，再建立一个主 checklist，最后实现；用户明确要求直接处理孤立小事时可以缩短流程。
- 较大任务始终维护一个当前主线；新消息除非明确改变目标，否则按插入请求处理，回应后回到主线。
- 多行文本优先用结构化 edit/write；经 shell 写入后必须回读。
- 不打印、提交或完整复述 secret、token、cookie、私有 URL 和真实 `.env`。`.env.example` 保持可提交且只含示例值。
- 默认不提交 `temp/`、`.env`、`.env.*`（`.env.example` 除外）、`.vscode/`、`.codex/`、`.claude/settings.local.json` 和任何构建/缓存产物。
- CAPTCHA、MFA、password、secret rotation、破坏性数据操作、大范围架构重写、新增 heavyweight production dependency、费用敏感基础设施变更时停下等待用户。
- 提交前运行 `bash scripts/check.sh`，失败时先修复再提交。

## 云端容器边界

- 容器是临时的：会话结束或空闲回收后，未 commit + push 的内容全部丢失。需要跨会话保留的结论必须写进已跟踪文件并推送。
- 与 AWZ 原版不同，本仓库的 `AGENTS.md`、`CLAUDE.md` 和 `docs/` **提交进 git**——它们是跨会话记忆，不是本机私有材料。只有 `temp/` 是可丢弃的本地工作区。
- 在语义边界（feature 完成、root cause 确认、决策落定、实验结束、会话即将结束）收口：更新 `docs/status.md`，随相关改动一起 commit 并 push。
- 网络、依赖、权限等环境问题先查阅环境文档与代理说明，有限诊断后报告 blocker，不在同一失败路径反复重试。

## 信息边界

- `README.md`：公开且持久的仓库定位、目录约定和验证入口。
- `docs/status.md`：当前阶段、主线、主 checklist 指针、阻塞项和恢复入口；唯一可变状态源。
- `docs/references.md`：稳定项目背景、开发环境基线和资料索引，不记录每日进度。
- `docs/guides/`：按任务加载的工作细则。
- `docs/decisions/`：编号决策记录（ADR），只追加，被替代时标注而不是删除。
- `docs/plans/`：阶段计划与 checklist。
- `experiments/`：一次性实验与原型，每个目录自带 README。
- `projects/`：长期维护的子项目，每个目录自带 README，依赖只在子项目内声明。
- `temp/`：可清理的任务产物、日志和截图，被 git 忽略。

## Git

- 稳定主线为 `main`；云端会话在分配的 `claude/*` 分支开发，推送用 `git push -u origin <branch>`，合并回 `main` 由用户决定。
- commit 按 logical change 切分；subject 格式 `type: 中文一句话概括`，body 使用 `1. **关键词**：具体改动点`。
- commit 末尾保留 Claude Code 要求的署名 trailer（`Co-Authored-By`、`Claude-Session`）。这是对 AWZ“禁止 AI attribution”规则的有意偏离：本仓库作者就是 Claude，如实署名。
- 细则见 `docs/guides/git-workflow.md`。

## 任务细则

任务到 guide、模板和回写位置的完整路由见 `docs/README.md`。
