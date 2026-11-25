# ADR 0003：本地优先持久化，驱动端口与迁移策略

- 状态：已接受（当前实现为内存，SQLite 待实现）
- 日期：2026-11-24

## 背景

产品是本地优先的个人待办 + 日历，没有云端、没有账号。数据必须：

- **始终属于用户本机**，不发起业务网络请求；
- 在应用重启后存活（当前缺失）；
- 能被未来版本安全升级 schema；
- 在测试中可替换、可预测（时间与 id 不能依赖系统随机与真实时钟）。

同时必须避免业务用例被某种具体存储绑死：今天用内存，下一版用 SQLite，未来移动端可能用不同的数据库实现。

## 决策

### 1. 本地优先，无云

没有任何同步 / 后端服务。数据只写入本机数据库文件（应用数据目录），Tauri CSP 为 `default-src 'self'`，`capabilities/default.json` 不授予网络权限。备份 / 导入导出留给后续版本，但方向是「用户可控的本地文件」，不是云。

### 2. 存储走驱动端口

持久化由 `packages/core/src/ports/repository.ts` 的 `UnitOfWork` 抽象：

```ts
interface UnitOfWork {
  readonly tasks: TaskRepository;
  readonly lists: ListRepository;
  readonly events: EventRepository;
}
```

用例（`TaskService`、`CalendarService`）只持有 `UnitOfWork`，从不接触 SQL、文件或 Tauri API。具体适配器在 `packages/adapters`：

- **现在**：`MemoryUnitOfWork`，由 `apps/desktop/src/App.tsx` 注入，配合 `seedDemoData` 提供演示数据。数据在内存数组里，刷新即丢。
- **下一步**：SQLite 适配器，同样实现 `UnitOfWork`，基于 Rust 侧已注册的 `tauri_plugin_sql`（`apps/desktop/src-tauri/src/lib.rs`，`Cargo.toml` 已开启 `sqlite` feature，权限见 `capabilities/default.json`）。切换只在组合根一行注入，`core` / `features` / `ui` 不改。

SQL 的具体形态被隔离在适配器内部：`packages/adapters/src/sql-driver.ts` 定义了最小的 `SqlDriver`（`execute` / `query`）与可选的 `SqlTransactionRunner`，仓储只对它编程；桌面用 `@tauri-apps/plugin-sql` 包一层，未来移动端换成 `op-sqlite` 即可，仓储代码与测试在纯 Node 里也能跑。`packages/adapters/src/errors.ts` 负责把「行不存在 / 输入非法 / 行无法解码」表达成类型化错误——`get` 未命中仍返回 `null`，写入未命中才抛 `EntityNotFoundError`。

时间与 id 也走端口：`Clock.now()` 与 `IdGenerator.task/list/event()` 由组合根注入（生产为 `SystemClock` / `CryptoIdGenerator`，测试为固定时钟与自增 id），使时间相关规则（完成时间戳、逾期判断）可确定地测试。

### 3. 迁移策略

- **编号迁移**：数据库 schema 用递增的整数版本管理，每个迁移是「从版本 N 到 N+1」的一步 SQL 脚本，内容在 `packages/adapters` 中随 SQLite 适配器一起维护。启动时读取当前 `user_version` / 迁移表，按序应用缺失的迁移，全部成功后才开放读写。
- **只前进、幂等、可回滚式的演进**：迁移只增加表 / 列或做数据搬迁，避免不可逆的破坏性操作；新增列必须带默认值，保证旧行可读。每次 schema 变更都必须先更新 `packages/core/src/domain/types.ts` 的领域类型，再写迁移，二者保持同步。
- **端口契约测试是跨实现的一致性门槛**：`packages/core/test/core.test.ts` 的 `makeHarness()` 是内存实现的契约基线。SQLite 适配器必须对同一套行为（不存在返回 `null` 或由用例抛 `TaskNotFoundError`、默认值、排序前的原始数据等）通过测试——任何适配器都必须满足同样的端口契约（里氏替换）。
- **单一事实来源**：领域类型以 `packages/core/src/domain/types.ts` 为准，SQL schema 是它在存储层的投影。示例：任务用 `important` / `urgent` 两个布尔轴存储，四象限是派生的（`domain/task.ts` 的 `quadrantOf`），不在数据库里冗余一列象限。
- **首次打开旧库**：若数据库文件不存在或版本为 0，一次性建到最新版；若版本高于当前应用支持的版本（用户降级），拒绝打开并提示，避免静默损坏数据。

## 后果

- 业务用例完全不知道存储实现，单测无需数据库；桌面与未来移动端可各自选择存储。
- 用户明确知道数据在本机；没有同步冲突，也没有跨设备能力（这是当前产品定位下的有意取舍）。
- 代价：需要自己承担备份、schema 演进与损坏恢复的责任；迁移必须严格测试（包括从旧版本升级的路径），且无法依赖云端做灾难恢复。
- 当前阶段**数据不持久**，必须在 README / 发布说明中说清楚，直到 SQLite 适配器落地。

## 备选方案

- **IndexedDB / localStorage**：无需 Rust，但容量、事务能力与查询（尤其日历范围查询）都弱，且与系统备份、文件迁移脱节；难以满足长期演进。
- **JSON 文件（整文件读写）**：实现最简单，但并发写入与部分更新容易损坏，查询要全量加载，不适合作为长期方案。
- **云端数据库（Supabase / Firebase 等）**：与「本地优先、无账号、隐私」的定位直接冲突，且会引入网络状态与冲突合并的复杂度。
- **本地 + 可选的端到端加密同步**：值得在未来考虑，但会显著增加复杂度（冲突解决、密钥管理），不在 0.1.0 范围内。
