# Kairos v2 设计稿评审 · 可访问性与键盘操作

> 评审对象：`design/v2/` 下 17 个自包含 HTML 片段 + `shared.css` / `demo.css` / `base.js` / `data.js`
> 评审维度：语义地标 · 标题层级 · 原生对话框 · roving tabindex · 可访问名 · 焦点可见性 · 焦点不被遮挡 · 触摸目标 · live region · 表单标签
> 评审方式：在 headless Chrome 158（CDP，`127.0.0.1:9333`）里用**真 Tab / 真方向键 / 真 Enter / 真 Space** 走完每个片段，
> 每一个结论都从**实时 DOM** 取 `getComputedStyle`、`elementFromPoint`、`document.activeElement`、`Accessibility.getFullAXTree` 得来，
> 不靠读源码推断。**探针一律用 `Emulation.setFocusEmulationEnabled({enabled:true})`**，否则 `document.hasFocus()` 为假、
> `:focus-visible` 不生效，会得到整片假阴性。
> 本文件只陈述结论；证据一律给到 `file:line` 和实测值。

**结论摘要：6 BLOCK · 12 WATCH · 10 MINOR。**

这一版的**外观层达标得相当整齐**：17 个片段里 16 个有且只有一个 `<h1>`（`06` 是唯一跳级）、
`lang="zh-CN"` 全部到位、图标按钮基本都有 `aria-label`、装饰性 SVG 的 `aria-hidden` 覆盖率超过 100%（连非 SVG 装饰都标了）、
真模态全部用原生 `<dialog>` + `showModal()`、`:focus-visible` 几乎每个可聚焦元素都有一条 2px 实心环。
键盘用户在**列表和象限板**上能完整操作：Tab → Space 勾完成、Enter 开菜单、方向键在菜单里走。

问题集中在两类：

1. **`role` 写了，但 `role` 承诺的行为没兑现。** `role="radiogroup"` 有 14 处、`role="tablist"` 有 1 处、
   `role="option"` 有 20 处、`role="menu"` 有 1 处——其中 **15 组复合控件让每个选项都 `tabIndex=0`**（只有 `16` 的两组例外）
   （最刺眼的是 `06` 的时间阶梯 6 个停点、`08` 的同款控件 6 个停点），20 个 option 全部 `tabIndex=0` 且一个没被选中。
   这比不写 role 更糟：屏幕阅读器会播报「单选组，6 个选项，已选 1 个」，然后用户按 ← → 什么也不发生，只能靠 Tab 一格一格爬。
2. **06 的脚本从 23:03 起语法错误，整页不渲染。** 这是评审期间被改坏的（其它维度同时也在改稿）。它现在不只是可访问性问题，
   而是**整个片段打不开**。

另外一条跨全部片段的元问题：`base.js` 把全局 `←` / `→` 绑成「翻到上一个/下一个片段」。这是一个**评审脚手架**，
但它监听在 `document` 上、只看被聚焦元素是不是文本框，于是**任何按钮、分段、日历格上的方向键都会被它抢先翻页**——
而这一版恰好有 15 组 radiogroup / tablist 应该用方向键。

---

## 0. 总表

| # | 级别 | 片段 | 问题 | 实测 |
|---|---|---|---|---|
| B1 | **BLOCK** | `06-detail.html` | 脚本 `SyntaxError`，整页不渲染，列表 0 行 | `Runtime.exceptionThrown` @ `06:1179` |
| B2 | **BLOCK** | 全局 ×15 | `role="radiogroup"` / `role="tablist"` 全组 `tabIndex=0`，方向键不换项 | 17 组中 15 组 `tab0 = n` |
| B3 | **BLOCK** | `03` `04` `05` | `role="dialog"` 手搓浮层无焦点进入、无焦点归还、无关闭控件 | Tab 44 次（`03`）/ 65 次（`05`）才够到；`aria-haspopup` 缺失 |
| B4 | **BLOCK** | `09-search.html` | 20 条搜索结果的**每一条可访问名都是 `…，undefined，…`** | AX tree：`「更新简历，undefined，下个月」` |
| B5 | **BLOCK** | `09` `10` | 真模态里**没有可见的关闭控件**（只有 Esc） | `querySelector('[aria-label*=关闭],.close')` → null |
| B6 | **BLOCK** | `10-settings.html` | `aria-controls` 指向**文档里第一个** `#pane-data`（隐藏），选中的 tab 播报错误的隐藏面板 | 5 个重复 id ×4 |
| W1 | WATCH | `01` `05` | 勾完成后重建 DOM，**焦点掉到 `<body>`** | 按 Space 后 `activeElement === body` |
| W2 | WATCH | `02-list.html` | `role="option"` ×20 全 `tabIndex=0`、无一 `aria-selected`、方向键不动 | 20 / 20 tabbable，`aria-selected=true` 计数 0 |
| W3 | WATCH | 全局 | `base.js` 全局劫持 `←/→` 翻片段，抢走分段的换项键 | `13` 按 → 直接跳到 `14-multi-day.html` |
| W4 | WATCH | `01` `02` `03` `05` `13` `14` `15` | **演示条盖住顶栏控件**：`新建`、`按时间/按清单`、`新建事情` 被遮 92–94% | 命中测试 `elementsFromPoint` 最上层是 `demo-bar` |
| W5 | WATCH | `03` `04` `05` `07` | 手搓浮层只复制了 `role="dialog"`，没有 `aria-modal`、没有焦点进入/归还、没有 `aria-haspopup` | 打开后 `focusInPop=false` |
| W6 | WATCH | `02` `05` | `<button>` / `role="option"` 里嵌 `<input type=checkbox>`（`05` 有 19 处） | AX tree：51 button + 19 checkbox |
| W7 | WATCH | 全部 | **没有任何片段有 `<main>`**（`index.html` 除外） | AX tree landmarks 只有 `banner / navigation / complementary` |
| W8 | WATCH | `03` `04` | 日历格 / 时间槽用 22×24、151×38 的按钮平铺，**Tab 停点 94 / 176 个** | `03` 94、`04` 176 |
| W9 | WATCH | `15-day.html` | 时间块本身不可聚焦，唯一入口是 6 个 20×20 的行内图标按钮（容器靠 focus-within 才显形） | `blk` 为 `DIV tabIndex=-1` |
| W10 | WATCH | `16-components.html` | `role="table"` 手工表：20 个 cell 全不带行列语义、`role="row"` 无 `rowheader` | AX：`rowheaders = 0` |
| W11 | WATCH | `07-capture.html` | 错误行 `保存失败，内容已保留。` **无 `role="alert"` / `aria-live`** | `role=null, aria-live=null` |
| W12 | WATCH | `12-empty-states.html` | 「不限」桶切换后空状态**无 live 播报、焦点不回** | 切换后 `activeElement = body` |
| M1 | MINOR | 全部 | 演示条焦点环 `outline: auto 1px rgb(16,16,16)` 在深色底上不可见 | 计算样式 |
| M2 | MINOR | `01` | 行内 `⋯` 按钮静止时 `opacity: 0`，键盘 Tab 到它才显形 | `opacity 0 → 1` on focus |
| M3 | MINOR | 全部 | 顶栏被演示条挤掉一块，`padding-inline-end: 7.25rem/10rem` 是**为脚手架打的补丁** | `13:32`、`03:18` |
| M4 | MINOR | `03` | 日格按钮 22×24（42 个）、`新建清单` 20×24，低于 24×24 | 实测 |
| M5 | MINOR | `01` `05` `16` | `.check` 16×16，热区靠行高撑到 34 / 38，左右仍只有 16px | `01` 左右 ±10px 命中 `qrow` |
| M6 | MINOR | `06-detail.html` | 标题层级 `h1 → h3`，跳过 `h2` | 4 个 `h3`（时间/象限/清单/备注） |
| M7 | MINOR | `09` `11` | `09` 2 个、`11` 8 个 `svg` 缺 `aria-hidden`（都在装饰容器内） | 逐节点查 |
| M8 | MINOR | `13` `14` `15` | 「月/周/多日/日/年」视图分段**完全不响应任何激活**（Enter、Space、点击都无效） | `13` 点击「月」后 `aria-checked` 不变 |
| M9 | MINOR | `11-dialogs.html` | 「清空全部数据」的 600ms 迟滞提示**无 live 播报**，禁用态变化无声 | `aria-live=null` |
| M10 | MINOR | `16-components.html` | 规范表画了 `.cb.is-focus` 的焦点环，**真实复选框没有 `:focus-visible`** | UA 默认 `auto 1px #101010` |

**每一条都在实时 DOM 里验证过**（见各条的「实测」列）。M7 的 10 个 SVG 确实没有 `aria-hidden`，
但它们都在 `aria-hidden` 容器内或已命名按钮内，屏幕阅读器不会误读，所以只记 MINOR。

---

## 1. BLOCK

### B1 · `06-detail.html` 整页不渲染：脚本语法错误

**场景**：打开 `06-detail.html`。它是「详情面板」这唯一的编辑面——
ADR 0004 §1 规定「详情面板只有一个」，所以这一页是全套稿子里最重要的一页。

**用户撞到什么**：页面外壳在、标题在、右侧详情面板的骨架在，**左边列表是空的**。
键盘用户按 Tab 只能在外壳里绕：rail 之后直接跳到右侧面板的「标题」输入框，
中间那 19 条事情一条都到不了。这不是「少了一个功能」，是**这一页整个不工作**。

```
Runtime.exceptionThrown  file:///.../06-detail.html
  lineNumber: 1178  text: "Uncaught"
  SyntaxError: Invalid left-hand side in assignment
```

**位置**：`06-detail.html:1179`

```js
K.quadrantOf(it) = +btn.getAttribute('data-q');   // 函数调用在赋值左边
```

这是改稿时把 `it.quadrant = …` 改成了 `K.quadrantOf(it) = …`——ADR §4 要求象限**派生不存储**，
改的人把「读」的写法照搬到了「写」的位置。语法错误使整个 `<script>` 块不执行：
`renderList()` 从未运行，`#rows` 始终是空的（实测 `children.length === 0`，而 `19 件未完成` 的计数却是对的——
那个数字写在 HTML 里，是个假象）。

**实测**：`Runtime.exceptionThrown` 捕获到 1 条异常；`document.getElementById('rows').children.length === 0`；
`window.Kairos` 存在、`K.quadrantOf` 是函数，所以不是数据问题。其余 16 个片段 `EXC_COUNT = 0`。

**为什么是 BLOCK**：一个键盘/屏幕阅读器用户在这一页上**无法完成任何任务**：看不到列表、选不中事情、改不了象限、删不了、撤销不了。

---

### B2 · 14 个 `role="radiogroup"` + 1 个 `role="tablist"` 让每个选项都 `tabIndex=0`，方向键不换项

**场景**：用户在 `06-detail.html` 的右侧面板改「时间精度」。这一组是整份稿子里最核心的控件——
ADR 0004 的「四个词、五种形状」全靠它表达。

**用户撞到什么**：屏幕阅读器播报「时间精度，单选组，6 个选项，已选 2 个」（`06` 实测已选 `day`）。
用户按 ↓：**焦点跳到下一个，但选中项不变**（实测 `aria-checked` 数组 `[f,f,t,f,f,f]` 前后一致）。
按 ↑：也不动。按 Home / End：**什么都不发生**。
想不选中任何东西地越过这一组？做不到——6 个选项每个都是 Tab 停点，要按 6 次 Tab。

KEEP.md §C2 写得很清楚：

> `role="radiogroup"` + roving tabindex + 方向键 + Home/End。
> **全组 `tabIndex=0` 是错误**——用户要按四次 Tab 才能越过一组。

**实测的 15 组坏掉的**（源码共 16 个 `radiogroup` + 1 个 `tablist`；`16` 的两组 `segx` 是唯一做对的）：

| 片段 | 位置 | 组 | n | tab0 |
|---|---|---|---|---|
| `02-list.html` | `265` | 分组方式 | 2 | 2 |
| `06-detail.html` | `667` | 时间精度 | 6 | 6 |
| `06-detail.html` | `705` | 象限 | 4 | 4 |
| `07-capture.html` | `622` / `662` / `729` | 象限 ×3 组 | 4 | 4 |
| `08-time-picker.html` | `534` | 时间精度 | 6 | 6 |
| `10-settings.html` | `353` | 设置分类（tablist） | 3 | 3 |
| `10-settings.html` | `378` | 皮肤 | 3 | 3 |
| `10-settings.html` | `412` | 主题 | 3 | 3 |
| `12-empty-states.html` | `295` | 不限桶状态 | 2 | 2 |
| `13-year.html` | `353` | 日历视图 | 5 | 5 |
| `14-multi-day.html` | `314` | 显示天数 | 3 | 3 |
| `14-multi-day.html` | `319` | 日历视图 | 5 | 5 |
| `15-day.html` | `328` | 日历视图 | 5 | 5 |

唯一做对的是 `16-components.html:850,863`（`segx`）：`tab0 = 1`，← → ↑ ↓ Home End 全通。
那份文件里还有一段注释自己解释了为什么（`16:1884`）：

> `base.js` 在 document 上监听 ←/→ 做片段跳转；分段控件里的方向键是「换选中」，必须就地截住，否则会翻页。

**这一条被 B3/W3 加倍放大**：即使某个组自己实现了方向键（`06` 实现了 ↓↑），
`06-detail.html:1124` 的处理器只处理 `ArrowDown/ArrowUp`、不处理 `ArrowLeft/ArrowRight`；
而 ← → 被 `base.js` 抢走 → **用户按 ← 会离开这个片段**（实测 `06` 按 → 跳到 `07-capture.html`）。

**位置**：以 `06-detail.html:667` 与 `08-time-picker.html:534` 为首，共 13 处（见上表）。
`06` 的实现见 `06-detail.html:1124-1133`（只认 ↓↑，且不把 `tabIndex` 降为 roving）。

---

### B3 · `03` / `04` / `05` 手搓 `role="dialog"` 浮层：焦点进不去、没有关闭控件

**场景 A（`03` 月视图）**：用户 Tab 到某一件「一段时间」的带子上，按 Enter，弹出了事件详情。
屏幕上出现一个卡片，里面有「打开」「勾完成」两个按钮。

**用户撞到什么**：

1. **焦点还在触发器上**（实测 `focusInPop === false`），屏幕阅读器不会播报弹层的内容。
2. 按 Tab：焦点走了 **44 次**才第一次落到弹层里（实测）。在 42 个日格 + 11 个 chip 之后，
   用户根本不知道这个弹层存在，也不知道怎么进去。
3. **弹层不跟着焦点关闭**：Tab 走 4 次，弹层仍在（实测 `popHidden: false`）。
4. **弹层没有关闭控件**（按钮只有「打开」「勾完成」），也没有 `aria-haspopup` / `aria-expanded`（触发器都没有）。
   屏幕阅读器用户拿到的信息是：一个 `role="dialog"` 出现了，里面两个按钮，但没有任何「关闭」。

**场景 B（`05` 日程）**：同上。`role="dialog"`、`aria-label="事情详情"`，
弹出后焦点留在行上，弹层按钮在 Tab 序列的第 65、66 位（总 75 个停点）。

**场景 C（`09` 搜索）**：这一处**用对了原生 `<dialog>` + `showModal()`**（`09:624`），焦点进入输入框、
Esc 归还焦点——这条没问题。它的问题不是 B3，见 B4 / B5。

**实测**：

| 片段 | 浮层 | role | aria-modal | 焦点进入 | 关闭控件 | Tab 距离 |
|---|---|---|---|---|---|---|
| `03-calendar-month.html:491` | 事情详情 | `dialog` | 无 | ✗ | 无 | 44 |
| `03-calendar-month.html:509` | 当天全部 | `dialog` | 无 | ✗ | 无 | — |
| `04-calendar-week.html:539` | 就地捕获 | `dialog` | 无 | 进入输入框（`capInput`） | 有「取消」 | 最近 |
| `04-calendar-week.html:561` | 事情详情 | `dialog` | 无 | ✗ | 无 | — |
| `05-agenda.html:345` | 事情详情 | `dialog` | 无 | ✗ | 无 | 65 |
| `07-capture.html:610,650,712` | 捕获条 ×3 | `dialog` + `aria-modal="false"` | 明确非模态 | 内联展示 | 不适用 | — |

`04` 的就地捕获反而是这批里唯一做对的（见 `04:539`，有 `<label for="capInput">`、有取消、焦点进输入框）。
`07` 的三条静态捕获条是「内联展示」的标本，不是弹出层，用 `role="dialog" aria-modal="false"` 是可辩护的（但我仍建议换成
`role="group"` + `aria-labelledby`，因为「dialog」对屏幕阅读器用户意味着「有东西挡住了页面」）。

**位置**：`03-calendar-month.html:491`、`03-calendar-month.html:509`、`04-calendar-week.html:561`、`05-agenda.html:345`。

---

### B4 · `09-search.html`：每一条搜索结果的**可访问名**都是 `…，undefined，…`

**场景**：用户按 Ctrl+K 打开搜索面板，输入「交」。屏幕阅读器逐条播报结果。

**用户撞到什么**：每一条都播报成「交房租，**undefined**，后天」。
`undefined` 是一个英文单词，读出来是「undefined」三个音节，夹在中文里极其刺耳，且占据了每一条结果的关键位置
（象限信息本该在这里）。

**实测**（`Accessibility.getFullAXTree`，不是猜）：

```
「更新简历，undefined，下个月」
「年度体检，undefined，下个月」
「读完《深度工作》，undefined，上周」
「产品评审会，undefined，今天 15:00」
…20 条，全带 undefined
```

**位置**：`09-search.html:502`

```js
var label = item.title + '，' + QNAME[item.q] + '，' + K.rungLabel(item) + ...
```

`QNAME[item.q]` 里的 `item.q` 不存在了：`data.js:204` 起明确说明「Items used to carry a single `q: 1..4` field,
which conflated the two axes … **Now: `important` is the only stored axis**」。`09` 是唯一没跟着改的片段
（也在同一行 `09:504` 用 `qdot--' + item.q` 画色点，于是象限色点也丢了）。

**为什么是 BLOCK 而不是 WATCH**：这是**每一条结果的唯一可读描述**。
屏幕阅读器用户在这一页上只能听到「标题 + undefined + 时间」，
象限——ADR §4 整个「紧急」体系的落点——在这页上完全丢失。视觉用户不受影响，
所以这是「只有键盘/屏幕阅读器用户才会撞到」的那类缺陷。

---

### B5 · `09` / `10` 两个真模态没有可见的关闭控件

**场景**：用户打开「设置」（`10`）或「搜索」（`09`）。他没有 Esc 这个习惯，
或者他用的是语音控制（Dragon / Voice Control），需要**说出屏幕上看得见的字**来关闭。

**用户撞到什么**：找不到任何关闭按钮。

**实测**：

| 对话框 | 位置 | 可见关闭控件 | 可关闭方式 |
|---|---|---|---|
| `searchDialog` | `09-search.html:426` | `querySelector('[aria-label*=关闭],[data-close],.close')` → **null** | 仅 Esc |
| `settingsDialog` | `10-settings.html:589` | 同上 → **null** | 仅 Esc |
| `dlgKeys` | `11-dialogs.html:527` | 有「关闭」按钮（`11:560`） | Esc / 关闭 |

（`dlgWipe` / `dlgDelete` / `dlgExport` 都有「取消」或「完成」，所以是达标的。）

现代 Web 指南 §4 的要求是明确的：

> **DO** provide a visible control for closing modal overlays, so that people using voice control
> software can easily determine how to dismiss the modal dialog.

**补充（`09` 的错误态）**：输入一个查不到的词后，对话框里只剩「输入框 + 清空搜索」两个可聚焦元素，
Tab 循环是 `清空搜索 → body → 输入框`。**Modal 的焦点陷阱本身是好的**（原生 `showModal()` 生效，
实测背景无法聚焦）；`body` 那一步是 Chromium 在模态内只剩极少可聚焦元素时的已知行为，
不是这一处 `<dialog>` 的 bug。但它说明：**没有任何一条「关闭」路径是可以用 Tab 走到的**，
所以关闭控件缺失在这里的代价被放大了。

**位置**：`09-search.html:426`（`<dialog>` 主体，内部由 `09:515` 的 `paletteHTML()` 生成，无关闭按钮）、
`10-settings.html:589-591`（只有 `<h3 class="visually-hidden">` + 一个克隆进来的 shell）。

---

### B6 · `10-settings.html`：`aria-controls` 指向错了（重复 id）

**场景**：用户用屏幕阅读器在设置对话框里按 Tab 到「数据」tab。SR 播报「数据，tab，已选」。

**用户撞到什么**：SR 被告知这个 tab 控制 `#pane-data`——但 `document.getElementById('pane-data')`
拿到的**不是对话框里的那个**，而是文档里第一个（隐藏的、背景页上的）。
所以 SR 说「控制：一个隐藏的面板」。用户按「跳到受控区域」这类命令，会被带到背景页的隐藏节点。

**实测**：

```
document.getElementById('pane-data').hidden            → true
document.getElementById('pane-data').closest('#settingsDialog') → null
重复 id：pane-appearance ×4、pane-data ×4、pane-about ×4、storagePath ×4、dbSize ×4
```

对话框里的那份克隆确实存在（`targetFoundInDlg: true`、`hidden: false`），但 id 解析按文档顺序取第一个，
而对话框是 `10:589` 的 `<dialog>` 被追加到**最后**，克隆体在它里面——所以 `getElementById` 永远拿错。

**位置**：`10-settings.html:353-363`（tablist + 三个 `aria-controls="pane-*"`）。
克隆逻辑在 `10:800`（`firstShell.cloneNode(true)` 后 **`removeAttribute('role')` 但没有去重 id**）。

---

## 2. WATCH

### W1 · 勾完成后焦点掉到 `<body>`（`01` / `05`）

**场景**：用户在四象限板里用键盘勾掉「设计评审」。他按 Space。

**用户撞到什么**：整行消失（进入「已完成」折叠），**焦点回到页面顶部**——`document.activeElement === body`。
下一步按 Tab，用户从 `<nav>` 的第一个图标重新开始。他勾了三件事，就要重新 Tab 三次穿过 6 个 rail 图标 + 7 个侧栏行。

同样的：`05-agenda.html` 按 Space 勾完成，行被 `btn.remove()`（`05:668`），焦点同样掉到 body（实测）。

现代 Web 指南 §6：

> **DO** maintain focus—moving it to a logical adjacent element or returning it to the trigger control—when
> the currently focused element is hidden or removed.

**实测**：`01` 按 Space 后 `activeElement = BODY`；`05` 同样。
（`02-list.html` **没有**这个问题——它重建整张列表但焦点保持，值得对照。）

**位置**：`01-quadrant.html:612-620`（`board.addEventListener('change', …)` → `render()` 重建整块板）、
`05-agenda.html:661-676`（`finish()` → `btn.remove()`）。

---

### W2 · `02-list.html` 的 `role="listbox"` 是假的

**场景**：用户 Tab 进平铺清单，听到「分组方式，单选组」（这是 radiogroup，见 B2）。然后 Tab 到列表。

**用户撞到什么**：AX tree 报「`listbox`，`option` ×20」。用户按 ↑↓（listbox 的标准键）——**不动**（实测 `idx` 保持 0）。
用户期望「选项被选中」，但 20 条里 `aria-selected="true"` 的**一条都没有**（实测计数 0）。
按 Home / End——不动。按 Enter / Space——切换了 `aria-selected`，但 SR 播报的变化是「选项 已选/未选」，
而这一行的真实语义是「打开一条事情」——`role="option"` 承诺的是「从集合里选一个」，不是「按钮」。

**实测**：

```
role="option" ×20，tabIndex=0 ×20，aria-selected=true ×0
按 ArrowDown：document.activeElement 仍是第一条
```

AX tree：`{"button":19,"banner":1,"radio":2,"listbox":10,"option":20,"checkbox":20}`——
10 个 listbox（按 rung 分组）×20 个 option，嵌套结构对 SR 来说是「10 个待选列表」，
而每一行里还塞了一个 checkbox。

**位置**：`02-list.html:436`（`tabindex="0" role="option" aria-selected="…"`）、
`02-list.html:540` 与 `02-list.html:553`（`<ul class="rows" role="listbox">`，各 1–5 条 option）。

---

### W3 · `base.js` 把 `←/→` 全局劫持成「翻片段」

**场景**：评审脚手架 `base.js`（不在应用里，在片段里）监听 `document` 的 `keydown`：

```
base.js:105-113
  if (el.closest('input, textarea, select, [contenteditable]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft' && prev) location.href = prev;
  else if (e.key === 'ArrowRight' && next) location.href = next;
```

**用户撞到什么**：**没有 `preventDefault` 的目标检查。** 任何按钮、link、自定义 radiogroup、
日历格、时间槽上按 ← → 都会**离开当前页面**。这是评审者最容易踩到的坑：他在测「方向键在分段控件里换项」，
页面直接翻走，于是他报告「分段控件方向键失效」——其实是被脚手架抢了。

**实测**（不是推断）：

| 片段 | 焦点在 | 按 → | 结果 |
|---|---|---|---|
| `13-year.html` | 「月」分段 | ArrowRight | → `14-multi-day.html` |
| `14-multi-day.html` | 「3 天」分段 | ArrowRight | → `15-day.html` |
| `15-day.html` | 「月」分段 | ArrowRight | → `06-detail.html` |
| `12-empty-states.html` | 「有 3 件」分段 | ArrowRight | → `16-components.html` |
| `06-detail.html` | 时间阶梯（↓ 已实现） | ArrowRight | → `07-capture.html` |
| `01-quadrant.html` | 侧栏行 | ArrowRight | → `02-list.html` |

而 `16-components.html` 自己在 `16:1884` 就写了 `event.stopPropagation()` 来躲它——
说明作者知道这个坑，但只有 `16` 这一处躲了。

**位置**：`base.js:105`（`document.addEventListener('keydown', …)`），影响全部 17 个片段。

**这不是产品缺陷**（`base.js` 是评审工具），但它是**评审结论的污染源**：任何人在这份稿子上测方向键都会得到假阴性。
我建议要么给 `base.js` 加一个「目标元素是 `[role=radio]/[role=tab]/[role=option]/[role=menuitem]` 或
在 `[role=radiogroup]/[role=tablist]` 内时直接 return」，要么把它降级为 `Alt+←/→`。

---

### W4 · 演示条盖住顶栏控件（7 个片段）

**场景**：用户在 `02-list.html` 想切换「按清单」分组。这是这一页唯一的真实交互。

**用户撞到什么**：

1. **鼠标点不到**。实测「按时间」「按清单」两个按钮的矩形是 `top 14 → bottom 40`，
   演示条是 `top 8 → bottom 42`。命中测试 `elementsFromPoint` 最上层是 `demo-bar`，
   所以**点击落在演示条上**（实测 `aria-checked` 点击前后一致：`[true,false] → [true,false]`）。
2. **焦点环被盖住**。`13-year.html` 的「新建」按钮，焦点环的四条边里有三条的命中测试最上层是 `demo-bar`
   （实测 `ringPoint` 三点全部 `demo-bar`）。
3. 演示条 `opacity: .35`（`demo.css:21`），所以**用户看得见这些控件，只是点不动**——这是最令人困惑的一类：
   「明明在那儿，为什么点不动」。

**实测覆盖率**（`elementsFromPoint` 与矩形交集）：

| 片段 | 被遮控件 | 遮挡比例 |
|---|---|---|
| `02-list.html` | `按时间` / `按清单` | 92% / 100% |
| `01-quadrant.html` | `新建` | 94% |
| `03-calendar-month.html` | `新建事情` | 94% |
| `13-year.html` | `新建` / `今天` / `年` | 94% / 94% / 82% |
| `14-multi-day.html` | 同上 | 94% / 94% / 82% |
| `15-day.html` | 同上 | 94% / 94% / 82% |
| `05-agenda.html` | `新建事情` | 94% |

KEEP.md §D3 只说「底部固定条」要留 scroll-padding，**顶部这条没提**。但它同样遮住焦点与点击目标。
片段的应对方式是给顶栏加 `padding-inline-end: 10rem`（`01:18`、`02:16`、`03:18`、`05:14`、`10:17`）、
`7.25rem`（`13:32`、`14:24`、`15:26`）——**补丁打得不一致，所以 `02`/`13`/`14`/`15` 还是漏**。

**位置**：`demo.css:10`（`.demo-bar { position: fixed; inset-block-start: .5rem; inset-inline-end: .5rem }`）、
`demo.css:21`（`opacity: .35`）。受害片段见上表。

---

### W5 · 手搓浮层只复制了 `role="dialog"`，没复制它的承诺

这一条是 B3 的「另一半」，单列是因为它影响的是**所有**手搓浮层，而不只是「进不去」。

**场景**：用户在 `04-calendar-week.html` 点一个空槽，弹出「在这段时间新建」。

**用户撞到什么**：焦点进了输入框（这一处做对了）。但：

- 触发器**没有 `aria-haspopup` / `aria-expanded`**（实测 `null`），SR 用户不知道按了会发生什么；
- 浮层**没有 `aria-modal`**（它是非模态的，KEEP.md §C5 明确要求「背后网格保持可交互」——
  所以「不设 `aria-modal`」是对的，但正因为如此，它**必须是 `<dialog>` 之外的 popover 语义，
  而不是 `role="dialog"`**：SR 会把它读成「对话框」并让用户期待焦点被困住）；
- Esc 关闭后焦点没有归还（`03` 实测：Esc 后 `activeElement` 是触发器，靠的是浏览器对按钮的默认行为，
  不是代码；`05` 实测 Esc 后焦点在行上，也是碰巧）。

`07-capture.html` 的时间浮层（`07:677`）在这一轮改稿里已经补上了 Esc + 点外关闭（`07:934-949`），
这一点值得肯定——但它的 `role="dialog"` 仍是错的（应为 `role="group"` 或 `popover`）。

**位置**：`03-calendar-month.html:491`、`04-calendar-week.html:561`、`05-agenda.html:345`、
`07-capture.html:677`（`role="dialog"` 但无 `aria-modal`、无 `aria-haspopup`）。

---

### W6 · `<button>` 里嵌 `<input type="checkbox">`（`05` 最严重，19 处）

**场景**：用户在日程视图里走到「回客户邮件」这一行。SR 播报「按钮，回客户邮件」。
他觉得「完成」应该是个可操作的控件，于是按 Tab 想找它。

**用户撞到什么**：**同一个东西出现了两次 Tab 停点**——先到行按钮，再到里面的 checkbox（实测
`next1 = INPUT.check`、`next2 = 下一个行按钮`）。而 DOM 上，`<input>` 是 `<button>` 的后代：

```
05-agenda.html  AX tree：{"button":51, "banner":1, "checkbox":19}
05:561-570   check 被 appendChild 进 end，end 被 btn.appendChild
```

`<button>` 内部的内容在 AX 里被视作按钮的 **name 来源**，不是独立可交互的后代。
实测 SR 视角下那 19 个 checkbox 确实被单独暴露了（Chromium 容忍这种结构），
但这是**未定义行为**：WebKit / Firefox 的表现不同，且会随版本变化。
现代 Web 指南 §1 明确：

> **DON'T** use generic `<div>` or `<span>` when semantic elements exist … **DON'T** change the native
> semantics of elements with ARIA unless it is a critical requirement.

并且指南 §6 要求「自然 DOM 顺序」。

**实测**：点击 checkbox 不会误触发行（`stopPropagation` 生效，`05:566`），
但键盘 Space 勾掉之后**焦点掉到 body**（见 W1），所以「勾完成」的键盘体验是：按一次 Space → 页面不动、焦点丢了。

`07-capture.html` 的静态标本没有这个问题；`02-list.html` 是 `<li role=option>` 里嵌 checkbox，同样有嵌套问题（W2）。

**位置**：`05-agenda.html:561-572`、`02-list.html:436-439`。

---

### W7 · 17 个片段里 16 个没有 `<main>`

**场景**：屏幕阅读器用户按「跳到主内容」快捷键（NVDA: `D`，VoiceOver: `VO+U` → Landmarks）。

**用户撞到什么**：地标列表里只有「导航：主导航」「补充内容区：筛选与清单」和一个 banner，
**没有「主内容」**。用户无法跳过 rail 与 sidebar 直接进入正题。

**实测**（`Accessibility.getFullAXTree`，17 个片段）：

| 片段 | landmarks |
|---|---|
| `01` | `navigation(主导航), complementary(筛选与清单), banner, region×4, form×4` |
| `02` | `navigation(主导航), complementary(筛选与清单), banner` |
| `03` `04` `05` `06` `09` `10` `13` `14` `15` | `navigation, complementary, banner`（+ region） |
| `07` `08` `12` `16` `17` | `navigation, banner`（+ region） |
| `index.html` | `banner, main, contentinfo` ✓ |

只有 `index.html`（评审索引页，不是设计稿）有 `<main>`。
`display: grid` 的 `<div class="main">` 在 `01:333`、`02:259`、`03:421`、`04:432`、`05:295`、`06:636`、
`09:319`、`10:326`、`13:340`、`14:301`、`15:315`、`16:524`、`17:194`、`07:587`、`08:452` 全部是 `<div>`。

现代 Web 指南 §1：

> **DO** use semantic landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`) …
> **DON'T** use more than one `banner`, `main`, or `contentinfo` landmark per page

**位置**：全部 16 个片段（`index.html` 除外）。改成 `<main class="main">` 是一行的事。

---

### W8 · 日历格 / 时间槽的 Tab 停点过多（`03` 94 个、`04` 176 个）

**场景**：用户在月视图里想去「下一个月」按钮。他从 rail 开始按 Tab。

**用户撞到什么**：先过 7 个 rail 图标 → 9 个侧栏行 → 顶栏 4 个按钮 → **42 个日格按钮** → 才能到 11 个 chip。
实测：`03` 总计 94 个 Tab 停点，其中 `dc__num` 占 42 个（`03:639-640` 每个日格都是 `<button>`，带 `aria-label`）。
周视图更甚：**126 个 slot**（`04:859-866`，每小时一个按钮，7 天 × 18 小时），总计 176 个停点。

KEEP.md §C2 的原则（「每一组单选一个 Tab 停点」）没有延伸到这里，但道理相同：
**42 个日格是一个二维网格，应当只有一个 Tab 停点 + 方向键在网格里走**。
现代 Web 指南把它归在「DON'T use positive tabindex」的反面——这里不是 tabindex 的正负问题，
而是「用 42 个独立 Tab 停点表达一个二维结构」的问题。

**实测**：

```
03: tabStops = 94, dc__num = 42
04: tabStops = 176, slot = 126，其中 button 类 139 个
```

顺带：`04` 的 slot 有 `aria-label`（`周一 06:00 新建事情`，`04:865`），这一点做得好；
但 126 个「新建事情」按钮排在 130 个停点里，用户按 100 次 Tab 才能过完一天。

**位置**：`03-calendar-month.html:639-640`、`04-calendar-week.html:859-866`。

---

### W9 · `15-day.html` 时间块本身不可聚焦，唯一入口是 6 个 20×20 图标按钮

**场景**：用户在日视图里走到「产品评审会」时间块。块本身是 `<div>`（`tabIndex=-1`、无 `role`），
**只能靠里面的「完成」「更多」两个图标按钮操作**。

**用户撞到什么**：

1. **尺寸不足**。`.blk__act` 是 `20×20`（`15:196-200`），实测布局 `20×24`，低于 WCAG 2.5.8 的 24×24。
2. **静止时整个动作条 `opacity: 0`**（`15:189-193` 的 `.blk__acts` 容器）。
   聚焦到按钮时 `:focus-within` 把它抬到 `1`（实测 `0 → 1`，过渡 120ms）——
   所以「聚焦时能看见」这一点是对的，但可见性依赖一个**容器的** CSS 状态，
   `15:194` 的规则只挂了 `.blk:hover` / `.blk:focus-within`，没有单独给 `.blk__act:focus-visible` 一条。
   任何一处微调（比如给按钮加 `position` / 换容器）就会让焦点环画在 `opacity: 0` 上。
3. 更根本：**块本身不可聚焦**。`15` 的 `col.addEventListener('click', …)`（`15:562`）用鼠标点空白格能建事情，
   但键盘用户只有那 6 个动作按钮，没有「选中这个时间块」的入口。

**实测**：6 个 `blk__act`，`.blk__acts` 静止 `opacity: 0`、`pointer-events: auto`；
聚焦后 `opacity: 1`；`.blk` 的 `tagName = DIV`、`tabIndex = -1`、`role = null`。

**位置**：`15-day.html:189-203`（`.blk__acts` / `.blk__act`）、`15-day.html:562`（列点击）。

---

### W10 · `16-components.html` 的 `role="table"` 没有行头/列头对应

**场景**：SR 用户在「四象限的三种尺寸」表里逐格读。

**用户撞到什么**：表有 5 个 `columnheader`（象限 / 6px / 10px / 20px / 名字），
但 4 行数据的第一个 cell（`Q1 · 重要且紧急`）是 **`role="cell"` 而不是 `role="rowheader"`**（实测 `rowheaders = 0`），
所以 SR 播报「单元格：--q1」时，**不会带上它属于哪一行**。

**实测**：

```
role="table" ×1（aria-label="四象限的三种尺寸"）
role="row" ×5，role="columnheader" ×5，role="cell" ×20，role="rowheader" ×0
```

现代 Web 指南 §1 要求「use semantic elements … DON'T use generic elements with added ARIA roles
when native elements with built-in semantics exist」。同一份稿子的 `17-icons.html:233` 用的是**真 `<table>`
+ `<th scope="col">` + `<th scope="row">`**，是全套稿子里表格做得最正确的一份——可以照抄。

**位置**：`16-components.html:1117-1145`。对照 `17-icons.html:233-243`。

---

### W11 · `07-capture.html` 的保存失败没有 live 播报

**场景**：用户按 Ctrl+N 捕获一件事，按「添加」，保存失败。

**用户撞到什么**：屏幕上出现一行红字「保存失败，内容已保留。」。
**屏幕阅读器什么都不说**——这一行是静态存在的 `<p class="capbar__error">`（`07:716`），
没有 `role="alert"`、没有 `aria-live`（实测 `role=null, aria-live=null`）。
`07:976` 反而在**用户点「重试」之后**才 `setAttribute('aria-live','polite')`——
也就是说：**第一次失败时无声，重试时才出声**。这正好反了。

指南 §9：

> **DO** ensure that information is available for people using screen readers, using text alternatives,
> appropriate accessible names, roles, and programmatic state information

错误必须用 `role="alert"`（或者至少在出现时把焦点移到错误上）。

**位置**：`07-capture.html:716`（错误 `<p>`）、`07-capture.html:976`（延迟设置 `aria-live`）。

---

### W12 · `12-empty-states.html`：「不限」桶切换无播报、焦点不回

**场景**：用户在 06 号标本里切换「有 3 件 / 空着」两个分段（`12:295-297`）。

**用户撞到什么**：视觉上内容区整块换了。**SR 什么也没说**（无 live region），
**焦点掉到 body**（实测 `activeElement = BODY`）。用户不知道自己刚刚做了什么、结果是什么。

**实测**：点「空着」后 `[data-bucket-empty].hidden = false`，`role=null`、`aria-live=null`，
`document.activeElement === body`。

（同一片段里「加载失败 → 重试 → 成功」有一个 `role="status"` 的 toast，那条是对的。）

**位置**：`12-empty-states.html:295-297`（radigroup）、`12:379-386`（切换逻辑，只改 `hidden`）。

---

## 3. MINOR

### M1 · 演示条上的焦点环在深色底上不可见

`demo-bar button` 没有 `:focus-visible` 规则，走的是 UA 默认 `outline: auto 1px rgb(16, 16, 16)`，
背景是 `rgba(20,20,24,.82)`（≈ `#3b3b3e`）。实测对比：`#101010` vs `#3b3b3e` = **1.7:1**，远低于 3:1。
键盘用户 Tab 到 A/B/C/明/暗 时，看不到焦点在哪（只有 `opacity: .35 → 1` 的变化，很弱）。

**位置**：`demo.css:25-31`（`.demo-bar button` 无 focus 样式）。

---

### M2 · `01-quadrant.html` 的 `⋯` 按钮静止 `opacity: 0`

`.qrow__more` 静止 `opacity: 0`（`01:135`），只在 `.qrow:hover` / `.qrow:focus-within` 时显形。
键盘 Tab 到它时因为 `:focus-visible` 里有 `opacity: 1`（`01:141`）所以能看见——**这一点是对的**。
但「静止时不存在、聚焦时出现」意味着：用户 Tab 到一行时，行里多出一个他刚才没见过的按钮，
按 Tab 会把焦点送到那里，再按一次又消失。视觉上像行内容在跳。
（`15-day.html` 的 `.blk__acts` 同理，见 W9。）

---

### M3 · 顶栏的 `padding-inline-end` 是为脚手架打的补丁

`01:18` / `02:16` / `03:18` / `05:14` / `10:17` 写 `10rem`，`13:32` / `14:24` / `15:26` 写 `7.25rem`。
这些数字**没有任何设计含义**，唯一作用是躲开右上角的演示条。
它们不一致，导致 `02` / `13` / `14` / `15` 仍然被遮（W4）。
删掉演示条后这些 padding 会变成顶栏右侧一大块莫名其妙的空白。

**位置**：见上。

---

### M4 · `03` 的 20–22px 控件

`03` 的日格按钮实测 `22×24`（`.dc__num`，`03:171-175`，42 个）、`新建清单` 实测 `20×24`
（内联写死 `block-size:20px;inline-size:20px`，`03:388`）。
WCAG 2.5.8 要求 24×24。42 个格子每个都窄 2px，在密集网格里就是明显偏小的点击目标。

**位置**：`03-calendar-month.html:171-180`（`.dc__num`）、`03-calendar-month.html:388`（内联 20px 的 `新建清单`）。

---

### M5 · `.check` 16×16，热区只有行高

`01` / `02` / `05` / `16` 的 `.check` 是 `16×16`，没有伪元素扩热区（实测 `::before` / `::after` 的 `content` 都是 `none`）。
`01` 的行高 34px 把上下撑开了，但**左右各只有 8px**（实测左右 ±10px 命中 `qrow`，上下 ±10px 也命中 `qrow`）。
KEEP.md §D1 说「图标按钮用伪元素扩热区，视觉尺寸不变。已在 `shared.css` 的 `--target-size` 里实现」——
实际上 `--target-size` 只作用在 `button, [role=button], select, a.btn` 上（`shared.css:403`），**不包括 `input`**。

**位置**：`shared.css:354-369`（`.check`）、`shared.css:403`（`--target-size` 选择器不含 `input`）。

---

### M6 · `06-detail.html` 标题从 `h1` 跳到 `h3`

`06:663-723` 有四个 `<h3>`（时间 / 象限 / 清单 / 备注），但没有 `<h2>`。
实测 AX tree：`h1:所有事情 → h3:时间 → h3:象限 → h3:清单 → h3:备注`。

指南 §1：**DO** maintain a sequential, non-skipping heading hierarchy (`<h2>` to `<h3>`, but not `<h2>` to `<h4>`).
这里是 `h1 → h3`（跳了 `h2`），同样违规。

**位置**：`06-detail.html:664`、`704`、`714`、`723`。

---

### M7 · 装饰性 SVG 缺 `aria-hidden`（`09` 2 个 / `11` 8 个）

整体覆盖极好（`17-icons.html` 80 个 SVG / 82 个 `aria-hidden`），但：

- `09-search.html:368-369`：两个 rail 图标 SVG 在装饰容器里，缺 `aria-hidden`；
- `11-dialogs.html:308,344,408,432,482,509,532,571`：8 个 SVG 缺 `aria-hidden`，
  其中 `11:482/509` 的删除图标是**弹窗标题旁的装饰**，`11:408/432` 是导出图标。

它们在 `aria-hidden` 容器内或按钮内（按钮有文字），所以**不会被 SR 误读**，但不符合指南 §1
「**DO** hide purely decorative SVG images from assistive technology using `aria-hidden="true"`」。

**位置**：见上。

---

### M8 · `13` / `14` / `15` 的视图分段完全不响应激活

**场景**：用户在年视图（`13`）里想切到月视图。

**用户撞到什么**：**这个控件是死的**。Enter、Space、鼠标点击，全部无效（实测 `aria-checked` 前后
`[false,false,false,false,true]` 不变，URL 不变）。它是 5 个 `tabIndex=0` 的 `role="radio"`，
每个都是 Tab 停点、每个都能聚焦，但按下去什么也不发生。

这比 B2 更糟：B2 是「方向键不换项，但点击/Enter 有效」，这里是**连点击都无效**。
同一片段里「3 天 / 5 天 / 7 天」（`14:314`）有 `data-days` 与 handler，是有效的；
但「日历视图」（`14:319`）与 `15:328` 的同款分段都只有 HTML、没有 handler。

**实测**：`13` 点击「月」→ `aria-checked` 不变；`14` 点击「3 天 → 5 天」→ 有效；
`14` / `15` 点击「月」→ 不变。

**位置**：`13-year.html:353-359`、`14-multi-day.html:319-325`、`15-day.html:328-333`（均为 HTML 无 JS）。

---

### M9 · `11-dialogs.html` 的 600ms 迟滞提示无 live 播报

「清空全部数据」的确认按钮初始 `disabled`（`11:648` 附近），旁边一个 hint 显示倒计时。
实测 `hint` 的 `role=null`、`aria-live=null`：SR 用户按 Tab 到确认按钮时听到「不可用」，
但**不知道原因，也不知道 600ms 后会变**。倒计时结束、按钮变可用，也**没有播报**。

KEEP.md §C3 要求「破坏性按钮在右侧末尾且有 600ms 迟滞」——迟滞本身做对了，
缺的是它的**可感知性**。

**位置**：`11-dialogs.html:592-660`（`armHysteresis`）、`11:519-520`（hint 节点）。

---

### M10 · `16-components.html` 的复选框：规范表画的焦点环，真控件没有

**场景**：这是「组件总表」。读者（实现者）看 `03 复选框` 那一节的「焦点」格，
看到一枚 `2px` 蓝色环（`.cb.is-focus`，`16:188`），据此认为 `.cb` 有焦点样式。**实际上没有。**

**用户撞到什么**：真实可聚焦的 `<input class="cb">` 走的是 UA 默认 `outline: auto 1px rgb(16,16,16)`，
在深色主题下对比 **1.18:1**，几乎不可见。而同一页的 `.btn` / `.field` / `.segx__item` / `.trow__open`
都有 2px `var(--focus)`（走 `shared.css` 的 `:focus-visible`）。**只有 `.cb` 这个组件没有**——
因为它在 `16` 里是本地类，没有复用 `shared.css` 的 `.check`。

这比 M1 更值得修：`16` 是**给实现者的规范**。规范表画的焦点态与真控件不符，实现者抄了就会漏掉焦点环。

**实测**：

```
.cb（真实元素，聚焦后）        → outline: auto 1px rgb(16,16,16) off=2px
.cb.is-focus（规范表里的示范） → outline: solid 2px rgb(59,130,246)
.btn / .field / .trow__open    → solid 2px var(--focus) ✓
```

**位置**：`16-components.html:165-188`（`.cb` 无 `:focus-visible`）、`16:188`（只有 `.is-focus` 静态演示）。

---

## 4. 通过的检查（给后续改稿的人一个基线）

这些是我逐项验过、确认没问题的，不要「顺手改坏」：

- **真模态**：`09` / `10` / `11` 的四个真模态全部 `<dialog>` + `showModal()`，`Esc` 原生关闭、
  焦点原生困住、`::backdrop` 已样式化（`oklab(… / 0.32)`）。**没有一处手写 focus trap。**
- **`::backdrop`**：`09:244`、`10:254`、`11:219` 都有。
- **`aria-hidden` 覆盖率**：`17-icons.html` 82 / 80，`16` 128 / 60，远超「够用」。
- **图标按钮命名**：rail、顶栏、日历导航、`.blk__act`、`17` 的 `.ibtn` 全有 `aria-label`。
  实测「无名字按钮」计数为 0（17 个片段全部）。
- **`lang="zh-CN"`**：17 个片段全部正确（`index.html` 除外）。
- **`<h1>` 唯一性**：16 个片段各 1 个（`06` 层级跳级但仍是 1 个）。
- **`:focus-visible`**：几乎所有可聚焦元素都有 `outline: 2px solid var(--focus)`。
  `refined/light` 的焦距对比 3.68:1（surface）——刚好过 3:1；其余五组合 4.92–6.47:1。
- **禁用态是颜色不是淡出**：`shared.css:296` `opacity: 1` 保持住了。
- **`<label>` 与表单**：`06` 的标题/清单/备注、`09` 的搜索框、`04` 的 `#capInput`、
  `07` 的三个捕获 textarea（`07:611,651,713` 视觉隐藏 label）——**全部有可访问名**，
  无一处「只有 placeholder」。
- **`07` 时间浮层的关闭路径**：`07:934-949` 的 Esc + 点外关闭是这一轮补上的，正确。
- **`16-components.html` 的 `segx`**：唯一一处 roving tabindex 做对的 radiogroup
  （`tab0=1`、←→↑↓、Home/End、`stopPropagation`），可以作为其他 15 组的样板。
- **`17-icons.html` 的真表格**：`<table>` + `<th scope="col">` + `<th scope="row">`，
  是 `16` 那个手工 `role="table"` 该抄的对象。

---

## 5. 一句话总结

**这一版的「眼睛看得见的部分」几乎都做对了；「耳朵听得见的部分」和「手上摸得到的部分」漏了一大片。**
`role` 写得很勤（14 个 radiogroup + 1 个 tablist、20 个 option、1 个 menu），但 role 承诺的行为（roving tabindex、
方向键、焦点进入、焦点归还）只兑现了 2/17（`16` 的两组；`06` 的阶梯只做了 ↓↑，且 ←→ 被 `base.js` 抢走）。
**写 role 不兑现，比不写更伤用户**——因为它让 SR 播报一个不存在的交互模型。

最该先修的三件事：`06` 的语法错误（整页打不开）、15 组复合控件的 roving tabindex（KEEP.md §C2 的明文要求）、
`09` 的 `undefined` 可访问名（每一条结果都带毒）。
