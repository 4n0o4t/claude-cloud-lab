# 当前状态

## 当前阶段

- 阶段：discover
- 状态：基线与目录约定就绪，等待第一个实验或子项目任务
- 最近收口：2026-09-24，`CHANGELOG.md` 切出 0.1.0 基线里程碑
- Branch：`main`（默认分支，2026-09-24 由仓库所有者从初始化提交 `6cdc906` 创建）
- 环境基线：已探测，见 `docs/references.md`

## 当前任务

- 目标：无进行中的任务
- 主 Checklist：无；多步骤任务开始时在 `docs/plans/` 建立，并在此填写唯一入口
- 任务来源：仓库所有者通过 GitHub Issue 派发；PR 描述写 `Closes #N` 以便合并后自动关闭
- 验收与验证：`bash scripts/check.sh`

## 已完成与验证

- 已完成：借鉴 AWZ Workflow 初始化基线，裁剪多 Agent 协作，调整为提交 `AGENTS.md` / `CLAUDE.md` / `docs/`（见 `docs/decisions/0001-adopt-awz-baseline.md`）。
- 已完成：`projects/` 长期子项目约定与模板，`scripts/check.sh` 新增“实验与子项目目录均有 README”检查（#2）。
- 已完成：GitHub Actions `check` 工作流，PR 上自动运行 `scripts/check.sh`。
- 已完成：分级托管规则写入 `AGENTS.md` 与 git 指南：普通 PR 自动合并，规则类 PR 人工合并。
- 已验证事实：`bash scripts/check.sh` 全部通过；README 检查的失败路径经负向测试确认。
- 已废弃路线：AWZ 的 room ledger、owner 表、handoff 模板、Reference Library 与 `.awz/references.json`——单一维护者且无持久本机，不需要。

## 阻塞项

暂无。

## 待确认

- 所有者是否已勾选 Allow auto-merge；首个普通 PR 上验证自动合并与 `repo hygiene` 显示为 Required。

## 恢复入口

- 恢复工作必须先读：`AGENTS.md`、`README.md`、本文件
- 最新 decision：`docs/decisions/0002-tiered-auto-merge.md`
- 最新 plan：无
- 可以忽略的旧上下文：无

## 下一步

1. 仓库所有者在 GitHub 网页基于 `main` 发布 `v0.1.0` Release（第 7 课练习），发布后本地 `git fetch --tags` 核对 tag 指向。
2. 等待仓库所有者通过 Issue 给出第一个实验或子项目任务。
