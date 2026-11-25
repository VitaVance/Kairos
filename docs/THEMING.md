# 主题与皮肤

应用有两套**正交**的视觉轴，可以任意组合，共 6 种外观：

| 轴 | 属性 | 取值 |
| --- | --- | --- |
| 明暗模式 | `<html data-theme>` | `light` / `dark`（`system` 在写入前已解析） |
| 设计方向（皮肤） | `<html data-palette>` | 缺省（= 清简）/ `protool` / `editorial` |

右上角调色板按钮打开的面板同时控制两者。选择分别持久化在
`localStorage` 的 `todolist.theme` 与 `todolist.palette`。

## 三套皮肤

| 名称 | `data-palette` | 来源设计稿 | 性格 |
| --- | --- | --- | --- |
| 清简 | *（不设属性）* | `design/A-refined.html` | 冷调中性、蓝色强调、干净 |
| 专注 | `protool` | `design/B-pro-tool.html` | 暖白底、单一靛蓝、信息密度高 |
| 纸墨 | `editorial` | `design/C-warm-editorial.html` | 纸感暖底、赭黄靛苔、衬线标题 |

「清简」是缺省值，因此**不写 `data-palette` 属性**——这保证全新安装的渲染路径
与引入皮肤系统之前逐字节相同。

## 实现约定

### 1. 一切颜色都来自令牌

组件样式只允许引用 `var(--tl-*)`。三套皮肤都在
`packages/ui/src/tokens.css` 里定义同名令牌，所以**没有任何组件规则需要知道
当前是哪套皮肤**。

### 2. 染色混向 `--tl-tint-base`，不要混向 `white`

这是本项目已经踩过的坑：

```css
/* 错误：深色模式下会把底色烤成一条白杠 */
background: color-mix(in oklab, var(--chip-color) 10%, white);

/* 正确 */
background: color-mix(in oklab, var(--chip-color) 10%, var(--tl-tint-base));
```

`--tl-tint-base` 指向当前 `--tl-surface`。混向字面量 `white` 在浅色下看不出
问题，深色下每一枚日历 chip 都会变成白条——而且只有运行起来才看得见。

### 3. 皮肤块必须成对覆盖

每套皮肤都定义了自己的浅色块，**以及**一个 `[data-palette="X"][data-theme="dark"]`
块。只要某个令牌在深色块里被单独改过，它的所有派生令牌（尤其是文字色、hover /
active 叠加层）都必须一起重新指定，否则会出现「深底 + 深字」看不见的情况——
悬浮视图切换胶囊的选中项就踩过这个坑。

### 4. 结构性差异放在 `apps/desktop/src/app.css`

皮肤不只是换色：纸墨用衬线标题、专注压缩行高。这类**结构性**差异按
`[data-palette='X'] .selector` 写在 shell 层，不要下推进组件里。

## 新增一套皮肤

1. 在 `packages/ui/src/tokens.css` 末尾加 `[data-palette="新名字"] { … }` 与
   `[data-palette="新名字"][data-theme="dark"] { … }`，至少覆盖
   `--tl-tint-base` 清单里的全部颜色令牌。
2. 在 `apps/desktop/src/shell/theme.ts` 的 `Palette` 联合、`PALETTES`
   数组与 `PALETTE_LABEL` 里登记。
3. 在 `ThemeToggle.tsx` 的 `PALETTE_OPTIONS` / `PALETTE_SWATCH` 里加入色板预览。
4. 跑 `pnpm -r typecheck && pnpm -r test && pnpm deps:check`。

## 验证方法

颜色问题只有真正渲染才看得见。最小验证：

```bash
pnpm dev
# 依次切换 3 套皮肤 × 浅/深，重点看：
#   - 日历 chip 在深色下是否是浅色条（应为暗底 + 色点）
#   - 底部悬浮视图切换胶囊的选中项是否可读
#   - 原生 <select> / <input type=date|time> 是否跟随暗色
```
