# REVIEW · 视觉工艺（v2 十七个片段）

审阅维度：**视觉工艺** —— 间距节奏、对齐、层级、密度、六组合渲染、时间阶梯标签的可分辨性、
窄窗极值。只审视觉层，不审交互逻辑与文案语义（另两份评审负责）。

- **快照**：2026-11-27 00:01（`shared.css` md5 `b68f1b93`，`01-quadrant.html` `a5625acd`，
  `14-multi-day.html` `5cb5bcee`）。审阅期间 `design/v2/` 一直在被并行编辑（23:02–23:42 有 12 个
  文件被改），以下每条都已在**快照时刻**重新量过。
- **方法**：headless Chrome + CDP（`127.0.0.1:9333`），每片段 × 六组合（refined/protool/editorial ×
  light/dark）截 1440×900，另截 960×640（应用窗口下限）。六组合状态（`data-skin`/`data-theme`、
  演示条 `aria-pressed`）逐格校验，**17 × 6 = 102 张全部状态正确**，无 console 报错。
  截图目录：`C:/Users/EDY/AppData/Local/Temp/ui-design/shots/rv/`。
- **注意（截图管线陷阱）**：CDP 的 `Page.captureScreenshot` 在 navigate 之后可能返回**上一页的帧**。
  本报告里所有结论都取自 `six-*` 系列（导航后丢弃两帧再截）；`crop-*`/`fix-*`/`month2-*` 等早期
  截图有串页，已作废不用。

---

## 严重度汇总

| 级别 | 定义 | 条数 |
|---|---|---|
| **BLOCK** | 已交付组合里读不出 / 坏了 / 六档标签分不出 | 4 |
| **WATCH** | 节奏、对齐、层级失守 | 8 |
| **MINOR** | 打磨项 | 9 |

编号：**B1** 六档标签在四个片段里塌成一种颜色（§1.2）· **B2** editorial 主按钮/紧急/删除同色（§2）
· **B3** 多日视图 960 顶栏被裁（§6）· **B4** 月视图 960 胶囊压住图例（§6）。

**结论先行**：六组合**整体成立**，editorial 现在有真衬线标题（不再是「refined 加滤镜」），
但 `--cta-bg`、`--danger`、`--q1` 在 editorial 是**同一个赭红** —— 主按钮和「重要且紧急」和
「删除」撞成一种色，这是编辑皮肤最伤的一处。**阶梯标签在不同片段里有两套实现**：板/清单用带形状的
`.lad`（六档一眼可分，这一部分做得好），日程/详情/搜索/组件总表用只有颜色的 `.when`（**六档同色**，
正是 KEEP.md §B3 点名要消灭的「六种灰」）。这是全套里最重要的视觉判断，结论见 §1。

---

## 1 · 阶梯标签：它们是六种形状，还是六种灰？

**这是这一版的核心视觉，单独下结论。**

### 1.1 板 / 清单：六档真的分得开（PASS）

`01-quadrant.html:196-241`、`02-list.html` 复用同一套 `.lad`，六档靠**形状**而非颜色区分：

| 档 | 形状（实测量到） |
|---|---|
| `month` 下个月 | 虚线胶囊 `border-radius: 999px` + `letter-spacing .04em` |
| `week` 这周 | 只在**左右两端**留 2px 竖括号，无圆角（`border-inline: 2px`） |
| `day` 明天 | 实线**方角** + `--bg-subtle` 实心底 |
| `period` 今天下午 | 实线**圆角**（`--radius-full`）+ 半圆图标 |
| `time` 今天 18:00 | **实心反白**（`background: var(--ink-1)`）+ 钟表 + 600 字重 |
| `none` 不限 | 无容器，只有清单名 + 色点 |

在 2× 放大下（`ladder-01-refined-light.png`）六档并排一眼可辨：虚线胶囊 / 两端括号 / 方底 / 圆底 /
实心黑 / 无色点，**形状差异足以在缩略图上区分**。这一部分完全达到 KEEP.md §B3，是整套设计里最扎实
的一处。

### B1 · 日程 / 详情 / 搜索 / 组件总表：六档塌成一种颜色

同样六件事，在另外四个片段里用的是 `shared.css:404-409` 的 `.when`：

```css
.when--none  { color: var(--ink-3); }
.when--month { color: var(--ink-2); }
.when--week  { color: var(--ink-2); }
.when--day   { color: var(--ink-2); }
.when--period{ color: var(--ink-2); }
.when--time  { color: var(--ink-2); }
```

**五行同色。** 实测 `05-agenda` 的时间列只有 3 种色（`ink-quiet` / `ink-1` / `warning-ink`），
`when` 的六档在 `06-detail`、`09-search`、`12-empty-states`、`16-components` 全部是同一个
`rgb(110,110,115)`，只有边框/底色全无（`border: 0px none`）。后果：

- **日程视图**（`05-agenda.html:115` `.arow-item__when`）：左列是「下午 / 15:00 / 晚上」——
  这三者读起来就是同一种灰小字，用户分不出「下午」是一格半天，「15:00」是一个时刻。而 SPEC.md §3
  说日程问的就是「什么时候」，这一栏恰恰该最会说话。见截图 `grey-05-agenda.png`。
- **详情面板时间阶梯**（`06-detail.html:809-880`）：右侧 inspector 的六行（下个月/这周/某一天/
  上午下午晚上/具体时刻/不限）是**同一个控件六选一**，六行同色同形，只有左端一个小圆圈。
  这不是「六档标签」，是一张按钮列表——用户得逐行读字才知道哪行是「半个月」哪行是「一个点」。
  见截图 `grey-06-detail.png`。
- **搜索**（`09-search.html:492`）：结果右列同样六档同色，且 `09` 连 `.lad` 的形状也不用了。
  见截图 `grey-09-search.png`。
- **组件总表**（`16-components.html`）自称「整个系统最重要的一处视觉」，而它自己的 `行内顺序`
  横排和 `rung-card__row` 里用的正是 `.when` —— **这张对照表把最重要的视觉演示成了六种灰**。

**为什么是 BLOCK 而不是 WATCH**：KEEP.md §B3 原文「如果用户分不出『下个月』和『11月30日』，
整个 ADR 的精度主张就白写了」；ADR 0004 的整个价值建立在这六档可读上。板/清单里成立、日程/详情里
不成立，等于**同一个概念在不同页面长相不同**——这正是 CONCEPT-AUDIT 要消灭的那种矛盾。

**修法**：把 `01/02` 里的 `.lad` 提升进 `shared.css`，四个片段改用同一套；`06-detail` 的六行做成
左端「精度轴」（轴从点到区间逐渐变粗，而不是六个等大的圆圈）。这是令牌级改动，按 KEEP.md §E.1
先改 `shared.css` 再改稿。

---

## 2 · 六组合渲染

### B2 · editorial 里主按钮 / 紧急 / 删除是同一个赭红

**场景**：editorial × light/dark，任意带主按钮的片段。
**看到什么**：`shared.css:135-143` 把 `--cta-bg`、`--danger`、`--q1` 都设成 `#b4553f`（dark 下
`#cd7661`）。实测（`16-components`、`04`、`07`）：主按钮「保存」、危险按钮「删除」、Q1 色点
**三者取到同一个值**。

| 组合 | `--cta-bg` | `--danger` | `--q1` |
|---|---|---|---|
| refined/light | `#2563eb` | `#ff5252` | `#ff5252` |
| **editorial/light** | **`#b4553f`** | **`#b4553f`** | **`#b4553f`** |
| **editorial/dark** | **`#cd7661`** | **`#cd7661`** | **`#cd7661`** |

`16-components.html` 的按钮矩阵里，editorial 下「主按钮」和「危险·hover」两格是**颜色完全相同的
两块赭红**（`six-16-components__editorial-light.png`）。refined 之所以分得开，是因为 CTA 走蓝、
danger 走红；editorial 把它们并到了一支笔上。
**为什么是 BLOCK**：「破坏性」与「主操作」在同一个皮肤里不可分辨，是 UX 安全级问题，不只是审美。
**位置**：`shared.css:135`（`--cta-bg: #b4553f`）、`:137`（`--danger: #b4553f`）、`:140`（`--q1`）。
**截图**：`six-16-components__editorial-light.png`、`six-16-components__editorial-dark.png`。

### W1 · editorial 只在标题上「真的不同」，正文仍是 refined 的排印

**场景**：editorial × light，所有片段。
**看到什么**：23:08 的 `shared.css` 补丁给 `h1/h2/h3/.topbar__title` 接上了 `--editorial-serif`，
标题确实变衬线了（`设置`、`组件总表` 都是衬线），这是对的。但同一补丁里的行距规则**写错了选择器**：

```css
[data-skin="editorial"] body,      /* body 是 <html> 的子元素，皮肤挂在 body 上 → 永不匹配 */
[data-skin="editorial"] .content { line-height: 1.62; }
```

实测 `02-list`：editorial `.content` 行高 **22.68px**、refined **21px**——`.content` 那条生效了；
`body` 那条是死规则。更重要的是设置页自己的文案承诺「暖纸底、**衬线标题、更松的行距**」，现在
「更松的行距」只落在 `.content` 的正文段落上，行对象（`.lrow` 38px、`.when` 12px、`--text-body`
13px）与 refined 完全逐值相同。所以 editorial 读起来仍是「refined 换了纸色 + 标题换字体」。
**判断**：不算 BLOCK（editorial 已经不再像「refined 加滤镜」，标题衬线是真实的差异化），但
KEEP.md 与设置页文案承诺的三分之二还没兑现。
**位置**：`shared.css:286`（死选择器）；`10-settings.html` 的皮肤说明卡。
**截图**：`six-10-settings__editorial-light.png`、`six-02-list__editorial-light.png`。

### 通过项（六组合）

- 17 片段 × 6 组合状态全部正确，无串色（同色令牌另见 B2）。
- protool 的 `--radius-*`、`--control-h` 整体下调在六组合里一致生效。
- 深色下 `--tl-block-tint` 由 14% 提到 16% 的做法在日历块上有效，没有出现「白杠」。

---

## 3 · 密度与节奏

### W2 · 行高在四个片段里是四个值

`DESIGN-LANGUAGE §4.1` 说「列表、象限板、面板字段共享这三个值，使『一行』处处同尺寸」。
实测快照：

| 片段 | 选择器 | 行高 | 左右内边距 |
|---|---|---|---|
| `01-quadrant.html:108` | `.qrow` | **34px** | `1px 12px 1px 3px` |
| `02-list.html:133` | `.lrow` | **38px** | `2px 16px` |
| `05-agenda.html:100` | `.arow-item` | **38px** | `0 8px` |
| `06-detail.html:112` | `.lrow`（左栏列表） | **40px** | `0 8px 0 12px` |
| `09-search.html` | `.palette__row` | **36px** | `4px 8px` |
| `06/08` | `.rung` | **30px** | `0 8px` |

同一件事从「四象限」拖到「清单」再点进「详情」，行会从 34 → 38 → 40 变化；在 `06` 里左栏列表
（40）与右侧 `rung`（30）并排，两个「一行」差 10px。这不是「板比日历密」那种有意的密度差，而是
同一类对象在同一屏里三个高度。
**位置**：上表各行；令牌侧 `shared.css:26-28` 只有 `--control-h`，没有 `--row-h`。
**截图**：`six-01-quadrant__refined-light.png`、`six-02-list__refined-light.png`、
`six-06-detail__refined-light.png`。

### W3 · 日历三视图的「一小时」是三个比例（38 / 46 / 32）

`04-calendar-week.html:203` `--hour: 38px`；`14-multi-day.html:354` `HR = 46`；
`15-day.html:363` `HR = 32`。周视图与多日视图并排切换时，同一场 15:00–16:00 的会
在三屏里高度不同（38 / 46 / 32），「现在时刻线」的斜率也随之改变。密度差本身可以是有意的
（周视图要挤 7 列，日视图可以松），但 32 与 46 相差 44% 已超出「同一尺度、不同缩放」的观感，
切换时会觉得换了个产品。建议统一到一个基准（如 40px）再按列数微调。
**位置**：`04-calendar-week.html:203`、`14-multi-day.html:354`、`15-day.html:363`。
**截图**：`six-04-calendar-week__refined-light.png`、`six-15-day__refined-light.png`。

### M1 · 块级间距里混着 5px / 7px

`DESIGN-LANGUAGE §4.1` 只允许 4px 节奏（`--sp-*`）和密集档 1/2/3/6。快照里仍有
`gap: 5px`（`01-quadrant.html:181` `.lad`、`02-list.html:24`、`06-detail.html:331` 等）和
`gap: 7px`（`04-calendar-week.html:110`）。在 8px 块体系里 5/7 都不落格。

### M2 · `--sp-7` 不存在，12 号片段的段间距实际是 0

`12-empty-states.html:25` `.spec { margin-block-end: var(--sp-7); }`，而 `shared.css:14-15`
只定义到 `--sp-6`、`--sp-8`。实测该值解析为 `0px`，六个空状态标本**首尾相接、没有段间距**。
视觉上六个框像一条连续列表，读者分不清哪一行是下一节的说明文字。
**截图**：`full-12-empty-states-1.png`、`full-12-empty-states-2.png`。

---

## 4 · 对齐

### W4 · 清单右列是三列各自右对齐，阶梯标签的右边缘在 4 个位置

`02-list.html` 每行右端有「阶梯标签 + 清单色点名 + 重复图标」，三者都是 `flex` 自然宽度：

| 行 | 阶梯标签右缘 | 清单名右缘 |
|---|---|---|
| 更新简历 / 年度体检 | 1314 | 1392 |
| 读完《深度工作》（带「未完成」旗） | **1163** | **1294** |
| 写季度总结 / 跟进合同签署 … | 1314 | 1392 |

实测 `ladRights` 有 **4 个互不相同的值**（1314 / 1163 / 1250 / 1272），`listRights` 也有
2 个（1392 / 1294）。于是扫描一列向下时，时间标签会左右跳 150px，眼睛建立不起来「时间在哪一列」。
`01-quadrant` 反而做对了：`distinctRightInsets` 只有一个值（42）——因为它右侧只有标签，没有
第二列。建议给清单行设固定的「时间 / 清单」两列（`grid-template-columns: … auto`），
让带不带「未完成」旗都不影响标签右缘。
**位置**：`02-list.html:133`（`.lrow` flex）与 `:155-162`（`.lrow__list` 自然宽）。
**截图**：`vp-02-rl.png`、`zoom2-02-ladder-rl.png`。

### M3 · 详情左栏与右栏的「一行」不同高，选中项的 inset 位移差 2px

`06-detail.html:129` 选中行用 `inset 2px 0 0 var(--accent)` + `inset 0 0 0 1px`，而右栏
`rung[aria-checked]`（`:315`）用 `inset 0 0 0 1px`。两个「选中」在同一屏左右并排，左边多一道
2px 竖条、右边没有，读起来像两种选中语义。

### M4 · 月视图图例行左右不齐（`已完成的事不在日历上` 独自靠右）

`03-calendar-month.html:459` 最后一项用 `margin-inline-start: auto` 钉到最右，前三项按
`gap: var(--sp-5)`（20px）排。在 1440 下它会贴到右边框，与前三个图例的视觉基线断开；在 960 下
（见下条）还叠进胶囊底下。图例的职责是「解码符号」，四段应该同一条带状排列。

---

## 5 · 层级

### W5 · 日历页顶栏和底部胶囊里各有一个实心主按钮

`03/04/05` 的顶栏右上角有 `.btn--primary`「新建事情」（`03-calendar-month.html:437`），
底部 `.vpill__cta` 也是同一个实心蓝「新建事情」（`:471`，`.vpill__cta` 用 `--cta-bg`）。
`DESIGN-LANGUAGE §5.1` 原文「每个可见界面**只有一个主按钮**」。日视图 `15-day.html`、
年视图 `13-year.html` 同样是顶栏「+ 新建」+ 胶囊「+ 新建事情」两处。一屏两个同权重的实心蓝，
用户第一眼不知道该看哪个；且两者功能相同，属于重复实现。
**位置**：`03-calendar-month.html:437` 与 `:471`；`04/05/13/14/15` 同构。
**截图**：`six-03-calendar-month__refined-light.png`（底部胶囊 + 顶栏）、`six-15-day__refined-light.png`。

### W6 · 「平铺清单」页完全没有主按钮，与其余视图不同调

`02-list.html`、`06-detail.html`、`09-search.html` 实测**没有任何**可见 `.btn--primary`
（顶栏只有「按时间 / 按清单」分段）。从四象限（有「新建」）切到清单，主操作凭空消失。
`02` 顶栏的「按时间/按清单」分段与其它页的「新建事情」占了同一个位置，视觉重心随之右移。
**位置**：`02-list.html` 顶栏（无 CTA）；对照 `01-quadrant.html` 顶栏。
**截图**：`six-02-list__refined-light.png`。

### M5 · 空状态示范页里有两个实心主按钮

`12-empty-states.html` 六张标本里，「新建一件事」与「重试」都是 `.btn--primary`（实测 2 个），
其余三个动作是 `.btn--secondary`。两张实心让「重试」和「新建」抢同一权重，建议只留一个实心。

---

## 6 · 窄窗 960×640（应用窗口下限）

### B3 · 多日视图顶栏溢出被裁掉，主按钮有一半在画面外

**场景**：`14-multi-day.html` @ 960×640，refined/light。
**看到什么**：`.topbar { padding-inline-end: 7.25rem }`（`:24`）是按演示条宽度拍的补丁，
但顶栏内容（标题 + 3天/5天/7天/月/周/多日/日/年 分段 + 今天 + 搜索 + 新建）本身就宽过 684px。
实测 `.topbar__actions` 右缘 **1035**，视口宽 960；`.main` 是 `overflow: hidden`，
所以「新建」按钮被切掉右半，**点击区也在画外**。这是唯一一个**内容真被裁掉**的片段。
**位置**：`14-multi-day.html:24`；`.main { overflow: hidden }` 见 `shared.css:247-251`。
**截图**：`final-14-top960.png`（可见「新建」右半截断）、`crop-14-top960.png`。

> 附：所有片段的顶栏用 `padding-inline-end: 7.25rem / 10rem / 13rem` 三种不同值来给演示条让位
> （`01:18`、`02:17`、`03:18`、`04:14`、`05:14`、`06:66`、`07:22`、`08:20`）。这是修补而不是布局，
> 演示条一改宽度就再次错位；`demo.css:29` 已经改成 `pointer-events: none`，这些 padding 其实
> 已经可以删掉。

### B4 · 月视图底部：胶囊压住图例，两条图例文字完全读不到

**场景**：`03-calendar-month.html` @ 960×640。
**看到什么**：`.legend`（`:230`）随内容换行成两行（盒高 569→630），底部胶囊
`.floating-center`（`:463`，`inset-block-end: 16px`）压在其上。逐字测像素：图例 1 的
「一段时间：一条横跨它覆盖的那些天」**2/2 行被盖**、图例 3「这一段已经过去 · 未完成」
**2/2 行被盖**，`elementFromPoint` 全部命中 `.vpill`。截图里只剩「某天：日 / 上午下午 / 几点」
的上半截和右端「已完成的事不在日历上」。
**为什么是 BLOCK**：图例是这套日历的**解码器**（它解释了窗口横带和逾期色），被遮掉一半后
用户看到绿色横带却读不到它是什么——而这正是 v2 的核心概念。
**位置**：`03-calendar-month.html:230`（`.legend` 无底部留白）、`:463`（胶囊固定 16px）。
**截图**：`final-03-legend960.png`、`occl-960.png`。
**修法**：给 `.content--cal` 设 `padding-block-end ≥ 胶囊高 + 12px`，或把图例改成
不与胶囊同层的固定条。

### W7 · 年视图热力图在 960 下被横向裁切（需要横滚）

`13-year.html` 的热力格固定宽，`.content` 是 `overflow-x: auto`，`scrollWidth 963` vs
`clientWidth 669`。最后一列（12 月及岁末格子）落在画外，且没有可见滚动条提示。
实测最后格右缘 **1239**，视口 960。读者会以为 12 月是空的。
**位置**：`13-year.html` 热力网格（`.heat-main` 无 `min-inline-size: 0` 收缩约束）。
**截图**：`final-13-heat960.png`（可见 12 月列被切）。

### M6 · 周/多日视图标题在 960 下折成两行

`04-calendar-week.html` 的日期标题与副标题在 960 下**两个字一行**折行（`final-04-top960.png`：
「11月23 / 日 – 29日」、「2026 年·第 / 48 周·本周」），顶栏高度从 26 变 51px。
`14-multi-day` 同病。多出的一行让顶栏与内容对不齐，且「11月23」与「日 – 29日」断得很难看。
建议 `<960` 时副标题（周数）`display: none`，而不是硬折。

---

## 7 · 空状态（12-empty-states.html）

结论：**每个空态都还是同一个产品**——同一个图标底（`--bg-sunken` 方块 + 线性图标）、同一句
标题 + 一句解释 + 一个动作，六段的形状一致，没有退化成一页白纸。两处不足：

- **MINOR-2 的段间距为 0**（见 §3），六个标本粘在一起，这是这页最直接的观感问题。
- **MINOR-5**：六张里「新建一件事」和「重试」两处实心主按钮，权重撞车。
- 长解释段落的行宽实测 479–543px（有 `max-inline-size` 约束），没有出现超宽问题。

截图：`six-12-empty-states__refined-light.png`、`__editorial-dark.png`、`full-12-empty-states-1/2.png`。

---

## 8 · 动效

### W8 · 减少动效时「已保存」信号彻底消失（§6 要求保留信号）

`shared.css:461-463` 有一条全局兜底（`* { transition: none !important }`），所以不会有过渡残留；
问题在**信号**：`06-detail.html:169-181` 的 `.saved` 靠 `opacity 0 → data-on → 1` 提示「已保存」。
它的 reduce 分支（`:595`）只写 `transition: none`，但 `.saved` **默认 opacity 就是 0**——
实测 reduce 下给元素加 `data-on` 后 opacity 从 0 变 1 是能读到的（`:181` 的规则本身生效），
所以这一条是**半通过**：信号没丢，但它依赖「静态跳变」而不是 §6 举的 `.qz-card--flash` 那种
「保持高亮」。真正的缺口在 `09-search.html:267`、`10-settings.html:275`、`11-dialogs.html:250`：
这三处的 reduce 分支名与通配兜底重复，没有额外保留任何状态信号。
**位置**：`06-detail.html:595`、`09-search.html:267`、`10-settings.html:275`、`11-dialogs.html:250`。

### M7 · 破坏性确认的进度条动画 `inline-size`（布局属性）

`11-dialogs.html:174` `.progress__fill { transition: inline-size var(--dur-base) }`，并在
`:639` 用 JS 再设一次 `inline-size ${HYSTERESIS_MS}ms linear`。§6 明确「不要动画 height/width」。
600ms 的进度条是低频元素，不构成卡顿，但它是全稿唯一一处**显式动画布局属性**，且 JS 里还写了
字面量时长（`HYSTERESIS_MS`），与「走 `var(--dur-*)`」冲突。改成 `transform: scaleX()` 即可。
**位置**：`11-dialogs.html:174`、`:639`。

---

## 9 · 其他打磨项

### M8 · 列表色点用字面量十六进制

`03/04/05/09/13/14/15` 等 8 个片段里清单色点是内联 `style="background:#5b8def"`（如
`04-calendar-week.html:416-419`），而 `data.js:10-13` 与 `01/02` 走 `l.color`。SPEC §5 要求
「不写字面量颜色」；这里虽然值与数据源一致，但绕过令牌的写法会在皮肤或清单改色时漏改。

### M9 · 图例右端项与其余三项的间距不等

`03-calendar-month.html:459` 最后一项「已完成的事不在日历上」用 `margin-inline-start: auto`
钉到最右，前三项按 20px `gap` 排；在 1440 下它会贴到右边框（1405，容器右缘 1424），
与前三项的视觉基线断开。视觉问题已并入 MINOR-4，此处仅记录像素值。

---

## 附：片段 × 组合 通过表

`P` = 该组合可读、配色属于本皮肤、无裁切；`F` = 该格有恰在上文列出的缺陷（注明编号）。

| 片段 | refined/L | refined/D | protool/L | protool/D | editorial/L | editorial/D | 备注 |
|---|---|---|---|---|---|---|---|
| 01-quadrant | P | P | P | P | **F(B2)** | **F(B2)** | 阶梯形状达标 |
| 02-list | **F(W2,W4)** | **F(W2,W4)** | **F(W2,W4)** | **F(W2,W4)** | **F(B2,W2,W4)** | **F(B2,W2,W4)** | 右列不齐 |
| 03-calendar-month | F(W5) + 960 B4 | F(W5) | F(W5) | F(W5) | **F(B2,W5)** + 960 B4 | **F(B2,W5)** | 960 下胶囊压图例 |
| 04-calendar-week | P | P | P | P | **F(B2)** | **F(B2)** | 960 标题折行（M6） |
| 05-agenda | **F(B1,W5)** | **F(B1,W5)** | **F(B1,W5)** | **F(B1,W5)** | **F(B1,B2,W5)** | **F(B1,B2,W5)** | 六档同色 |
| 06-detail | **F(B1)** | **F(B1)** | **F(B1)** | **F(B1)** | **F(B1,B2)** | **F(B1,B2)** | 六档同色 |
| 07-capture | P | P | P | P | **F(B2)** | **F(B2)** | — |
| 08-time-picker | P | P | P | P | **F(B2)** | **F(B2)** | — |
| 09-search | **F(B1,W2)** | **F(B1,W2)** | **F(B1,W2)** | **F(B1,W2)** | **F(B1,B2,W2)** | **F(B1,B2,W2)** | 六档同色 |
| 10-settings | P | P | P | P | P | P | 皮肤卡文案见 W1 |
| 11-dialogs | F(M7) | F(M7) | F(M7) | F(M7) | **F(B2,M7)** | **F(B2,M7)** | 进度条动画 |
| 12-empty-states | **F(M2,M5)** | **F(M2,M5)** | **F(M2,M5)** | **F(M2,M5)** | **F(B2,M2,M5)** | **F(B2,M2,M5)** | 段间距 0 |
| 13-year | P | P | P | P | **F(B2)** | **F(B2)** | 960 热力裁切（W7） |
| 14-multi-day | **F(B3,W3,M6)** | **F(B3,W3)** | F(W3) | F(W3) | **F(B2,B3,W3,M6)** | **F(B2,B3,W3)** | 960 顶栏裁切 |
| 15-day | P | P | P | P | **F(B2)** | **F(B2)** | 小时比例 32（W3） |
| 16-components | **F(B1,W3)** | **F(B1,W3)** | **F(B1,W3)** | **F(B1,W3)** | **F(B1,B2,W3)** | **F(B1,B2,W3)** | 「最重要视觉」示范成灰 |
| 17-icons | P | P | P | P | P | P | — |

图例：B1 六档同色 · B2 editorial 主/危/紧急同色 · B3 960 顶栏裁切 · B4 960 胶囊压图例 ·
W2 行高不统一 · W3 小时比例 · W4 清单右列不齐 · W5 双主按钮 · W7 热力裁切 ·
M2 段间距 0 · M5 双实心按钮 · M6 标题折行 · M7 进度条动画。
W6（清单页无主按钮）与 W8（reduce 信号）是组合无关的结构问题，不单列到格子里。

---

## 三个最「不好看」的片段

1. **`05-agenda.html`（日程）** —— 一屏灰：时间列「下午 / 15:00 / 晚上」同一种小灰字，
   行距 38px 又比左右栏松，整页几乎没有视觉落点。这是 v2 最该好看的一页，却最平。
2. **`06-detail.html`（详情）** —— 左栏 40px 行 × 右栏 30px 行 × 两个不同选中样式，
   六档阶梯退化成六个同色圆圈按钮；1440 下右栏 380px 里塞了标题 + 时间 + 象限 + 清单 +
   备注，段落感被压平。
3. **`14-multi-day.html`（多日）** —— 960 下顶栏主按钮被切；1440 下小时高 46px 让 10:00 到
   15:00 之间空出 250px 无人区，而三列只放了四件事，页面重心严重偏上。

## 截图索引（`C:/Users/EDY/AppData/Local/Temp/ui-design/shots/rv/`）

- `six-<片段>__<skin>-<theme>.png` —— 17×6 = 102 张，**本报告所有判断的基准**（状态已逐格校验）。
- `final-14-top960.png`、`final-03-legend960.png`、`final-13-heat960.png`、`final-04-top960.png`
  —— 960×640 极值证据（B3、B4、W7、M6）。
- `ladder-01-refined-light.png` / `-editorial-light.png` / 另四组合 —— 2× 放大，判 B1 的正反两面。
- `grey-05-agenda.png`、`grey-06-detail.png`、`grey-09-search.png` —— 六档同色的近景。
- `zoom2-02-ladder-rl.png`、`vp-02-rl.png` —— 清单右列对齐（W4）。
- `full-12-empty-states-1/2.png` —— 空状态全页（M2）。
- 作废（截图管线串帧，勿引用）：`crop-*`、`fix-*`、`month2-*`、`occl-*`。

---

## 六档阶梯标签：可分辨性判定

**一半达标、一半不达标。**
- **板与清单（01/02）里：可分辨（PASS）。** 六档靠形状区分——虚线胶囊 / 两端括号 / 方角实心 /
  圆角实心 / 黑底反白 / 无色点，2× 下并在缩略图上也能读出来，完全达到 KEEP.md §B3。
- **日程、详情、搜索、组件总表（05/06/09/16）里：不可分辨（BLOCK）。** 同一套 `.when`
  把 month/week/day/period/time 五种全设成 `--ink-2`，`none` 一档 `--ink-3`——本质是
  「六种灰」里勉强两种灰。组件总表甚至拿它来演示「整个系统最重要的一处视觉」。

因此：**设计语言本身是对的，落差在于同一语言只被两个片段采用。** 修法在 §1.2。
