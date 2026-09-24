# experiments/

每个实验、原型或小工具一个自包含目录。

## 约定

- 目录名：`YYYY-MM-DD-<slug>`，slug 用小写英文和连字符，例如 `2026-09-24-streaming-latency`。
- 每个目录必须有 `README.md`，从 `../docs/templates/experiment.md` 复制，至少写清问题、复现方式和结论。
- 依赖只在实验目录内声明（`pyproject.toml`、`package.json` 等），不在仓库根目录生成工程文件。
- 不提交大文件、数据集、构建产物和运行日志；需要时在 README 里说明如何重新生成，产物放 `temp/`。
- 实验结束（完成或放弃）时更新 README 的状态和结论，并在下方索引登记一行。
- 结论影响到仓库长期做法时，另写 `../docs/decisions/` 记录。

## 索引

| 目录 | 问题 | 状态 | 结论摘要 |
| --- | --- | --- | --- |
| [`2026-09-24-threejs-titanic`](2026-09-24-threejs-titanic/README.md) | 单文件 Three.js 泰坦尼克号动画如何组织、还原工程是否忠实 | 完成 | 还原忠实且可运行；核心是“故事状态为时间的纯函数”，疑似多 Agent 分模块编写 |
