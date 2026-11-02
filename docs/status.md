# 当前状态

## 当前阶段

- 阶段：discover
- 状态：无进行中的任务。所有者在探索“AI 做视频”方向，本仓库先用一支 Remotion 科普短片试水
- 最近收口：2026-11-02，完成 Remotion 科普短片实验（`experiments/2026-11-02-remotion-sky-blue/`）；同日早些时候做了仓库整理（环境基线复核、CHANGELOG 补齐）
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
- 已完成：`v0.1.0` Release 由所有者在网页发布，tag 指向 `main` 合并提交 `2709031`。
- 已完成：第一个实验 `experiments/2026-09-24-threejs-titanic/`，拆解单文件 Three.js 泰坦尼克号动画。
- 已完成：作者授权公开后，第一个子项目 `projects/titanic-1912/` 收录原始单文件（逐字节保存）与还原 Vite 工程；未指定许可证，不适用仓库 MIT。
- 已验证事实：普通 PR 自动合并可用（PR #6 检查通过后自动合并）；`repo hygiene` 为必须通过的检查（PR #5 检查运行中处于 `blocked`）。
- 已验证事实：`bash scripts/check.sh` 全部通过（2026-11-02 复核）；README 检查的失败路径经负向测试确认。
- 已完成：`experiments/2026-11-02-remotion-sky-blue/`，Remotion 4.0.540 制作 50 秒科普短片，云端容器可直接渲染（复用预装 headless Chromium）。
- 已完成：同一实验加 AI 配音（Kokoro-82M-v1.1-zh，CPU、无 API Key），旁白时长驱动时间轴，整片 87 秒；用 faster-whisper 转写回听自检。TTS 虚拟环境在 `temp/`，不进仓库，重建方法见实验 `tools/requirements-tts.txt`。
- 已验证事实：2026-11-02 重新探测环境基线，容器镜像已升级（Python 3.13、uv 0.11、Node 22.23），详见 `docs/references.md`。
- 已验证事实：`projects/titanic-1912/source` 不依赖提交外的 `dist/`，干净复制后 `npm ci && npm run build` 成功，新构建在无头 Chromium 中渲染无错误。
- 已废弃路线：AWZ 的 room ledger、owner 表、handoff 模板、Reference Library 与 `.awz/references.json`——单一维护者且无持久本机，不需要。

## 阻塞项

暂无。

## 待确认

- 多 Agent 候选规则 R1–R10 是否采纳、是否用迷你版泰坦尼克号试点（见 `experiments/2026-09-24-multi-agent-workflows/README.md` 的“候选规则”“试点建议”）。所有者暂未决定，不必主动追问；所有者回来时可提一句。

## 已定事项（不再追问所有者）

- `projects/titanic-1912/` 授权问题：原作者未知，文件由朋友转发。2026-09-24 所有者决定保留收录，仓库保持公开（曾考虑转私有，最终未转）。此事已定，后续会话不再就此纠结或追问。

## 恢复入口

- 恢复工作必须先读：`AGENTS.md`、`README.md`、本文件
- 最新 decision：`docs/decisions/0002-tiered-auto-merge.md`
- 最新 plan：无
- 最新日记：`docs/diary/2026-09-24.md`（回顾用，不作为状态源）
- 可以忽略的旧上下文：无

## 下一步

0. 已完成：3D 精修版 `SunsetHero`（官方 Remotion Agent Skills + @remotion/three），24.6 秒，软件 WebGL（swangle）渲染 11 分钟；等所有者看片反馈。
1. 等所有者对 Gemini 3.8 Flash TTS 与 Kokoro 的 A/B 试听反馈（前 4 幕；Gemini 免费档每天 10 次请求，剩余 3 句待配额恢复或换付费档）。之后可选：换音色、加 BGM、词级字幕、竖版等（见实验 README“后续”）。
   - Gemini 密钥：所有者给的是临时密钥，已承诺吊销；新会话需要时请所有者把 `GEMINI_API_KEY` 配到环境设置里，不在聊天里传。
2. 恢复时先重新探测环境基线有无变化，再看“待确认”里的候选规则是否有了结论。
