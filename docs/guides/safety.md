# 阻塞和安全指南

改编自 AWZ Workflow 的 blockers-and-safety guide。

## 基础设施阻塞

DNS、网络、安装依赖、文件权限、磁盘配额等问题阻塞关键工作时：

1. 先查环境文档（代理说明、网络策略、磁盘配额）确认是否为已知限制；
2. 选择一次合理 fallback；
3. 不在同一个失败路径上反复打转；
4. 汇报真实 blocker 和已尝试的修复。

磁盘写满（`no space left on device`）时先删除不再需要的大文件（构建产物、缓存、旧 clone），删除操作在配额用尽时仍可执行。

## 破坏性文件操作

递归删除、批量覆盖或清理计算路径前：

1. 使用任务专属变量，不把 `HOME` 等系统变量改作沙盒路径；
2. 解析目标的绝对规范路径，拒绝空值、`/`、用户目录、仓库根、越界路径和符号链接跳转；
3. 同时校验目录身份，例如测试目标必须位于 `temp/` 下且匹配 `smoke-*`；
4. 清理放在 `trap` 中，并使用经过负向测试的 guarded helper。

安全校验失败时保留临时产物并报告，不为了“清理干净”而降级为无保护删除。

## Git 破坏性操作

- 不对共享分支 force-push、rebase 或 amend 已推送的 commit；仅当分支只含已合并历史时可以 `--force-with-lease` 重建。
- 删除分支、改写历史、`reset --hard` 前先看清目标。

## 必须停下等用户

- CAPTCHA、MFA、password；
- 破坏性文件或数据库操作；
- secret rotation；
- 大范围架构重写；
- 新增 heavyweight production dependency；
- 变更部署目标或费用敏感基础设施。
