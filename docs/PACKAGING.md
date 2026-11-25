# 桌面端打包指南

本文说明如何把 Tauri 2 桌面应用打包成 Windows 安装包。目标产物有两种：

- **MSI**（WiX 生成，适合企业批量分发 / 组策略部署）
- **NSIS `-setup.exe`**（体积更小，适合普通用户直接双击安装，可自动引导安装 WebView2）

两者可在一次构建中同时产出。

> 本仓库的桌面端位于 `apps/desktop`，Tauri 配置在
> `apps/desktop/src-tauri/tauri.conf.json`，Rust 工程在
> `apps/desktop/src-tauri/Cargo.toml`。

---

## 1. 前置条件

| 依赖 | 版本 / 说明 | 是否必需 | 安装方式 |
| --- | --- | --- | --- |
| Node.js | ≥ 22（本机为 25.x） | 必需 | `winget install OpenJS.NodeJS.LTS` |
| pnpm | 11.21.0（由 `packageManager` 固定） | 必需 | `corepack enable && corepack prepare pnpm@11.21.0 --activate` |
| Rust 工具链 | stable，MSVC 目标 | 必需 | `winget install Rustlang.Rustup` 然后 `rustup default stable-msvc` |
| MSVC C++ 生成工具 | 提供 `link.exe` 链接器 | 必需 | 见下方命令 |
| WebView2 Runtime | Windows 11 自带；NSIS 安装包内含引导程序 | 运行必需 | 无需手动安装 |
| WiX / NSIS 打包器 | Tauri 首次构建时自动下载 | 自动 | 需联网（见“故障排查”） |

> **最容易踩的坑：装的是 GNU 工具链，而不是 MSVC。**
> 如果你之前执行过 `winget install Rustlang.Rustup` 或从 rustup 官网下载，默认可能得到 `stable-x86_64-pc-windows-gnu`。它看起来"Rust 装好了"（`cargo --version` 正常），但 Tauri 在 Windows 上需要 MSVC 目标，构建会失败或链接出错。
> 先确认：`rustup show active-toolchain`。如果末尾是 `-gnu`，执行 `rustup default stable-msvc`（会额外下载约 300MB 的 MSVC 工具链并解压到本地，期间请勿中断）。
> 切换完成后 `rustup show active-toolchain` 应显示 `stable-x86_64-pc-windows-msvc`。

MSVC C++ 生成工具的安装命令（在**管理员** PowerShell 中执行）：

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

> **只装 rustup 不够。** Rust 的 MSVC 目标必须能找到 `link.exe`，所以一定要装
> Visual Studio Build Tools 的 *Desktop development with C++* 工作负载（上面的
> `Microsoft.VisualStudio.Workload.VCTools`）。这是首次构建最常见的失败原因。

安装完成后**关闭并重新打开终端**，让 PATH 生效。

### 一键自检

```powershell
pnpm desktop:preflight
# 等价于：node scripts/check-toolchain.mjs
```

脚本会逐项打印 `✓ / ✗` 检查结果，对每个 `✗` 给出可复制的修复命令，并打印预期产物路径。
**只有全部通过时退出码为 0**，否则为 1（便于接入 CI 或构建脚本做门禁）。

检查项：Node ≥ 22、pnpm、`cargo --version`、`rustc --version`、rustup、
`x86_64-pc-windows-msvc` 目标是否安装、MSVC `link.exe` 是否可用（优先用 `vswhere`
检测，并会排除 Git for Windows 自带的伪 `link.exe`）。

---

## 2. 首次构建步骤

```powershell
# 1. 在仓库根目录安装依赖（冻结 lockfile，保证可复现）
pnpm install --frozen-lockfile

# 2. 自检工具链
pnpm desktop:preflight

# 3. 构建（同时产出 msi + nsis）
pnpm desktop:build
```

也可以直接用封装脚本，它会自动执行上面三步并列出产物：

```powershell
# PowerShell（推荐 Windows）
powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
# 只构建其中一个：
powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1 -Bundle nsis

# Git Bash / WSL
bash scripts/build-desktop.sh
bash scripts/build-desktop.sh msi
```

> 首次构建会编译整个 Rust 依赖树并下载 WiX / NSIS 工具，耗时通常 **10–20 分钟**，
> 之后的增量构建会快很多。`Cargo.toml` 中开启了 `lto = true` 与 `codegen-units = 1`，
> 以构建时间为代价换取更小的二进制和更好的运行性能。

---

## 3. 三条构建命令与产物

| 命令 | 说明 | 产物 |
| --- | --- | --- |
| `pnpm desktop:build` | 按 `tauri.conf.json` 的 `bundle.targets`（即 `["msi","nsis"]`）构建 | MSI + NSIS |
| `pnpm desktop:build:msi` | 仅构建 WiX MSI（`--bundles msi`） | 仅 `.msi` |
| `pnpm desktop:build:nsis` | 仅构建 NSIS 安装器（`--bundles nsis`） | 仅 `*-setup.exe` |

（`pnpm tauri:build` 是等价于 `desktop:build` 的历史脚本，保留兼容。）

构建前会先执行 `beforeBuildCommand`（`pnpm build`，即前端 `tsc --noEmit && vite build`），
产物前端资源输出到 `apps/desktop/dist`，再被打进安装包。

---

## 4. 产物位置

默认都在 `apps/desktop/src-tauri/target/release/` 下：

```
apps/desktop/src-tauri/target/release/
├── todolist.exe                              # 便携版单文件（无安装器，可直接运行/分发）
└── bundle/
    ├── msi/
    │   └── 清单_0.1.0_x64_zh-CN.msi          # WiX MSI 安装包
    └── nsis/
        └── 清单_0.1.0_x64-setup.exe          # NSIS 安装器
```

> **关于文件名中的中文**：`productName` 为「清单」，Tauri 会把它用于安装包文件名、
> 开始菜单快捷方式与卸载项显示名。为保证**可执行文件名与默认安装目录**是 ASCII 安全的，
> 配置里设置了 `mainBinaryName: "todolist"`：
>
> - 可执行文件固定为 `todolist.exe`，安装目录为
>   `%LOCALAPPDATA%\清单\`（目录仍用 productName，属预期）。
> - **安装包文件名**仍会带中文（如 `清单_0.1.0_x64-setup.exe`）。这在 Windows 和
>   NSIS/WiX 下均可正常工作；但若下游分发系统（部分杀软白名单、老旧的下载站点、
>   某些 CI artifact 上传工具）不能处理非 ASCII 文件名，可改用
>   `tauri build --bundles ...` 后手动重命名再分发，或在 `tauri.conf.json` 中将
>   `productName` 改为纯 ASCII（会一并改变开始菜单显示名，需权衡）。
>
> 综合结论：**保留中文产品名 + `mainBinaryName: "todolist"`**，文件名可含中文，
> 但二进制与主程序名保持 ASCII。MSI 的 `UpgradeCode` 由 Tauri 依据 productName 派生，
> 若日后改名会导致升级识别为“另一个应用”，改名时请显式固定
> `bundle.windows.wix.upgradeCode`。

---

## 5. 当前 bundle 配置说明

`tauri.conf.json` 关键片段：

```jsonc
"productName": "清单",
"mainBinaryName": "todolist",            // 可执行文件固定为 todolist.exe
"identifier": "app.todolist.local",      // 保持不变（影响注册表/数据目录/升级识别）
"bundle": {
  "targets": ["msi", "nsis"],
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.ico"                     // Windows 必需（ico 内含多尺寸）
  ],
  "windows": {
    "wix":  { "language": "zh-CN" },     // MSI 安装界面语言：简体中文
    "nsis": {
      "languages": ["SimpChinese", "English"],  // NSIS 支持中英双语
      "installMode": "currentUser"              // 按用户安装，无需管理员权限
    }
  }
}
```

- `installMode: "currentUser"`：默认装到 `%LOCALAPPDATA%`，普通用户可直接安装，
  卸载信息写入 `HKCU`。若需装到 `Program Files`（需管理员），改为 `"perMachine"` 或
  `"both"`。
- 图标均已由 `tauri icon` 生成并**逐一核对存在**于 `apps/desktop/src-tauri/icons/`。
- **保持 `identifier` 不变**：它决定了应用数据目录、单实例标识、MSI/WiX 识别，
  以及未来的自动更新校验；修改会导致用户数据与升级链断裂。

### Cargo release 配置

`Cargo.toml` 的 `[profile.release]` 针对 Windows 小体积 + 高性能做了调优：

```toml
[profile.release]
opt-level = "s"      # 体积优先的优化级别
lto = true           # 全量链接期优化
codegen-units = 1    # 更好的优化，编译更慢
panic = "abort"      # 去掉 unwinding，减小体积
strip = true         # 去除调试符号
```

`[profile.dev]` 保持默认（`opt-level = 0`、`debug = true`），保证开发时增量编译快。

---

## 6. 代码签名（重要）

**未签名的 MSI / NSIS 会触发 Windows SmartScreen 的“未知发布者”警告**，用户需要点
“更多信息 → 仍要运行”。对于内部分发可以接受；对公开发布建议签名。

> **签名是纯本地、可选的（opt-in）。** 仓库里的 `tauri.conf.json` 故意**不含**任何签名
> 配置，因此没有证书的机器上 `pnpm desktop:build` 照常工作。是否启用由你本机决定，
> 且**私钥和指纹都不要提交**到仓库。

> **有两条完全不同的签名，别混为一谈。**
> - **Tauri 更新签名**（`TAURI_SIGNING_PRIVATE_KEY`）：`tauri-plugin-updater` 在安装更新前，
>   用 `plugins.updater.pubkey` 校验 `.sig` / `latest.json`。它防的是“更新包被篡改”。
> - **Windows Authenticode 签名**（本章的证书 / SignPath）：SmartScreen 与 Windows 校验
>   安装包内嵌的发布者证书。它防的是“未知发布者”警告。
>
> 两者可以同时存在，也必须同时存在；它们的先后顺序见 §6.2。

### 6.1 三条签名路线怎么选

| | (a) 本地证书（自签名 / 已有 pfx） | (b) **SignPath Foundation（开源免费）** | (c) 购买正式证书 |
| --- | --- | --- | --- |
| 适用场景 | 内网、小范围、离线机器 | 公开的 OSI 许可开源项目，非商业分发 | 对外商业分发，需要项目自己的发布者名 |
| 私钥在哪 | 本机证书存储 / 你自己的 HSM | **SignPath 的 HSM，永不可导出** | 你的 HSM / 云签名服务 |
| SmartScreen 效果 | 自签名仍警告，除非用户手动信任根证书 | 是真实 OV 证书，但**声誉仍需逐步累积**（新证书前期仍可能提示） | OV 同样累积；EV 更快建立声誉 |
| 费用 | 免费 | 免费 | 数千元 / 年起 |
| 申请门槛 | 无 | 需 **OSI 认可许可证 + 公开仓库 + 非商业分发**，由 SignPath 人工审核，**通常需数周** | 需企业资质与组织验证 |
| 是否能在本地构建时签名 | 能（`certificateThumbprint` / `signCommand`） | **不能，只能在 CI 里提交签名请求**（见下） | 视方案：本地或 CI |
| 证书主体 | 你自定的 CN | 显示为 **SignPath Foundation**，不是你项目的名字 | 你的公司 / 项目 |
| 本章命令 | `pnpm desktop:signing-check`、`scripts/sign-desktop.ps1` | `.github/workflows/release.yml` | 同 (b)，换成自有证书 / 云签名 |

> **SignPath 的关键约束：私钥只在 SignPath 的 HSM 里，无法下载到本地。**
> 因此：
> - **本地** `pnpm desktop:build` 出来的安装包**仍然是未签名的**；
> - **只有** `.github/workflows/release.yml` 在 CI 中产出的安装包才是 Authenticode 签名的。
>
> 这是**设计如此**（私钥永不落到开发机），不是配置错误。第一次本地构建看到
> “未知发布者”属预期。

申请与接入步骤（一次性）：到 <https://signpath.org> 提交 Foundation 申请 → 获批后在
SignPath 后台创建 organization / project / signing policy / artifact configuration →
把 `SIGNPATH_API_TOKEN` 作为仓库 Secret，并把工作流里的 `YOUR-ORG`、`YOUR-PROJECT`、
`YOUR-SIGNING-POLICY`、`YOUR-ARTIFACT-CONFIGURATION` 换成实际值。

### 6.2 签名顺序（最容易悄悄弄坏自动更新的地方）

**Authenticode 签名会改变安装包的字节；而 Tauri 的 `.sig` 是对这些字节的签名。**
所以固定顺序是：

1. `pnpm tauri:build`：构建**未签名**安装包（此时 Tauri 会生成一份 `.sig`，是临时占位）。
2. 把 `*-setup.exe` 与 `*.msi` 上传并提交给 SignPath，取回已签名的副本。
3. 用签名后的文件**覆盖**原安装包。
4. **重新生成 Tauri 的 `.sig`**：`tauri signer sign --app-version <version> <安装包>`，
   让 `.sig` 覆盖 Authenticode 签名后的新字节。
5. 最后才发布（`latest.json` 读取的正是第 4 步的 `.sig`）。

顺序反了（先 Tauri 签名、后 Authenticode 签名），已安装用户下载更新时会因签名不匹配而
**静默拒绝更新**。工作流中的 “Re-sign updater artifacts…” 一步就是第 4 步，删掉它等于
发布“坏更新”。

> 若 CI 里没有 `SIGNPATH_API_TOKEN`（例如 fork，或 Foundation 申请尚未获批），工作流会
> **跳过**第 2–4 步，照常发布**未签名**的安装包，不会失败。项目在申请等待期内仍可发版。

### 6.3 本地命令速览

| 命令 | 作用 |
| --- | --- |
| `pnpm desktop:signing-check` | 只读自检：本机是否有签名证书、`signtool` 是否可用、`tauri.conf.json` 当前声明了什么。**永远退出 0**（仅信息展示）。 |
| `powershell -ExecutionPolicy Bypass -File scripts\sign-desktop.ps1 -Generate -File <exe>` | 生成本地自签名代码签名证书并对指定文件签名，最后用 `signtool verify /pa` 验证，并打印可复制粘贴的指纹。 |
| （构建时）`pnpm desktop:build` | 只要 `bundle.windows` 里配了 `certificateThumbprint`，Tauri 就会自动用系统 `signtool` 签名安装包。 |

### 6.4 路线 (a)：本地自签名证书（仅内部使用）

适合公司内网 / 小范围分发。缺点是**外部用户仍会看到警告**（证书不在受信根中），
需要先把根证书导入“受信任的根证书颁发机构”，属于纯内部可控场景。

```powershell
# 1. 生成自签名代码签名证书（仅示例，生产请妥善保管 .pfx 与密码）
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=todolist" `
  -KeyUsage DigitalSignature `
  -FriendlyName "todolist code signing" `
  -CertStoreLocation "Cert:\CurrentUser\My"

# 2. 记录指纹（Thumbprint，即配置里的 certificateThumbprint，40 位十六进制）
$cert.Thumbprint

# 3. 导出为 pfx 备份（可选）
Export-PfxCertificate -Cert $cert -FilePath .\todolist.pfx -Password (Read-Host -AsSecureString)
```

上面第 1–2 步等价于一条命令（会用 `New-SelfSignedCertificate` 生成证书、对文件签名、
`signtool verify /pa` 验证，并把指纹打印成可复制形式）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sign-desktop.ps1 `
  -Generate `
  -File apps\desktop\src-tauri\target\release\todolist.exe
# 已有证书时用指纹：
#   ... -Thumbprint <40位HEX> -File <exe|msi|*-setup.exe>
# 完全离线（不做时间戳）：
#   ... -Generate -TimestampUrl '' -File <exe>
```

> 脚本会在 PATH 和 Windows SDK 的 `bin\<version>\x64\` 中查找 `signtool.exe`；
> 找不到时直接报错并给出安装位置（`winget install Microsoft.WindowsSDK`），
> 不会误签。对自签名证书，`verify /pa` 可能因根证书未受信而失败——这是预期行为，
> 签名本身已写入；把证书公钥导入 `Cert:\CurrentUser\Root` 后即可通过（见下）。

#### 在本机启用（3 步，不提交）

1. 运行上面的 `sign-desktop.ps1 -Generate ...`，记下它打印的 **40 位指纹**。
2. 把模板 `apps/desktop/src-tauri/signing.example.jsonc` 里的三行原样粘贴进
   `apps/desktop/src-tauri/tauri.conf.json` 的 `bundle.windows` 对象，把 `<THUMBPRINT>`
   换成你的指纹。**只改本机文件，不要提交**（可用
   `git update-index --skip-worktree apps/desktop/src-tauri/tauri.conf.json`
   让 Git 忽略本地改动）。
3. 正常构建：`pnpm desktop:build`。Tauri 会用系统 `signtool.exe` 按指纹查找证书并
   对 exe / 安装包签名。

粘贴后的结构应为（**本仓库默认没有这些字段**，保持为空以便无证书机器也能构建）：

```jsonc
"bundle": {
  "windows": {
    "wix":  { "language": "zh-CN" },
    "nsis": { "languages": ["SimpChinese", "English"], "installMode": "currentUser" },
    // ↓ 本机可选启用：不要提交真实指纹
    "certificateThumbprint": "你的证书指纹(40位HEX)",
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

Tauri 会用系统 `signtool.exe` 按指纹查找证书并对 exe / 安装包签名。
时间戳服务器（`timestampUrl`）让签名在证书过期后仍然有效。

> **想随时确认本机状态？** 运行 `pnpm desktop:signing-check`。它只读、永远退出 0，
> 会报告：`CurrentUser\My` 中有无签名证书（指纹/主体/有效期）、`signtool` 是否可用
> （PATH 或 SDK）、`tauri.conf.json` 里当前声明了哪些签名键。也可直接
> `node scripts/check-signing.mjs`。

**想把自签名证书变成“内部受信”**（让内部机器不再弹警告）：把证书公钥导出并导入本机
受信任根，其他内部机器同样导入一次：

```powershell
Export-Certificate -Cert (Get-Item Cert:\CurrentUser\My\<指纹>) -FilePath .\todolist-codesign.cer
# 每台内部机器执行一次（当前用户，无需管理员）：
Import-Certificate -FilePath .\todolist-codesign.cer -CertStoreLocation Cert:\CurrentUser\Root
```

### 6.5 路线 (c)：购买正式代码签名证书（对外商业发布）

从 DigiCert / Sectigo / SSL.com 等购买 **Code Signing Certificate**（推荐 EV 证书，
能更快建立 SmartScreen 信誉）。使用方式同上：把证书装进当前用户/机器的“个人”证书存储，
配置 `certificateThumbprint` 即可；或用 `.pfx` + 密码在 CI 中导入后构建。

> 自 2023 年起，普通 OV 代码签名证书的私钥必须具备硬件保护（USB token / HSM），
> 因此更常见的做法是在 CI 中配置**云签名 / 自定义签名命令**。此时用 `signCommand`：

```jsonc
"bundle": {
  "windows": {
    "signCommand": {
      "cmd": "你的签名工具.exe",
      "args": ["sign", "--file", "%1"]   // %1 会被替换为待签文件路径
    }
  }
}
```

`signCommand` 与 `certificateThumbprint` 二选一即可；若使用云端签名服务（如
Azure Trusted Signing、SSL.com eSigner），用 `signCommand` 更灵活。

> **CI 注意**：签名证书/密钥**不要**提交进仓库。用 GitHub Actions Secrets 注入，
> 或使用 OIDC 直连云签名服务。

### 6.6 发布工作流需要的仓库 Secrets

在 `Settings → Secrets and variables → Actions` 中配置：

| Secret | 必需 | 作用 |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | **是** | 更新签名私钥内容（`tauri signer generate` 生成）。缺失时 `tauri build` 会直接失败。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 视密钥而定 | 私钥密码；生成时未设密码则留空。 |
| `SIGNPATH_API_TOKEN` | 否 | SignPath 接入令牌。**存在时**走 Authenticode 签名；**不存在时**工作流自动退化为发布未签名安装包（fork、或 Foundation 申请审批中都可以正常发版）。 |
| `GITHUB_TOKEN` | 自动 | 由 Actions 提供，无需手动配置。 |

`SIGNPATH_API_TOKEN` 缺失时的行为：构建照常进行，SignPath 相关步骤（上传、提交签名、
覆盖、重签）全部跳过，最终发布**未签名**安装包。这正是申请等待期内仍可发版的原因。

---

## 7. 自动更新（GitHub Releases）

更新走 **`tauri-plugin-updater` + GitHub Releases**，公开仓库不需要额外服务器：
把 `latest.json` 作为 release 资产上传后，固定地址
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`
会始终指向最新一版。

### 7.1 这里说的「纯本地」是什么意思

需要说清楚，因为很容易被理解成「应用永不联网」：

| | |
| --- | --- |
| **不上云**（这是承诺） | 没有账号、没有云同步、没有遥测。**你的任务、清单、日程永远不离开这台电脑**，也不会上传任何设备信息。 |
| **联网**（仅此一处） | 更新检查会向发布页发一个 GET，取一个静态的版本清单。任何 HTTP 请求都会让对方知道「有人来取过」，但仅此而已，不携带任何业务数据。 |

更新检查**不会**在启动时自动发生，也没有定时轮询：只有用户点「检查更新」才会请求。
下载与安装同样需要用户确认。

### 7.2 一次性准备：生成签名密钥

更新包必须签名——插件会**在安装前校验签名**，这是公开分发时防篡改的关键。

```powershell
npx tauri signer generate -w $HOME\.tauri\todolist.key --password ""
```

会得到私钥 `todolist.key` 与公钥 `todolist.key.pub`。然后：

1. 把**公钥**内容填进 `apps/desktop/src-tauri/tauri.conf.json` 的
   `plugins.updater.pubkey`（已填好本机生成的这一把）。
2. 把**私钥**作为 CI Secret 保存，命名 `TAURI_SIGNING_PRIVATE_KEY`；
   若设了密码再存 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

> ⚠️ **私钥绝不能提交进仓库。** 丢了私钥，已经装过旧版的用户就再也收不到更新，
> 只能手动重装。请离线备份。`.gitignore` 已排除 `*.key`。

### 7.3 配置更新源

`tauri.conf.json` 里两处需要一致（本仓库是 `VitaVance/Kairos`）：

```jsonc
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/VitaVance/Kairos/releases/latest/download/latest.json"],
    "pubkey": "…",                       // 7.2 的公钥
    "windows": { "installMode": "passive" }
  }
}
```

`installMode: "passive"` 表示无人值守安装、安装完自动重启，但仍由用户点击触发。

前端面板的在线/离线判断读的是构建期变量 `VITE_UPDATE_ENDPOINT`；
留空时面板会明确显示「尚未配置更新源」，而不是静默失败。
本地构建时可这样带上：

```powershell
$env:VITE_UPDATE_ENDPOINT = "https://github.com/VitaVance/Kairos/releases/latest/download/latest.json"
pnpm desktop:build
```

### 7.4 发布一版

打 tag 即可。`.github/workflows/release.yml` 会先跑完整门禁，然后：

1. `pnpm tauri:build` 构建**未签名**安装包（同时生成占位的 `.sig`）；
2. 若配置了 `SIGNPATH_API_TOKEN`，把安装包交给 SignPath 做 Authenticode 签名；
3. 用签名后的安装包覆盖原文件，并**重新生成 `.sig`**（顺序原因见 §6.2）；
4. 上传资产并创建 Release（草稿态，确认后手动发布）。

```bash
git tag v0.2.0
git push origin v0.2.0
```

发布后仓库资产的 `latest.json` 就是应用读取的那份，无需另行托管。

### 7.5 离线分发

`plugins.updater` 之外，应用仍支持**离线检查**：用户在面板里选「离线」，
填一个本地 `latest.json` 路径即可比较版本。适合内网或断网机器。

---

## 8. 故障排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `cargo: command not found` / preflight 报 cargo ✗ | 未安装 Rust | `winget install Rustlang.Rustup` 然后 `rustup default stable-msvc`，重开终端 |
| 链接阶段报 `link.exe not found` / `LINK : fatal error LNK1181` | 缺 MSVC C++ 生成工具（只装了 rustup 不够） | 安装 Build Tools 的 C++ 工作负载（见前置条件命令）；确认工具链是 `stable-*-msvc` 而非 `*-gnu` |
| 构建能用但运行报找不到 `WebView2Loader.dll` / 白屏 | 目标机没有 WebView2 Runtime | Win11 自带；Win10 用户用 NSIS 安装包（内含引导程序）或手动装 Evergreen Runtime |
| 安装包文件名/快捷方式显示乱码 | 终端编码不是 UTF-8，或非 ASCII 文件名传给不支持的工具 | 用 Windows Terminal / PowerShell 7；或按第 4 节将分发文件名改为 ASCII |
| 构建时卡在下载 WiX / NSIS 工具，或报网络错误 | Tauri 首次构建需从 GitHub 下载打包工具，网络受限 | 配置代理；或设置环境变量指向镜像/本地缓存；也可在 `bundle` 中设 `useLocalToolsDir: true` 把工具缓存在 `target/.tauri`，便于离线复用 |
| MSI 报 `ProductVersion` 非法 | version 不符合 `major.minor.patch` | 确认 `tauri.conf.json` 的 `version` 为三段式语义化版本（MSI 主/次版本上限 255） |
| 升级后出现两个应用 / 数据丢失 | 改了 `productName` 导致 `UpgradeCode` 变化 | **不要随意改 productName**；若必须改，先固定 `bundle.windows.wix.upgradeCode` |
| SmartScreen 拦截 | 安装包未签名 | 见第 6 节；内部可用自签名，开源项目可用 SignPath Foundation，商业分发购买正式证书 |
| CI 首次构建超时 | 冷编译 Rust 依赖 + 下载工具 | 缓存 `~/.cargo` 与 `apps/desktop/src-tauri/target`；见 `.github/workflows/ci.yml` 的 `desktop` job |
| **双击 exe 弹出一个黑色命令行窗口，关掉它整个应用就退出了** | 二进制的 PE subsystem 是 `CONSOLE` 而不是 `WINDOWS`。`#![windows_subsystem = "windows"]` 被写在了 `src/lib.rs`——那是**库** crate 的 crate 根，对最终 exe 的 PE 头无效 | 把该属性放进 `src/main.rs`（真正的 binary crate 根）。验证方法见下方「验证 subsystem」 |
| **安装包明明生成了，`tauri build` 却退出码 1**，日志末尾是 `A public key has been found, but no private key` | `bundle.createUpdaterArtifacts` 已开启，构建除安装包外还要为每个产物生成 `.sig`。没有私钥时 Tauri **先写出安装包、再在签名步骤失败** | 用封装脚本构建（`scripts/build-desktop.{ps1,sh}` 会自动读取 `$HOME/.tauri/todolist.key`），或手动 `export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/todolist.key)"`。首次需要 `npx tauri signer generate -w $HOME/.tauri/todolist.key` |

---

### 验证 subsystem（可选但推荐）

打包后不必双击试，直接读 PE 头即可确认。`subsystem` 字段在 Optional Header 里，
PE32+ 的偏移是 `0x44`：

```bash
node -e "
const b=require('fs').readFileSync(process.argv[1]);
const pe=b.readUInt32LE(0x3c), opt=pe+24;
console.log('subsystem=', b.readUInt16LE(opt+0x44), '(2=GUI, 3=CONSOLE)');
" "apps/desktop/src-tauri/target/release/todolist.exe"
```

必须是 `2`。如果是 `3`，说明 `windows_subsystem` 属性没生效在二进制上。

> 注意 Tauri 打包时会把自己的 binary 重命名成 `mainBinaryName`（本仓库是
> `todolist.exe`）。**`target/release/todolist-desktop.exe` 才是 cargo 直接产出的**，
> `todolist.exe` 是打包后的副本——两者都应检查，若不一致说明复制的是旧产物。

---

## 9. 相关文件

| 文件 | 作用 |
| --- | --- |
| `apps/desktop/src-tauri/tauri.conf.json` | Tauri 配置：bundle targets、图标、WiX/NSIS 选项 |
| `apps/desktop/src-tauri/Cargo.toml` | Rust 工程与 `[profile.release]` 调优 |
| `package.json` | `desktop:build` / `desktop:build:msi` / `desktop:build:nsis` / `desktop:preflight` 脚本 |
| `scripts/check-toolchain.mjs` | 工具链自检（退出码门禁） |
| `scripts/check-signing.mjs` | 代码签名只读自检（`pnpm desktop:signing-check`，永远退出 0） |
| `scripts/sign-desktop.ps1` | 本地自签名证书生成 + `signtool` 签名 + 验证 |
| `apps/desktop/src-tauri/signing.example.jsonc` | 签名配置模板（`bundle.windows` 片段，不含密钥） |
| `scripts/build-desktop.ps1`、`scripts/build-desktop.sh` | 构建封装脚本 |
| `scripts/ci/noop-tauri-build.mjs` | 发布用的空操作 `tauriScript`，让 `tauri-action` 发布已签名产物而不重建 |
| `.github/workflows/ci.yml` | `desktop` job 在 `windows-latest` 上调用 `pnpm tauri:build` |
| `.github/workflows/release.yml` | 打 tag 时：构建 → （可选）SignPath 签名 → 重签 `.sig` → 发布 |
