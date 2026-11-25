# 发布手册

> 从零到「朋友点链接就能下载安装」的全过程。
> 需要改**代码**的地方已经改完了；这份文档只讲**你需要去 GitHub 上点什么**。

---

## 0. 两条路径，先选一条

| | 无签名（现在就能用） | 有签名（推荐，需要申请） |
|---|---|---|
| 需要做什么 | **什么都不用配** | 申请 SignPath + 配 5 个变量 |
| 用户看到什么 | 「Windows 已保护你的电脑」→ 点「更多信息」→「仍要运行」 | 直接装，显示「Kairos」 |
| 能发布吗 | 能 | 能 |
| 自动更新 | **正常** | 正常 |

**建议先走无签名路径把链路跑通**，确认能发布、能更新，再去申请签名。
申请审批要几周，不该阻塞你发第一版。

---

## 1. 唯一必须配的 Secret（无签名也要）

自动更新靠 `tauri-plugin-updater`，它要验证更新包的签名。
**这个密钥已经在本机生成好了**：

```
C:\Users\EDY\.tauri\todolist.key       ← 私钥（绝不可提交、绝不可泄露）
C:\Users\EDY\.tauri\todolist.key.pub   ← 公钥（已经写进 tauri.conf.json）
```

> ⚠️ **备份这个私钥。** 丢了的后果：已经装了旧版的用户**永远收不到更新**，
> 只能手动重新下载安装。它不在任何云端，只在你这一台机器上。
> 建议复制到 U 盘 / 密码管理器 / 加密备份。

### 配置步骤

1. 打开 https://github.com/VitaVance/Kairos/settings/secrets/actions
2. 点 **New repository secret**
3. Name 填 `TAURI_SIGNING_PRIVATE_KEY`
4. Secret 填**文件的完整内容**（用记事本打开 `todolist.key` 全选复制）

5. 再点 **New repository secret** 加第二个：
   - Name：`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   - Secret：**留空**（这个密钥没设密码）

   留空也要建，因为 workflow 会读它；不存在时会被当成未定义。

### 命令行配置（等价，更快）

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY -R VitaVance/Kairos < ~/.tauri/todolist.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R VitaVance/Kairos --body ""
```

---

## 2. 发布一版

推送一个 tag 就够了：

```bash
git add -A
git commit -m "release: v0.1.1"
git push origin main

git tag v0.1.1
git push origin v0.1.1
```

然后去 https://github.com/VitaVance/Kairos/actions 看 `release` 这个 workflow。

它会依次做：

1. **verify** — 架构边界 / 类型检查 / 全量测试。任一失败就停，不会发布半成品。
2. **publish** — 构建 `.exe` 和 `.msi`，生成签名后的 `latest.json`，创建 **draft release**。
3. 你去 Releases 页面检查一遍，点 **Publish release**。

> **为什么是 draft？** 自动更新读的是 `releases/latest/download/latest.json`。
> 草稿不算「latest」，所以在你手动发布前，现有用户不会收到半成品更新。
> 这是故意的，别关掉。

发布后，已安装旧版的用户打开应用就会看到更新提示。

---

## 3. SignPath 代码签名（可选，消除「未知发布者」）

### 3.1 申请

SignPath Foundation 给**免费开源项目**提供免费的代码签名证书。

1. 打开 https://signpath.org/apply
2. 填仓库地址 `https://github.com/VitaVance/Kairos`
3. 需要仓库是**公开**的且有 **OSI 认可的许可证** —— 你用的是 MIT，✅ 符合
4. 审批通常要 **1–3 周**

### 3.2 拿到 5 个值

审批通过后，在 SignPath 后台创建：

| SignPath 里的东西 | 对应 GitHub 变量名 | 举例 |
|---|---|---|
| Organization ID（一串 UUID） | `SIGNPATH_ORGANIZATION_ID` | `a1b2c3d4-…` |
| Project slug | `SIGNPATH_PROJECT_SLUG` | `kairos` |
| Signing policy slug | `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing` |
| Artifact configuration slug | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | `windows-installers` |
| API token（这个算密码） | `SIGNPATH_API_TOKEN`（**Secret**） | `xxx…` |

前四个是 **Variables**（公开标识），最后一个是 **Secret**。

### 3.3 配置

**Variables**：https://github.com/VitaVance/Kairos/settings/variables/actions
**Secret**：https://github.com/VitaVance/Kairos/settings/secrets/actions

```bash
gh variable set SIGNPATH_ORGANIZATION_ID          -R VitaVance/Kairos --body "<uuid>"
gh variable set SIGNPATH_PROJECT_SLUG             -R VitaVance/Kairos --body "kairos"
gh variable set SIGNPATH_SIGNING_POLICY_SLUG      -R VitaVance/Kairos --body "<policy>"
gh variable set SIGNPATH_ARTIFACT_CONFIGURATION_SLUG -R VitaVance/Kairos --body "<config>"
gh secret   set SIGNPATH_API_TOKEN                -R VitaVance/Kairos
```

**五个里有任何一个没配，workflow 会自动跳过签名并照常发布**（构建不会失败）。
这是刻意设计的：签名是增强，不该变成发布的单点故障。

### 3.4 签名顺序（已在 workflow 里处理，这里只是解释）

这是最容易搞错的地方，所以写清楚：

1. Tauri 构建 → 生成未签名的 `.exe` 和它的 `.sig`（更新签名）
2. SignPath 给 `.exe` 盖上 Windows 的 Authenticode 签名 → **文件字节变了**
3. **必须重新生成** `.sig`，因为它签的是文件字节

顺序颠倒的话，安装包和它的 `.sig` 对不上，所有已安装用户都会**静默拒绝更新**。
workflow 的 `Re-sign updater artifacts` 这一步就是干这个的，别删。

---

## 4. 检查清单

发布前逐项打勾：

```
[ ] TAURI_SIGNING_PRIVATE_KEY 已配置
[ ] TAURI_SIGNING_PRIVATE_KEY_PASSWORD 已配置（可以是空值）
[ ] 私钥已离线备份（U 盘 / 密码管理器）
[ ] 应用内「关于」的版本号 = 这次要打的 tag
[ ] gh run list 里上一次 CI 是绿的
```

发布后验证：

```
[ ] Actions 里 verify 和 publish 都是绿的
[ ] Releases 里能看到 draft，两个安装包都在
[ ] 下载 .exe 装上，能启动
[ ] 数据目录 C:\Users\<你>\AppData\Roaming\app.todolist.local\todolist.db 生成了
[ ] 点「发布」让 draft 变成 latest
[ ] curl https://github.com/VitaVance/Kairos/releases/latest/download/latest.json 返回 200
```

最后一条是关键：它证明自动更新的地址是通的。

---

## 5. 常见失败

| 现象 | 原因 | 处理 |
|---|---|---|
| `A public key has been found, but no private key` | 构建时缺 `TAURI_SIGNING_PRIVATE_KEY` | 本地构建需 `export`；CI 需配 secret |
| release 里没有 `latest.json` | `createUpdaterArtifacts` 被关掉 | 检查 `tauri.conf.json` 里是 `true` |
| 用户装了新版却还提示更新 | `latest.json` 的版本号 ≤ 应用版本 | 确认 tag 和 `tauri.conf.json` 的 `version` 一致 |
| SignPath 步骤失败但其他都绿 | 五个值有一个不对 | 看日志里 `Authenticode signing disabled. Unset: …` 那行列出了缺哪个 |
| 安装时提示「未知发布者」 | 没配签名 | 正常，见第 3 节 |

---

## 6. 本地构建（不走 CI）

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/todolist.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
pnpm desktop:build:nsis
```

产物在 `apps/desktop/src-tauri/target/release/bundle/nsis/`。
本地构建**永远是未签名**的——Authenticode 私钥在 SignPath 的 HSM 里，导出不来。
只有 CI 出的包才有 Windows 签名。
