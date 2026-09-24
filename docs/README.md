# docs/ 导航

`docs/` 在本仓库是**提交的**跨会话知识库（AWZ 原版把它设为本地 ignored，这里因为容器临时而改为提交）。放置前先按内容寿命选位置，不要在多个文件里维护同一事实的副本。

```text
docs/
├─ README.md            # 本文件：目录职责与任务路由
├─ status.md            # 当前阶段、主线、阻塞项、恢复入口（唯一可变状态源）
├─ references.md        # 稳定项目背景、环境基线、资料索引
├─ guides/              # 按任务加载的工作细则
│  ├─ git-workflow.md
│  ├─ verification.md
│  ├─ code-architecture.md
│  ├─ review.md
│  ├─ safety.md
│  ├─ frontend.md
│  └─ frontend/         # 前端专题，按需再读
├─ decisions/           # NNNN-slug.md 编号决策记录
├─ plans/               # 阶段计划与 checklist
└─ templates/           # 可复制的模板
```

## 放置规则

- “这个仓库长期是什么、环境是什么、结论来自哪里”：`references.md`。
- “现在在做什么、卡在哪、下个会话从哪继续”：`status.md`。
- “本轮多步骤任务怎么推进”：`plans/<yyyy-mm-dd>-<slug>.md`，status 只指向一个主 checklist。
- “为什么选了 A 而不是 B”：`decisions/NNNN-<slug>.md`。
- “一次实验的代码、过程和结论”：`experiments/<yyyy-mm-dd>-<slug>/`。
- “可以随时删的大文件、日志、截图”：`temp/`（ignored，容器回收即消失）。

## 任务路由

仓库整理、工具选择、`.gitignore` 调整：

- `guides/verification.md`
- `guides/safety.md`（涉及删除、覆盖或清理时）

Git、分支、commit、版本：

- `guides/git-workflow.md`

新实验或原型：

- `../experiments/README.md`
- `templates/experiment.md`

后端、架构、重构：

- `guides/code-architecture.md`
- `guides/verification.md`

前端、UI、浏览器预览：

- `guides/frontend.md`，再按需读 `guides/frontend/` 专题
- `guides/verification.md`

review、debug、hardening：

- `guides/review.md`
- 跨多轮或包含修复时，复制 `templates/review-checklist.md` 到 `plans/`
- 涉及安全风险、权限或破坏性操作时，再读 `guides/safety.md`

方案选择或架构取舍：

- `references.md`
- `templates/decision.md`

外部资料或第三方源码借鉴：

- `references.md` 的资料清单
- 第三方源码只 clone 到 `temp/` 或会话 scratchpad 阅读，不复制进仓库；借鉴实现时遵循其 license。

## 阶段收口与恢复

收口按语义边界触发，不按 token 数触发：feature 完成、root cause 确认、决策落定、实验结束、会话即将结束或切换阶段时：

1. 核对真实代码、Git 和验证结果；
2. 更新 `status.md` 的阶段、已验证事实、未解决项、下一步和恢复入口；
3. 只有职责命中时才更新 decision、plan、references 或 CHANGELOG；
4. 与对应改动一起 commit 并 push——没推送的收口等于没做。

新会话按 `AGENTS.md` → `README.md` → `status.md` → status 指向的材料 → 当前任务 guide 恢复。低风险小改不改变阶段或长期事实时，不必制造收口文档。
