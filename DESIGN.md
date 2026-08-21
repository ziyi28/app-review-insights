---
name: App Review Insights
description: Local, model-driven analysis of App Store user reviews into evidence-grounded product plans
colors:
  bg-canvas: "#090a0f"
  bg-subtle: "#0d0f17"
  bg-panel: "#131722"
  bg-card: "#181d2c"
  bg-elevated: "#1f2538"
  bg-hover: "#262e45"
  bg-active: "#2f3854"
  text-primary: "#f5f7fa"
  text-muted: "#9499ad"
  text-faint: "#59617a"
  border-default: "#1e2436"
  border-strong: "#2c354e"
  border-subtle: "#161a27"
  accent-sky: "#38bdf8"
  accent-strong: "#0ea5e9"
  priority-p0: "#f87171"
  priority-p1: "#fbbf24"
  priority-p2: "#60a5fa"
  status-ok: "#34d399"
  status-warn: "#fbbf24"
  status-danger: "#f87171"
  status-ai: "#818cf8"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "0.03em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.text-primary}"
    textColor: "{colors.bg-canvas}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  button-accent:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.bg-canvas}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  button-secondary:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  card-panel:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
  card-elevated:
    backgroundColor: "{colors.bg-card}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
  chip:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: App Review Insights

## Overview

**Creative North Star: "The Precision Evidence Lab 2.0 (精密证据工坊 2.0)"**

App Review Insights 采用深邃雅致的曜石青灰（Obsidian Slate）暗黑调性与科学仪器般的极简高密度排版。系统的核心宗旨是**将海量无序的用户评论转化为可溯源、高可信度且确定性验证的 PRD 需求与测试规格**。整体界面摒弃了一切虚华的渐变发光与多余装饰，聚焦于数据本身的条理与层级，提供如严密工程仪器般的专注感。

整个工作台提供两重视角：一键在「全透明流水线工作台（Workbench）」与「高管交付报告（Executive Report）」之间无缝切换。暗色画布严格基于 5 级深色调层次构建空间深度，辅以 1px 超细微边框，传达出沉稳、严谨与权威的专业质感。

**Key Characteristics:**
- **曜石青灰层次感**：以 `#090a0f` 纯正暗色为画布基底，通过 `#0d0f17`、`#131722`、`#181d2c`、`#1f2538` 构筑细腻有机的阶梯空间深度。
- **克制的天蓝单焦点**：天空青蓝（`#38bdf8`）严格作为点睛与状态激活色，占据屏幕面积 ≤ 5%，确保视觉焦点纯粹。
- **语义化证据与追溯**：机器来源徽章、原文字段精确对照与代码标签无障碍跳转，形成可闭环审查的证据网络。
- **零装饰性色边**：坚决拒绝在卡片左侧随意添加 3px 伪彩条（Anti-pattern Refusal），优先级通过规范的语义 Badge 徽章与柔和底色呈现。

## Colors

调色系统建立在深色多阶面板、高对比文字与精确克制的冷天蓝指示色之上。

### Primary
- **Obsidian Canvas** (`#090a0f`): 全局底色与主画布。
- **Subtle Surface** (`#0d0f17`): 侧边栏与弱化背景。
- **Panel Surface** (`#131722`): 默认工作台面板与数据卡片底色。
- **Elevated Card** (`#181d2c`): 浮起卡片与重要容器背景。
- **Sky Cyan Focus** (`#38bdf8` / `#0ea5e9`): 单一焦点主色，用于主要激活态、聚焦环与进度指示。

### Neutral
- **Text Primary** (`#f5f7fa`): 主要标题、正文与数值（对比度 > 14:1）。
- **Text Muted** (`#9499ad`): 次要说明、元数据、表头与标签。
- **Text Faint** (`#59617a`): 弱化辅助信息与占位符。
- **Border Default** (`#1e2436`): 标准 1px 分割线与卡片边框。
- **Border Strong** (`#2c354e`): 悬停高亮与选中卡片边框。

### Semantic Priorities & Status
- **Priority P0** (`#f87171`): 致命缺陷与必须修复项，辅以 `rgba(248, 113, 113, 0.12)` 柔和背景。
- **Priority P1** (`#fbbf24`): 重要特性与高价值项，辅以 `rgba(251, 191, 36, 0.12)` 柔和背景。
- **Priority P2** (`#60a5fa`): 常规与次要项，辅以 `rgba(96, 165, 250, 0.12)` 柔和背景。
- **Status OK** (`#34d399`): 验证闭环通过与数据就绪。
- **Status AI** (`#818cf8`): 大模型提炼生成标记。

### Named Rules
**The Single Focus Rule.** 荧光天蓝色仅出现在当前活跃选项卡、主操作按钮或运行中心跳指示器上，在全屏视觉面积中占比不超过 5%。
**The Priority Badge Rule.** 优先级严禁使用卡片左侧粗边线（border-left），必须通过自包含的徽章胶囊（`badge-p0`, `badge-p1`, `badge-p2`）清晰传达。

## Typography

**Display / Body Font:** 现代操作系统无衬线字体栈 (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`)
**Code / Machine Font:** 高可读等宽字体族 (`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`)

**Character:** 极度克制、清爽利落的现代工具栈排版，数字全部采用等宽对齐（tabular-nums）。

### Hierarchy
- **Display** (Bold 700, 24px, line-height 1.2, letter-spacing -0.02em): 高管报告大标题与全屏核心视口标题。
- **Headline** (Semi-bold 600, 17px, line-height 1.4): 各分析板块标题、统计卡片关键指标与高管报告章节头。
- **Title** (Semi-bold 600, 15px, line-height 1.4): 需求卡片标题、发现问题标题与核心实体名。
- **Body** (Regular 400, 14px, line-height 1.55): 默认正文、需求详细描述与验收标准。
- **Caption** (Regular 400, 13px, line-height 1.5): 卡片内次要正文、元数据网格取值与评论引用文字。
- **Code / Meta** (Regular 400, 12px, line-height 1.5): Review ID、实体唯一 ID、测试用例编号与键盘无障碍跳转锚点。
- **Label** (Semi-bold 600, 11px, letter-spacing 0.03em, uppercase): 机器来源徽章（AI-GENERATED / COMPUTED / LIMITATION）与表头。

### Named Rules
**The Monospace Discipline Rule.** 等宽字体仅用于机器 ID、哈希校验码、确凿评论原文摘录与数据表格，绝不作为普通正文的装饰性字体。

## Layout

- **Workbench 双栏结构**：左侧为固定宽度 `250px` 的语义工作台导航栏，右侧为自适应滚动主工作区。
- **响应式分析网格**：分布图与数据指标采用 `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))` 弹性 3 列自适应排列，在大屏下充分利用横向空间，在移动端优雅折叠。
- **高管报告阅读流**：报告模式下收拢为最大宽度 `1080px` 的居中页面容器，配备顶部胶囊式快速目录栏（TOC）。

## Elevation & Depth

系统采用**色调分层（Tonal Layering）与微弱柔和阴影**相融合的深度模型。纯平底色通过明度递增构建近远关系，不使用无模糊硬边缘阴影。

### Shadow Vocabulary
- **Shadow Low** (`box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.4)`): 标准卡片与输入框基础阴影。
- **Shadow Medium** (`box-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.6)`): 悬停卡片与抽屉面板浮起阴影。
- **Shadow High** (`box-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.8)`): 对话框与独立浮层阴影。

## Shapes

- **Radius Scale**:
  - `xs (4px)`: 代码徽章、内嵌小标签。
  - `sm (6px)`: 按钮、输入框、下拉菜单、分段选项。
  - `md (10px)`: 标准内容卡片、数据面板。
  - `lg (14px)`: 模态对话框、高管报告容器。
  - `full (999px)`: 状态胶囊 Chip、进度条轨道。
- **Border**: 全局统一为 `1px` 细实线，不使用大于 `1px` 的粗边框。

## Components

### Buttons
- **Shape:** 6px 圆角 (`var(--radius-sm)`).
- **Primary:** 高对比度白底黑字 (`background: var(--text-primary); color: #040810; font-weight: 600; padding: 7px 14px`).
- **Accent:** 天蓝色实色 (`background: var(--accent-strong); color: #04121f; font-weight: 600`).
- **Secondary:** 深色面板底 (`background: var(--bg-elevated); border: 1px solid var(--border)`).
- **Ghost:** 透明背景，悬停时高亮.
- **Focus:** 显式两层焦点环 (`box-shadow: 0 0 0 1px var(--bg), 0 0 0 2px var(--accent)`).

### Interactive Code Badges (`.code-badge`)
- **Affordance:** 语义化等宽代码跳转按钮，具有 `role="button"`、`tabIndex={0}`、微上浮悬停交互与完整的键盘 `Enter`/`Space` 响应.

### Cards / Containers
- **Corner Style:** 10px 圆角 (`var(--radius)`).
- **Background:** `var(--bg-panel)` (基础卡片) / `var(--bg-card)` (浮起卡片).
- **Internal Padding:** `16px 18px` 或 `18px 20px`.
- **Border:** 1px `var(--border)`.

### Live Progress Bar
- **Track:** 6px 高度胶囊轨道 (`background: var(--bg-elevated)`).
- **Fill:** 天蓝纯色填充，采用 GPU 硬件加速合成 (`transform: scaleX(progress); transform-origin: left; transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1)`), 杜绝触发 Layout 回流.

## Do's and Don'ts

### Do:
- **Do** 对所有可交互的 Review ID 与追溯链节点提供 `role="button"`、`tabIndex={0}` 与键盘无障碍响应。
- **Do** 将分析分布图组织为自适应 3 列网格以提升横向信息密度。
- **Do** 进度条动画统一采用 `transform: scaleX()` 合成加速。
- **Do** 保持天蓝色重点强调面积 ≤ 全屏 5%。

### Don't:
- **Don't** 在卡片左侧使用粗彩色线条（border-left）做装饰。
- **Don't** 对 `width` 或 `height` 属性进行 CSS `transition` 动画。
- **Don't** 使用未经 Token 规范的离散字体尺寸或硬编码圆角值。
- **Don't** 在暗色界面上使用没有环境模糊的高发光晕轮或硬阴影。
