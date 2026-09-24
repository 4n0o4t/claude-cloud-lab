# 前端指南

改编自 AWZ Workflow 的前端基线（`style/frontend-baseline.md`）。

本文件是当前项目的前端入口与激活配置。默认只读本文件；只有任务命中时才继续读取 `frontend/` 下的专题。

## 项目配置

首次开展中大型前端工作时填写；随着产品阶段变化更新，不适用项保持空白。

```text
产品类型：[效率型 / 数据型 / 内容型 / 品牌营销型 / 叙事实验型]
视觉命题：[]
首要任务：[]
交互强度：[低 / 中 / 高]
重点 viewport：[]
已采用的 UI / motion 方案：[]
```

## 始终生效

- 先建立 typography、spacing、color、control、focus、overlay 和 layout 语言，再扩页面。
- 用对齐、尺度、留白和明度建立层级；card 只用于真实独立对象或交互边界。
- 一个 viewport 保持一个主要焦点，辅助信息和装饰主动退后。
- loading、empty、error、success、disabled、focus 等状态不能事后补。
- 原生控件不能裸奔；随机圆角、无意义阴影、card 套 card 和奇怪内部滚动默认拒绝。
- 使用真实浏览器验证关键桌面、移动端和交互状态；无法验证时说明风险。

## 按需加载

- 新页面、较大改版、排版、图像或视觉层级：`frontend/visual-composition.md`
- 状态反馈、转场、复杂滚动、动画、Canvas、3D 或技术库选择：`frontend/motion-and-interaction.md`
- 多端适配、布局重排、交付验收和可访问性：`frontend/responsive-and-verification.md`

普通样式修复或已有组件内的小改动，在本文件足够时停止扩展上下文。
