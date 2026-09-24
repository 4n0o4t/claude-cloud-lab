@AGENTS.md

## Claude Code 补充

- 本文件导入 `AGENTS.md`，避免维护两份规则；规则改动只改 `AGENTS.md`。
- 大范围架构、依赖、部署改动先用 plan mode 或先写 `docs/plans/` 再动手。
- 需要验证网页或前端时，优先用容器内预装的 Chromium（Playwright）做真实浏览器检查。
- 临时脚本和中间产物放会话 scratchpad 或 `temp/`，不要散落在仓库根目录。
