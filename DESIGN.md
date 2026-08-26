# Agent Platform Console Design

## Visual Theme and Atmosphere

面向外部客户与运营人员的浅色智能体工作台。整体采用安静石墨色、低饱和纸面和阅读优先的层级，优先展示 Agent 可用性、调用状态与操作入口。

## Color Palette and Roles

| Token   | Value                    | Role                 |
| ------- | ------------------------ | -------------------- |
| Canvas  | `oklch(0.975 0.003 90)` | 页面底色             |
| Sidebar | `oklch(0.94 0.004 90)`  | 导航背景             |
| Surface | `oklch(1 0 0)`           | 表格与抽屉表面       |
| Ink     | `oklch(0.25 0.008 90)`   | 主文字               |
| Muted   | `oklch(0.52 0.008 90)`   | 次要文字             |
| Brand   | `oklch(0.25 0.008 90)`   | 主操作与链接         |
| Success | `oklch(0.52 0.09 155)`   | Online / Healthy     |
| Warning | `oklch(0.58 0.09 75)`    | Degraded             |
| Danger  | `oklch(0.56 0.12 25)`    | Offline / 破坏性操作 |

## Typography Rules

使用 `Aptos, PingFang SC, Microsoft YaHei, sans-serif`，为中文后台保留高可读性。数据使用等宽数字，页面标题 28px、区块标题 16px、正文 14px、辅助信息 12px。

## Component Stylings

按钮和输入框统一 8px 圆角，表格与内容区域使用 12px 圆角。主按钮使用 Brand 实色；状态使用小圆点与文字，不依赖颜色单独表达；按压时仅缩放至 `0.96`。

## Layout Principles

固定 240px 侧栏，主区以表格和详情抽屉组织。在线调试页是独立的全视口会话工作台：左侧为历史，中间为阅读区，低频配置与轨迹进入抽屉；顶部只保留返回、当前 Agent 和必要操作。

## Depth and Elevation

侧栏与主区使用背景明度差区分；浮层使用 `0 14px 34px rgb(20 37 58 / 0.14)` 阴影，普通内容区不堆叠卡片。

## Do's and Don'ts

- 用状态、时间与错误信息说明 Agent 是否可用。
- 仅对需要聚焦的内容使用浮层。
- 不使用渐变、玻璃拟态、默认三卡片布局或粗色条装饰。
- 不把内部任务细节伪装成营销指标。

## Responsive Behavior

小于 860px 时侧栏收起为顶部导航，在线调试隐藏全局后台导航并以左滑历史抽屉承载会话；Composer 使用安全区且不占用抽屉布局；所有按钮保持至少 40px 点击区域。

## Agent Prompt Guide

- 创建 Agent 状态行：Canvas 背景，14px 正文，状态圆点 8px，Online 用 Success，Offline 用 Danger，圆角 8px。
- 创建危险确认对话框：Surface 背景，12px 圆角，使用 Danger 文本说明影响，取消按钮为中性，确认按钮为 Danger，按压缩放 0.96。
