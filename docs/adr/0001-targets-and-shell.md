# ADR 0001：Windows 优先，Tauri 2 作为桌面外壳

- 状态：已接受
- 日期：2026-11-24

## 背景

产品是本地优先的桌面待办 + 日历应用，**Windows 是第一目标平台**，后续需要覆盖 iOS / Android。第一版没有云端、没有账号，外壳只负责托管 WebView 与本地能力（数据库、通知、文件）。我们需要一个能打包出 Windows 安装包、且不会把移动端路堵死的方案。

约束：

- 界面用 React 19 + TypeScript strict，以 Web 技术栈开发。
- 数据持久化计划使用 SQLite，需要从 JS 侧安全访问本地数据库。
- 团队规模小，希望外壳尽量薄——业务逻辑全部留在 `packages/core`，Rust / 原生代码只做宿主。

## 决策

**采用 Tauri 2 作为桌面外壳，优先 Windows。**

具体落点：

- `apps/desktop/src-tauri/tauri.conf.json`：`productName: 清单`，窗口 1440×900（最小 960×640），CSP 为 `default-src 'self'`，打包目标 `["nsis", "msi"]`。
- `apps/desktop/src-tauri/Cargo.toml`：`tauri = "2"`，注册 `tauri-plugin-sql`（`sqlite` feature）、`serde`、`serde_json`；`rust-version = "1.77"`。
- `apps/desktop/src-tauri/src/lib.rs`：薄宿主，只 `tauri::Builder` 挂上 SQL 插件；已经写成 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`，为移动端入口预留。
- `apps/desktop/src-tauri/capabilities/default.json`：只授予 `core:default` 与 `sql:default` / `allow-load` / `allow-execute` / `allow-select` / `allow-close`，**没有任何网络或任意文件系统权限**。
- 前端构建用 Vite 7（`apps/desktop/vite.config.ts`），浏览器开发与桌面开发共用一套代码。

## 后果

- 安装包体积小、内存占用低（系统 WebView2，而非捆绑 Chromium）。
- 权限按 capability 显式声明，默认拒绝网络，契合「数据不出本机」。
- 代价：Windows 上构建需要 Rust 工具链、MSVC 与 WebView2（Windows 11 自带；Windows 10 需安装）。浏览器开发（`pnpm dev`）不受影响。
- Rust 侧会成为新增原生能力（通知、托盘、深度链接等）的必经之路；需要保持 `lib.rs` 只做装配，不写业务逻辑。
- 移动端：Tauri 2 的 iOS / Android target 可以直接复用 `apps/desktop` 的 Web 前端与 `@todolist/core`，但需要各自的原生工程与存储路径适配，且 WebView 在手势与性能上不如原生。

## 备选方案

- **Electron**：生态成熟、调试方便，但**没有可行的移动端路径**——iOS / Android 需要另起一套，代码复用只剩 Web 层。安装包体积（捆绑 Chromium）与内存占用也明显更大，与「轻量本地工具」的定位不符。故放弃。
- **纯 Web / PWA**：无法可靠地访问本地 SQLite 与系统通知，离线安装体验弱。
- **Flutter / .NET MAUI**：可跨端，但要放弃现有 React + TypeScript 技术栈，且无法自然复用 `packages/core`。
- **移动端的后续选项**：优先 Tauri 2 mobile target（复用 `features` / `ui` / `core` 与组合根思路）；若原生交互或性能成为瓶颈，再用 React Native 外壳，只复用 `@todolist/core` 与适配器端口，UI 重写。这个决定留到真正做移动端时再评估，本 ADR 不预先锁死。
