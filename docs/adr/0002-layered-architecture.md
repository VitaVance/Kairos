# ADR 0002：洋葱分层，依赖只向内

- 状态：已接受
- 日期：2026-11-24

## 背景

这是一个本地优先的待办 + 日历应用，领域规则（象限派生、完成状态、排期投影、排序）会持续演化；存储从内存走向 SQLite；未来还有移动端外壳与可能的 React Native 重写。如果把业务规则和 React、Tauri、SQL 混在一起，每次换存储或换外壳都要重写规则，测试也会被 IO 拖慢。

我们希望有一套明确的边界，让「换存储 / 换外壳」不触碰「业务规则」，并且能在没有框架、没有数据库的环境里对规则做单元测试。

## 决策

采用**洋葱 / 六边形架构**，四层，依赖只指向内层：

```
apps/desktop        （外壳 + 组合根，知道所有具体实现）
    ↓
packages/features   （屏幕 / 视图，React）
    ↓
packages/ui         （无状态组件 + 设计令牌）   packages/adapters（存储 / 系统实现）
    ↓                                              ↓
                packages/core（领域 + 端口 + 用例，零依赖）
```

- **core**（`packages/core/src`）：`domain/`（类型与纯函数）、`ports/`（接口）、`application/`（用例）、`shared/`（日期工具）。`package.json` 无运行时依赖，不导入 React / Tauri / 存储。
- **adapters**（`packages/adapters/src`）：实现 `UnitOfWork` / `Clock` / `IdGenerator`，当前为 `MemoryUnitOfWork` / `SystemClock` / `CryptoIdGenerator`，未来加 SQLite。
- **ui**（`packages/ui/src`）：无业务语义的组件与 `tokens.css`，只依赖 React，不依赖 core。
- **features**（`packages/features/src`）：React 屏幕，依赖 core 与 ui，不依赖 adapters。
- **apps/desktop**：唯一的组合根（`src/App.tsx`、`src/composition.ts`）与 Tauri 宿主，负责选择并注入具体适配器。

### SOLID 映射

- **S（单一职责）**：`TaskService` 只管任务用例，`CalendarService` 只管日历读侧投影；一个适配器只实现一个端口族。`domain/task.ts` 与 `domain/calendar.ts` 分别是任务与日历的纯规则。
- **O（开闭）**：新增视图 = 在 `packages/features` 加一个模块并在 `Shell.tsx` 挂载，core 不改；新增存储 = 在 `packages/adapters` 加一个 `UnitOfWork` 实现，core 也不改。
- **L（里氏替换）**：所有适配器必须满足同一套端口契约。`packages/core/test/core.test.ts` 的 `makeHarness()` 是可替换性的基线证明；SQLite 适配器落地时必须对同一契约测试通过。
- **I（接口隔离）**：端口拆小——`TaskRepository`、`ListRepository`、`EventRepository`、`Clock`、`IdGenerator` 各自独立；用例只依赖它实际用到的能力（`TaskService` 依赖 `Clock` + `IdGenerator`，`CalendarService` 只依赖 `UnitOfWork`）。
- **D（依赖倒置）**：core 声明接口，adapters 实现，组合根注入。高层（用例）不依赖低层（存储），二者都依赖抽象。

## 后果

- 换存储只改 `apps/desktop/src/App.tsx` 的注入；换外壳（如 React Native）可复用 `@todolist/core` 与组合根思路。
- 用例测试不碰 IO、不依赖真实时间：`Clock` 与 `IdGenerator` 注入，`packages/core/test/core.test.ts` 里用固定 `now` 与自增 id 断言。
- 分层由机器强制：`.dependency-cruiser.cjs` 定义 `core-is-pure`、`ui-is-presentational`、`features-no-adapters`、`adapters-no-ui`、`no-circular` 五条规则，`pnpm deps:check` 在本地与 CI（`.github/workflows/ci.yml`）中执行，违规导入直接失败。
- 代价：多了一层间接（端口 + 适配器），小功能的脚手架略多。

## 备选方案

- **单一包 + 按目录分层**：脚手架少，但依赖方向无法靠包边界强制，容易滑向「UI 直接调 SQL」。
- **feature-first（每个功能自带 domain / UI / data）**：模块边界清晰，但跨功能共享领域模型（任务同时服务四象限与日历）会重复或循环依赖，且不利于移动端复用。
- **仅用 TypeScript 的 `import type` 做隔离**：无运行时约束，无法阻止反向导入具体实现。
