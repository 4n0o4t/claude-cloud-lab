# Git 工作流指南

改编自 AWZ Workflow `style/git-style.md`，按单一维护者与云端会话调整。

## 分支

- `main` 是稳定主线。
- 云端会话在分配的 `claude/*` 分支开发；不要推送到未被授权的其他分支。
- 一个会话分支对应一段可解释的工作；合并回 `main` 由用户决定（PR 或直接合并），不要长期漂着。
- 分支对应的 PR 已合并后，后续工作从最新 `main` 重新起分支，不在已合并历史上堆叠。

推送：

```bash
git push -u origin <branch>
```

仅在网络错误时按 2s、4s、8s、16s 退避重试，最多 4 次。

## Commit subject

```text
type: 中文一句话概括
```

types：`init`、`feat`、`fix`、`docs`、`style`、`refactor`、`test`、`chore`、`build`、`ci`、`exp`（实验目录的新增或结论更新）。

示例：

```text
init: 借鉴 AWZ Workflow 初始化仓库基线
exp: 记录流式输出延迟实验结论
fix: 修复检查脚本对空仓库的误报
```

## Commit body

需要细节时使用带序号的 Markdown 分点：

```text
1. **关键词**：具体改动点
2. **关键词**：具体改动点
```

## 署名

- 使用环境预配置的 git 用户名和邮箱，不手动改写。
- commit 末尾保留 Claude Code 要求的 trailer（`Co-Authored-By`、`Claude-Session`）。
- 这与 AWZ 的“禁止 AI attribution”相反，是有意偏离：本仓库作者就是 Claude，如实署名比隐藏更合适。见 `../decisions/0001-adopt-awz-baseline.md`。

## 节奏

- 一个 commit 对应一个 logical change：能单独 review，不混入无关格式化或临时文件。
- 不要一个 typo 一个 commit，也不要把 refactor、功能、修 bug、格式化混在一起。
- 大阶段可以拆成：骨架 → 实现 → 验证 → 文档/清理。
- 会话结束前确认所有要保留的工作已 commit 并 push——容器回收后未推送的内容无法找回。

## Commit 前检查

1. `git status --short`，确认没有意外文件。
2. `bash scripts/check.sh` 通过。
3. staged diff 中没有 secret、真实 `.env`、`temp/` 内容。
4. 生成文件是有意加入的。
5. 相关的 status / CHANGELOG 已随改动更新（仅在职责命中时）。

## 版本

- 仓库整体不维护版本号；需要发布的实验在自己目录内管理版本。
- 值得标记的里程碑用 `vMAJOR.MINOR.PATCH` tag，并在 `CHANGELOG.md` 记录。
