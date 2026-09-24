# projects/

长期维护的子项目，每个一个自包含目录。和 `../experiments/` 的区别：

| | `experiments/` | `projects/` |
| --- | --- | --- |
| 寿命 | 一次性，得出结论即结束 | 持续维护、迭代 |
| 目录名 | `YYYY-MM-DD-<slug>` | `<slug>`，不带日期 |
| README 重点 | 问题、复现、结论 | 用途、运行、验证、当前状态 |

## 约定

- 目录名：小写英文和连字符，例如 `markdown-linter`。
- 每个目录必须有 `README.md`，从 `../docs/templates/project.md` 复制，至少写清用途、如何运行和如何验证。
- 依赖、构建配置和测试只放在子项目目录内（`pyproject.toml`、`package.json` 等），不在仓库根目录生成工程文件。
- 不提交构建产物、缓存和大文件；需要时在 README 里说明如何重新生成。
- 实验成熟后可以“毕业”成子项目：新建 `projects/<slug>/`，README 注明来源实验目录；原实验目录保留作为记录。
- 需要发版时，tag 使用 `<slug>-vMAJOR.MINOR.PATCH`，避免不同子项目的版本号互相冲突。
- 新增、归档子项目时更新下方索引；影响仓库长期做法的取舍另写 `../docs/decisions/`。

## 索引

| 目录 | 用途 | 状态 |
| --- | --- | --- |
| [`titanic-1912`](titanic-1912/README.md) | Three.js 泰坦尼克号程序化短片：原始单文件与模块化还原工程（第三方作品，经授权收录） | 可用（存档） |
