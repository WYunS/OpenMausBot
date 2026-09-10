# 锐捷 Bot：Windows 打包指导

本文件可直接交给另一位打包者。只针对 **Bot**，不是锐捷 Harness；不要使用
Harness 的 Yarn、2.1.6 版本号、DSH profile 或打包脚本。
与本目录另外三份文件配套使用。编写基线：2026-09-10，功能修复提交 `580b38a8`。

## 1. 取得唯一交付源码

公开仓库：<https://github.com/WYunS/OpenMausBot>。
本轮交付分支：`codex/openmaus-upgrade-0.1.71-ready`。**不要默认下载 main**：
它可能仍是上游内容，且更新 main 的版本号可能触发现有 Release 自动工作流。
打包前从交付人取得最终完整 commit SHA，Windows、Mac 必须使用同一 SHA。

在自己选择的父目录运行（已有检出则不要重复 clone）：

```powershell
git clone --branch codex/openmaus-upgrade-0.1.71-ready https://github.com/WYunS/OpenMausBot.git OpenMausBot
Set-Location -LiteralPath ./OpenMausBot
```

以下命令要求 **PowerShell 7.4+、Windows x64、Node.js 24.x、Corepack**。
pnpm 版本由 package.json 的 `packageManager` 锁定，当前为 10.33.0。
不要用碰巧在 PATH 上的 pnpm 11 代替，它会忽略旧位置的跨架构依赖配置。

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$repoRoot = (git rev-parse --show-toplevel).Trim()
Set-Location -LiteralPath $repoRoot
git status --short
git rev-parse HEAD
git remote -v
node --version
node -p 'process.arch'
corepack pnpm --version
node -p 'require("./package.json").version'
```

当前 Bot 版本为 **0.1.71**；正式版本以当前 SHA 的 package.json 为准。
不能把 Harness 的 2.1.6 填进去，不能为让命令通过临时修改版本号或锁文件。
同版本若已公开发布且字节不同，须先协调新版本提交，禁止覆盖既有资产。
已有改动归原作者所有；不要 reset、强制 checkout 或删除用户数据来清场。

## 2. 打包前必读

- 发布配置必须用根目录 `electron-builder.ruijie.mjs`，它读取上游完整资源规则，
  只把更新源改为 `WYunS/OpenMausBot`。不要直接使用 `pnpm package:win`，
  该原始命令仍使用上游更新源；也不要运行上游 Release/镜像发布工作流。
- 产品窗口和快捷方式叫“锐捷Bot”，兼容身份仍为 `com.openmausbot.app`，
  内部 productName 和产物前缀目前为 `OpenMausBot`。不要擅改 App ID 或安装目录。
- 安装版 Electron 数据目录是 `%APPDATA%/锐捷Bot Installed`，服务数据在其
  `server-data`；源码开发版使用独立目录。新安装版看不到开发版会话不等于清空数据。
  不要复制加密凭据文件来做迁移，不要将个人 profile、Gmail、飞书 token 打入包。
- `enterprise/` 使用单独许可证，不是 Apache-2.0；打包脚本在目录存在时会带入它。
  内部生产使用、对外分发、白标的授权应由发布负责人核实，保留 LICENSE/NOTICE，
  不得绕过许可检查。源码上传不等于获得安装包再分发授权。

## 3. 不需要从零编译所有第三方组件

Electron、Chromium、agent-browser、CUA、cloudflared 使用锁定的预编译发行文件。
正常打包不需要装 Rust 去重编译浏览器，也不需要重编译 Harness。
依赖仓库缓存、下载缓存可复用，但最新 Bot 的 UI、server、companion、updater
必须重新生成。旧 release/win-unpacked 不是新源码的构建结果。

标准可复现路径（不清空整个工作区或下载缓存）：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
node --test electron/ruijie-package-config.node-test.mjs electron/local-windows-launcher.node-test.mjs
corepack pnpm test:packaged-server
corepack pnpm package:prepare
corepack pnpm build:cua:windows
corepack pnpm exec electron-builder --config electron-builder.ruijie.mjs --win --x64 --publish never
```

`package:prepare` 包含 UI/server/companion/updater、Android 工具、cloudflared、
浏览器资源准备。任何一步非零退出就停止，不能跳过 afterPack。
仅在同一 SHA、锁文件、平台、配置和生成物都有可核对构建记录时，才允许续跑
最后的 electron-builder；换人、换提交或生成物来历不明，一律重新生成自己的 JS。
下载失败时修复网络/代理或提供脚本支持的校验缓存，不关闭 TLS 或哈希校验。

Windows 浏览器必须是 `0.36.0-omb.1`，不是未修复 stdio 继承问题的上游 0.37.0。
Mac/Linux 则使用源码各自的 pin。完整 staged tree 包含 agent-browser、Chrome
Headless Shell、manifest 和 licenses，不能只复制一个 exe。
默认 Windows 无代码签名，准确报告“未签名”；不得添加虚假的 publisherName。

## 4. 检查实际打出的资源，不只检查文件名

```powershell
$resources = Join-Path $repoRoot 'release/win-unpacked/resources'
@('app.asar','app-update.yml','ui/index.html','server/index.js',
  'server/ruijie-computer-proxy.js','companion/index.js','cua-driver.exe',
  'cloudflared/cloudflared.exe','browser-engine/manifest.json',
  'browser-engine/agent-browser.exe','tuantuan-feishu/index.mjs') |
  ForEach-Object { if (-not (Test-Path -LiteralPath (Join-Path $resources $_))) { throw "Missing resource: $_" } }
Get-Content -LiteralPath (Join-Path $resources 'app-update.yml')
node scripts/smoke-browser-bundle.mjs --resources $resources
$env:OMB_SMOKE_DIST = Join-Path $resources 'server'
try { node scripts/smoke-packaged-server.mjs --browser-bundle (Join-Path $resources 'browser-engine') }
finally { Remove-Item Env:OMB_SMOKE_DIST -ErrorAction SilentlyContinue }
```

`app-update.yml` 必须为 GitHub / owner WYunS / repo OpenMausBot。
浏览器 smoke 必须实际运行，`--check-only` 只算结构检查。
额外的最小源码回归：

```powershell
corepack pnpm exec vitest run server/browser-navigation.test.ts server/browser-live.test.ts server/browser-runtime.test.ts server/drivers/ruijie-harness-local.test.ts server/drivers/ruijie-harness.test.ts server/retained-computers.test.ts src/components/BrowserPanel.test.ts src/components/ModelPicker.test.ts src/components/SidebarBotListItem.test.ts
```

完整 HTTP 回归命令为 `corepack pnpm exec vitest run server/index.test.ts`，可能需要数分钟。
跳过项应写明原因。通过源码测试不等于安装版验收通过。

## 5. Windows 安装版真人验收

使用专用测试系统账户；只有获得本次授权才安装/覆盖，先备份该测试账户。

1. 安装 `release/OpenMausBot-<版本>-setup.exe`，从安装快捷方式打开，不从源码脚本打开。
   记录程序路径、版本、SHA。安装目录无源码/node_modules 仍能启动。
2. 启动有 RJ 加载反馈，不应长时间无解释黑屏；登录页写锐捷Bot。普通启动不弹出
   Harness 窗口，也不把已安装未运行的 Harness 置灰或挡住模型列表。
3. 另行安装兼容 Harness（本轮接口基线 2.1.6），它不包含在 Bot 安装器中。
   主动用 Harness 发消息才启动后台桥接；使用安装版账号额度，不硬编码开发路径。
   默认 V4 Flash / low，Bot 固定 none/low/medium/high/xhigh/max 档位向合法值映射。
   含图片的请求不可误发非视觉模型；每个 GPT/Claude/DeepSeek 抽测必要档位和图片。
4. “没有电脑”和“这台电脑”分别打招呼；后者实际执行一项无害截图/输入工具。
   不得再出现 schema mount、stderr pipe 导致子进程退出的错误。
5. 开启浏览器权限后查看画面、接管、访问本地测试页或当前网络可达网站、输入、交还、
   刷新重连；同一个全屏按钮进入/退出，不依赖 Esc。网页不可达不应锁死操作。
   无外网时 Google 搜索失败不能冒充产品失败，也不能冒充已验证 Google 成功。
6. 只删除新建的临时 Bot：即使关联电脑离线也能删，界面显示“正在删除”；
   独立电脑不随之销毁，可能继续运行/计费；应明确提醒去设置或服务商管理。
   正在执行/创建电脑/保存凭据等状态仍需安全收尾。
7. 已归档在工具的下一级；插件品牌图标显示，已授权测试 Gmail/飞书连接在升级和刷新后
   保留。飞书原生连接器目前是 Windows 能力，授权必须由测试者本人完成。
8. Local VM 是可选外部容器运行时，不承诺安装器自带 Podman/虚拟机镜像。
   未配置时提示真实原因；已配置时抽测，不能把缺组件包装成“所有电脑都可用”。

详细浏览器隔离复现见 `docs/verification/browser-live.md`；本轮已完成的源码/Windows
证据见 `docs/verification/ruijie-browser-delete-2026-09-10.md`，不能继承为新安装包结论。

## 6. 交付记录与放行

```powershell
$version = node -p 'require("./package.json").version'
$installer = Join-Path $repoRoot "release/OpenMausBot-$version-setup.exe"
Get-Item -LiteralPath $installer | Select-Object Name,Length
Get-FileHash -Algorithm SHA256 -LiteralPath $installer
Get-AuthenticodeSignature -LiteralPath $installer | Select-Object Status
git rev-parse HEAD
git status --short
```

交付安装器、对应 blockmap/latest.yml（需要后续自动更新时）、SHA-256、完整 commit、
工具版本、签名状态、验收报告。`--publish never` 不上传资产，本指南不授权发布 Release。
自动更新发布另需同版本资产、feed、size/hash 一致，并确认所有入口指向 WYunS。
不能拿旧安装器改文件名交付，不能把压缩便携包说成 NSIS 安装版。
报告只写“通过/失败/环境阻塞/未执行”；核心启动、数据、工具、安全失败时不放行。
