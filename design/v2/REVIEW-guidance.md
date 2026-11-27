# Kairos v2 设计稿评审 · 平台指南符合度

> 评审对象：`design/v2/` 下 17 个自包含 HTML 片段 + `shared.css` / `demo.css` / `base.js`
> 评审维度：modern-web-guidance（HTML 语义 · 原生浮层 · 表单控件 · 容器查询 · 文字排版 · 焦点）
> 评审方式：读源码 + 在 headless Chrome 158（CDP，127.0.0.1:9333）里真开、真按、真量
> 本文件只陈述结论；证据一律给到 `file:line` 和实测值。

**结论摘要：4 BLOCK · 11 WATCH · 11 MINOR。**

这一版的**原生底座是好的**：四个真模态全部 `<dialog>` + `showModal()`，Esc 原生关闭、焦点原生困住、
没有一处手写 `role="dialog"` / `aria-modal` / focus trap；`text-wrap` 用法合规；`prefers-reduced-motion` 已覆盖；
`.main` 已经带了 `container-type`。问题集中在**「浮层只用了一半原生」**：真模态里缺 `closedby` 和滚动遏制，
非模态浮层（菜单、气泡、就地捕获）全部退回 `<div>` + 手写 Esc + 手写 `getBoundingClientRect` 定位，
其中两处连「怎么关掉」都没写对。加上「模态没有可见关闭控件」和「矮窗口下模态被裁切且不可滚」，
构成了这份报告的四条 BLOCK。

---

## 0. 浮层总表：每一个浮层用的是什么原语

| # | 浮层 | 位置 | 原语 | 模态 | 关闭方式 | 判定 |
|---|---|---|---|---|---|---|
| 1 | 搜索面板 | `09-search.html:426` | `<dialog>` + `showModal()` | 是 | **仅 Esc** | **BLOCK** |
| 2 | 设置 | `10-settings.html:589` | `<dialog>` + `showModal()` | 是 | **仅 Esc** | **BLOCK** |
| 3 | 清空全部数据 | `11-dialogs.html:477` | `<dialog>` + `showModal()` | 是 | Esc / 取消（`.close()`） | WATCH |
| 4 | 删除一件事 | `11-dialogs.html:504` | `<dialog>` + `showModal()` | 是 | Esc / 取消（`.close()`） | WATCH |
| 5 | 快捷键帮助 | `11-dialogs.html:527` | `<dialog>` + `showModal()` | 是 | Esc（按钮被裁到视口外） | **BLOCK** |
| 6 | 导出进度 | `11-dialogs.html:566` | `<dialog>` + `showModal()` | 是 | Esc / 取消 / 完成 | PASS |
| 7 | 月视图条目气泡 | `03-calendar-month.html:491` | `<div role="dialog">` + `position:fixed` | 否 | Esc / 外部点击 | WATCH |
| 8 | 月视图当天全部 | `03-calendar-month.html:509` | `<div role="dialog">` + `fixed` | 否 | Esc / 外部点击 | WATCH |
| 9 | 周视图条目气泡 | `04-calendar-week.html:561` | `<div role="dialog">` + `fixed` | 否 | Esc / 外部点击 | WATCH |
| 10 | 周视图就地捕获 | `04-calendar-week.html:539` | `<div role="dialog">` + `fixed` | 否 | Esc / 外部点击 | WATCH |
| 11 | 日程条目气泡 | `05-agenda.html:345` | `<div role="dialog">` + `fixed` | 否 | Esc / 外部点击 | WATCH |
| 12 | 捕获条（三态） | `07-capture.html:610,650,712` | `<div role="dialog" aria-modal="false">`（内联静态） | 否 | —（内嵌展示，无需关） | WATCH |
| 13 | 捕获 · 选择时间 | `07-capture.html:677` | `<div role="dialog">` + `absolute` | 否 | **只能靠选一个值** | **BLOCK** |
| 14 | 四象限 ⋯ 菜单 | `01-quadrant.html:261,701` | `<div role="menu">`（JS 造） | 否 | Esc / 外部点击 | **BLOCK** |
| 15 | 多日视图就地捕获 | `14-multi-day.html:559` | `<div>`（无 role） | 否 | Esc / 外部点击 | WATCH |
| 16 | 日视图待确认 | `15-day.html:567` | `<div class="pending">` | 否 | 仅 Esc | WATCH |
| 17 | Toast ×8 | 03/04/05/06/09/10/11/12 | `<div role="status" aria-live>` | 否 | 定时消失 | MINOR |
| 18 | 详情面板 | `06-detail.html:650` | `<aside>`（常驻面板，非浮层） | 否 | Esc / 关闭按钮 | PASS |

> 判定口径：**原生** = 用的是 `<dialog>` / `popover` / 语义元素；**手搓** = `<div>` + 手写定位 + 手写关闭。
> 第 7–16 行全部是手搓；其中只有 13、14 的关闭逻辑本身是坏的。

**四类「本该是原生」的东西，这一版都手搓了**：菜单（→ `popover`）、非模态气泡（→ `popover`）、
就地捕获条（→ `popover`）、浮层定位（→ CSS anchor positioning，Chrome 158 已支持，实测 `CSS.supports('top','anchor(--a bottom)') === true`）。

---

## 1. BLOCK

### B1 · 捕获条的时间浮层：按 Esc 不关、点外面也不关

**场景**：`07-capture.html` 状态 B。用户点「时间」按钮展开浮层，随便点一下页面别处，再按 Esc——
浮层还在。整个应用里唯一能关掉它的办法是**从里面挑一个预设或点一天**。

**撞到什么**
> **DO** utilize the Popover API (`popover` attribute) for non-modal UI (menus, tooltips) that do not require focus traps.
>
> **DO** use `closedby="any"` … to enable native "light-dismiss" (closing on backdrop click) without custom JavaScript.

也撞到 `KEEP.md §C5`：「背后的网格要保持可交互，点外面就关」。

**位置**
- `07-capture.html:677` — `<div class="popover" data-role="popover" role="dialog" aria-label="选择时间">`，50 个可聚焦 `button` 全在里面；
- `07-capture.html:273-285` — `position:absolute` + `hidden` 当开关，没有 `popover` 属性；
- `07-capture.html:919-929` — `openPop(true)` 只在预设点击、日历点击、时间片点击时被调 `false`，**没有 drop 到 document 的 pointerdown / keydown**。

**实测**：浮层打开态下 `clickAt(1420,40)`（页面空白处）后 `hidden === false`；`pressEscape()` 后仍 `hidden === false`。
> `07 popover {"tag":"DIV","role":"dialog","popover":null}` / `07 after outside click still open? true` / `07 after Esc still open? true`

**怎么改**：改成 `popover="auto"`（或 `popover="manual"` + 一条 Esc 监听），锚点用
`anchor-name` / `position-anchor`。原生 light-dismiss、Esc、点外三条关闭路径一次到位。
若坚持手动实现，至少补 `document.addEventListener('pointerdown'…)` 与 `keydown === 'Escape'`，并把焦点还给「时间」按钮。

---

### B2 · 四象限 ⋯ 菜单：声明了 `role="menu"`，却从不把焦点放进去

**场景**：键盘用户 Tab 到某行的「更多操作」按 Enter，菜单出现。再按 Tab——焦点去了左侧 rail，
菜单（含「删除」）成了键盘够不着的孤岛。

**撞到什么**
> **DON'T** use generic elements with added ARIA roles or states when native elements with built-in semantics and behavior exist.
>
> **DO** utilize the Popover API (`popover` attribute) for non-modal UI (menus, tooltips)…

`role="menu"` 一旦写上，就承诺了「方向键在 menuitem 间移动、焦点在菜单内」这套键盘契约。这一版只抄了 role，
没抄行为——这比不写 role 更糟：读屏会宣布「菜单」，用户按方向键却什么都不会发生。

**位置**
- `01-quadrant.html:261-274` — `.qmenu` `position:fixed` + `z-index:var(--z-popover)`，纯 CSS 造的浮层；
- `01-quadrant.html:701-720` — `openMenu()`：造 div、`setAttribute('role','menu')`、`body.appendChild`，
  **没有 `menuItem.focus()`、没有 ArrowUp/Down、没有 `aria-expanded`/`aria-haspopup` 回写触发器**
  （实测触发器 `{"haspopup":null,"expanded":null}`），聚焦失败后 `document.activeElement` 是 `<body>`；
- `01-quadrant.html:690-699` — 只有 `closeMenu` 和 Esc。

**实测**：菜单打开后连按 5 次 Tab：`["BUTTON.rail__item" ×5]`，一次都没落进菜单。

**怎么改**：`<div popover="auto" role="menu" id="qmenu-x">` + 触发器写 `popovertarget` / `aria-haspopup="menu"`，
打开时 `menu.querySelector('[role=menuitem]').focus()`，补 ↑↓ Home End；或者干脆丢掉 role，
用「按钮组 + 原生 `popover`」——这是指南给菜单位的首选（`<dialog>` 管会打断人的事，`popover` 管菜单）。

---

### B3 · 快捷键弹窗：窗口一矮就被裁掉，而且滚不动

**场景**：窗口高度 420（笔记本分屏、或 125% 缩放下的 1080p）按 `?`。弹窗顶部跑到视口上方 −27px，
标题看不见；底部「关闭」按钮在 402–434，**完全在视口外**。滚轮滚不动——弹窗设了 `overflow: visible`，
`scrollHeight === clientHeight`。

**撞到什么**
> **DO** ensure that focusable elements aren't obscured by anything when they receive focus …（WCAG 2.4.11 Focus Not Obscured）
>
> **DO** provide a visible control for closing modal overlays…

`showModal()` 会把焦点放进弹窗，而这里落点恰好是那个被裁掉的「关闭」按钮——
键盘用户看到的是「按了 ? 页面变暗、什么都没发生」。

**位置**
- `11-dialogs.html:213-218` — `dialog.native-dlg { max-block-size: none; margin: auto; overflow: visible; }`
- `11-dialogs.html:527` — 快捷键弹窗又用内联 `inline-size:min(46rem, calc(100vw - var(--sp-8)))` 撑到 46rem 宽，内容更高。

**实测**

| 视口高 | dialog top | 关闭按钮 | 可滚动 |
|---|---|---|---|
| 520 | 23 | 452–484 可见 | 否（不需要） |
| 420 | **−27** | 402–434 **CLIPPED** | `scrollHeight === clientHeight`，滚轮无效 |
| 340 | −67 | 362–394 CLIPPED | 同上 |

Tab 循环也证实：`["…[visible]","打开 [visible]","关闭 [CLIPPED]","打开 [visible]","关闭 [CLIPPED]"]`。

**怎么改**：`dialog { max-block-size: calc(100dvh - 2rem); overflow: auto; overscroll-behavior: contain; }`
把 `max-block-size: none` 删掉（它只服务于「不想出滚动条」，代价是没有上限）。

---

### B4 · 两个真模态都没有可见关闭控件，而且没有 `closedby` 轻关闭

**场景**：打开「设置」（或 Ctrl+K 的搜索面板）。界面上**没有任何 ×、没有「关闭」、没有「完成」**。
点浮层外的灰色区域——什么都不发生（`--scrim` 只是颜色，不是关闭）。
唯一出口是 Esc；对语音控制用户（「点击关闭」）和不知道 Esc 的人来说，这两个模态是出不去的。

**撞到什么**
> **DO** provide a visible control for closing modal overlays, so that people using voice control software can easily determine how to dismiss the modal dialog.
>
> **DO** use the `closedby="any"` attribute to enable native "light-dismiss" (closing on backdrop click) without custom JavaScript.

**位置**
- `09-search.html:236-245` — `dialog.palette-dialog`，`::backdrop` 有颜色、无 `closedby`；`426` 的 `<dialog>` 只有 `aria-label`；
- `10-settings.html:248-255` — `dialog.settings-dialog`，同上；`589-591` 的 `<dialog>` 内只有一个 `h3.visually-hidden`；
- 设置弹窗里按钮全集实测：`["外观","数据","关于","A精炼",…,"导出完整备份","导出 CSV","选择备份文件…","清空全部数据","打开文件夹"]` —— **没有一个是关闭**。

**实测**：`10 backdrop click closes? false`；`09 backdrop click closes? false`；`09 close btn false`。
（Esc 是真的能关：`09 after Esc open=false`、`10 Esc closes? true`——所以这是「关得掉但看不出来」的问题，不是死锁。）

**怎么改**：两个 `<dialog>` 都加 `closedby="any"`；设置弹窗右上或底栏加一个 `关闭`（`aria-label="关闭设置"`）；
搜索面板在 `.palette__foot` 的「Esc 关闭」旁加一个真正的按钮。`closedby` 不支持时的兜底
（`dialog.addEventListener('click', e => { if (e.target === dlg) dlg.close() })`）写进 `shared.css` 旁边或 `KEEP.md`。

---

## 2. WATCH

### W1 · `shared.css` 里没有一条 `dialog` 规则：滚动遏制全缺

> **MANDATORY**: Set `overscroll-behavior: contain` on the `<dialog>` (using `dialog:modal`) and the `dialog::backdrop`.
> **MANDATORY**: Set `overflow: hidden` (or `auto`) on `dialog::backdrop` so that it becomes a scroll container.

`shared.css` 出现 `dialog` 的次数：**0**。四个模态各自只写了 `::backdrop { background: var(--scrim) }`。

**实测**（每个模态 computed）：`overscroll-behavior: auto`、`::backdrop { overflow: visible; overscroll-behavior: auto }`。

**位置**：`shared.css`（整体缺）；`09-search.html:244`、`10-settings.html:254`、`11-dialogs.html:219` 只有背景色。

**怎么改**：把这段放进 `shared.css`，一处覆盖 17 个片段：

```css
dialog:modal { overscroll-behavior: contain; }
dialog::backdrop { overflow: hidden; overscroll-behavior: contain; }
```

### W2 · `closedby` 十七个片段一次都没用

> **DO** use the `closedby="any"` attribute to enable native "light-dismiss"…

`grep closedby` 在 `*.html` 里 0 命中（`HTMLDialogElement.prototype` 上 `closedBy` 存在，Chrome 158）。
这条与 B4 是同一根因；B4 讲后果，这里讲「平台能力没用上」。

### W3 · 非模态气泡被写成 `role="dialog"`，且没有 `popover`

> **DO** utilize the Popover API for non-modal UI (menus, tooltips) that do not require focus traps.

第 7–11 行浮层：`<div role="dialog">` + `hidden` + `position: fixed` + 手写 `clampPlace()`。
它们是「看一眼 / 点一下」的气泡，不该声明成对话框（对话框语义会给读屏一个「已进入对话框」的错误暗示），
更不该手写：`03:545`、`04:639`、`05:383` 三份一模一样的 `clampPlace`，
以及 `03:1007-1012`、`04:1133-1135`、`05:714-722` 三份一模一样的「pointerdown 外点 + keydown Esc」。
另外 `07-capture.html:610,650,712` 的捕获条把 `role="dialog" aria-modal="false"` 挂在**静态内联**的 div 上——
`aria-modal="false"` 是 `role="dialog"` 的默认值，写了等于没写，属于冗余 ARIA。

**怎么改**：`<div popover="auto" id="pop-item">`，用 `anchor-name` 锚到被点的那一条；
`role` 删掉。`keepalive` 场景（气泡里要放可交互按钮）用 `popover="manual"` + 一条 Esc。

顺带：第 9、11 行（`04` 条目气泡、`05` 条目气泡）虽有「打开 / 勾完成」两个按钮，
但**没有关闭控件**——只有 Esc 和点外面。非模态不强制这条，但语音控制用户点不到「关掉这个」。
`popover="auto"` 自带的 light-dismiss 能补上，或者在气泡角上加一个 `aria-label="关闭"` 的 ×。

### W4 · 三套「就地捕获条」，三套手写关闭

| 文件 | 结构 | 关闭 |
|---|---|---|
| `04-calendar-week.html:539` | `<div class="cap" role="dialog">` fixed | 外点 / Esc / 输入框 Esc（`981-983`,`1133`） |
| `14-multi-day.html:559` | `<div class="cap">`（无 role）absolute 在网格里 | 外点 `mousedown` / 头一次 Esc（`586`） |
| `15-day.html:567` | `<div class="pending">` | **只有** `document keydown Esc`（`586`） |

这三处是同一件事的三种写法，关闭键各不相同；`15` 的 `pending` 甚至没有外点关闭，也没有「取消」按钮。
指南里同一句「non-modal → popover」就解决掉三份实现。`KEEP.md §C5` 说的「不用 `<dialog>`」仍然成立——
`popover` 不是 `<dialog>`。

### W5 · 平铺清单的 `role="listbox"` 是一张不成立的契约

**场景**：Tab 进 `.lrow`，按 ↓——什么都没发生；再 Tab，焦点落到行内那个复选框上。

**撞到什么**
> **DON'T** use generic elements with added ARIA roles or states when native elements with built-in semantics and behavior exist.
> **DON'T** change the native semantics of elements with ARIA unless it is a critical requirement.

`<ul role="listbox">` + `<li role="option" tabindex="0">`：listbox 承诺「↑↓ 移动选中、整组一个 Tab 停点」，
这里每一项都是 `tabindex="0"`，↓ 无处理（`02-list.html` 全文只有 click 监听），而且每个 option 里还嵌了一个原生
`<input type="checkbox">`——一个「选项」里放一个可独立聚焦的控件，会让读屏的 listbox 模式直接失效。

**位置**：`02-list.html:436`（li 的 role/tabindex）、`540`、`553`（ul role="listbox"）。

**实测**：`02 focused lrow/option` → `ArrowDown` → 仍是同一个 `lrow`；`Tab` → `INPUT.check`。

**怎么改**：删掉 `role="listbox"/"option"/"aria-selected"`，回到 `<ul>` + 行内 `<button>`（或整行 `<a>`/`<label>`）。
多选语义交给那个原生 checkbox，它本来就是对的。

### W6 · 所有 radiogroup 都是「全员 tabIndex=0」，KEEP C2 要求的 roving 只在一个片段实现

> 指南 §6：**DON'T** use positive `tabindex` … **DO** rely on natural DOM order for sequential navigation.
> 仓库自己的 `KEEP.md §C2`：「`role="radiogroup"` + roving tabindex + 方向键 + Home/End。全组 `tabIndex=0` 是错误。」

`16-components.html:1851` 正确地实现了 roving（`item.tabIndex = i === index ? 0 : -1`），
但 **06 / 08 / 10 / 12 / 13 / 14 全部是全员 0**：

| 文件 | 组 | 实测 tabIndex |
|---|---|---|
| `06-detail.html:667-693` | 时间精度（6） | `[0,0,0,0,0,0]` |
| `08-time-picker.html:534-551` | 时间精度（6） | `[0,0,0,0,0,0]` |
| `13-year.html:353-358` | 日历视图（5） | `[0,0,0,0,0]` |
| `14-multi-day.html:315-324` | 多日 / 视图（8） | `[0,0,0,0,0,0,0,0]` |
| `10-settings.html:378,412` | 皮肤 / 主题 | 全员 0（且 `role="tablist"` 的 tab 也没做 roving） |

后果是指南与 KEEP 都点名的那个：用户要按六次 Tab 才能跳过一组时间精度。
`06` / `08` 还各写了一份 `ArrowDown/Up` 处理（`06:1124`、`08:862`），方向键有了、roving 没做——半套实现。

### W7 · 设置弹窗克隆出四份重复 id，tabpanel 的 `aria-labelledby` 全是空指针

**场景**：`10-settings.html` 为了在页面上并排展示「外观 / 数据 / 关于」三个静态画框，
把同一张 `.settings` 壳克隆了 4 次（3 个画框 + 1 个真弹窗）。

**撞到什么**
> **DO** ensure that information is available for people using screen readers, using text alternatives, appropriate accessible names, roles, and programmatic state information.

**实测**
- 重复 id：`pane-appearance ×4`、`pane-data ×4`、`pane-about ×4`、`storagePath ×4`、`dbSize ×4`；
- 12 个 `role="tab"` **没有一个有 `id`**（`hasOwnId:false` ×12）；
- 12 个 `role="tabpanel"` 的 `aria-labelledby="tab-appearance|tab-data|tab-about"` **全部指向不存在的 id**（`exists:false` ×12）；
- `aria-controls="pane-data"` 指向的是**第一个** `pane-data`，不一定是同一个画框里的那个。

**位置**：`10-settings.html:355-363`（tab）、`371/444/539`（panel）、`800-826`（克隆逻辑）。

**怎么改**：克隆时给每个副本加前缀（`frame2-pane-data`），tab 补 `id` 并回写 `aria-labelledby`；
或者画框里的静态示意改用 `role="group"`、真弹窗保留 tab 语义——现在两者混在一起，语义是假的。

### W8 · 搜索面板的 combobox 三根线都断了

> **DO** ensure that information is available for people using screen readers, using text alternatives, appropriate accessible names, roles, and programmatic state information.

- 输入框没有 `role="combobox"`、没有 `aria-controls`、没有 `aria-expanded`（实测 `{role:null, expanded:null, controls:null}`）；
- `.palette__row` 是 `role="option"` 但**没有 `id`**（实测 `optionIds: ["(none)","(none)","(none)"]`），
  所以 `list.setAttribute('aria-activedescendant','')` 永远只能是空串（`09-search.html:536`）；
- `09-search.html:514` 生成的 `<label for="q7f3x1">` 的 `for` 是随机串，**input 没有 id**（实测 `matches:false`）——
  靠 input 自己的 `aria-label` 兜住了可访问名，但那行 label 是死代码。

**位置**：`09-search.html:503-519`、`536`、`514`。

### W9 · 组件布局用视口媒体查询，而不是容器查询

> Use container queries instead of viewport-width media queries for component layout, so a component adapts wherever it is placed.

`shared.css:247-251` 已经给 `.main` 设了 `container: main / inline-size`，
`03` 和 `06` 的底部胶囊也照 `KEEP §D2` 改成了 `.floating-center`。但**组件级**的断点还留在视口上：

| 位置 | 断点 | 它其实在判断什么 |
|---|---|---|
| `10-settings.html:269` | `@media (max-width: 720px)` → `.settings` 单列 | 组件在**弹窗里**自己有多宽 |
| `13-year.html:290` | `@media (max-width: 74rem)` → 隐藏 `.stats`、卡片跨 3 列 | 年视图网格自身宽度 |
| `16-components.html:470` | `@media (max-width: 1100px)` → 三套 grid 降两列 | 卡片流宽度 |
| `17-icons.html:172` | `@media (max-width: 1100px)` | 同上 |
| `12-empty-states.html:143` | `@media (max-width: 720px)` | 画框宽度 |

最直接的反例是设置：同一个 `.settings` 在 928px 的画框里和 760px 的弹窗里，
`@media (max-width:720px)` 给出的答案一样（都是「三列」），因为视口没变——判据维度错了。
改成 `container-type: inline-size` + `@container (max-width: 40rem)`，组件搬到哪儿都对。

### W10 · 浮层定位靠 JS + `window.innerWidth`，不用 CSS anchor positioning

`03:545`、`04:639`、`05:383` 三份 `clampPlace()`，再加 `03:1018` / `04:1138` 的 `resize` 重排。
Chrome 158 实测：`CSS.supports('top','anchor(--a bottom)') === true`、`CSS.supports('position-anchor','--a') === true`。
指南的浮层章节配套的就是 `anchor-name` / `position-anchor` / `position-try-fallbacks`——
它原生处理「贴着锚点、出界自动翻转、窗口变化自动跟随」，正好是这三份 `clampPlace` 手写的全部内容。

### W11 · 17 个片段的主区都是 `<div class="main">`，全站没有一个 `<main>`

> **DO** use semantic landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`) to create regional navigation for assistive technologies.
> **DON'T** use generic `<div>` or `<span>` when semantic elements exist.

`<nav class="rail">`（17/17）、`<aside class="sidebar">`、`<header class="topbar">` 都做对了，
唯独 `.main` 是 div（`shared.css:247` 的选择器也是 `.main`）。读屏的「跳到主内容」跳跃键在这里没有落点。
`index.html:82` 和 `REVIEW.html:49` 反而用了 `<main>`——说明不是不知道，是漏了。

**怎么改**：`shared.css` 里 `.main` 的规则改成 `main`（或加 `main.main`），片段骨架按 `SPEC.md §6` 更新。
顺带 `06-detail.html:650` 的 `<aside class="inspector">` 是对的，不需要动。

---

## 3. MINOR

| # | 问题 | 位置 | 指南根据 |
|---|---|---|---|
| M1 | 全站 0 个 `<search>`；搜索面板的真实输入也没包在 `<search>` / `<form role=search>` 里 | 17 个文件；`09-search.html:513-517` | **DO** use `<search>` to enclose search and filtering mechanisms |
| M2 | 没有 `color-scheme` 声明。实测 `getComputedStyle(document.documentElement).colorScheme === 'normal'`，深色主题下原生 `<select>` 弹层、滚动条、自动填充仍是浅色 | `shared.css`（`:root`）；`06-detail.html:717` 的 `<select>` | 深色模式章节：声明 `color-scheme` 让 UA 控件跟随 |
| M3 | `text-wrap: balance` 只写到 `h3`，设置里 7 个 `h4` 拿到的是 `wrap`（实测 `h4 → wrap`） | `shared.css:414`；`10-settings.html:376,410,432,449,504,518,527` | **DO** balance on headings（**没有**写成 `*`，这点做对了） |
| M4 | `prefers-contrast` / `forced-colors` 全站 0 处。`KEEP §A4` 自己说「box-shadow 在强制色下整个消失」，那就更需要一个 `@media (forced-colors: active)` 兜住描边 | `shared.css` | 高对比度 / 强制色 |
| M5 | 状态挂在没有角色的元素上：`<tr aria-selected>`（`role=null`，实测），以及 `role="group"` 里的 `aria-checked`（`04-calendar-week.html:547-550`） | `08-time-picker.html:476-506,744`；`04-calendar-week.html:547-550` | **DON'T** use generic elements with added ARIA states |
| M6 | 三个确认弹窗用 `cancel.closest('dialog').close()` 手写关闭，而不是 `<form method="dialog">` | `11-dialogs.html:747` | **DO** use `<form method="dialog">` to dismiss dialogs without manual JS |
| M7 | 静态内联样式与字面量颜色：`09` 15 处、`10` 14 处、`11` 14 处、`16` 19 处、`17` 20 处（如 `style="background:#5b8def"`），部分违反 `SPEC.md §5` | `09-search.html:306-309`；`10-settings.html:...`；`16-components.html` | **DON'T** use inline styles for static design that belong in a stylesheet |
| M8 | `100vh` 而非 `100dvh`（桌面壳内影响小，但模态高度直接吃 `100vh`） | `09-search.html:240`；`10-settings.html:76`；`shared.css:177` | 视口单位：`dvh` 更稳 |
| M9 | 详情面板 Esc 关闭后焦点落到 `<body>`（实测 `BODY`），没有还给打开它的行 | `06-detail.html:1065,1207,1215` | **DO** maintain focus … returning it to the trigger control |
| M10 | Toast 用 `position:fixed` + `div role=status`；指南把 toast 归到 `popover`（`popover="manual"`） | `03:483`、`04:530`、`05:336`、`09:427`、`10:592`、`11:593`、`12:331` | **DO** utilize the Popover API for non-modal UI … toasts |
| M11 | `role="dialog"` 的**静态示意**用 `<div>` 画在页面上：指南只允许 `role="dialog"` 出现在真对话框上，且 `<dialog>` 才有焦点语义。`11-dialogs.html` 的静态标本正确改用了 `role="group"`，其余片段没改 | `03-calendar-month.html:491,509`、`04:539,561`、`05:345`、`07:610,650,677,712` | **DON'T** use generic `<div>` … with added ARIA roles |

---

## 4. 已做对、不要「修」的（防止下一轮误改）

1. **`<dialog>` 第一原则完全合规**：`09/10/11` 四个 `<dialog>` 上**没有** `role="dialog"`、`aria-modal`、
   手写 focus trap、`inert` 切换、手写 Esc。`11-dialogs.html:765` 甚至留了注释「Esc handled natively by `<dialog>`」。
   `11` 里静态示意用的 `role="group"` 也是对的（它不是真弹窗）。
2. **模态打开时焦点确实在里面**：`dlgWipe` Tab 循环实测 `["取消 [in]","…[in]"]` 反复，没有一次逃到 `[OUT]`。
3. **`<dialog>` 背景用令牌**：三处 `::backdrop { background: var(--scrim) }`。
   只是 `--scrim` 是三个文件各自的局部变量（`09:11-16`、`10:14-15`、`11:18-21`），不属于 `shared.css` 的令牌——
   一致性维度可以另提，但用法本身是指南认可的。
4. **`text-wrap` 没有落到 `*`**：`shared.css:414-415` 只写 `h1,h2,h3` 与 `p,li`，正是指南要求的写法。
5. **禁止项都守住了**：无 `onclick=` 内联事件（0 处）、无正 `tabindex`、无 `role="presentation"` 滥用。
6. **`prefers-reduced-motion` 覆盖到位**：`shared.css:436` 全局兜底，另有 6 处片段级细化。
7. **触摸目标**：`:root { --target-size: 24px }` + `@media (pointer: coarse) { 44px }`，`shared.css:400-409`。
8. **`<select>` 是真原生**：`06-detail.html:717` 用 `<select>`，外面只包了一层定位壳、`appearance:none` 后自绘箭头——
   这是「原生控件 + 样式」，不是「用 div 重造 listbox」，符合指南偏好。
9. **片段间跳转用 `<a href>`**：`base.js` 的演示条全部是 `<a>`（`index.html`、`^`、`‹`、`›`）；
   rail 里的按钮是切视图（同页动作），用 `<button>` 也对。

---

## 5. 验证方法（可复跑）

- 浏览器：headless Chrome 158.0.8127.38，`http://127.0.0.1:9333`；
- 驱动：`C:/Users/EDY/AppData/Local/Temp/ui-design/scripts/cdp.mjs`，
  本轮脚本 `gd-probe1.mjs` … `gd-probe21.mjs`（同目录），每个文件直接 `node <file>`；
- 关键测量项：`dialog.open` / `matches(':modal')`、`getComputedStyle(dialog).overscrollBehavior`、
  `getComputedStyle(dialog,'::backdrop').overflow`、Tab 循环的 `contains(activeElement)`、
  视口 420/460/520 下的 `getBoundingClientRect()`、`CSS.supports('top','anchor(--a bottom)')`、
  `getComputedStyle(h1).textWrap`、重复 id 扫描。

> 注：`03/04/05` 里用 `window.innerWidth` 写死的定位在 1440×900 下看不出问题，
> 是在 1280×420 这一档才暴露的。评审浮层类问题请至少量一遍「矮窗口」。
