# Agent Platform Console Design

## Visual Theme and Atmosphere

面向外部客户与运营人员的浅色智能体工作台。整体采用紧凑的信息密度、分层纸面和克制的蓝色强调，优先展示 Agent 可用性、调用状态与操作入口。

## Color Palette and Roles

| Token   | Value                    | Role                 |
| ------- | ------------------------ | -------------------- |
| Canvas  | `oklch(0.975 0.006 250)` | 页面底色             |
| Sidebar | `oklch(0.94 0.012 250)`  | 导航背景             |
| Surface | `oklch(1 0 0)`           | 表格与抽屉表面       |
| Ink     | `oklch(0.25 0.025 255)`  | 主文字               |
| Muted   | `oklch(0.52 0.018 255)`  | 次要文字             |
| Brand   | `oklch(0.46 0.14 255)`   | 主操作与链接         |
| Success | `oklch(0.58 0.13 150)`   | Online / Healthy     |
| Warning | `oklch(0.7 0.13 80)`     | Degraded             |
| Danger  | `oklch(0.58 0.18 28)`    | Offline / 破坏性操作 |

## Typography Rules

使用 `Aptos, PingFang SC, Microsoft YaHei, sans-serif`，为中文后台保留高可读性。数据使用等宽数字，页面标题 28px、区块标题 16px、正文 14px、辅助信息 12px。

## Component Stylings

按钮和输入框统一 8px 圆角，表格与内容区域使用 12px 圆角。主按钮使用 Brand 实色；状态使用小圆点与文字，不依赖颜色单独表达；按压时仅缩放至 `0.96`。

## Layout Principles

固定 248px 侧栏，主区以表格和详情抽屉组织。顶部只呈现当前环境、刷新时间和注册入口，不使用营销式 Hero。

## Depth and Elevation

侧栏与主区使用背景明度差区分；浮层使用 `0 14px 34px rgb(20 37 58 / 0.14)` 阴影，普通内容区不堆叠卡片。

## Do's and Don'ts

- 用状态、时间与错误信息说明 Agent 是否可用。
- 仅对需要聚焦的内容使用浮层。
- 不使用渐变、玻璃拟态、默认三卡片布局或粗色条装饰。
- 不把内部任务细节伪装成营销指标。

## Responsive Behavior

小于 860px 时侧栏收起为顶部导航，Agent 表格保留名称、状态、健康度和操作四列；所有按钮保持至少 40px 点击区域。

## Agent Prompt Guide

- 创建 Agent 状态行：Canvas 背景，14px 正文，状态圆点 8px，Online 用 Success，Offline 用 Danger，圆角 8px。
- 创建危险确认对话框：Surface 背景，12px 圆角，使用 Danger 文本说明影响，取消按钮为中性，确认按钮为 Danger，按压缩放 0.96。
