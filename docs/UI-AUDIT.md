# UI 走查报告

> 生成日期：2026-11-26
> 审阅基线：工作区当前状态（未提交改动，见 `git status`）
> 参考框架：`modern-web-guidance`（本地 guides）+ 本仓库 `docs/DESIGN-LANGUAGE.md`
> 目标运行时：Windows / Tauri 2 / WebView2（Chromium 常青）。**不涉及 Safari/iOS 回退判断。**

本文档是「现状 + 待办」，与 `docs/DESIGN-LANGUAGE.md` 同构：任何一处修复完成后，应同步删除对应条目，
让文档始终等于事实，而不是一句谎。

---

## 0. 怎么用这份文档

- **§1** 是结论摘要，20 秒读完。
- **§2** 是全部缺陷，按 P0 → P1 → P2 分级，每条带 `file:line`、触发场景、修法与依据。
- **§3** 是「看起来像问题、核实后不是」的清单——避免下一轮审查重新提出。
- **§4** 是待补的审查面与已知盲区（含 §4.1 测试缺口）。
- **§5** 是执行顺序建议。
- **§6** 是文档债：`docs/DESIGN-LANGUAGE.md` §8 哪些条目已过期。

分面原始报告共 15 份（`01`–`15`），在 `%TEMP%\ui-audit\`，本文件是它们的去重合并。
第二轮（`11`–`15`）全部为只读补充审查，结论已并入 §2.2、§4.1 与 §6。

---

## 1. 摘要

| 项 | 数 |
| --- | --- |
| 已审查界面面 | 10 |
| 第二轮补充面 | 5（i18n / 快捷键 / 令牌矩阵 / 错误链路 / 测试缺口） |
| 逐控件核查项 | ~900 + 155 令牌 × 6 皮肤 × 3270 对比度对 |
| **P0（数据损坏 / 数据不可见 / 应用不可用）** | **9** |
| P1（按根因归并） | 15 簇 |
| P2 | ~200 |
| 核实后推翻的怀疑 | 12 条（见 §3） |

**一句话结论**：交互骨架是对的（原生 `<dialog>` 用对了一半、令牌体系基本成立、
`SegmentedControl` 与 DatePicker 的键盘模型完整、`color-mix` 零违规），但有三类系统性问题：

1. **写入路径缺少 IME 防护**，一个 `TextField` 组件污染了 6 个输入点；
2. **删除语义不统一且不可撤销**，三个入口都是「同位置两段式」，与仓库自己的 §5.4 结论冲突；
3. **静默失败太多**：月视图丢事件不给提示、提醒在睡眠期丢失、「稍后」等于永久关闭、
   `inFlight` 丢写入不报错、加载失败无重试入口、更新面板禁用按钮只用 `title` 解释。

另有三条**用户可见但没人会主动怀疑**的确定性 bug，优先级应当很高：

- **更新功能整体不可用**：版本号被注入成文件路径（P0-9）；
- **英文界面是半成品**：`UpdatePanel` 整块中文、启动屏中文、导出的 CSV 表头中文（§L）；
- **Esc 归属没有统一规则**：按一次 Esc 会关错层、关太多层（§M）。

---

## 2. 缺陷清单

### 2.1 P0 — 数据损坏 / 数据不可见 / 应用不可用

#### P0-1　IME 回车提交半截标题（全局单点）

**位置**：`packages/ui/src/components/TextField.tsx:40-44`

```ts
onKeyDown={(e) => {
  if (e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit(value); }
```

**触发**：中文/日文输入法下，拼音组词时按回车确认候选词 → 组件立刻提交，写入半截标题。

**受影响调用点**：

| 文件:行 | 后果 |
| --- | --- |
| `packages/features/src/task/QuickAdd.tsx:84` | 顶栏快速捕获写入半截标题 |
| `packages/features/src/quadrant/QuadrantScreen.tsx:291` | 四象限建出半截任务 |
| `packages/features/src/lists/ListEditor.tsx:84` | 清单创建/重命名被截断 |
| `packages/features/src/search/SearchPanel.tsx:227` | 组词回车**直接打开第一条结果并关闭面板** |
| `packages/features/src/calendar/QuickEventComposer.tsx:288` | 建出半截日程 |
| `packages/features/src/task/TaskDetailPanel.tsx:407` | 标题改名被截断 |

**依据**：`forms/ime-safe-enter-submit.md`——
*"Single-line `<input>` fields with their own `Enter` handling … receive the same IME-confirming `Enter` keydown as a `<textarea>` does, with `isComposing` set to `true`."*

**修法**：在 `preventDefault()` 之后加 `if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;`。
全仓只有 `packages/features/src/shortcuts/useShortcuts.ts:279` 做对了，可作范本。

**附带缺陷**：`TextField.tsx:49` 把 `{...rest}` 展开在内部 `onKeyDown` **之后**，外部传入的
`onKeyDown` 会静默覆盖组件自身的 Enter/Escape 处理。`TaskDetailPanel.tsx:406-415` 与
`SearchPanel.tsx:270` 正在吃这个行为。应在类型上禁止或显式合并。

---

#### P0-2　任务删除不可撤销，三个入口同形

**位置**：

| 入口 | file:line |
| --- | --- |
| 扁平列表行 | `packages/features/src/task/TaskListRow.tsx:74-97` + `packages/features/src/styles.css:1650-1653` |
| 详情面板 | `packages/features/src/task/TaskDetailPanel.tsx:315-337`, `:637-651` |
| 实际写入 | `apps/desktop/src/shell/Shell.tsx:239-250` → `packages/adapters/src/sqlite/repositories.ts:157-158` |

**触发**：点击删除按钮后，按钮原地变成「确认」/「取消 + 确认删除」，**位置不变、无迟滞**。
连点两下或触屏双击 = 永久删除。

**关键事实**：

- `repositories.ts:158` 是真 `DELETE FROM tasks`，`removeTask` 不入撤销栈；
- 而**清单**删除（`ListSidebar.tsx:342-366`）是入撤销栈的——同一应用两种删除语义；
- `docs/DESIGN-LANGUAGE.md` §5.4 把「内联两段式确认、触发与确认同位置」记为本仓库真实事故，
  但只修了「清空全部数据」，没修任务删除。

**依据**：`docs/DESIGN-LANGUAGE.md` §5.4 五条；`ui-components/dialog.md`
*"DO put `autofocus` on the safe action (such as Cancel or Keep) in a destructive confirmation"*
与 *"DON'T let the confirmation move controls under the pointer"*。

**修法（需先定方向）**：二选一，然后三个入口一起改——

- **A. 可撤销**（推荐）：删除后走现成的 `UndoProvider` toast，6 秒内可撤销。成本最低，且与清单删除一致。
- **B. 独立 modal**：抽 `DataTransferPanel.tsx:729-770` 那套（原生 `<dialog>` + Cancel 聚焦 + 600ms 迟滞）
  为共享组件 `DestructiveConfirm`，三处 + 另外三处内联 alertdialog 一起替换。

---

#### P0-3　月视图静默丢事件

**位置**：`packages/features/src/calendar/MonthView.tsx:134,145` + `packages/features/src/styles.css:592,604`

**两处独立缺陷叠加**：

1. `MonthView.tsx:134` 渲染 `entries.slice(0, 4)`、`:145` 阈值 `entries.length > 4`，
   但实测每格只放得下 2 个 chip（1440×900 / 1366×768 均是）。**容量算错**。
2. `.mv__more` 上写了**两个** `position` 声明：`styles.css:592` 的 `sticky` 被 `:604` 的 `relative` 覆盖。
   `+N` 因此退回普通流内元素，落进 `overflow: hidden` 的裁切区之外。

**后果**：一天有 5+ 事件时，用户只看到 2 个 chip，**没有任何「还有更多」的提示**。

**附加**：`+N` 是裸 `<span>`（`MonthView.tsx:145`）——不可聚焦、不可点，
点它会冒泡触发整格的 250ms 跳日视图，语义完全不同。

**修法**：

- 删掉 `styles.css:604` 重复的 `position: relative`（`z-index` 生效不需要 `relative`，`sticky` 本身就是定位元素）；
- 容量改为按可用高度计算，而非写死 4；
- `+N` 改 `<button>` + `stopPropagation`，点击展开当日全部事件。

---

#### P0-4　「重置全部数据」成功后应用被自己的模态框锁死

**状态：✅ 已修复**（`resetOutcome(ok)` 纯函数驱动两条分支，17 例测试锁死边界）

**位置**：`packages/features/src/data/DataTransferPanel.tsx:409-427`

**触发**：数据管理面板 → 重置全部数据 → 确认。成功后：

```ts
await onReset();
undoStack?.clear();
setStatus(t('data.status.resetDone'));
resetImport();
onClose();                    // ← 只关了外层 <dialog>
```

**缺 `setConfirmReset(false)`**（失败分支 `:423` 有）。内层确认 `<dialog>` 仍是 `showModal()`
状态，页面被 `inert`。**数据删了，界面点不动。**

**修法**：成功分支补一行 `setConfirmReset(false);`。

**测试现状**：`packages/features/test/data-transfer-reset.test.ts` 只测了文案函数
（`resetCopy` / `resetLossLine`），没有覆盖这条路径。

---

#### P0-5　搜索面板 Tab 陷阱方向反了，焦点逃到背景

**状态：✅ 已修复**（改原生 `<dialog>` + `showModal()`，`SearchPanel` 常驻挂载）；
Esc 归属另由 `escapeStack` 承担，见 §2.2-M 的实施修正。

**位置**：`packages/features/src/search/SearchPanel.tsx:170-186`

```ts
const focusables = panel.querySelectorAll<HTMLElement>(
  'input, button, [href], [tabindex]:not([tabindex="-1"])',
);
const last = focusables[focusables.length - 1];
```

**缺陷**：`SearchPanel.tsx:333` 的搜索结果复选框传了 `tabIndex={-1}`，但它仍是 `<input>`，
被选择器的 `input` 分支命中 → 成为 `last`。于是：

- **正向 Tab**：`activeElement === first`（输入框），但 `=== last` 为假 → 不拦截 → **焦点离开面板**；
- **Shift+Tab**：被拦截，把焦点送去那个 `-1` 的复选框；
- 面板是手写 modal（`<div class="search-overlay">`），**背景没有 `inert`**，
  焦点落在背景控件上，用户既看不见也不知道自己在哪。

**修法（推荐）**：整体改成原生 `<dialog>` + `showModal()`。仓库已有 5 处同款正确实现
（`SettingsDialog`、`ShortcutHelp`、`EventEditor`、`DataTransferPanel`、`DataTransferPanel:729`），
可净删约 40 行手写 Tab 陷阱 / Esc / 焦点恢复代码，同时修掉遮罩过淡与滚动穿透。

**依据**：`ui-components/dialog.md` Rule 1；`accessibility/accessibility.md` §12
*"Use `inert` … Apply `role="dialog"` … Move focus to the overlay"*。

---

#### P0-6　「结束重复」按钮：长得像撤销，点了永久删数据

**位置**：`packages/features/src/data/useTasks.ts:283-300` + `packages/features/src/undo/UndoProvider.tsx:287-310`

**触发**：完成一个重复任务。toast 同时渲染两个按钮：

- 左：`action.label` = 「结束重复」→ `tasks.remove(spawned.id)` + `setRecurrence(completedId, null)`；
- 右：`disabled={!flags.canUndo}` 的「撤销」。

两个都是 `variant="ghost" size="sm"`，**外观完全相同**。`action.run` **不入撤销栈**。
点左边 = 永久删除下一期 + 清空重复规则；点右边 = 撤销刚才的完成。一步之差。

**修法（三选一）**：

- 把「结束重复」移出 toast（放到详情面板的重复设置里）；
- 或改成可撤销操作，进 `UndoProvider` 栈；
- 或至少换 `variant="danger"` + 迟滞。

**依据**：`accessibility/accessibility.md` §3
*"Disambiguate controls that look visually identical but which perform different actions"*。

---

#### P0-7　更新面板是手写 modal，背景可操作

**状态：✅ 已修复**（改原生 `<dialog>` + `showModal()`；24 处硬编码中文迁到 `update.*`
共 28 个 key，中英对称；禁用原因改为可见文字 + `aria-describedby` 取代 `title`；
`check()` 补 15s 超时，`CheckOptions.timeout` 已核实存在于 `plugin-updater@2.14.1`）

**位置**：`apps/desktop/src/shell/UpdatePanel.tsx:132-144` + `:105-121`

```tsx
<div className="up" role="dialog" aria-modal="true" aria-label="检查更新">
```

无 `inert`、无焦点陷阱、不在 top layer。`aria-modal` **只影响读屏，不阻止 Tab**。

**附带**（同一文件，经 i18n 面独立复核，约 **24 处**硬编码中文）：

- `UpdatePanel.tsx:24-27,67,137,147,149,154,161,169,176-197,210-251` ——
  英文界面下中英混排。**它是全仓唯一没有调用 `useTranslation` 的用户界面**；
- 禁用按钮用 `title` 属性解释原因（`:208-214`）——`title` 不可键盘访问、读屏不朗读，
  且 `disabled` 按钮不可聚焦 → 用户永远不知道为什么不让他点；
- `STATUS_COPY`（`:22-28`）是中文常量表，没有走 i18n。

**修法**：改原生 `<dialog>` + `showModal()`（照抄 `SettingsDialog.tsx:122-131` 的 imperative 驱动），
删掉手写 Esc / 焦点恢复；文案迁到 `shell:update.*`；禁用原因改为可见文字 + `aria-describedby`。

**依据**：`ui-components/dialog.md` Rule 1；`accessibility/accessibility.md` §12 Custom overlays；
`accessibility/accessibility.md` §3 *"Don't use `title` as a naming mechanism"*。

---

#### P0-8　日历网格 `touch-action: none` 关掉了触摸滚动

**位置**：`packages/features/src/calendar/calendar.css:1100-1104`，
挂在 `WeekView.tsx:352`、`DayView.tsx:446`、`MultiDayView.tsx:287`

```css
.cal-range-col {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
```

**触发**：触摸笔记本 / 触屏上，在时间网格内滑动想滚动 → 手势被吞，且一按下即进入拖选 →
弹出快捷新建面板。**用户滚不动网格。**

**修法**：按 pointer 类型收窄。`@media (any-pointer: coarse)` 下把拖选改为两段式
（点起点 → 点终点），或只在左侧小时刻度栏允许拖选，列本身恢复 `touch-action: pan-y`。

**依据**：`accessibility/accessibility.md` §5
*"Don't use `touch-action: none;` for custom gestures … Scope to the axis you actually need - `pan-y` for horizontal swipes"*。

---

#### P0-9　版本号被注入了文件路径，整条更新链路永久失效

**状态：✅ 已修复**（`version.ts` 的 `resolveAppVersion()` 跟随间接引用；
`vite build` 实测产物中 `"../package.json"` 出现 0 次、`"0.1.3"` 存在；5 例 `node:test` 覆盖
字面版/引用版/文件缺失/非 semver/既非 semver 也非引用 五种输入，**全部抛错而非静默**）

**位置**：`apps/desktop/vite.config.ts:14-25` + `apps/desktop/src-tauri/tauri.conf.json:5`

```jsonc
// tauri.conf.json
"version": "../package.json",   // ← Tauri CLI 的间接引用语法
```

```ts
// vite.config.ts
const tauriConfig = JSON.parse(readFileSync('.../tauri.conf.json', 'utf8'));
define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(tauriConfig.version) }
```

Vite 把这个字段当**字面量**注入，没有解析 Tauri 的间接引用语义。
**构建产物里可以直接看到证据**：`apps/desktop/dist/assets/index-*.js` 含 `"../package.json"`。

**后果链**（已用 node 逐步验证）：

1. `Shell.tsx:66` 的 `APP_VERSION` = `"../package.json"`；
2. 关于面板（`Shell.tsx:690`）把这个路径当版本号显示给用户；
3. `evaluateUpdate` → `isUpdateAvailable("../package.json", latest)` →
   `parseVersion` 对 `{0,...}` 形式以外的输入返回 `null` →
   `compareVersions` 返回 `null` → 状态 `invalid-version`；
4. 更新面板因此**永远**显示「无法比较版本：清单里的版本号格式不正确」，
   把责任推给"清单坏了"，实际是自己的版本号坏了。

**修法**：`vite.config.ts` 读到 `../package.json` 这类值时，跟随引用去解析真实版本号。
（`scripts/version.mjs` 已有版本管理逻辑，可复用其解析。）
这是纯确定性 bug，不需要实机验证。

---

### 2.2 P1 — 按根因归并的 16 簇

#### A. 原生 `<dialog>` 缺全局滚动隔离

**状态：部分修复** —— `UpdatePanel` 的 `.up-dialog:modal` / `::backdrop` 已补；
其余 5 处（`cal-dialog`、`dt-panel`、`dt-reset-dialog`、`set-dialog`、`sc-help`）仍缺。

6 处 `<dialog>`（`cal-dialog`、`dt-panel`、`dt-reset-dialog`、`set-dialog`、`sc-help`、更新面板改后）
全无：

```css
dialog:modal { overscroll-behavior: contain; }
dialog::backdrop { overflow: hidden; overscroll-behavior: contain; }
```

当前 `body` 不滚动（`app.css:36` `height: 100vh` + `overflow: hidden`），故**此刻无可观察后果**，
但属定时炸弹——一旦将来引入可滚动的主区域即暴露。

**依据**：`ui-behaviors/prevent-page-scroll-under-modal-dialog.md`（标为 MANDATORY）。

#### B. 破坏性确认只剩「清空全部」是对的

**状态：部分修复** —— 已抽出共享组件 `DestructiveConfirm.tsx`，「重置全部」与「替换导入」已改用；
`ListSidebar` 删除清单、`EventEditor` 的删除/丢弃仍在用内联 alertdialog。

| 位置 | 现状 |
| --- | --- |
| `ListSidebar.tsx:642-669` 删除清单 | 内联 `role="alertdialog"`，无焦点转移、无迟滞 |
| `EventEditor.tsx:500-524` 删除/丢弃日程 | 内联 `role="alertdialog"`，且叠在已打开的 dialog 内 |
| `DataTransferPanel.tsx:612-653` 替换导入 | 内联 alertdialog，会 `undoStack.clear()` |
| `DataTransferPanel.tsx:729-770` 重置全部 | **唯一正确范式**：独立 `<dialog>` + Cancel 聚焦 + 600ms 迟滞 |

→ 把最后一个抽成共享组件，替换前三个。（与 P0-2 的 B 方案同一次改动。）

#### C. 表单字段的可访问名丢掉了值

`DatePicker.tsx:189-196`、`TimePicker.tsx:136-143` 的触发器用 `aria-label={label}`，
**覆盖了可见的日期/时间文本**。所以：

- `TaskDetailPanel.tsx:441,468,551`
- `EventEditor.tsx:405-431`

读屏只听到「开始日期」「开始时间」，**听不到 2026-11-26 09:00**。
违反 2.5.3 Label in Name（可见文本必须包含在可访问名中）。

**修法**：`aria-label={`${label} ${triggerText}`}`，或改 `aria-labelledby` 引用一个含两者的隐藏节点。

#### D. 菜单模型只挂 role 不实现键盘

`ListSidebar.tsx:551` 的 `role="menu"` 缺：焦点入项、↑↓、Home/End、Esc 还焦点、Tab 关闭。
现有实现只有外点关闭（`:172-188`）与 Esc 关闭，**Esc 后焦点不回触发器**。

`ThemeToggle.tsx:62-109` 承诺 `aria-haspopup="dialog"`，但面板无关闭按钮、无 `aria-label`、
Tab 可一路走出面板且面板不关。

**依据**：`ui-components/menu.md` *"Escape in a top-level menu. Closes it and restores focus to its trigger."*

#### E. 浮层体系整体该迁原生 `popover`

`packages/ui/src/components/Popover.tsx` 手写了：`fixed` 定位 + 手算翻转/钳制 + 自写 Esc +
自写外点关闭 + 手写 Tab 陷阱 + `role="dialog"`（`:94`，`useId()` 生成了 id 却没挂到任何
`aria-labelledby`/`aria-labelledby` 上 → 读屏只播「对话框」）。

**具体缺陷**：

- `:36-41` Esc 只 `stopPropagation()` 不 `preventDefault()` → UA 仍给外层 `<dialog>` 发 `cancel`。
  **实际后果**：日程编辑器里按 Esc 想关日期浮层，却弹出「放弃未保存的修改？」确认框；
- 面板 `max-block-size: 70vh` + `overflow: auto`，表头跟着一起滚；
- 被祖先 `overflow: hidden` 裁切的风险靠 fixed 定位绕开，但位置全靠手算。

**修法**：迁 `<div popover>` + CSS anchor positioning（`ui-components/menu.md` 有完整范式），
净删约 40 行手写逻辑，同时获得 top-layer、light-dismiss（带 press-release 匹配）、
分层 Esc 与焦点归还。

#### F. 拖拽/拖选是纯指针能力，键盘无等价路径

| 能力 | 位置 | 现状 |
| --- | --- | --- |
| 拖选时间范围 | `WeekView.tsx:352`、`DayView.tsx:446`、`MultiDayView.tsx:287` | 列不可聚焦，无键盘路径 |
| 拖到别的象限 | `QuadrantRow.tsx:128-145` 手柄 **10×22px** | 有方向键，但提示只写在 `title` |
| 拖任务到清单 | `ListSidebar.tsx:467-483` | 无键盘路径（详情面板有 `<select>` 可作替代，但需先打开） |
| 拖动改期 | `WeekView.tsx:50,101,165,205,367` | **`onReschedule` 全仓从未传入 → 死代码** |

`MonthView.tsx:127-131` 的单元格是 `<div onClick>`，键盘用户完全无法进入某天；
`MultiWeekView.tsx:171-178` 已有正确写法（`<button>`）可照抄。

**依据**：`accessibility/accessibility.md` §5 Target sizes（24×24 下限）；
`ui-behaviors/drag.md` *"Make the handle focusable for keyboard movement and give it an accessible name
that mentions the arrow-key interaction"*。

#### G. 对比度硬指标不达标

第一轮抽样发现 7 条；第二轮做了穷举核算（#13）：**1 926 个文字对 / 1 344 个非文字对 / 6 组皮肤×主题**，
全部用脚本算，不是估算。下面第一张表是第一轮的 7 条，第二张是穷举新增的。

**已知 7 条**：

| 位置 | 实测 | 要求 | 备注 |
| --- | --- | --- | --- |
| `.mv__cell--out .mv__date` `styles.css:497-500` | **1.46:1** | 4.5 | 非本月日期 |
| 卡片滚动条 `tokens.css:281` | **1.41:1** | 3.0 | 象限卡唯一滚动容器 |
| 浮岛 CTA `tokens.css:278` + `styles.css:614` | **3.26:1**（hover **2.51**） | 4.5 | 注释声称 4.58，实测不符 |
| Badge 四象限名 `Badge.tsx:10` + `styles.css:404` | 2.20–3.68:1 | 4.5 | `--badge-ink` 从不被设 |
| `.flat-group__count` `task-list.css:71-82` | **4.46:1** | 4.5 | 12px，无大字豁免 |
| `.tl-empty` `styles.css:638-645` | **4.27:1** | 4.5 | 承载空/加载/失败三态 |
| 年视图热力相邻档 `calendar.css:1968-1979` | **1.10–1.18:1** | 3.0 | 且是唯一位图编码 |

**穷举新增**（均为「原始色相当文字」，`-ink` 兄弟就在旁边却没人用）：

| 位置 | 问题 | 实测 |
| --- | --- | --- |
| `apps/desktop/src/shell/update-panel.css:158` | `.up__error` 用 `--tl-danger` 当文字 | **3.19**（`-ink` 5.62） |
| `apps/desktop/src/shell/update-panel.css:171` | `.up__ok` 用 `--tl-success` 当文字 | **2.54**（`-ink` 5.48） |
| `apps/desktop/src/shell/shell.css:44` | `.sh-error__icon` 用 `--tl-danger` 当图标墨 | **2.88** |
| `apps/desktop/src/shell/shell.css:123` | `.sh-error__btn--primary` 用 `--tl-accent`（应 `--tl-accent-strong`） | **3.68**（strong 5.17） |
| `packages/ui/src/styles.css:633` | `.tl-pill__caption` 的 tertiary 墨压在深色浮岛底上 | **1.99**（应 `--tl-pill-text-muted` 5.61） |
| `packages/features/src/undo/undo.css:36` | 撤销按钮 hover 的 `accent-ink` 落在 `accent-tint` 上（editorial/dark） | 4.28 |
| `packages/features/src/data/data-transfer.css:503` | `.dt-btn--danger` 在 editorial/dark 落在 `dt-drop` 灰底 | 4.19 |

**根因令牌**：`--tl-text-tertiary` 在 30 个 ink×表面格里 **16 格破线**（最低 4.01），
是 17 个组件失败点的共同来源。它需要一个明确的语义边界（只能落在 surface/subtle/bg），
或者把值调到能盖住 hover/sunken 底。

**Badge 修法现成**：`Badge.tsx:10` 只设 `--badge-color`，`styles.css:404` 的
`color: var(--badge-ink, var(--badge-color))` 回落分支永远生效。传入已有的
`--tl-quadrant-qN-ink`（5.48–5.92）即可，无需改 CSS。

**依据**：`visual-design/color.md`；`accessibility/accessibility.md` §9。

#### H. 焦点在操作后丢失

| 场景 | 位置 |
| --- | --- |
| 标题内联编辑提交后 → `<body>` | `TaskDetailPanel.tsx:194-205, 406-415` |
| 删除任务后 → `<body>` | `Shell.tsx:239-250` |
| toast 自动消失/被新 toast 覆盖时焦点在按钮上 → `<body>` | `UndoProvider.tsx:251-262` |
| 切换任务时焦点被拽回上一条的行 | `TaskDetailPanel.tsx:348-355` |
| 快捷键撤销后 → `<body>` | `UndoProvider.tsx:251-262` |

**依据**：`accessibility/accessibility.md` §5
*"Manage focus correctly to and from updated content … (when dismissed) returns to the element that
originally triggered"*。

#### I. 状态可恢复性

- `packages/ui/src/components/EmptyState.tsx` **没有 action 插槽**（只有 `message/hint/icon/compact`）。
  四象限加载失败（`QuadrantScreen.tsx:225-227` → `lists.json:65` "请稍后重试"）只有静态文案，无重试控件。
- 扁平任务列表页**没有新建任务入口**：`TaskListScreen.tsx:142` 的 QuickAdd 受 `onCreate` 门控，
  而 `Shell.tsx:531-543` 没传；顶栏 `+` 是「新建日程」（`TopBar.tsx:66`）。用户要绕到四象限卡片里加任务。
- 扁平列表页不透传 `loading`/`error`（`TaskListScreen.tsx:144-147`）：
  加载首帧播报「没有任务」，查询失败后永久显示空态。

#### J. 静默丢弃用户操作

`packages/features/src/task/TaskDetailPanel.tsx:177-178`

```ts
const run = (fn, message) => {
  if (inFlight.current) return;   // ← 静默丢弃
```

7 个调用点共享（`:204/208/217/247/255/600/624`）。必现组合：改备注后立刻改象限、
改间隔后立刻改「直到」。用户看到自己的操作没生效，**没有任何提示**。

**修法**：排队（写入串行化）或给可见反馈。

#### K. 系统性缺口：`forced-colors` 规则数 = 0

全仓（排除 `dist`/`node_modules`）零条 `@media (forced-colors: active)`。
Windows 高对比度模式下所有自绘控件失去可见性：复选框勾、chip 色块、热力阶梯、焦点环。

**依据**：`visual-design/adapt-scrollbar-to-contrast-preferences.md`；
`accessibility/accessibility.md` §5（`forced-colors` 下的 `outline` 回退）。

#### L. i18n 覆盖不完整（#11 结论）

键集与占位符在 8 个 namespace × 2 语言间**完全对称**，复数后缀正确，`Intl` 调用点全部传入了
当前 locale（硬编码 `'zh-CN'`/`'en'` 为 0 处）。问题集中在「漏进英文 UI 的中文」与一处病句：

| 级别 | 位置 | 现象 |
| --- | --- | --- |
| P0 | `UpdatePanel.tsx`（见 P0-7） | 全仓唯一未接 i18n 的用户界面 |
| P1 | `packages/ui/src/i18n/locales/en/misc.json:30` | 英文渲染成 **`(1 completed completed)`** —— `discardWithDone` 模板里 `({{done}} completed)` 与 `done_other` 的值 `"{{count}} completed"` 撞了 |
| P1 | `packages/features/src/data/useTasks.ts:311` | 完成/取消完成失败的 toast 是中文模板字面量 |
| P1 | `apps/desktop/src/App.tsx:190,211,214` | 启动屏 `正在加载` / `启动失败` / `重试` 全中文 |
| P1 | `packages/features/src/data/export-import.ts:170-177,211-213` | **英文界面导出中文表头的 CSV** |
| P1 | `packages/core/src/application/{list,task}-service.ts` | 领域错误中文经 `err.message` 直出到 7 处 UI；应按 `error.name` 映射到 `errors:` |
| P1 | `apps/desktop/src-tauri/src/lib.rs:88,96` | 托盘菜单启动期恒为英文（前端在 `initI18n()` 后才同步，React 挂载前的那段窗口期是英文） |

**已合规、不必改**（复核确认）：`i18next.d.ts` 覆盖全部 8 个 namespace，`t('bogus')` 编译报错；
narrow 星期标签（`M T W T F S S`）只出现在 `aria-hidden` 的装饰表头，读屏走完整日期；
`h1.top-bar__title` 有 `title` 兜底且英文最长 19ch 不截断；`.tl-btn`/`EmptyState` 无固定宽度。

#### M. 全局快捷键：Esc 归属没有统一规则（#12 结论）

快捷键模块本身**没有 P0**，守卫做得比一般水平好（`useShortcuts.ts:279` 的
`defaultPrevented`/`isComposing`/`repeat` 三件套、精确修饰符双向比较、Windows 上 `mod` 只展开 Ctrl、
无原生全局快捷键冲突）。问题出在**各浮层各自判断该不该让位**：

| 级别 | 位置 | 现象 |
| --- | --- | --- |
| P1 | `Shell.tsx:445` → `:337-340` | `g q` 走 `onSelectView('quadrant')`，**不清 `filter`**；日期筛选下 `flatView` 仍为真，`QuadrantScreen` 被挡（`:227`），结果打开的是任务清单。侧栏四象限图标走 `openQuadrants`（`:352-356`）会清 filter——两条路径不一致 |
| P1 | `TaskDetailPanel.tsx:641` vs `SearchPanel` | 详情面板在 `Shell.tsx` 中**先挂载**，document 监听先注册先执行并 `stopPropagation()`。详情 + 搜索同开时按 Esc，**关掉的是下面那层详情**，搜索留着 |
| P1 | `QuickEventComposer.tsx:167-177` | capture 阶段 Esc 无条件 `onClose()`；日期网格展开时按 Esc 会**一次关到底**，已输入的标题一并丢失 |
| P1 | `TextField.tsx:45-47` + `TaskDetailPanel.tsx:614-626` | 输入框里的 Esc 只 blur、不阻止冒泡。标题编辑有 `if (editingTitle) return` 守卫（`:361`），**备注 `<textarea>` 没有**，且 `onBlur` 会顺带保存 → 按 Esc 想退出输入，结果面板被关 |
| P1 | `useShortcuts.ts:345-349` | 序列第一键 `g` 直接 `preventDefault()` 并静默启动 1 秒计时器，**屏幕毫无变化**；超时也无提示，用户无法区分「没生效」和「在等第二个键」 |

**共同根因**：各 overlay 各自为政地判断「该不该让位」。应引入栈式 Esc 归属（最上层拥有 Esc），
并让下层以 `isEditableTarget(document.activeElement)` 作为让位条件——一次重构可同时消掉这 5 条。

> **实施修正（2026-11-26，已落地验证）**：本报告此前推断「把 `SearchPanel` 改成原生
> `<dialog>` 后，Esc 冲突会自动消失」。**这条不成立**——UA 在 Esc 时只会把 `cancel` 交给最上层
> dialog，**不会**阻止其他 document 级 Esc 监听器（即 `TaskDetailPanel` 那个）同时触发。
> 所以栈式归属是必需项，不是可选项。
> 已落地：`useShortcuts.ts` 导出 `createEscapeStack()` 与共享实例 `escapeStack`，
> `SearchPanel` 是第一个消费者（capture 阶段 + `isTopmost()` + target 在 dialog 子树内 才拦截）。
> 其余 4 个消费者（`TaskDetailPanel`、`QuickEventComposer`、`ListSidebar`、`Popover`）待接，
> 改法见 `%TEMP%\ui-fix\04-DEFERRED.md`。
> **架构前置**：`Popover` 接栈需先把 `createEscapeStack` 移到 `packages/ui`
> （`packages/ui` 不能反向依赖 `packages/features`），再从 `useShortcuts` 重导出以保证共用同一实例。

#### N. 测试能力缺口（#15）

见 §4.1。要点：**CI 对 8 个 P0 的实际拦截率 = 0**，因为环境测不了 DOM；
且 `"lint": "tsc --noEmit"` 意味着全仓没有真正的 linter。

#### O. 提醒链路：睡眠丢提醒、「稍后」等于永久关闭（#14 结论）

| 级别 | 位置 | 现象 |
| --- | --- | --- |
| P0 | `useReminders.ts:8,112-119` + `ReminderScheduler.ts:232` | **睡眠/唤醒无补偿**。全仓无 `visibilitychange`、无 OS 级 `Schedule` 排程；醒来后那一次 tick 只看 `[now, now+10min]`，睡眠期间到期并出窗的精确提醒**静默丢失**。（跨时区白天场景不漏不重，因为 `minutesUntil` 基于 `Date.parse` 绝对毫秒） |
| P0 | `Shell.tsx:518-526` + `useTasks.ts:227-232` | 「完成」与「稍后」都是**先消失再说**：任务已被删时 `toggleDone` 静默 `return` 而横幅仍消失；写失败回滚任务但横幅不回来；`onSnooze` 丢弃 `until` 并 `dismissOne` → **「稍后」实际是永久关闭** |
| P1 | `ReminderScheduler.ts:291` | `fired` 纯内存，重启后当天日/半天任务**重申一次** |
| P1 | `ReminderScheduler.ts:341-349` | 200 条 FIFO 淘汰可能让长会话提醒重复 |
| P1 | `useReminders.ts:160` | 关闭整条横幅后同批提醒永久消失，无说明、无历史入口 |
| P1 | `useReminders.ts:149` | 事件提醒整条链路**完全静默失败**（无日志之外任何反馈） |

**三场景明确结论**：

| 场景 | 会漏？ | 会重复？ |
| --- | --- | --- |
| 睡眠 / 唤醒 | **会，且静默** | 否 |
| 跨时区 / 夏令时（白天） | 否 | 否 |
| 跨时区（运行中改系统时区） | 日/半天任务的 09:00 锚点会落到错误时刻 | — |
| 重启 | 关闭期间的**精确时间**提醒不补发（设计如此，但无告知） | **日/半天任务会重复一次** |

#### P. 错误处理与可观测性（#14 结论）

| 级别 | 位置 | 现象 |
| --- | --- | --- |
| P1 | `Shell.tsx:98-112` + `ErrorBoundary.tsx:93-96` | 边界只包 `ShellBody`，**一个视图抛错替换整个 shell**；重试对确定性错误是死循环 |
| P1 | `ErrorBoundary.tsx:21-23` | i18n 未就绪时 `getFixedT` 返回 `""`（已实证），错误卡文字**全空**——恰好在最该兜底的时刻失效 |
| P1 | `Shell.tsx:120-128` | 全局异步 handler 把 `error.message`（如 `no such table`）原样弹给用户，且不 `preventDefault` |
| P1 | `tauri-notifier.ts:41-55` | 权限一旦被拒整会话不再请求，无 UI 提示（banner 兜底成立 ✅） |
| P1 | `tauri-sql-driver.ts:24-35` | `databasePromise = null` 的重置是死代码，唯一恢复是整页 reload；`close()` 无调用者 |
| P1 | `useAsync.ts:36` | 失败时把 `data` 置 null → **一次刷新失败擦掉已渲染的整月/整年内容** |
| P1 | `tauri-update-checker.ts:102` | `updater.check()` 未传 `timeout` → 网络半死时永远停在「正在检查…」 |
| P1 | 全仓 24 处 `console.*` | 零持久化、零上报。`UndoProvider.tsx:195,213,260`、`services.tsx:78` 均为完全静默失败 |
| P1 | `lib.rs:139-146` + `Cargo.toml:20-21` | 注释称「tray 让提醒调度器活着」**不成立**：wry 的 `backgroundThrottling` 只在 wkwebview 分支实现，Windows 是空操作 |

**已确认做得好**：`ErrorBoundary` 类实现完整、`describeError` 永不抛、`role="alert"` + `<details>` +
双出口；`useGlobalErrorHandler` 注册/清理正确；调度器纯函数化、坏行隔离、20+ 单测；
**"omitted means banner-only" 契约确实成立**（`Shell.tsx:515-529`，横幅独立于 notifier）；
版本比较语义（前导 v、预发布、build metadata、`invalid → null` 不猜）全部正确；
更新链路无后台轮询、HTTPS 强制、签名验证分层正确。

---

### 2.3 P2 摘要

约 200 条，分布在 15 份分面报告中。最常出现的几类：

- **字号/尺寸/时长字面量**：绕过 `--tl-*` 阶梯（`ThemeToggle.tsx:28-32` 的 9 个色值、
  `ListEditor.tsx:9-18` 的 8 个色值与 token 重复但值不同；穷举统计：颜色 21、时长 6、
  尺寸 604、圆角 6）；
- **死令牌 21 个**：含 `--tl-success-ink`、`--tl-quadrant-qN-tint`、`--tl-space-compact`；
- **`aria-controls` 悬空 IDREF**：指向条件渲染不存在的节点（`SettingsDialog`、`QuadrantScreen`）；
- **`document.title` 全仓零引用**：切视图/切语言标题永远停在 "Kairos"，违反 SPA 标题更新（2.4.2）；
- **视图切换三态不一致**：错误在多周/年是 `role="status"` 而非 `alert`，空态措辞三套；
- **重复实现**：`.view-pill*` 是 `.tl-pill*` 的副本（§8 第 8 条），已无 TSX 引用，只剩死 CSS；
- **10 处物理方向属性**：`features/styles.css:660/765` 等仍用 `border-left` 而非 `border-inline-start`。

完整列表见分面报告。

---

## 3. 核实后推翻的怀疑（避免重复提出）

审查过程中有 12 条「看起来像问题」的判断，经核对代码后**不成立**：

| 怀疑 | 结论 |
| --- | --- |
| 模态标题应为 `<h1>`，现在是 `<h2>` | **不成立**。`h2→h3→h4` 层级合法，指南是建议不是要求。降为 P2 一致性建议。 |
| `SegmentedControl` 五选一用 `aria-pressed` | **不成立**。`SegmentedControl.tsx:55-70` 确为 `role="radiogroup"` + `role="radio"` + `aria-checked` + 方向键。 |
| 日期浮层打开时焦点落在「上月」按钮 | **不成立**。`DatePicker.tsx:114-117` 的聚焦 effect 随后把焦点移到当前日。 |
| 选调色板后焦点被拽走 | **不成立**。`onCloseRef` 已修好，切换不再重建 effect。 |
| `shouldActivateRow()` 判据与实际 DOM 不一致 | **不成立**。行内只有 input + 两个 button，无链接/kbd/拖拽把手/覆盖层，判据一致。 |
| 行是嵌套 button | **不成立**。行是 `<div>`，内部 button 合法。 |
| Space 在行上会滚页 | **不成立**。 |
| 月视图应加 `role="grid"` | **不成立**。没有键盘模型就不应标 grid，现状（`role="group"` + 注释说明）是正确判断。 |
| 多周视图切 N 时 cursor 漂移 | **不成立**。`rangeStart` 恒为 `startOfWeek(cursor)`，`weeksShown` 与翻页步长同源。 |
| 从资源管理器拖文件进窗口会导致 WebView 导航 | **不成立**（风险落空）。`tauri.conf.json:24` 已设 `dragDropEnabled: false`。 |
| `base-select` 在 WebView2 失效 | **不成立**。常青 Chromium 支持，且有降级。 |
| `aria-expanded` 与 listbox 空结果分支不一致 | **不成立**。一致。 |

**明确判定为高质量的既有实现**（改动时不要破坏）：

- 三视图 chip 完全合规，只消费 `--tl-block-*`，深浅两套下 12.1–15.1:1；
- 年视图热力给的是**原始条目数**而非「第 2 档」，无障碍替代优于一般水平；
- `prefers-reduced-motion` 保留信号（`.qz-card--flash` 改为静态保持而非淡出）；
- `<html lang>` 随语言切换更新（`i18n/types.ts:78`）；
- `en` / `zh-CN` 五组 catalog 键集一致；
- 四象限卡等分几何正确（`minmax(0,1fr)` + `min-height: 0` + 单一滚动容器）；
- 四象限方向键映射与阅读序一致，移动后焦点跟到新卡；
- 三视图切换的 cursor 连续性全部正确。

---

## 4. 待补的审查面（本轮已完成 / 进行中）

### 已完成（10 面）
1. 四象限看板　2. 扁平任务列表　3. 任务详情侧栏　4. 日历时间网格　5. 月/多周/年视图
6. 浮层与选择器　7. 设置/快捷键/更新　8. 数据面板+日程编辑器　9. 外壳导航+清单侧栏
10. 搜索+反馈+原子/令牌层

### 第二轮 — 补充审查面（全部只读）

11. i18n 完整性与英文排版 ✅ 已并入 §2.2-L
12. 全局快捷键体系 ✅ 已并入 §2.2-M
13. 令牌矩阵穷举核算 ✅ 已并入 §2.2-G 与 §6
14. 错误处理与提醒链路 ✅ 已并入 §2.2-O / §2.2-P / P0-9
15. 测试缺口映射 ✅ 已并入 §4.1

### 已知盲区（未覆盖，需要实机或工具）

| 盲区 | 为什么静态审查查不到 | 建议手段 |
| --- | --- | --- |
| 真实几何（月格实际高度、chip 实际容量） | 依赖窗口尺寸与字体度量 | 实机截图 1440×900 / 960×640 两档 |
| 对比度 | 已用公式复算，但 `color-mix` 在 oklab 下的感知差异需实机确认 | DevTools + 取色器 |
| 真机键盘走查 | 焦点顺序、实际 Tab 落点 | 只按 Tab/Enter/Esc 走完核心流程 |
| 屏幕阅读器播报 | 依赖 AT 实现 | NVDA + Chrome / Narrator + Edge |
| 高对比度模式 | `forced-colors` 无法静态验证 | Windows 高对比度开关 |
| 触屏手势 | 需要触屏设备 | 触摸笔记本或 DevTools 触摸模拟 |
| 性能（年视图拉全年数据） | 需实际数据量 | DevTools Performance |
| 颜色区分（色盲） | 需模拟 | DevTools 色觉缺陷模拟 |

### 4.1 测试缺口（#15 结论，已核实）

#### 现状

`pnpm test` 全绿 **515 例**，但层次严重偏科：

| 包 | 测试文件 | 例数 |
| --- | --- | --- |
| `packages/features` | 19 | 263 |
| `packages/core` | 7 | 122 |
| `packages/adapters` | 6 | 103 |
| `packages/ui` | 1 | 27（全是 i18n） |
| `apps/desktop` | **0** | **0**（无 test script，无 test 目录） |

约 **95% 是纯函数/纯逻辑**（很多测的是从组件文件 export 出来的 helper，如 `scheduleForChoice`、
`resetCopy`）。组件渲染只有 `packages/features/test/inbox-i18n.test.tsx` 一个文件 4 例，
且用的是 `react-dom/server` 的 SSR 字符串，**不是真实 DOM**。

#### 环境判定（这是补测试的前提）

- 全仓**无任何 `vitest.config.*`** → 跑 vitest 默认 `node` 环境；
- `@testing-library/react` 写在 `packages/features/package.json:25` 且已安装，但**全仓零 import**；
- `jsdom` / `happy-dom` / `user-event` / `axe` **一个都没装**（`require.resolve` 均失败）。

**结论：键盘事件、焦点、IME（`isComposing`）、`dialog.showModal()` 目前全部不可测。**
补测试的第一步是补环境，不是写用例。

#### 9 个 P0 的可测性判定

| P0 | 可拦层次 | 判定 |
| --- | --- | --- |
| P0-1 IME 回车 | component，或抽 `isSubmitKey(e)` 后纯单测 | **能拦** |
| P0-2 删除不可撤销 | integration（撤销栈不变量） | **能拦**（须先定语义） |
| P0-3 月视图丢事件 | unit 拦容量与可聚焦；几何 ❌ | 部分能拦 |
| P0-4 重置后锁死 | component（断言 `dialog.open === false`） | **能拦** |
| P0-5 搜索 Tab 陷阱 | component（断言 `document.activeElement`） | **能拦** |
| P0-6 结束重复 | integration（撤销栈） | **能拦** |
| P0-7 更新面板 modal | component 拦焦点束缚；top-layer ❌ | 部分能拦 |
| P0-8 `touch-action:none` | 单测原理上不可行 | 只能静态规则/人工 |
| P0-9 版本号注入路径 | 纯单测（`vite.config` 的解析函数可抽出来） | **能拦** |

**当前 CI 对 9 个 P0 的实际拦截率 = 0。**

#### 会因修复而变红的测试（提前知道，避免误判回归）

反直觉结论：P0 所在地几乎没测试，**修 P0 本身几乎不会红**。会红的是下游的文案/白名单锁死测试，
主要在第二轮「统一删除组件、补键盘」时触发：

| 文件:行 | 锁死了什么 |
| --- | --- |
| `packages/features/test/shortcuts.test.ts:75-113` | 硬编码快捷键白名单（`not.toContain('mod+n')`） |
| `packages/features/test/list-sidebar.test.ts:54-70` | 逐字英文文案 |
| `packages/features/test/data-transfer-reset.test.ts:17-53` | 逐字文案 |
| `packages/features/test/use-tasks.test.ts:127-224,251-279` | 精确调用序列（`['remove:next-1','toggle:done-1']`） |
| `packages/features/test/inbox-i18n.test.tsx:37` | 正则绑死 `.list-sidebar__name` 类名 |
| `packages/core/test/services.test.ts:46-55` | 非空清单拒删 |
| `packages/features/test/row-click.test.ts:52,73` | 依赖类名 |
| `packages/features/test/export-import.test.ts:98` | 断言备份字段顺序 `slice(0,4)` |

#### 最值得先补的 5 个测试（按投入产出）

1. **`TextField` IME 守卫**（P0-1）——先抽 `isSubmitKey(e)`，纯单测即可，一处挡 5 个 Enter 点；
2. **`DataTransferPanel` 重置后 `dialog.open === false`**（P0-4）——一条用例锁死「整页锁死」；
3. **数据层销毁性不变量**（P0-2 + P0-6）——`UndoProvider` + 假 port，无需 DOM；
4. **`SearchPanel` Tab 陷阱 + 焦点不逃逸**（P0-5），顺带覆盖 §H；
5. **令牌对比度纯测**（§G）——`readFileSync(tokens.css)` 算 WCAG 比值，无需浏览器。

环境未就位前，第 5 条与 `EmptyState` action 插槽的 SSR 测试是少数能立刻落地的。

#### 门禁的大空档：没有真正的 linter

各包的 `"lint": "tsc --noEmit"` —— **全仓没装 ESLint，也没装 stylelint**。
所谓 lint 门禁实为类型检查，对下面这些完全无能为力。建议先引入 linter（不需要 DOM 环境，
可排在补测试环境之前）：

| 规则 | 能直接拦住的 |
| --- | --- |
| stylelint `declaration-block-no-duplicate-properties` | **P0-3** 的 `styles.css:592,604` 重复 `position` |
| stylelint `declaration-property-value-disallowed-list: { touch-action: ["none"] }` | **P0-8** |
| ESLint + `jsx-a11y` 推荐集；自定义 `no-restricted-syntax` 禁止 `e.key === 'Enter'` 无 `isComposing` 守卫 | **P0-1**、P0-5、P0-7、§C |

---

## 5. 执行顺序建议

### 第一批 — 纯修复，无设计决策（预计半天）

| # | 改动 | 对应 |
| --- | --- | --- |
| 1 | `vite.config.ts` 跟随 `"../package.json"` 间接引用解析真实版本号 | **P0-9** |
| 2 | `TextField.tsx` 加 `isComposing \|\| keyCode === 229` 守卫；5 处自写 Enter 同步 | P0-1 |
| 3 | `DataTransferPanel.tsx:415` 补 `setConfirmReset(false)` | P0-4 |
| 4 | `styles.css:604` 删掉重复的 `position: relative` | P0-3 一半 |
| 5 | 对比度 7 处 + 穷举新增 4 行换令牌（`-ink` 兄弟就在旁边） | §G |
| 6 | `SearchPanel.tsx:174` 选择器去掉裸 `input`（临时缓解，正式改见第二批） | P0-5 缓解 |
| 7 | `Shell.tsx:445` 的 `g q` 改走 `openQuadrants`（一行） | §M |
| 8 | `en/misc.json:30` 去掉 `({{done}} completed)` 的重复 `completed` | §L |

### 第二批 — 需要先定方向

| # | 决策点 | 影响 |
| --- | --- | --- |
| 1 | **删除语义**：可撤销 vs 独立确认框 | P0-2，三个入口 |
| 2 | 抽共享 `DestructiveConfirm` 替换三处内联 alertdialog | §B |
| 3 | 「结束重复」移出 toast 或改为可撤销 | P0-6 |
| 4 | `Popover` 迁 `popover` + anchor positioning | §E |
| 5 | 月视图容量重算 + 单元格改 `<button>` + `+N` 改按钮 | P0-3 后半 |
| 6 | 键盘等价路径（四象限手柄、时间网格空槽、清单拖放） | §F |
| 7 | `SearchPanel` 整体改原生 `<dialog>` | P0-5 |
| 8 | `UpdatePanel` 改原生 `<dialog>` + i18n 化 | P0-7 |

### 第零批 — 先立门禁（可与第一批并行）

当前 `lint` 段实为 `tsc --noEmit`，**全仓未安装 ESLint / stylelint**，这是最大空档。
先引入 linter 并落 3 条规则，即可自动拦住 9 个 P0 中的 4 个（见 §4.1 末表）：

1. stylelint `declaration-block-no-duplicate-properties` → P0-3
2. stylelint 禁 `touch-action: none` → P0-8
3. ESLint `jsx-a11y` + 禁无 IME 守卫的 Enter → P0-1 / P0-5 / P0-7

补 DOM 测试环境（`vitest.config` + `jsdom` + 启用已装的 `@testing-library/react`）是下一步，
但不需要与门禁同时做——上述 3 条规则不依赖 DOM。

### 第三批 — 工程加固

`forced-colors` 全量（§K）、`dialog:modal` overscroll（§A）、`EmptyState` 加 action 插槽（§I）、
`inFlight` 排队（§J）、焦点归还（§H）、触屏 `touch-action` 收窄（P0-8）、
提醒的 `visibilitychange` 补偿与 OS 排程（§O）、Esc 归属栈式重构（§M）。

---

## 6. 文档债

`docs/DESIGN-LANGUAGE.md` §8 的约定：

> 后续任何一处修复都应同时**删掉本节对应条目**，让文档始终等于「现状 + 待办」，而不是一句谎。

第二轮对 §8 十二条做了逐条裁决（#13，脚本核行号）：

| §8 条目 | 裁决 | 现状 |
| --- | --- | --- |
| 1 `--tl-block-*` 只在日历生效 / base Chip 自造比例 | **已修复（主体）** | 比例、竖条、圆角已统一；`--chip-tint` 逃生口与 `Chip.tint` prop 仍在，但**零调用方**，可删 |
| 2 行/控件高度令牌是死令牌 | **部分修复** | `--tl-control-h`/`-sm` 已落地 46 处；`--tl-row-h` 只用于 `.tk-row`，`.qz-row:177` 仍写死 36px；`--tl-space-compact` 仍零引用 |
| 3 控件高度散落硬编码 | **部分修复** | `ui/styles.css:504`(26px)、`:518`(28px)、`settings.css:275`(26px) 仍写死；pickers/data/lists 已清零 |
| 4 字面量时长 | **表述过期** | `ui/styles.css` 已无字面量时长；新违规在 `features/styles.css:50/262/340`、`App.tsx:183` |
| 5 字面量阴影 | **表述过期** | 原 `:1110` 现是 `.tv__empty` 边框；面板阴影已用 `--tl-shadow-panel` |
| 6 字段静止态用重边框 | **仍存在** | 4 处：`calendar.css:327`/`:420`、`pickers.css:19`/`:327`（原行号全变） |
| 7 block 圆角写死 6px | **仍存在** | `calendar.css:131`、`:1680` 仍写死 6px（原行号已失效） |
| 8 重复的胶囊实现 | **已修复** | `.view-pill*` 已无 TSX 引用，只剩 `features/styles.css:1130-1153` 死 CSS 可删 |
| 9 全大写微字距标签 | **已修复** | 无 uppercase/0.08em；`lists.css:98` 已是 `letter-spacing: 0` |
| 10 低于字阶的字号 | **已修复** | `search.css:211` 已是 `--tl-font-size-xs`；全仓无 10px/11px |
| 11 物理方向属性 | **已修复（范围更大）** | 议程已用逻辑属性；`features/styles.css:660/765` 等仍有 10 处物理方向 |
| 12 象限 tint 令牌未被消费 | **仍存在** | CSS 零引用属实；JS 里 `QUADRANT_COLOR.tint` 无消费方 |

**净结论：6 条说「已违反」的其实已修或部分修复，3 条行号已失效。**
这份清单当前比真实缺口更误导，应整节重写：把 5 条「仍存在」留下并修正行号，其余删除。

**其他已核实的事实**（#13）：

- `color-mix` 共 65 处，**混向 `white`/裸 hex/rgb 的 = 0** —— §2.2 是全仓执行得最好的一条；
- 死令牌 **21 个**（含 `--tl-success-ink` 与 `--tl-quadrant-qN-tint`）；
- 字面量：颜色 21、时长 6、尺寸 604、圆角 6；
- `transition` 71 处、`@keyframes` 12 个、`prefers-reduced-motion` 18 块、`forced-colors` **0**。

---

## 附录 A：分面报告索引

| 文件 | 范围 | 核查项 | P0/P1/P2 |
| --- | --- | --- | --- |
| `01-quadrant.md` | 四象限看板 | 76 | 0/9/21 |
| `02-task-list.md` | 扁平任务列表 | 62 | 3/7/15 |
| `03-detail-panel.md` | 任务详情侧栏 | 38 | 1/7/15 |
| `04-cal-time-grids.md` | 日历时间网格 | 64 | 1/8/17 |
| `05-cal-overview.md` | 月/多周/年视图 | 118 | 3/9/12 |
| `06-overlays-pickers.md` | 浮层与选择器 | 106 | 0/7/20 |
| `07-dialogs-info.md` | 设置/快捷键/更新 | 60 | 1/5/17 |
| `08-dialogs-data-event.md` | 数据面板+日程编辑器 | 62 | 1/6/13 |
| `09-shell-nav-lists.md` | 外壳导航+清单侧栏 | 94 | 0/8/15 |
| `10-search-feedback-atoms.md` | 搜索+反馈+原子/令牌层 | 118 | 3/11/28 |
| `11-i18n.md` | i18n 完整性与英文排版 | — | 进行中 |
| `12-shortcuts.md` | 全局快捷键体系 | 38 | 0/6/14 |
| `13-token-matrix.md` | 令牌矩阵穷举核算 | 155 令牌 / 1926 文字对 / 1344 非文字对 | 0/8/若干 |
| `14-errors-reminders.md` | 错误处理与提醒链路 | 25 | 3/13/9 |
| `15-test-gaps.md` | 测试缺口映射 | 515 例现有测试 | 已并入 §4.1 |

## 附录 B：审查方法

- 每个界面面一个独立 agent，只读审查，互不重叠；
- 每条发现必须给 `file:line` + 具体触发场景 + 指南 id 与原文引用；
- 无指南支撑的判断标为「工程判断」，不伪装成规范违规；
- 调用方对关键结论独立复核（对比度自行复算、几何自行推导、焦点路径自行走查），
  复核结果见 §3 与各 P0 条目内的「核实」说明。
