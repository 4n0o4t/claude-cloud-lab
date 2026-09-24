# 验证指南

改编自 AWZ Workflow `workflows/verification-baseline.md`。先识别已有的 README、脚本、配置和测试入口，再选择最小有效验证。不要为了跑检查生成项目并不需要的依赖或配置。

## 验证层级

- `DryRun`：回答“如果执行，会改什么”，不写文件、不安装依赖、不修改环境。
- `Smoke`：回答“最小闭环能不能跑”。
- `Full Check`：回答“这个阶段能不能交付或合并”。

仓库级入口：`bash scripts/check.sh`，CI（`.github/workflows/check.yml`）在每个 PR 上自动运行同一脚本。实验级入口写在各实验的 README 中。本地通过后仍要看 PR 的 Checks 结果，CI 红了先修再请求合并。

## 风险比例

问题优先级 `P0–P3`（见 `review.md`）与验证级别分开：

| 验证级别 | 典型改动 | 默认验证 |
| --- | --- | --- |
| `V0` | 文案、注释、格式、无行为配置 | diff review + `scripts/check.sh` |
| `V1` | 单函数、单模块局部逻辑 | 相关测试或最小 smoke |
| `V2` | 跨模块、API、schema、数据流 | 受影响模块 + 必要 integration check |
| `V3` | 公共核心、安全、并发、持久化、依赖 | 明确范围的 Full Check；必要时 E2E/浏览器 |

## 停止策略

- 每次验证前说明它验证的具体风险。
- 同一代码树、同一命令、同一环境已通过时，不重复执行。
- focused 通过后不自动升级 full suite；只有失败、相关代码变化、新风险或明确 gate 才升级。
- 昂贵验证（full suite、E2E、benchmark、长时间 build）需要任务明确要求或用户确认。
- 环境失败只做有限诊断和一次合理 fallback，之后报告 blocker。
- 达到验收条件后停止，并记录命令、结果、未覆盖风险。

## 云端环境

- 首次构建或环境变化时，探测 OS、shell、runtime、package manager 和验证入口，把有效事实写入 `../references.md`。
- 网页和前端用预装 Chromium（Playwright）做真实浏览器检查，不运行 `playwright install`。
- 一次性输出放 `temp/` 或会话 scratchpad，不放仓库根目录。
- 通过 shell 写入多行文本后立即回读，确认字符、编码和行尾。

## 交接格式

最终说明使用：

```text
验证层级：
运行命令：
结果：
未验证：
原因：
后续建议：
```
