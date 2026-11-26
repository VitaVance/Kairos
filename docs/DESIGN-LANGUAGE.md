# 设计语言规范

规则书，不是灵感集。新建界面/组件/皮肤前先读；审阅时拿它当清单。
令牌全部定义在 `packages/ui/src/tokens.css`，本文引用的每个名字都能在那里 grep 到。
**目标是「一致」，不是「已完成」**——代码仍在若干处违反本规范，逐条列在 §8。

---

## 1. 层级

颜色与尺寸只能沿四层单向流动，越层即 bug。

| 层 | 内容 | 允许出现的位置 |
| --- | --- | --- |
| **T1 字面量** | `#3b82f6`、`rgba(...)`、`28px`、`100ms` | **仅** `tokens.css` 内 |
| **T2 语义** | `--tl-surface`、`--tl-text`、`--tl-border`、`--tl-accent`、`--tl-danger`、`--tl-quadrant-q1`、`--tl-hue-1-base`、`--tl-heat-1`、`--tl-tint-base` | 任意组件消费 |
| **T3 UI / 共享语言** | `--tl-block-*`、`--tl-row-h`、`--tl-control-h`、`--tl-space-*`、`--tl-radius-*`、`--tl-font-size-*`、`--tl-duration-*`、`--tl-ease-*`、`--tl-shadow-*`、`--tl-z-*` | 任意组件消费 |
| **T4 组件** | `.tl-btn`、`.tl-chip`、`.qz-row`、`.cal-*` | 只允许 `var(--tl-*)` |

**规则：组件 CSS 只消费令牌，绝不自己发明颜色。** 唯一允许的算式是混色，且必须含至少一个令牌：

```css
/* 合法：hue + surface 两个令牌 */
background: color-mix(in oklab, var(--chip-color) var(--tl-block-tint), var(--tl-surface));
/* 合法：令牌稀释成半透明 */
box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tl-accent) 18%, transparent);
/* 非法：字面量参与混色 */
background: color-mix(in oklab, var(--chip-color) 10%, white);
```

T4 可声明**本地钩子**（`--chip-color`、`--badge-ink`、`--mv-ground`），但值必须来自 T2/T3——它只是
「选哪条令牌」，不产生新颜色。皮肤差异一律留在 `tokens.css`，组件规则里不准出现 `[data-palette=...]` 颜色分支。

---

## 2. 颜色

### 2.1 三种角色

- **表面**：`--tl-bg`（画布）→ `--tl-surface`（卡片/面板）→ `--tl-surface-raised`（浮层）→
  `--tl-surface-subtle`（安静嵌入底）→ `--tl-surface-hover` / `--tl-surface-sunken`（瞬时态/下沉）。
- **分隔线**：`--tl-border-soft`（最轻，段内）→ `--tl-border`（结构线）→ `--tl-border-strong`（需被看见的边界）。
  不要拿 ink 令牌冒充分隔线。
- **文字 ink**：`--tl-text`（正文/标题）→ `--tl-text-secondary`（次要/元信息）→ `--tl-text-tertiary`（安静提示）
  → `--tl-text-disabled`（禁用）。`--tl-chip-text` 专给 chip 体，`--tl-text-inverse` 用于深底反白。

### 2.2 染色永远混向 surface，绝不混向 white

```css
color-mix(in oklab, <hue> N%, var(--tl-surface))   /* 唯一正确形态 */
```

意图是「当前表面」时用 `--tl-tint-base`（它等于 `--tl-surface`）。原因：混向字面量 `white` 在浅色下
看不出来，在深色下把每个日历 chip 烤成白杠——只有真跑起来才看得见。同一色相占比在暗底上**感知更弱**，
所以深色块调高比例（`--tl-block-tint` 14%→16%），而不是换一套令牌。

### 2.3 对比度下限

**文字 ≥ 4.5:1；UI 边界/焦点 ≥ 3:1**（WCAG 1.4.11）。色相令牌普遍只够当「点/边」不够当「字」，
因此成对提供 `-ink` 兄弟——**兄弟存在就是因为原始色相没过线**：`--tl-accent`(3.7:1)→`--tl-accent-ink`
（`--tl-accent-strong` 是带白字的填充，别当文字）；`--tl-danger`(3.1:1)→`--tl-danger-ink`（实心危险按钮用
`--tl-danger-contrast` 墨）；`--tl-quadrant-q1..q4`(2.2–3.7:1)→`--tl-quadrant-qN-ink`；
`--tl-block-time-ink` 则因裸 `--tl-text-secondary` 在某 14% 蓝 tint 上只有 4.34:1。深色焦点环用
`--tl-focus-ring` 或实心 `--tl-accent`，半透明环会跌破 3:1。

### 2.4 三套色相词汇，各管一摊

| 词汇 | 令牌 | 用在哪 | 不要用在哪 |
| --- | --- | --- | --- |
| **象限** | `--tl-quadrant-q1..q4` (+`-ink`,`-tint`) | 艾森豪威尔四象限身份信号（点/徽标/卡头） | 任意清单/事件着色 |
| **清单** | `--tl-hue-1..8-base / -solid / -tint` | 用户清单色、日历事件 `--chip-color` | 象限语义 |
| **热力** | `--tl-heat-0..4` | 年视图计数阶梯，由 `--tl-accent` 派生 | 任何非计数密度场景 |

四象限色在任何地方都表示「重要/紧急」，不表示「第七个清单」；热力阶梯只在年视图用。

---

## 3. 彩色块（block）

日历 chip、周/日/多日时间块、全天条、议程行——以及**任何将来的彩色对象**——同一套 T3 构件：

| 部位 | 令牌 |
| --- | --- |
| 填充 | `color-mix(in oklab, var(--chip-color) var(--tl-block-tint), var(--tl-surface))` |
| 前导竖条 | `border-inline-start: var(--tl-block-bar) solid var(--chip-color)` |
| 圆角 | `border-radius: var(--tl-block-radius)` |
| 标题墨 | `color: var(--tl-block-title-ink)`，字重 `--tl-font-weight-medium`（标题比时间重一档） |
| 时间墨 | `color: var(--tl-block-time-ink)` |
| hover | 填充换 `--tl-block-tint-hover` |

**已完成/弱化变体**：填充 `--tl-block-tint-muted`；竖条
`color-mix(in oklab, var(--chip-color) var(--tl-block-bar-muted), var(--tl-surface))`；标题改用
`--tl-block-time-ink` 并加删除线。

**明确禁止**：新界面**必须复用**上述令牌，**不得**自建 `--x-tint` / `--x-bar` / `--x-radius`。
上一版就是日历 14%、议程 9%、base chip 10%、done 7% 各说各话，看着像几个产品拼的。竖条只有
`--tl-block-bar`（3px）一个值，不要另写 2px。

---

## 4. 尺寸与密度

### 4.1 间距：8px 块级 + 密集 2/3px

块级布局用 `--tl-space-1..10`（4/8/12/16…40px），保 4px 节奏。紧凑控件**内部**才用密集档：
`--tl-space-dense`(2px)、`--tl-space-dense-2`(3px)、`--tl-space-compact`(6px)、`--tl-space-hairline`(1px)。
密集档用于 chip 内边距与间距、分段单项内边距、相邻行间距、图标↔标签微调；**不要**拿它做区块间距。
行对象：`--tl-row-h`（36px），行间距 `--tl-row-gap`（2px）；常规控件 `--tl-control-h`（32px），密集控件
`--tl-control-h-sm`（28px）。列表、象限板、面板字段共享这三个值，使「一行」处处同尺寸。

### 4.2 字号

`--tl-font-size-xs`(12)→`sm`(13)→`base`(14)→`md`(15)→`lg`(17)→`xl`(20)→`2xl`(28)。不要临时造 10px、11px。

**分区标签已改句首大写（sentence case），不再是全大写微字距**：`--tl-font-size-xs` +
`--tl-font-weight-semibold` + `letter-spacing: 0` + `text-transform: none`。「小字印」观感主要来自
全大写 + 0.08em 字距，现在靠字号与颜色分层。

### 4.3 半径阶梯

| 令牌 | 值 | 属于 |
| --- | --- | --- |
| `--tl-radius-xs` | 4 | 复选框、小色块、行内高亮 |
| `--tl-radius-sm` | 6 | chip / block / 行 / 输入框 / 小按钮 |
| `--tl-radius-md` | 8 | 按钮、输入框、浮层内部项 |
| `--tl-radius-lg` | 10 | popover、toast、年视图月份卡 |
| `--tl-radius-xl` | 12 | 卡片、面板、弹窗、整块视图容器 |
| `--tl-radius-full` | 999 | 胶囊、圆点、头像 |

皮肤会整体下调阶梯（protool/editorial 更小），永远引用令牌名，不要写死 `6px`。

---

## 5. 组件约定

### 5.1 按钮

每个可见界面**只有一个主按钮**：`.tl-btn--primary`，填充 `--tl-accent-strong`、墨 `--tl-accent-contrast`、
hover `--tl-accent-strong-hover`；次级 `--secondary`（surface + `--tl-border-strong`）、幽灵 `--ghost`、
危险 `--danger`（静止 `--tl-danger-tint` 底 + `--tl-danger-ink` 墨，hover 才转实心）。次要动作（空态、
搜索、清空）用 ghost，别抢主按钮的实心蓝；高度走 `--tl-control-h`/`-sm`，触摸 (`any-pointer: coarse`) 提到 44px。

**字段：安静地面，焦点才加强边界，静止态绝不重边框。** 静止 `--tl-surface-subtle` 底 + `--tl-border`（或透明）
细线；hover `--tl-surface-hover` 或 `--tl-border-strong`；focus 边界转 `--tl-accent`（可叠 `--tl-accent-tint`
光晕）或 `outline: 2px solid var(--tl-focus-ring)`；禁用 `--tl-surface-sunken` 底 + `--tl-text-disabled` 墨，
保留 `opacity: 1`（禁用是颜色，不是淡出）。

### 5.2 行是一个对象

**行体即打开详情**，`cursor: pointer`；**只有复选框完成**——完成是唯一会产生第二行
（重复任务派生下一条）的破坏性手势，不能由任意一次落在标题上的点击触发。路由判定统一走
`shouldActivateRow()`（`packages/features/src/task/row-click.ts`），判据不是「哪个处理器」而是
「这条点击链上有没有控件」：复选框、删除键、链接、行尾箭头都算控件，它们各占自己的点击。

**抓取把手只在 hover / `:focus-within` 出现**（`opacity: 0 → 1`），grab cursor 只属于把手；
按下反馈全 app 一致：底色下沉 `--tl-surface-sunken` + `scale: 0.995`。

### 5.3 详情面板的段落节奏

段间用**发丝线**：`border-block-end: 1px solid var(--tl-border-soft)`，最后一段去掉。**不要在段内再套
带边框/底色的面板**——「面板里的面板」正是要消除的堆叠感，用间距 + 一条线。段内节奏统一
`--tl-space-2`，段标题句首大写（§4.2），说明文字 `--tl-text-tertiary`。

### 5.4 破坏性操作的确认

清空数据、删除清单这类**不可逆**动作，确认流程按下面的形状来（依据 modern-web-guidance 的 native dialog 指南）：

1. **独立 modal `<dialog>`**：用原生元素 + `showModal()`。浏览器自带焦点陷阱、`Esc`、`:modal`
   顶层、关闭后焦点回到触发者。**不要**再手写 `role="dialog"`、`aria-modal`、`inert` 或 Esc 处理。
2. **安全动作默认获得焦点**：确认框打开时焦点落在「取消」上，破坏性按钮排在**不会紧贴触发按钮**的位置
   （右对齐行的末尾）。规范原文：*"put `autofocus` on the safe action (such as Cancel or Keep) in a
   destructive confirmation"*，以及 *"DON'T let the confirmation move controls under the pointer"*。
3. **迟滞（迟按下才生效）**：破坏性按钮在弹窗打开后短暂禁用（本仓库用 600ms）。这挡住三类误触：
   连点两下、脚本连发点击、长按 Enter 的重复 keydown。
4. **文案只讲代价**：说明一句话、确认一句话，数量单独给出。同一句话不要在三处重复——
   这既是噪音，也是把真实信息稀释掉了。
5. **优先可撤销**：能撤销就不要拦截。本仓库的删除有撤销栈；只有「清空全部」这种不可撤销的才拦。
   拦了之后**不要**再叠加第三层确认。

反例（本仓库真实事故）：内联两段式确认，触发按钮与确认按钮占据**同一屏幕位置**，一次双击即清空全部数据。

### 5.5 图标

全 app 只有**一套**图标，位于 `packages/ui/src/icons.tsx`。`apps/desktop/src/shell/icons.tsx`
只做 re-export，不画路径。

**几何来源**：一律取自 [Lucide](https://lucide.dev)（ISC 许可）。**不要手绘路径**——
手绘齿轮在这个仓库失败过两次：一次像太阳，一次像带凸起的轮子，原因是齿缺少平直侧壁。
这类形状不该每个图标重新推导一遍。

**规格**

| 项 | 值 | 原因 |
| --- | --- | --- |
| 网格 | `viewBox="0 0 24 24"` | Lucide 原生网格，path 可直接粘贴 |
| 描边 | 随尺寸缩放（14px→1.9 / 16px→1.8 / 18px→1.7 / ≥24px→1.6） | 描边是网格的固定比例；16px 上画 1.7 会比 24px 上显得更粗 |
| 端点 | `stroke-linecap/linejoin: round` | Lucide 一致 |
| 填充 | `fill: none`，仅圆点等装饰用 `fill="currentColor"` | |
| 颜色 | `currentColor`，**只此一种** | 图标继承控件颜色，hover/focus/disabled 无需单独写图标规则 |
| 默认尺寸 | `18`（可用 `size` 属性覆盖） | 侧栏、顶栏、按钮内均为 18 |

**可访问性**

- 每个 `<svg>` 固定 `aria-hidden="true"`；**名字属于控件**，用 `aria-label` 或可见文字给出。
- 图标**不得**作为唯一的语义载体：图标按钮必须有 `aria-label`。
- 对比度 ≥ **3:1**（WCAG 1.4.11 非文本对比）。默认用 `--tl-text-secondary`（浅/深色下均 ≥4.6:1）；
  **不要**用危险色或品牌色表示中性动作——红色问号曾被用来表示「帮助」，是语义误用。

**新增图标**

1. 在 Lucide 找到同名图标，复制其 path。
2. 加进 `packages/ui/src/icons.tsx`，按用途分组（导航 / 动作 / 状态 / 箭头）。
3. 在 14 / 16 / 18 / 24px 与两套主题下目视确认。
4. shell 需要时，在 `shell/icons.tsx` 补一行 re-export。


---

## 6. 动效

时长：`--tl-duration-fast`(120ms) 用于 hover/按下/颜色；`--tl-duration-base`(180ms) 用于进出场/位移；
`--tl-duration-slow`(260ms) 只留给大块过渡。缓动：`--tl-ease-standard`（默认）、`--tl-ease-out`（进场）、
`--tl-ease-in-out`（双向）。不要写 `100ms` 这种原值。

**只动画 transform / opacity**（含单独 `scale` / `translate` / `rotate`）——走合成器，不触发布局；
不要动画 `height`、`width`、`top`、`background-position`。**必须**提供
`@media (prefers-reduced-motion: reduce)` 分支：关掉 transition/animation，但**保留信号**——例如移动
成功的那圈高亮要「保持」而非「淡出」（见 `.qz-card--flash`），否则减少动效的用户会失去反馈。

---

## 7. 检查清单

提交前逐条打勾，审阅时也按这个问：

- [ ] 有硬编码颜色吗？（`#…` / `rgb()` / `hsl()` 出现在 T4 = 违规）
- [ ] 有新造的 tint / bar / radius 变量吗？（应只有 `--tl-block-*`，没有 `--x-tint`）
- [ ] 染色是 `color-mix(in oklab, <hue> N%, var(--tl-surface|--tl-tint-base))` 吗？混向 `white` 了吗？
- [ ] 文字 ≥ 4.5:1、边界/焦点 ≥ 3:1 量过了吗？用了 `-ink` 兄弟吗？
- [ ] 两套主题（`data-theme` 浅/深）都看过了吗？
- [ ] 三套皮肤（默认 / `protool` / `editorial`）都看过了吗？
- [ ] 尺寸走 `--tl-row-h` / `--tl-control-h` / `--tl-space-*`，而不是临时像素吗？
- [ ] 分区标签是句首大写，不是全大写微字距吗？
- [ ] 只动画了 transform / opacity 吗？`prefers-reduced-motion` 分支在吗？
- [ ] 新彩色对象复用了 `--tl-block-*`，而不是自建一套吗？
- [ ] 破坏性操作走独立 modal、焦点在安全动作、破坏性按钮有迟滞吗？（§5.4）
- [ ] 图标取自共享的那一套（Lucide 几何、currentColor、aria-hidden）吗？没有手绘路径吗？（§5.5）

---

## 8. 未完成 / 已知缺口

以下为撰写时**实际违反**本规范的位置（行号基于当次读取快照；仓库正被并行修改，以 grep 为准）。
按「收益/风险」排序。

1. **`--tl-block-*` 只在日历生效，base Chip 仍自造比例。** `packages/ui/src/styles.css:315` 用
   `10%`、`:327` 用 18%、`:380` 用 7%（均混向 `--tl-tint-base`），且 `:315` 保留 `--chip-tint` 逃生口、
   `Chip.tsx:20` 允许调用方注入任意 tint；基础竖条在 `:313` 是 **2px**，与 `--tl-block-bar` 的 3px 冲突。
   → 改为消费 `--tl-block-*`，删除 tint 逃生口。
2. **行/控件高度令牌是死令牌。** `--tl-row-h`、`--tl-row-gap`、`--tl-control-h`、`--tl-control-h-sm`
   与密集间距 `--tl-space-dense/-dense-2/-compact/-hairline` 在组件里**零引用**；`.qz-row`
   (`packages/features/src/styles.css:176,179`) 与 `.tk-row` (`:1440,1443`) 各写死 `36px`/`2px 8px`。
   → §4 目前只是目标。
3. **控件高度散落硬编码。** `packages/ui/src/styles.css:84`(32)、`:97`(28)、`:490`(26)、`:504`(28)；
   `pickers.css`、`data-transfer.css`、`lists.css` 成片 `30px/32px`。统一到 `--tl-control-h`/`-sm`（尤其
   26px 的分段控件偏小）。
4. **字面量时长。** `packages/ui/src/styles.css:261-262` 写死 `100ms`/`160ms`，应换 `--tl-duration-*`。
5. **字面量阴影。** `packages/features/src/styles.css:1110` 详情面板用 `rgb(20 20 25 / 0.28)`，
   应改为令牌或新增令牌。
6. **字段静止态用了重边框。** `calendar.css:238`（`.cal-input`）、`:334`、`pickers.css:19,327` 静止即
   `--tl-border-strong`，违反 §5.1；`styles.css:1228`（`tk-input`）已正确，可作范本。
7. **block 圆角写死 6px。** `calendar.css:127,552,1195` 用 `border-radius: 6px`，应改 `--tl-block-radius`。
8. **重复的胶囊实现。** `styles.css:1045` 起的 `.view-pill*` 是 `.tl-pill*` 的硬编码副本（含写死 28px），
   应删除并复用 `.tl-pill`。
9. **全大写微字距标签仍在。** `apps/desktop/src/shell/shell.css:227-228` 主题菜单标签
   `letter-spacing: 0.08em; text-transform: uppercase`，违反 §4.2；`lists.css:98` 的 `0.04em` 同类残留。
10. **低于字阶的字号。** `packages/features/src/search/search.css:212` 用 `font-size: 10px`（kbd），
    应改 `--tl-font-size-xs`。
11. **物理方向属性。** 议程 `.tv__event`（`styles.css:978`，`border-left` 在 `:989`）用 `border-left`
    而非 `border-inline-start`，与日历块写法不一致（纯一致性项）。
12. **象限 tint 令牌未被消费。** `--tl-quadrant-qN-tint` 在 CSS 中零引用（象限卡背景走 `--tl-surface`）：
    要么用起来，要么在令牌注释里标为预留。

> 后续任何一处修复都应同时**删掉本节对应条目**，让文档始终等于「现状 + 待办」，而不是一句谎。
