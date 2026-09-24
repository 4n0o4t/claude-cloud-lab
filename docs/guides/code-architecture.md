# 代码架构指南

## 核心原则

同时避免两种失败：

- 全部代码塞进一个巨型文件；
- 拆成一堆没有稳定职责的小文件。

默认拆分方向：

- route/controller 层接外部输入输出；
- schema/DTO 层定义请求/响应 contract；
- service/use-case 层编排业务流程；
- domain/model 层承载核心规则和实体；
- repository/data 层抽象持久化；
- infrastructure 层处理数据库、文件、队列、外部 API；
- config 层加载环境和设置；
- tests 尽量镜像相关源码结构。

行数和复杂度阈值是 review trigger，不是绝对阻塞。超过时说明原因、风险和未来拆分点。

## 技术选择

- 优先采用现代主流方案，而不是旧默认。
- Python API 默认优先 FastAPI，而不是旧式 Flask 默认，除非项目明确需要 Flask。
- 非平凡前端在项目允许时优先 TypeScript。
- 生态已有清晰约定时，优先跟随 framework convention，而不是手搓自定义模式。
- 如果项目已经存在成熟风格，优先跟随现有项目。

## 例外

所有规则都允许例外，但重要例外必须说明：

1. 为什么需要例外；
2. 会带来什么风险；
3. 是否需要后续还债；
4. 如果需要人工确认，由谁接受这个 tradeoff。
