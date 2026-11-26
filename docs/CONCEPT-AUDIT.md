# 概念一致性走查报告

> 生成日期：2026-11-26
> 审阅基线：工作区当前状态（未提交改动）
> 审阅对象：**概念**，不是像素。`docs/UI-AUDIT.md` 已覆盖视觉/交互缺陷，本文件不重复。
> 目标运行时：Windows / Tauri 2 / WebView2。

本文档的立场来自一句产品批评：

> 「产品设计一定要逻辑全局一致，这本质上是管理学的问题。」
> 「别硬造概念，都是要干的事。」
> 「任务 / 日程，你引入了这两个概念，但是在四象限和各个日历视图里完全区分不出来啊。」

**一句话结论**：`Task` 与 `CalendarEvent` 不是两种"要干的事"，是同一件事的**两个投影**。
应用在 `CalendarEntry` 这一层已经把两者合并了（`packages/core/src/domain/types.ts:176-202`），
但在**重要性、完成、重复、搜索、创建**这五处上，两条路各走一边，于是"合并"只发生在渲染层，
没有发生在概念层。用户被迫记住的不是业务规则，而是这张分流表。

本文档是「现状 + 待办」，与 `docs/DESIGN-LANGUAGE.md` 同构：任何一处修复完成后，应同步删除对应条目。

---

## 0. 怎么用这份文档

- **§1** 是结论摘要与计数。
- **§2** 是模型现状：两条记录、一个投影。
- **§3 / §4 / §5** 是缺陷清单，P0 → P1 → P2，每条带 `file:line`、场景、矛盾点、依据、修法方向。
- **§6** 是本次新增的一等章节：**产品在哪些地方强迫用户理解 任务 / 日程**，每条标注
  `[dies with the merge]` / `[survives, needs a new rule]` / `[becomes a real gap]`。
- **§7** 是新用户前五分钟要交的学费。
- **§8** 是合并之后**变好**的部分（用户抱怨的是"不一致"，这里回答"一致换来什么"）。
- **§9** 是核实后推翻的怀疑。
- **§10** 是钉住现状的测试与文档债。

---

## 1. 摘要

| 项 | 数 |
| --- | --- |
| **P0（产品说错话 / 用户丢数据）** | **4** |
| P1（同一问题两个答案，用户必须记忆分流） | 12 |
| P2（残留、死代码、静态谎言） | 7 |
| 概念泄漏面（§6） | 15 处（含 1 处已合并的正面先例） |
| 核实后推翻的怀疑 | 5 条（§9） |

已确认的四条（不重复论证，只在相关处引用）：

1. 两种"紧急"：`Task.urgent` 布尔 vs `isOverdue()`，且 `isOverdue` **零 UI 消费方**；
2. 日历 chip 用清单色 `colorOfList()`，艾森豪威尔四色不在日历上；
3. `CalendarEvent` 没有 `important/urgent`；
4. 精度阶梯 `none|day|period|time`，没有周/月。

本轮新发现的三条最伤（不属于上述四条）：**§3.1 捕获条的任务模式丢掉你点的那一格时间**、
**§3.2 事件编辑器把你的备注和清单显示成空**、**§3.4 导出 CSV 静默丢掉全部日程**。

---

## 2. 模型现状：两条记录，一个投影

```
Task        (list_id NOT NULL, important, urgent, status, completed_at, recurrence, due_period)
CalendarEvent (list_id NULLABLE,            —          —             —           —)
        │                    │
        ├── taskToEntry ─────┤
        │                    ├── eventToEntry
        ▼                    ▼
              CalendarEntry { source, startAt, endAt, color, done, period }
```

- 投影层是统一的：`packages/core/src/domain/types.ts:176-202`。
- 记录层是分裂的：`packages/adapters/src/sqlite/schema.ts:36-61`。
- 分裂的代价被 `source` 一个字段推给了 UI：`apps/desktop/src/shell/Shell.tsx:429-433`。
- **任务的时间是"点"，日程的时间是"区间"**，但投影时任务被伪造成区间：
  `packages/core/src/domain/calendar.ts:59` 给定时任务写了 `endAt = dueAt`（零长度），
  `packages/features/src/calendar/DayView.tsx:181` 再用 `Math.max(end, start + 15)` 补成 15 分钟。
  也就是说**"区间"这个概念本来就能容纳任务**，分裂不是数据形状逼出来的。

---

## 3. P0 — 产品说错话 / 用户丢数据

### 3.1 捕获条切到「任务」，你刚点的那一格时间被丢掉

**位置**
- `packages/features/src/calendar/QuickEventComposer.tsx:408-417`（任务分支只调 `createInbox` + `moveToQuadrant`）
- 同文件 `:540-542`（任务模式整块不渲染日期/时长 chip）
- `packages/features/src/calendar/QuickEventComposer.tsx:472-483`（类型切换是面板第一个控件）
- 调用点：`apps/desktop/src/shell/Shell.tsx:378-382`（格子点击 → 捕获条）

**场景**：在周视图点周五 14:00 的空格，面板弹出（默认「日程」），把标题写好，看到最上面
「任务 / 日程」两个分段按钮，心想"这就是个待办"，点「任务」，再点「添加」。

**你撞到什么**：建出来的任务 **没有截止日期**。它会出现在四象限板上，但**不会出现在你刚刚点击
周五 14:00 的那张周视图里**——因为 `createInbox`（`packages/core/src/application/task-service.ts:74-92`）
只写 `title/listId`，日期为 `null`；`taskToEntry` 对无日期任务返回 `null`
（`packages/core/src/domain/calendar.ts:53`），所以日历里根本没有它。

**为什么这是 P0 而不是 P2**：这正是仓库自己记录过的失败模式。捕获条之所以有这个开关，注释写得很清楚：

> `QuickEventComposer.tsx:53-58`：「Ctrl+N 只产出 `CalendarEvent` —— 板子不渲染它，你刚捕获的东西消失了。」

现在这个 bug 以**镜像**形式回来了：在日历上点「任务」，产出的 `Task` 日历不渲染，你刚捕获的东西
从你点击的位置消失了。开关只是把"消失"从一个方向搬到另一个方向。

**附加矛盾**：同一个开关还决定了哪些字段存在——

| 模式 | 有日期/时长 | 有象限 |
| --- | --- | --- |
| 任务 | 否（`:540-542` 整块不渲染） | 是（`:513-538`） |
| 日程 | 是（`:543-594`） | 否 |

所以面板的第一个控件不是"选类型"，而是"选你这辈子只能填一半字段"。

**修法方向**：合并之后这个开关消失；`startAt/endAt` 成为唯一的时间概念，任务也写它们。
在合并之前的最小修复是：从日历格子打开、且用户选了「任务」时，把 `date`/`time` 作为
`kind: 'time'` 的 `TaskSchedule` 写进去（`task-service.ts:346-352`），而不是丢掉。

---

### 3.2 打开任何日程，你的备注显示为空，清单显示为「无清单」，而且改不回来

**位置**
- `packages/features/src/calendar/EventEditor.tsx:165-168`（编辑既有条目时 `listId: ''`、`notes: ''`）
- 同文件 `:458-470`（清单下拉里 `''` 就是「无清单」）
- 同文件 `:461`、`:481`（编辑态下清单与备注 `disabled={... || isEditing}`）
- 但投影层**已经**带上这两个字段：`packages/core/src/domain/calendar.ts:32-36`

**场景**：在月视图点开「产品评审会」，备注里明明写过会议链接。

**你撞到什么**：备注输入框是空的，清单一栏写着「无清单」——即使这条日程确实属于「工作」清单、
确实有备注。而且这两个控件在编辑态是 `disabled` 的，所以用户既看到错误信息，又无法修正。
打开一个没有改动的日程再关掉，不写回（`EventEditor.tsx:301-309` 只 patch 四个字段），
所以数据没坏——**坏的是界面在陈述一件假事**。

**证据链**：`eventToEntry` 的注释（`calendar.ts:32-36`）说这两个字段"带过来是为了让事件检查器
就地编辑"。而 `EventEditor.tsx:165-167` 的注释说"`CalendarEntry` 不携带 listId/notes"。
**两段注释直接互相否认**，后者已经过期一年了：类型上 `CalendarEntry.listId/notes` 是可选字段
（`types.ts:192-201`），`eventToEntry` 也一直在写。

**附加后果**：日程一经创建，**清单和备注就永久不可编辑**（新建时有，编辑时灰掉）。
这已经不是概念问题，是能力缺失。

**修法方向**：`seed` 从 `entry.notes ?? ''`、`entry.listId ?? ''` 初始化；编辑态放开这两个字段，
并加入 `EventService.update` 的 patch（`packages/adapters/src/fields.ts:38-45` 已允许）。

---

### 3.3 「今天」的角标数字与「今天」列表里的行数对不上

**位置**
- 角标：`packages/features/src/lists/ListSidebar.tsx:197-207`（`if (task.status === 'done') continue;`
  在 `dueToday += 1` 之前）
- 列表：`apps/desktop/src/shell/Shell.tsx:231-240`（只按 `dueDate` 过滤，**没有状态过滤**）
- 渲染：`packages/features/src/task/TaskListScreen.tsx:84-93`（已完成行照常入桶，`compareTasks` 只是排后面）

**场景**：今天只有一件事。做完它，侧栏「今天」的角标变成 0。点进去。

**你撞到什么**：列表里那一行还在（带删除线）。角标说 0，列表说 1。

**同一处还有两个"全部"**：
- 角标 `openTotal` = 未完成任务数（`ListSidebar.tsx:202`）；
- 点「全部」进的是 `taskListMode`，渲染 `tasks ?? []` 全部任务，含已完成和无日期
  （`Shell.tsx:232`）——两者永远差一个"已完成"的量级。

**为什么归 P0**：角标是产品对用户做的**陈述**（"今天有 3 件事"）。陈述与内容不符，
用户会以为自己漏看了，或者以为完成了没生效。

**修法方向**：一个筛选器同时决定计数与内容。要么两处都含已完成（角标写 `3（1 已完成）`），
要么两处都排除已完成（列表加"显示已完成"开关）。**只有一处口径**是重点。

---

### 3.4 导出 CSV 静默丢掉全部日程，而文案只说"不含 id"

**位置**
- `packages/features/src/data/export-import.ts:169-178`（`CSV_COLUMNS` 只有任务字段）
- 同文件 `:200-224`（`exportTasksToCsv(tasks, lists)` 的签名里根本没有 events）
- 调用点 `packages/features/src/data/DataTransferPanel.tsx:324`
- 文案：`packages/ui/src/i18n/locales/zh-CN/misc.json:6`

**场景**：设置 → 数据 → 「导出 CSV」，想拿去表格里看这一年的安排。

**你撞到什么**：文件里只有任务。所有日程一条都没有。面板上的说明是：

> 「完整备份包含任务、清单与日程……CSV 适合在表格软件中查看，**但不含 id**。」

它诚实地说出了"不含 id"，**没有说出"不含日程"**。用户读到的是"CSV 是同一份数据的另一种格式"，
而事实是"CSV 是另一份数据"。

**依据**：`docs/UI-AUDIT.md` §2.2-L 已经记过"导出的 CSV 表头中文"——这里更深一层：
导出的**内容**也不是用户以为的集合。同一个面板同时提供两种"你的数据"定义，且措辞只披露了较无害的那个差异。

**修法方向**：二选一，不要中间态——
A. 合并后 CSV 只有一张表（一切皆条目），问题自动消失；
B. 合并前：要么补 `events` 行（加"类型"列），要么把按钮文案改成「导出任务 CSV」。

---

## 4. P1 — 同一问题两个答案

### 4.1 任务的时间在哪都不显示，只有日历显示

**位置**
- `packages/features/src/task/due-label.ts:19-29`（`formatDue` 只读 `dueDate` + `duePeriod`，**从不读 `dueAt`**）
- `packages/features/src/task/TaskListRow.tsx:72`（行内 due 列）
- `packages/features/src/quadrant/QuadrantRow.tsx:76-79`（板子行 meta）
- `packages/features/src/search/SearchPanel.tsx:42-60`（搜索结果 due 标签，同样只看 `dueDate`）

**场景**：任务设为「具体时间 20:00」。在详情面板里能看到 20:00（`TaskDetailPanel.tsx:480-488`），
保存。回到列表 / 板子 / 搜索结果。

**你撞到什么**：三处都只写「今天」。时间是**存下来了、也算进了排序**（`compareTasks` 用 `dueAt`，
`packages/core/src/domain/task.ts:124-126`），但在所有列表面里**不可见**。用户无法确认自己设的
20:00 还在不在，唯一办法是再点开详情面板。

**与已知 #1 的关系**：这是"两种紧急"的可见后果。列表既不知道时间，就永远只能说日期；
而 `isOverdue` 知道时间，却没有调用方（见 §4.9）。于是"20:00 截止"这个事实，**只有域层知道**。

**修法方向**：`formatDue` 在 `dueAt` 非空且非 `allDay` 时追加 `HH:MM`。一个函数的改动，
同时修好三个面。

---

### 4.2 全天日程永远不会提醒（同一 bug，任务修了，日程没修）

**位置**
- 任务：`packages/features/src/reminders/ReminderScheduler.ts:79-109`（`reminderAnchorOf` 把 `day` 推到 09:00，
  把 `period` 推到 09:00/12:00/19:00）
- 日程：同文件 `:242-256`（直接用 `event.startAt`，**没有 anchor 推导**）
- 全天日程的 `startAt` 是午夜：`QuickEventComposer.tsx:421`、`EventEditor.tsx:262-263`

**场景**：新建一个「全天」日程（例如"母亲生日"）。

**你撞到什么**：它的 `startAt` 是当天 00:00。提醒循环里 `if (dueMs < nowMs) continue;`
（`:245`），所以只要应用不是恰好在 00:00 前的 10 分钟窗口里跑着，这条提醒**永远不会触发**；
如果它恰好在跑，就在**午夜**弹。这正是任务侧注释里描述过的原始 bug：

> `ReminderScheduler.ts:14-19`：「按存储值播报，是一个『今天』任务在 00:00 提醒然后再也不提醒。」

任务侧用 `reminderAnchorOf` 修好了，日程侧没修，因为日程没有"精度"概念可推。
**这是合并最直接的收益之一**：全天不再分两种来源。

**修法方向**：合并后统一走 `reminderAnchorOf`，`dueDate` 非空即 09:00 起锚。

---

### 4.3 删清单：任务被拦下，日程被静默脱钩；两种存储后端还各说各话

**位置**
- 服务层：`packages/core/src/application/list-service.ts:54-61`（只数 tasks，`force` 才能删）
- UI 只传不带 `force`：`apps/desktop/src/composition.ts:30-47`
- SQLite：`packages/adapters/src/sqlite/schema.ts:38`（tasks `ON DELETE CASCADE`）、
  `:53`（events `ON DELETE SET NULL`）
- 内存适配器：`packages/adapters/src/memory/MemoryUnitOfWork.ts:144-148`（**纯 splice，没有 FK 语义**）
- 文案：`packages/ui/src/i18n/locales/zh-CN/lists.json` 的 `deleteConfirm.*`（只提"任务"）

**场景**：「工作」清单里没有任务，只有 8 个会议。删除它。

**你撞到什么**：
- 删除成功（因为 `ListService.remove` 只看 tasks），**8 个会议一条都不问**；
- SQLite 下它们的 `list_id` 被置 NULL，内存模式下 id 原样留着（悬空）；
- 无论哪种，`colorOfList()`（`packages/core/src/domain/calendar.ts:73-78`）都找不到清单，
  于是这些会议**从清单色变成第三级灰**——用户看到的是"我的会议掉色了"，没有任何提示。

**概念矛盾**：产品对同一动作有两套承诺。对任务："不会被一并删除，请先处理"
（`lists.json` `deleteConfirm.blocked`）；对日程："没人说过"。两类东西都在同一个清单里，
删除对话却只替其中一类说话。

**为什么归 P1 而不是 P0**：默认路径下不丢数据（`ON DELETE CASCADE` 因为没传 `force` 而
不会触发），但**能力分叉是真实的**：`packages/core/test/services.test.ts:53` 用
`remove(list.id, { force: true })` 锁死了"force 会连任务一起删"，也就是说这行代码是
**可达的、有测试的**，只是 UI 没走。任何未来调用 force 的路径都会让任务的保护蒸发。

**修法方向**：合并后清单只有一种成员，删除规则只能有一条。推荐：不删成员，只脱钩
（`SET NULL`），并在确认框里如实计数 `N 个条目将失去清单`。

---

### 4.4 点同一个 chip，打开两个编辑器：字段集不同、保存语义不同

**位置**
- 分流：`apps/desktop/src/shell/Shell.tsx:429-433`（`entry.source === 'task'` → 任务详情面板；否则事件编辑器）
- 任务：`packages/features/src/task/TaskDetailPanel.tsx`（侧栏，**每次改动立即写入**）
- 日程：`packages/features/src/calendar/EventEditor.tsx`（模态，**有保存/取消/脏检查**）

**场景**：在一张周视图上，两个长得一模一样的 chip。点第一个，右边滑出一个面板；点第二个，
中间弹出一个模态框。

**你撞到什么**：同一块视图里的两个同形对象，交互模型（侧滑 vs 模态）、控件（无保存按钮 vs 有保存按钮）、
可编辑字段（象限/重复/备注 vs 开始/结束/时长/清单）全都不同。用户必须先从视觉上判断
"这块是哪种"，而视觉上**没有区别**（见 §6.6）。

**死代码证据**：事件编辑器里专门有一条分支处理"任务类条目只读"
（`EventEditor.tsx:149` `canEditEntry`、`:387-391`、i18n `event.taskEntryReadonly`），
但分流规则保证 `EventEditor` **永远收不到 task 条目**——`editingEntry` 只在
`Shell.tsx:431` 的 else 分支被赋值。这条分支是这次分裂留下的化石，同时也证明"分裂"曾经更严重过。

---

### 4.5 四象限与时间轴从不叠加

**位置**
- 板子：`packages/features/src/quadrant/QuadrantScreen.tsx:112-131`（按象限分组，**没有任何日期过滤**，无日期任务也在内）
- 日历：`packages/core/src/application/calendar-service.ts:34-43`（按时间取条目，**不读 `important/urgent`**）

**场景**：「重要且紧急」的那件事今天下午截止。打开板子看优先级；打开周视图看时间。

**你撞到什么**：两个问题是两个屏幕。板子上你看不到"今天"，周视图上你看不到"重要"。
更糟的是侧栏的「今天」**会把板子整个换掉**（`Shell.tsx:230` `flatView`），所以没有任何一处
能同时回答"今天最该做的是哪件"。

**与已知 #2 的关系**：#2 说的是"日历 chip 不用象限色"。更深一层是：**产品两个核心模型
（艾森豪威尔 × 时间）在任何视图里都不相乘**，只在 `TaskDetailPanel` 里各占一个 section。
这不是配色问题，是信息架构问题——两个模型默认彼此无关。

**修法方向**：合并后至少提供一个交叉面：板子的行显示日期、日历的 chip 带象限色（或优先级标记）；
或者一个「今天」视图同时呈现"重要且紧急"分组。取舍留待设计，但"从不叠加"必须结束。

---

### 4.6 搜索只搜任务，而且文案自己承认

**位置**
- `packages/features/src/search/search.ts:1`（`import type { ListId, Task }`）
- `packages/features/src/search/SearchPanel.tsx:90`（`useTasks()` 是唯一数据源）
- 文案：`packages/ui/src/i18n/locales/zh-CN/misc.json:105-107`（「搜索任务」「搜索任务标题或备注…」）

**场景**：想找上周那个「客户电话」，只记得名字，不记得它在日历上还是清单上。

**你撞到什么**：搜不到。搜索框已经提前告诉你了——它叫「搜索任务」。所以这不是 bug，
是**产品对"要干的事"有两个索引**。而用户并不知道自己上次建的是哪一种（见 §7）。

**修法方向**：合并后 `applyFilters` 的入参从 `readonly Task[]` 变成条目集合；
`SearchPanel` 的分组键从 `listId` 改为"清单 + 无清单条目的一个桶"，日程自动进入已有分组。

---

### 4.7 议程与年视图：能看到，但什么都不能做

**位置**
- `apps/desktop/src/shell/Shell.tsx:628`（`<TimelineView cursor today />`，没有 `onOpenEntry`）
- `packages/features/src/calendar/TimelineView.tsx:8-13`（props 里没有回调）
- `apps/desktop/src/shell/Shell.tsx:662-670`（`YearView` 只给 `onOpenDay`，且只是打开月份）

**场景**：在议程视图里看到今天第三项「交报销单」，想勾掉它。

**你撞到什么**：点不动。议程视图是**只读的截图**：它渲染任务也渲染日程，但两类都不能打开、
不能完成、不能改期。年视图同理。用户只能记住"这一项在议程里，要回板子/详情里处理"。

**概念后果**：「能看到的地方不能操作，能操作的地方看不到」——这是分裂的典型症状。
合并后议程应当与板子共享同一条"打开 → 操作"路径。

> 注：这里也可以只当成 UI-AUDIT 的键盘可达性问题。之所以记在概念账上，是因为
> **它恰好只覆盖了"两类都显示"的唯一一个视图**，却不给任何一类提供操作——
> 也就是说，唯一一个"合并视图"是死的。

---

### 4.8 每周五的复盘会：做成任务能重复，做成日程不能

**位置**
- `Task.recurrence`：`packages/core/src/domain/types.ts:152`；规则 `packages/core/src/domain/recurrence.ts`
- 编辑入口只在任务详情：`packages/features/src/task/TaskDetailPanel.tsx:493-577`
- `CalendarEvent` 无 recurrence 字段：`types.ts:159-169`；无列：`schema.ts:51-61`

**场景**：每周五 17:00-17:30 的复盘会。

**你撞到什么**：两条互斥的路——

| | 做成任务 | 做成日程 |
| --- | --- | --- |
| 显示在周五 17:00 的格子里 | 只有选「具体时间」且只有 15 分钟（`DayView.tsx:181`） | 可以，30 分钟正常 |
| 能重复 | 能（每周五） | **不能** |
| 能勾完成 | 能 | 不能 |
| 能带象限 | 能 | 不能 |
| 有持续时长 | 不能 | 能 |

所以"每周五复盘"这个真实的东西，**没有任何一种表达方式是对的**。用户只能二选一，
然后接受某一半错。这不是"两种概念"，这是**同一个概念被劈成两半，各留一半能力**。

**附加**：任务的重复完成是"派生新行"（`task-service.ts:94-157`）——完成一次，列表里多一行。
如果日程也这样重复，日历会被已完成的历史塞满；这是合并时必须重新回答的问题
（见 §6 的 `[survives, needs a new rule]`）。

---

### 4.9 `isOverdue` 是死代码；「已逾期」只在半夜才成立

**位置**
- `packages/core/src/domain/task.ts:74-96`（有完整实现、有 8 条测试）
- 唯一消费方：`packages/core/test/scheduling.test.ts`（测试）
- UI 的「已逾期」分组：`packages/features/src/task/TaskListScreen.tsx:48-60`（`diff < 0`，**只看日期**）

**场景**：任务设 20:00 截止。20:30 打开列表。

**你撞到什么**：它还在「今天」组里，没有任何逾期标记。提醒也不会再来
（精确时间任务"过点不补播"，`ReminderScheduler.ts:230-232`）。**从 20:00 到午夜，
应用对"这件事已经迟了"这件事一言不发**；到第二天它才突然变成「已逾期」。

也就是说：域层有一份正确的"逾期"定义（精确到分/半天/天），UI 另有一份只看日期的近似，
两份都不完整，而且互不知道。这正是你点名的第一条，这里补上它的**时间窗证据**。

**修法方向**：合并 + 一个 `urgencyOf(task, now)` 派生函数，同时供列表标记、排序、日历 chip 使用。
`isOverdue` 不删，成为那个函数的一半。

---

### 4.10 `QuickAdd` 是死代码：斜杠命令和"带时间的快速捕获"一起消失

**位置**
- `packages/features/src/task/QuickAdd.tsx:30-94`（`/重要` `/紧急` `@14:00` 的完整实现）
- 挂载条件：`packages/features/src/task/TaskListScreen.tsx:106-108`、`:142`（仅当传入 `onCreate`）
- 唯一调用点**不传**：`apps/desktop/src/shell/Shell.tsx:572-583`
- 解析器仍是活的且有测试：`packages/features/src/task/due-label.ts:96-127`、
  `packages/features/test/task.test.ts:51-120`

**场景**：在老版本里，`写周报 /重要 /紧急 @14:00` 一次回车完成三件事。

**你撞到什么**：现在没有任何输入框支持这套语法。捕获条（`QuickEventComposer`）有象限芯片
和日期芯片，但**不支持斜杠命令**，**任务模式下连日期芯片都没有**（`:540-542`）。
用户为一个能力付了两次代价：先失去了快捷语法，再失去了"捕获时直接定时间"。

**概念账**：这是"别硬造概念"的实证。`QuickAdd` 是一个**只懂任务**的捕获面，捕获条是一个
**懂两种但不会合并**的捕获面。产品最后选了后者，却没有把前者的能力搬过去。

**证据补充**：`packages/features/src/index.ts:38` 仍然导出 `QuickAdd`，`due-label.ts` 仍导出
`parseQuickAdd`，i18n 的 `task.json:121-126` 仍保留 `quickAdd.*` 四条文案。**整条链都在，
只是入口没了**——下一轮审查很容易误判为"功能存在"。

---

### 4.11 有四个"新建"，它们对"新建什么"的回答不一致

| 入口 | 位置 | 建出什么 |
| --- | --- | --- |
| 顶栏 `+` | `apps/desktop/src/shell/TopBar.tsx:66` → `Shell.tsx:539` | 永远 `CalendarEvent`（即使在四象限板上，板子不渲染它） |
| 底部胶囊 CTA | `apps/desktop/src/shell/Shell.tsx:673-678` | 永远 `CalendarEvent` |
| 月视图双击格子 | `packages/features/src/calendar/MonthView.tsx:90-93` → `Shell.tsx:597-601` | 永远 `CalendarEvent`（连捕获条的开关都没有） |
| 周/日/多日空格点击 | `Shell.tsx:610-611`、`:623`、`:635` | 捕获条，默认日程，**可切任务** |
| Ctrl+N | `Shell.tsx:397-409` | 看当前视图：板子/任务列表→任务，日历→日程 |
| 四象限卡内输入框 | `packages/features/src/quadrant/QuadrantScreen.tsx:292-321` | 永远任务，**无日期** |

**场景**：在四象限板上，用户想"加一件明天的事"。

**你撞到什么**：板上那个 `+` 建的是**日程**——一个板子根本不显示的东西（已知问题的镜像，
`Shell.tsx:386-395` 的注释正是在讲这件事）。而卡里的输入框建的是任务，但没地方填日期。
Ctrl+N 建任务，也没日期。**四个入口，四种能力，没有一个能在"板子上"建出"有日期的任务"。**

**修法方向**：合并后这个表坍缩成一行——一个捕获面，一套字段。这也是 §8 的第一条收益。

---

### 4.12 「今天」在跨午夜后不更新（应用是常驻的）

**位置**
- 默认参数只求值一次：`apps/desktop/src/shell/Shell.tsx:91-92`（`today = todayLocal()`），
  全仓**没有任何定时器**更新它（同文件仅在 `:213` 有一个 `watchSystemTheme` 的 effect）
- 提醒侧**会**滚动：`apps/desktop/src/shell/useReminders.ts` 的 `tick()` 每次 `new Date()`；
  文件内注释明确写了"应用现在常驻托盘，可能跑一周"

**场景**：晚上 23:50 打开，第二天 00:10 还在用。

**你撞到什么**：提醒横幅开始播报"明天"的任务（它读的是真时钟），但侧栏「今天」的角标、
板子的日期元信息、`TaskListScreen` 的分组、`MonthView` 的今日高亮，**全部还停在前一天**。
同一个应用，两个"今天"。

**概念后果**：这不是时区/闰秒细节，而是**"今天"这个产品概念有两个实现**：一个由时钟驱动，
一个由挂载时刻冻结。合并概念时应当只留一个（`todayLocal()` + 一个跨午夜的 tick）。

---

## 5. P2 — 残留、死代码、静态谎言

### 5.1 Ctrl+N 已绑定，但帮助页里没有；同文件两段注释互相矛盾

- 绑定：`apps/desktop/src/shell/Shell.tsx:483`（`'mod+n': openCaptureBar`）
- 帮助页白名单：`packages/features/src/shortcuts/ShortcutHelp.tsx:41-70`（无 `mod+n`）
- 测试**钉住**了这个缺席：`packages/features/test/shortcuts.test.ts:108-113`
  （`expect(advertised).not.toContain('mod+n')`，理由写作「No global capture surface」——早已不成立）
- 注释打架：`Shell.tsx:476-482` 说「`mod+n` 这里意味着新建日程，不是新建任务」，
  `Shell.tsx:386-395` 说「打开模式跟随当前视图」。代码（`:405-407`）以后者为准。

**后果**：唯一的全局捕获快捷键不可发现；注释让下一个维护者相信相反的事实。
`docs/UI-AUDIT.md` §4.1 已预告此测试会在修复时变红——它值得变红。

### 5.2 提醒横幅只为任务提供「完成」

- `packages/features/src/reminders/ReminderBanner.tsx:114-123`（`item.kind === 'task'` 才渲染完成按钮）
- 同文件 `:100-102`（同时渲染「任务 / 日程」这个类别标签——**分类可见，动作按分类分叉**）

这是 §6 里最清楚的形态：**提示层已经把两类合并且标了类名，却只在其中一类上给按钮**。
同时它是**唯一的正面先例**（见 §6.1）。合并后这个分支直接删掉，全部条目都可完成/可勾选。

### 5.3 已完成的任务永远留在日历上，并且抬高年视图的热度

- `packages/core/src/application/calendar-service.ts:34-38`（`tasks.list()` 不过滤 status）
- `packages/core/src/domain/calendar.ts:52-71`（`taskToEntry` 保留 `done: true`）
- `packages/features/src/calendar/year-math.ts:104-116`（`heatByDay` 数所有条目）

**场景**：三月的年视图。

**你撞到什么**：热度代表"那天有多少东西"，其中包括早已完成的任务和早已过去的会议。
"忙"与"待办"是同一张图。这不是致命错，但它让"我什么时候最忙"这个唯一有用的判断失真。

### 5.4 `EventEditor` 的注释在陈述一个已经不存在的事实

`packages/features/src/calendar/EventEditor.tsx:165-167`：「`CalendarEntry` carries no listId/notes」。
类型（`types.ts:192-201`）与生产方（`calendar.ts:32-36`）都说它携带。见 §3.2 —— 这段注释
不只是文档债，它是 §3.2 那个 bug 的**成因**。

### 5.5 捕获条拒绝"无清单"的日程，而事件模型和编辑器都允许

- 拒绝：`packages/features/src/calendar/QuickEventComposer.tsx:398-402`（`noListTask`）
- 允许：`packages/adapters/src/sqlite/schema.ts:53`（`list_id` 可空）、
  `packages/features/src/calendar/EventEditor.tsx:458-464`（下拉第一项就是「无清单」）
- 文案还错了：错误 key 叫 `noListTask`，但这条分支对**日程**也生效

同一个产品里，"日程能不能没有清单"有两个答案。

### 5.6 周视图的拖拽改期从未接线

- `packages/features/src/calendar/WeekView.tsx:50`（`onReschedule?`）
- `apps/desktop/src/shell/Shell.tsx:606-614`（**没有传** `onReschedule`）
- 因此 `WeekView.tsx:367` 的 `draggable = Boolean(onReschedule) && !b.entry.allDay` 恒为 `false`

组件的文档头（`WeekView.tsx:83-90`）写着"pointer drag to reschedule"，属性注释（`:47-50`）
描述了这个能力，但没有任何入口能触发它。你问的 `drag.entry.source === b.entry.source`
（`:371`）**只是 ghost 高亮的身份比较**，本身不决定可拖性；真实答案是：**谁都不能拖**，
而如果接线了，任务块和日程块都会被当作可拖——这正是合并后应有的样子。

### 5.7 域层的"象限词汇"是一份没人用的中文常量

`packages/core/src/domain/task.ts:13-18` 的 `QUADRANT_LABEL` 是全仓唯一的硬编码中文，
UI 一律走 i18n（`QuadrantScreen.tsx:42-47`）。同类的还有 `calendar.ts:5-18` 的
`inRange` / `overlaps`，零调用方。这些是"概念曾经长在域层、后来搬到 UI"留下的化石；
合并时应顺手清掉，否则下一个维护者会以为有两个词汇表。

---

## 6. 一等章节：产品在哪些地方强迫用户理解 任务 / 日程

> 用户决策：「我觉得不要让用户去理解 任务 / 日程 的区别。」
> 因此本节不是"缺陷清单"，而是 **待删除清单 + 必须重新回答的问题清单**。
>
> 标签：
> - `[dies with the merge]` —— 合并后自然消失，不需要新规则；
> - `[survives, needs a new rule]` —— 合并后问题还在，但只剩一个答案，必须写下来；
> - `[becomes a real gap]` —— 只有一类拥有的能力，合并后必须对全部条目提供。

### 6.1 唯一的正面先例：提醒层已经合并了

`ReminderScheduler` 的 `ReminderKind = 'task' | 'event'`（`ReminderScheduler.ts:23`），
两类走**同一条** `computeUpcoming`、同一个排序、同一个去重键、同一个横幅。
这是全仓唯一一处"两类同权"的实现，**合并可以直接照抄它的形状**：

- 同一份数据、同一套字段（`ReminderItem`，`:121-140`）；
- 同一个类型标签只用于**展示**，不用于分叉逻辑（除了 §5.2 那个按钮）；
- 一个已知缺口：全天日程没走 anchor 推导（§4.2）——说明"统一的形状"还不够，
  **派生规则也得统一**。

### 6.2 逐面清单

| # | 面 | 用户必须知道什么 | 是否可发现 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | chip 点击分流（`Shell.tsx:429-433`） | 这块 chip 是任务还是日程，否则不知道会弹出哪个编辑器 | **不可发现**：同形、同色、同 Chip 组件 | `[dies with the merge]` |
| 2 | 事件编辑器的只读分支（`EventEditor.tsx:149, 387-391`，i18n `event.taskEntryReadonly`） | —— | 不可达死代码 | `[dies with the merge]` |
| 3 | 捕获条的 任务/日程 开关（`QuickEventComposer.tsx:472-483`） | 必须先选类型，再决定能填哪些字段（§3.1） | 开关可见，**代价不可见** | `[dies with the merge]` |
| 4 | 「新建日程」/「添加」/「新建」措辞（`shell.json` `topBar.newEvent`、`calendar.json` `capture.*`；`TaskListScreen` 无文案） | 同一个动作有两个名字 | 可见，但没人解释差别 | `[dies with the merge]`（统一为一个动词） |
| 5 | 月视图双击 vs 周视图点击（`MonthView.tsx:90-93` vs `Shell.tsx:610`） | 哪个视图能建任务、哪个只能建日程 | 不可发现 | `[dies with the merge]` |
| 6 | chip 外观完全相同（`Chip.tsx`；`MonthView.tsx:134-144`、`WeekView.tsx:310-319`（全天条）/`:389-395`（时间块）、`DayView.tsx:402-411`） | 只能靠点开才知道类型 | **只能靠意外学会** | `[dies with the merge]` |
| 7 | 日历上没有任何勾选框（所有 chip 都不带 `Checkbox`；完成状态只体现为删除线 `styles.css:382-391`） | 想勾完成必须离开日历 | 可发现（没有按钮就是没有） | `[survives, needs a new rule]`：**统一定义**"条目能不能勾、勾了意味着什么"。建议：日历 chip 上提供完成操作，让"完成"成为所有条目的共同动词 |
| 8 | 已完成状态只有任务有（`eventToEntry` 硬编码 `done: false`，`calendar.ts:29`） | 日程永远不会有"已发生/已处理" | 不可发现 | `[becomes a real gap]`：会议也需要一个终态。"已过去的会议"应当有明确语义（自动置为已发生？需手动确认？），而不是永远"待在那里" |
| 9 | 重复只有任务有（`TaskDetailPanel.tsx:493-577`） | 会不能重复，只能在日历上手动建 N 条 | 可发现（日程编辑器里没有这一节） | `[becomes a real gap]`：见 §4.8。同时必须重新回答"重复完成是否派生新行" |
| 10 | 重要性/象限只有任务有（`types.ts:129-131`；`CalendarEvent` 无此字段） | 会议不能标"重要" | 可发现（没有控件），但**后果不可发现**（板子永远看不到会议） | `[becomes a real gap]`：见 §4.5。合并后 `important/urgent` 属于所有条目 |
| 11 | 搜索只有任务（`SearchPanel.tsx:90`、`search.ts:1`） | 得先记得上次建的是哪种 | **不可发现**：搜索失败无提示，只有 UI 复制承认"搜索任务" | `[becomes a real gap]`：见 §4.6 |
| 12 | 拖拽改期没接线（§5.6） | —— | 无 UI 提示 | `[survives, needs a new rule]`：接线后必须决定"时间点是任务、区间是会议"是否都能拖成区间 |
| 13 | 全天条目两种来源、两种提醒行为（§4.2） | 同样画在"全天"条里的两个 chip，一个有提醒一个没有 | **不可发现** | `[becomes a real gap]`：全天条目必须统一锚定规则 |
| 14 | 清单删除的两套承诺（§4.3） | 清单里除了任务还有没有会议 | 不可发现 | `[survives, needs a new rule]`：见 §4.3 |
| 15 | 提醒横幅的分类标签 + 只有任务有「完成」（§5.2） | 看到一个 chip 叫"日程"就不能勾 | 可见 | `[dies with the merge]`（删分支、删类名，或把类名改为真正的子类型而非两套生命周期） |

### 6.3 合并后必须回答的三个问题（不是删除就能解决的）

1. **"完成"对过去发生的事意味着什么？**（#8）
   现状：任务 `status: open|done` + `completedAt`（`types.ts:127, 154`）；日程什么都没有。
   合并后每个条目都需要一个终态，而"会议开完了"与"任务做完了"不是同一件事。
   建议的最小答案：**一个 `done` + 一个 `completedAt`，由用户显式勾选**；不自动置为完成
   （自动置完成会让日历年视图的密度与"已完成"混淆，§5.3）。

2. **重复的粒度是什么？**（#9）
   现状：`Recurrence` 是纯日期规则（`recurrence.ts:1-17`），没有时间、没有时长；
   任务的"完成重复任务"会派生新行（`task-service.ts:94-157`）。
   合并后一个"每周五 17:00-17:30"的条目，重复时**必须**把 `startAt`/`endAt` 一起移动
   （现在只有 `shiftToDate`，`task-service.ts:411-428`，它连 `duePeriod` 都不移动——
   半天桶由 `seedNextOccurrence` 原样复制）。这是真正的建模工作，不是删分支。

3. **"点"与"区间"怎么统一？**（§2）
   现状：已有伪区间（零长度 endAt + 15 分钟下限）。合并后建议 `startAt` 必填、
   `endAt` 可空（空 = 一个时间点，即"今天要做"，日历按点渲染），而不是造两种记录。

---

## 7. 新用户的前五分钟：他必须先学会什么

按真实操作路径走一遍。**每一步都不需要读文档，但每一步都在教一个没说出口的规则。**

| 时刻 | 用户做什么 | 产品实际做了什么 | 他学到的隐藏规则 |
| --- | --- | --- | --- |
| 0:00 | 打开，看到 2×2 板 + 示例数据 | 板子按象限分组，行 meta 显示日期（`QuadrantRow.tsx:76-79`） | "这里有四个格子 = 四类事" |
| 0:30 | 想在「重要且紧急」里加"交报告，明天 15:00" | 卡内输入框**只有标题**（`QuadrantScreen.tsx:292-321`） | **规则 1：这里不能填日期** |
| 0:40 | 点板上那个 `+`（顶栏），以为能加卡里的事 | 弹出**日程编辑器**，且它建的东西不回板子（`TopBar.tsx:66` → `Shell.tsx:539`） | **规则 2：`+` 不一定是加到你看的地方** |
| 1:00 | 放弃，去周视图点明天 15:00 的空格 | 捕获条弹出，默认「日程」 | 以为这就对了 |
| 1:30 | 看到最上面的「任务 / 日程」，觉得"这是待办"，点「任务」 | 日期被丢掉，任务进了板子（§3.1） | **规则 3：切到任务 = 放弃刚点的时间** |
| 2:00 | 回板子上找它，找到了，但没有时间 | 详情面板里可以设时间 | **规则 4：时间是"另一个面板里的第二件事"** |
| 2:30 | 想让它每周五重复 | 只能在任务详情里设；日程没有 | **规则 5：只有一半的东西能重复** |
| 3:00 | 想勾掉上周那个会 | 会议没有勾选框，横幅里"完成"按钮只对任务出现（`ReminderBanner.tsx:114-123`） | **规则 6：会议不算"做完"** |
| 3:30 | 用搜索找"客户电话" | 搜不到（§4.6），输入框写着"搜索任务" | **规则 7：有两种东西，搜索只管一种** |
| 4:00 | 去议程视图想看今天全部安排 | 能看到，但点不动（§4.7） | **规则 8：看得见 ≠ 能处理** |
| 4:30 | 删一个只有会议的清单 | 会议静默脱钩、掉色（§4.3） | **规则 9：清单里有两类成员，规则只保护一类** |
| 5:00 | 什么都不确定，于是退化成"只往板子里打字" | 板子能建任务但不能定时 | **结论：他学会了绕开产品，而不是使用产品** |

**用一句话说清这笔学费**：用户被迫在**没有任何提示**的情况下掌握"两种条目、九条分流规则"，
而产品在四个"新建"入口、五种视图、三个编辑器里给出的**视觉与措辞线索完全一致**——
它们看起来是同一个东西。**这就是用户的抱怨在操作层面的样子**：不是"我看不懂按钮"，
而是"我每次都要猜这次点下去的是哪一半"。

**第一分钟就交的学费**：捕获条把「任务 / 日程」放在**第一个控件**（`QuickEventComposer.tsx:472-483`），
等于把整个模型的选择前置到一个还没有任何信息的时刻。用户此刻既不知道两者的差别，
也不知道选错的代价（时间会被丢掉）。**产品把最需要解释的决策，放在了最不可能理解它的位置。**

---

## 8. 合并之后变好的是什么

不是"少一个 bug"，是**少一整类问题**。以下每一条都可验证：

1. **一个捕获面，一套字段。** §4.11 那张六行的表坍缩成一行；§3.1 的"切类型丢时间"不可能再发生，
   因为不存在"两个类型"。捕获条的开关（`QuickEventComposer.tsx:472-483`）消失，标题输入框成为第一个控件。
2. **一个搜索框搜到所有东西。** §4.6 从"已知限制"变成"不需要知道"。搜索的分组（`SearchPanel.tsx:121-152`）
   已经是按清单分组的，会议只要进入同一份数据就落在同一个分组里。
3. **一个"这周要干什么"的答案。** §4.5 的板子/日历分裂结束：一个条目只有一个日期，
   所以"本周"在任何视图里都指同一批东西。
4. **"今天"只有一个定义。** §3.3（角标 vs 列表）、§4.9（两种逾期）、§4.12（冻结的今天）
   是同一问题的三个症状；合并 + 一个 `todayLocal()` tick 之后，只剩一个口径。
5. **提醒真的对所有东西生效。** §4.2 的全天日程黑洞关闭；§5.2 的"完成按钮只对任务"分支删除。
   这是唯一已经有正确形状的能力（§6.1），合并只是把它推广。
6. **清单删除只有一条规则。** §4.3 的"任务拦下、会议脱钩"变成"条目脱钩或阻止"，不再取决于类型。
7. **导出只有一份数据。** §3.4 的 CSV 缺口不存在了（或者只剩一张表），"完整备份"和"表格视图"
   终于描述同一个集合。
8. **编辑器只有一个。** §4.4 的侧栏/模态分裂结束：点任何一块都进同一个地方。
9. **周视图的拖拽可以真的接上。** §5.6 的 `onReschedule` 不再需要按类型判断"这块能不能拖"；
   §4.8 的"复盘会"可以既重复、又有时长、又能勾完成——**没有任何一半需要被牺牲**。

**净效果**：用户不需要在五分钟内学会九条隐藏规则，只需要学会一件事——**这里有一种"要干的事"，
它有标题、时间、重要性、是否完成、是否重复**。所有视图都是它的不同切面。
这正是「别硬造概念，都是要干的事」的字面实现。

---

## 9. 核实后推翻的怀疑

| 怀疑 | 结论 |
| --- | --- |
| 「四象限和日历视图里完全区分不出来」 | **方向正确，机制不同**。四象限里日程**根本不出现**（`QuadrantScreen.tsx:112-131` 只读 tasks），所以不是"混在一起分不清"，而是"日历里混、板子里没有"。这个区别决定了修法：不是给 chip 加标记，而是让两者进入同一份数据。 |
| 提醒也只覆盖任务 | **不成立**。`ReminderKind = 'task' \| 'event'`（`ReminderScheduler.ts:23`），两类都进 `computeUpcoming`。这是全仓唯一的合并先例（§6.1）。 |
| 日历上任务的完成状态看不出来 | **部分不成立**。`taskToEntry` 传 `done`（`calendar.ts:68`），Chip 渲染删除线（`styles.css:382-391`）。能看出，但**只能在日历上看，不能在日历上改**。 |
| 任务和日程共用一套颜色，所以分不清 | **不成立**。它们确实共用 `colorOfList()`，但任务必有清单、日程可无清单，所以无清单日程反而是**唯一**一个灰色条目（`calendar.ts:73-78`）。问题不在"分不清"，在"清单色挤掉了象限色"（已知 #2）。 |
| `WeekView` 的 `source` 比较说明任务块不可拖 | **不成立**。该比较只用于 ghost 高亮（`WeekView.tsx:369-374`）；真实原因是 `onReschedule` 从未传入（§5.6），**所有条目都不可拖**。 |

---

## 10. 钉住现状的测试与文档债

**钉住当前行为的测试**（修复时会变红，提前知道，别误判为回归）：

| 文件:行 | 锁死了什么 |
| --- | --- |
| `packages/features/test/shortcuts.test.ts:108-113` | 帮助页**不得**包含 `mod+n`，理由写作「No global capture surface」（§5.1） |
| `packages/core/test/services.test.ts:46-55` | 非空清单拒删，且 `force: true` 会连任务一起删（§4.3） |
| `packages/features/test/task-list.test.ts:38-60` | `dueGroupOf` 只看 `dueDate`（§4.9） |
| `packages/features/test/reminder-anchors.test.ts:100-160` | 任务的 day/period 锚点；**没有**任何日程锚点的用例（§4.2 的缺口因此没被测试发现） |
| `packages/features/test/task.test.ts:51-120` | `parseQuickAdd` 的斜杠语法；它对应一个**没有挂载点**的组件（§4.10） |
| `packages/features/test/export-import.test.ts` | CSV 只含任务字段（§3.4） |

**文档债**：

- `packages/features/src/calendar/EventEditor.tsx:165-167` 的注释与 `types.ts:192-201` 相反（§3.2/§5.4）；
- `apps/desktop/src/shell/Shell.tsx:476-482` 与 `:386-395` 对 `mod+n` 的语义各说一套（§5.1）；
- `packages/features/src/task/TaskListScreen.tsx:14-15` 仍说"创建交给 `QuickAdd`"，实际不会挂载（§4.10）；
- `packages/features/src/shortcuts/ShortcutHelp.tsx` 的白名单缺 `mod+n`（§5.1）。

---

## 附录：本轮新增的三条最伤发现（不含已知四条）

1. **§3.1** 捕获条切到「任务」会丢掉你刚点击的那一格时间——正是仓库自己修过的
   "捕获的东西消失了"，以镜像形式复发；
2. **§3.2** 打开任何日程，备注显示为空、清单显示「无清单」，且永远改不回来——
   投影层已经带上这两个字段，编辑器却按旧假设丢弃；
3. **§3.4** 「导出 CSV」静默丢掉全部日程，而文案只承认"不含 id"——同一面板里两种"你的数据"。
