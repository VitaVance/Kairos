# 参与贡献

感谢你愿意一起打磨「清单」。这是一份**可执行的**贡献指南：它只写你真正需要知道的流程与红线，不重复仓库里已有的文档。

## 环境准备

工具链（Node / pnpm / Rust / MSVC / WebView2）的版本表与安装命令统一维护在
[docs/PACKAGING.md](docs/PACKAGING.md) 的「1. 前置条件」，这里不再抄录——避免两处漂移。

只需要记住一条：**浏览器开发不需要 Rust**。Rust 与原生工具链只在运行 / 打包 Tauri 桌面壳时才用到。

## 本地开发

```bash
corepack enable
pnpm install
pnpm dev        # 浏览器开发，默认 http://localhost:5173
```

浏览器里跑的是内存适配器，刷新即重置，这是开发便利，不是发布形态。要验证真正的持久化与桌面行为，用：

```bash
pnpm tauri dev
```

单包调试：

```bash
pnpm --filter @todolist/core test
pnpm --filter @todolist/core typecheck
```

## 提交 PR 前的门槛

以下三条必须在本地通过，CI（`.github/workflows/ci.yml`）跑的是同一套：

```bash
pnpm -r typecheck   # 全仓 tsc --noEmit
pnpm -r test        # 全仓 Vitest
pnpm deps:check     # dependency-cruiser 分层边界检查
```

`bash scripts/verify.sh` 会把边界检查 → 类型检查 → 测试 → Web 构建依次跑一遍，是更完整的本地校验。

## 架构红线

依赖**只允许向内**。这条规则不是口头约定，`pnpm deps:check` 会用
`.dependency-cruiser.cjs` 机械地拒绝违规导入：

| 包 | 规则 | 含义 |
| --- | --- | --- |
| `packages/core` | **不导入任何东西** | 领域模型、端口、用例。没有 React、没有存储、没有 Tauri、没有网络。它只声明端口，其余各方实现或消费这些端口。 |
| `packages/ui` | **只做展示** | 组件只接收普通 props 并渲染，不承载业务逻辑，不依赖 `core` / `features` / `adapters` / 外壳。 |
| `packages/features` | **不得导入 adapters** | 屏幕层只依赖 `@todolist/core`（类型与用例）与 `@todolist/ui`（组件）；绝不直接碰存储适配器或 `apps/*` 外壳。这才让同一套屏幕能跑在桌面与移动端。 |

另外 `packages/adapters` 不得导入 `ui` / `features` / 外壳，且整个仓库禁止循环依赖。

写代码前先读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：它解释了四层职责、端口清单和常见扩展怎么做。如果你的改动需要让 `features` 直接读存储，那通常说明应该往 `core` 的用例或端口里加能力，而不是打破边界。

## 主题与皮肤

界面有两套正交的轴（明暗模式 × 皮肤），所有颜色都来自 `packages/ui/src/tokens.css` 的 `--tl-*` 令牌。两条硬性约定：

1. **组件样式只引用 `var(--tl-*)`**，不要写死颜色。
2. **绝不 `color-mix(..., white)`**。染色必须混向 `var(--tl-tint-base)`：

   ```css
   /* 错误：深色模式下日历 chip 会变成一条白杠 */
   background: color-mix(in oklab, var(--chip-color) 10%, white);

   /* 正确 */
   background: color-mix(in oklab, var(--chip-color) 10%, var(--tl-tint-base));
   ```

   这个坑只有在真正渲染、并且切到深色时才看得见。

完整约定（皮肤块要成对覆盖、结构性差异放外壳层等）见 [docs/THEMING.md](docs/THEMING.md)。

### 新增一套皮肤

不要跳过 `--tl-tint-base` 清单。步骤见
[docs/THEMING.md 的「新增一套皮肤」](docs/THEMING.md#新增一套皮肤)，概括为：

1. 在 `packages/ui/src/tokens.css` 追加浅色块与 `[data-palette="新名字"][data-theme="dark"]` 深色块，覆盖全部颜色令牌。
2. 在 `apps/desktop/src/shell/theme.ts` 登记 `Palette` 联合、`PALETTES`、`PALETTE_LABEL`。
3. 在 `ThemeToggle.tsx` 的 `PALETTE_OPTIONS` / `PALETTE_SWATCH` 加入预览色板。
4. 跑三条门槛命令，并在 `pnpm dev` 里逐一切换「3 套皮肤 × 浅/深」目视确认。

## 提交与 PR 约定

- **提交信息用约定式前缀**，中文或英文正文均可，前缀保持英文小写：
  `feat:` 新功能、`fix:` 修 bug、`refactor:` 不改行为的重构、`docs:` 文档、`test:` 测试、`chore:` 构建 / 依赖 / 工具、`perf:` 性能。
  例：`fix(calendar): 深色下 chip 不再混向 white`。
- **改动小而聚焦**：一个 PR 只做一件事。跨层的顺手重构请拆开，方便审查与回滚。
- **描述里写清动机与验证**：改了什么、为什么、如何验证（贴出门槛命令的输出或关键截图）。
- **不要提交密钥**：签名私钥、证书指纹、任何形式的 token 都不进仓库。相关处理方式见 [SECURITY.md](SECURITY.md) 与 [docs/PACKAGING.md](docs/PACKAGING.md) 第 6、7 节。
- 新功能或行为变更建议附测试；至少保证现有测试不被破坏。

## 遇到问题

- 缺陷与功能建议走 GitHub Issue。
- **安全漏洞不要开公开 Issue**，按 [SECURITY.md](SECURITY.md) 的私密渠道报告。

## 许可

本项目以 [MIT](LICENSE) 许可发布。提交贡献即表示你同意以同一许可提供你的改动。
