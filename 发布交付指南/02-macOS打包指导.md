# 锐捷Bot：macOS Universal 打包指导

## 2026-09-14 补充：默认云沙箱随私密源码交付

本次已增加跨平台的沙箱预置导入与打包流程，**不包含 Universal 原生资源改造**；下文 Universal 待实施边界不变。
维护者交付的私密 `RuijieBot-source-<SHA>.tar.gz` 包含 `release-inputs/ruijie-sandbox.json`；
公开 WYunS/main 不含密钥，仅从 GitHub clone 时须另收这一个私密文件，不能借打包者的 Keychain、SSO 或 cookie。
归档不含 `.git`：解压后先 `git init && git add . && git commit -m "Import authorized source handoff"`；
原始来源 SHA 见 `release-inputs/handoff.json`，此后按本机实际工作树生成新的验收记录。

标准 `pnpm package:mac` 自动先运行 `pnpm build:sandbox`。缺失或非法输入立即阻断；
手工构建前可执行 `node scripts/prepare-ruijie-sandbox-bootstrap.mjs`，或用
`RUIJIE_SANDBOX_PRESET_FILE` 指向受控文件。禁止改用上游配置绕过预置和原有发布门禁。
安装资源为 `.app/Contents/Resources/ruijie-sandbox/bootstrap.json`，首启使用当前用户 Keychain
支持的 Electron safeStorage 保存凭据，manager URL 保存至 `~/.ruijiebot/config.json`；
Windows 的 credentials.bin 不能复制来充当 Mac 的运行凭据。

新建 Bot 默认云端/锐捷沙箱；保留已有连接及主动清除意图，不覆盖其他账号或软件。
预置限定 `attach_only: true`，只带 client_id/vnc_key/minio_url，不能夹带 models/custom_env 密钥；
已有桌面消失时请管理员恢复，安装端不会自动重建或改变对面的环境。
飞连/内网可达是前提；同一模板共享同一桌面，各安装实例之间无中央排队。
配置、私密源码归档和含共享凭据的安装器仅交授权人员，不上传公开 GitHub/Release。
本机 Windows 测试不代表 Mac Keychain、签名后运行或最终 DMG 已验收，必须执行第三份指南新增测试。

本地编译预览与安装版现在共用预置导入和加密凭据保存；同地址、缺凭据的旧配置可补齐，
但已有自定义连接及显式清除标记不覆盖。Mac 仍须独立测连续重开、钥匙串持久化与真实画面，
不能以 Windows 客户端通过替代 Mac 验收。

> 2026-09-11 文档状态：**Universal 交付规范，尚未实施或验收**。
> 当前代码基线为 `d7cd142712c11f44a7a13d9e75c8d31ad9799891`，仍按 arm64/x64 分架构打包。
> 本次只保留文档修改，源码、构建配置和 Actions 没有合入 Universal 改造，也没有打包。
> 已有 Mac 飞书基础适配与分架构运行时不等于 Universal 已可用；签名后运行、真实授权和 TCC 仍待验。

交付目标是 **一个 Universal DMG，同时支持 Apple Silicon（M 系列）和 Intel**。
目标是同一个 `.app` 内含双架构 Electron/Helper，原生侧车带齐两套并按运行架构选用。
Bot 版本以 package.json 为准；本指南不是 Harness 打包指南，
不要照搬 Harness 版本号、Yarn 或 `cn.com.ruijie.dsh.desktop` 身份。
先读本目录签名策略，最终交付按 `03-macOS真人验收测试指导.md` 验收。

## 0. 当前状态与执行边界

当前 `electron-builder.yml` 的 DMG/ZIP 目标仍为 `arch: [arm64, x64]`；
锐捷配置继承这个目标。直接运行现有 `pnpm package:mac` 不会得到合格的 Universal 包。
资源当前在平面 `Resources` 目录按架构复制，hooks 与 Release 资产规则也仍按分架构工作。
把文件名改成 universal、只加构建器参数或把两份 DMG 压在一起，均不满足本指南。

后续执行者须先取得源码/流程实施授权，完成第 2.1 节并通过无安装器预检；
再取得候选构建授权，才执行下文打包命令。文档任务到文字核对为止，不能自动升级为实施、
运行 Actions、构建、提交、推送或发布。正式分发还须独立完成最终 DMG 的真人验收。
先读 [通用回归与发布门禁](04-通用回归与发布门禁.md)，其中“待实施”要求不能当成已生效门禁。

## 1. 源码与环境

公开仓库 <https://github.com/WYunS/OpenMausBot>，正式交付入口为它自己的 `main`。
从该分支固定完整 SHA；Mac 与 Windows 一致，不使用作者仓库的 main 或旧修复分支替代。
普通 main 推送不自动生成安装器；Release 仅保留手动入口，其上游发布/镜像步骤须另行审查。
可在自己的任意可写路径检出，以下从仓库根目录执行：

```bash
git clone --branch main https://github.com/WYunS/OpenMausBot.git OpenMausBot
cd OpenMausBot
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
git status --short
git rev-parse HEAD
node --version
corepack pnpm --version
node -p 'require("./package.json").version'
xcode-select -p
```

要求原生 macOS、Node 24.x、Corepack 管理的 pnpm 10.33.0、Xcode Command Line Tools。
不要从 Windows 交叉打出 DMG 就声称 Mac 可用。安装 Swift speech helper 需要本机 Apple
工具链，但 Electron、CUA、Chromium、cloudflared 使用锁定预编译文件，不从零编译。
不要覆盖已有开发现场；新打包者优先用独立干净检出，保留可校验下载缓存。

## 2. 发布配置和许可

始终用 `--config electron-builder.ruijie.mjs`，更新源才是 `WYunS/OpenMausBot`。
`pnpm package:mac` 已接入锐捷配置和现有单架构门禁，但尚未接入 Universal；
先完成下节，再使用该入口。不要改用上游配置或删除 hook 来绕过失败。
不要替换 appId；内部 App 仍叫 OpenMausBot.app，窗口叫锐捷Bot，DMG/ZIP 前缀为 RuijieBot。
安装版服务数据使用当前 macOS 用户主目录的 `~/.ruijiebot`，源码开发版仍使用
`~/.openmausbot`；不要把 Windows 的盘符或用户名写死到 Mac 构建中。
`enterprise/` 是单独许可，构建时会纳入；生产使用/分发许可须由发布负责人核实。

当前代码不会因“有 Harness 许可证”自动获得 Bot Enterprise 许可。不得移除许可证
或绕过 feature gate；如要改为纯 OSS 发行，那是另一次明确的发行配置变更和验收。

### 2.1 Universal 待实施清单（获授权后执行）

按顺序落实下表；每行都有代码差异与测试证据后，才能标记该行完成。本次文档更新不勾选这些项目。

| 改造对象 | 必须完成的改造 | 完成条件 |
|---|---|---|
| 锐捷构建配置 | DMG/ZIP 均改成 `arch: [universal]`，使用 ASAR 合并；产物名按第 5 节。优先限定在锐捷 Mac 配置，保留 Windows/Linux 行为 | 配置回归证明只选择一个 Universal 目标；Windows 安装器、品牌、数据身份和资源路径不变 |
| 原生资源布局 | 两个合并输入都携带第 5 节规定的两棵相同 native 树；共同 JS、许可和 speech helper 保留公共位置 | 两树完整且来源可核验，不受本机架构或 partial 环境变量影响；共有 Mach-O 自身为 Universal |
| 运行时选取 | 修改 CUA、浏览器、飞书、隧道及所有服务端/子进程资源读取入口，按 Electron 的 `process.arch` 选树；签名信任根仍指向真正 App | arm64、x64、Rosetta、缺文件/错架构和开发/安装隔离都有回归；不借 PATH/Homebrew 或下载兜底掩盖缺资源 |
| 签名前 hooks | `check-ruijie-release-readiness.mjs` 联合验证两份 Mac receipt；`after-pack.mjs` 处理两个输入及最终 Universal 结果 | 缺任何架构凭据/资源、源码指纹或共用 JS 摘要不一致、哈希/许可失败均阻断；合并结果不再被当成未知架构 |
| 合并及签名 | 根据锁定的 electron-builder 版本配置合并例外，保留固定哈希侧车；新增可复用的 afterSign/最终 App 架构与完整签名门禁 | 正式 Mac 缺 Developer ID 即失败，所有代码对象验签、同 Team；ad-hoc 单独标为内部候选，不放宽飞书校验 |
| 检查脚本与更新 | 让 `smoke-browser-bundle.mjs` 等工具识别新布局；复核 `regenerate-mac-feed.mjs`、更新器和全部资产白名单 | 同一个 Universal ZIP 被两 CPU 选中；feed 拒绝夹杂旧分架构文件，大小/摘要对应最终字节 |
| GitHub Actions | 修改 `.github/workflows/release.yml` 和 `sync-published-release.yml` 的 App 路径、签名、公证、ZIP、别名、上传/镜像核验；保留无安装器预检的原生矩阵 | Mac 只生成一份 DMG/ZIP；更新 owner 是 WYunS；上游仓库/镜像步骤先审查并按本产品需求处理，不误上传作者仓库 |

合并例外只针对 `Contents/Resources/native/darwin-{arm64,x64}/**` 两棵树；
使用 `mergeASARs` / `x64ArchFiles` 时必须按锁定构建器验证实际匹配范围和 hooks 时序。
Electron/Helpers 必须真正包含 arm64、x86_64，不能扩大例外让单架构主程序混过检查。
固定哈希的飞书 CLI/Node 等侧车保留各自原始字节，不为凑 Universal 强行 lipo。
当前代码尚无 `scripts/verify-mac-universal.mjs`，也不支持 `darwin-universal` 验收 CLI 目标；
如后续新增此类入口，应连同测试与文档一起提交，不能照不存在的命令声称检查通过。

现有 `regenerate-mac-feed.mjs` 只按已有清单重算摘要，不会把分架构列表自动变成 Universal。
现有 Release 还遍历 `release/mac-arm64` / `release/mac`，并带上游 owner/镜像假设；
必须一并改造，不能只改打包目标就手动触发旧工作流。

预检使用 `.github/workflows/verify-ruijie-prerelease.yml` 的
`Ruijie pre-package verification (NO INSTALLERS)`，执行时记录固定 SHA 和实际 runner 架构。
它已有 arm64/x64 原生检查，但不生成 App、安装器或发布凭据，也未替上述新增实现完成验证。
补上新路径、双树/签名负例、更新选择回归后，在两种原生 runner 执行；飞书真实授权、
签名后的运行与持久 TCC 仍留到专用 Mac 账户。Actions 绿灯不替代最终安装验收。

## 3. 构建共用资源

以下是获授权后的资源准备步骤，不是在文档任务中执行的命令；资源准备成功也不表示 Universal 已实现。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
node --test electron/ruijie-package-config.node-test.mjs
corepack pnpm test:packaged-server
corepack pnpm package:prepare
corepack pnpm build:speech
corepack pnpm build:cua
corepack pnpm build:feishu:mac
```

默认准备两种架构；pnpm 10 从 package.json 的 supportedArchitectures 安装对应原生包。
`--current` / CUA 的 partial 模式只用于本机预检，不能用于 Universal 资源准备。
打包前两份 `darwin-arm64` / `darwin-x64` 原生验收凭据必须绑定同一源码指纹与共用 JS 摘要。
缺 `@trycua/cua-driver-darwin-*` 时检查包管理器/锁文件，不复制 Windows 的 `.node`。
浏览器使用 Mac 的平台 pin；Windows `0.36.0-omb.2` 不能拷进 Mac。
第 2.1 节改造后，`afterPack` 必须对两个合并输入和最终 Universal App 都核对两套资源的来源哈希、架构、manifest 与许可证。
新增 `afterSign` 必须再检查完整签名和双架构；正式 Mac 路线要求缺证书即失败，不允许静默跳过签名。
全新安装版 profile 必须默认显示内置浏览器；用户已明确关闭时仍保持关闭。
设置窗口关闭按钮的尺寸与点击区域属于共用 UI 修复，Mac 构建不得换回旧版 `dist`。

变更了 Bot UI/server/companion/updater 就重建这些 JS；不用重编译 Harness。
只有 SHA、锁文件、平台/架构、配置和前序生成物全部可核对时才能复用构建断点。
同一 DMG 的验收脚本修正可续验；产品或依赖变更则是新候选，不能继承旧 DMG 结论。

## 4. 选择准确的签名路线

以下候选命令仅在第 2.1 节实现、对应回归和原生预检已完成，且另获打包授权后执行。

### A. 已有自己的 Developer ID（正式分发）

发布人员在受保护构建环境中配置自己获授权的 Developer ID；不要复制上游作者证书
或 Team ID。以下命令不会自动完成公证：

```bash
corepack pnpm exec electron-builder --config electron-builder.ruijie.mjs --mac --publish never
```

执行前确认修改后的默认目标是 Universal；当前未改造配置不满足这个前提。
不追加 `--arm64` / `--x64` 改回分包。构建器内部生成 x64/arm64 临时输入，
合并后交付一个 App；内部两次构建不代表交付两个 DMG。

源码 mac.notarize=false：先验证 `.app` 和全部嵌套代码签名，再由发布人员通过自己的
notarytool Keychain profile 提交 DMG/ZIP，等待 Accepted，staple `.app` 和 DMG。
staple 后按第 2.1 节已改造并复核的流程重新生成 Universal ZIP、blockmap、latest-mac.yml，
不能直接执行当前旧 release.yml 的双架构路径和上游/镜像发布步骤。最终哈希必须在所有字节变化结束后计算。

### B. 无 Developer ID（内部测试候选）

明确使用 ad-hoc，而不是把 identity=null 的完全未签名产物称为已签名：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false corepack pnpm exec electron-builder \
  --config electron-builder.ruijie.mjs --mac --publish never \
  -c.mac.identity=- -c.dmg.sign=false
```

该路线准确状态为 `ad-hoc signed, not notarized`，不是正式公证分发。
待实现的签名门禁只能在显式内部 ad-hoc 路线下允许该签名类型，仍逐个验证 Mach-O 和主 App，
报告必须标为“内部候选，不允许正式分发”；不能把缺证书自动降级成内部通过。
飞书对重新签名字节的替代校验仍要求 Developer ID，同 Team 规则不为内部包放宽；
ad-hoc 不能替代正式飞书签名后验收。无正式证书时先做无安装器预检，不伪造正式通过记录。
必须逐个验签真实 Mach-O、外层 `.app`，并通过普通实体 Mac 的 TCC 验收。
electron-builder 成功退出不证明签名闭包通过。若内嵌 CUA/浏览器缺签或权限循环，
停止放行，记录问题，不把关闭 Gatekeeper/删除 quarantine/重置所有 TCC 当修复。
内部包能否给员工安装由发布负责人决定，本指南不默认授权改变系统安全策略。

### C. 屏幕录制反复授权不能只看“已签名”

屏幕录制属于 TCC；公证/Gatekeeper 通过不等于系统已授予或持续识别该权限。
先记录完整弹窗、macOS 版本、同版/升级、安装路径与实际责任进程，再按
[签名策略第 5.1 节](macOS代码签名与TCC身份策略.md#51-屏幕录制重复授权的定向诊断) 排查。
代码的 embedded CUA 失败后可尝试已有 standalone CuaDriver，两者授权身份不同；
需记录实际模式，不能因机器早已安装并授权 CuaDriver 就算包内 CUA 通过。
同版、同位置已允许后，每次截图/退出重开仍反复请求，或者拒绝后持续弹窗，都阻断交付。
系统版本规定的周期性复核应按弹窗原文单列，不与每次操作的权限循环混为一谈。
Developer ID 需核对签名闭包与稳定 requirement；ad-hoc 的跨版本身份不能视作同等保证。
GitHub Actions 不保存用户持久 TCC 状态，最终必须按真人指南完成重复操作与覆盖升级测试。

## 5. 产物及安装形态检查

以下名称、路径和命令适用于第 2.1 节完成后的目标布局，不描述当前代码已生成的产物。

最终 App：`release/mac-universal/OpenMausBot.app`。
交付安装器：`RuijieBot-<版本>-mac-universal.dmg`；自动更新包：`RuijieBot-<版本>-mac-universal.zip`。
稳定下载别名只有 `RuijieBot.dmg`，是同一个 DMG 的副本；ZIP 不要求普通用户另行下载。
`latest-mac.yml` 只列该 Universal ZIP/DMG，两个 CPU 使用相同更新字节。
不要留下旧架构 DMG/ZIP 混入上传列表；Windows ZIP 名称保持原样。

包内公共代码位于 `Resources/{ui,server,companion,tuantuan-feishu}`；
双原生树须固定为 `Resources/native/darwin-arm64` 和 `Resources/native/darwin-x64`，每树包含：
`cua-driver`、`cua-sdk`、`cloudflared`、`browser-engine`、`tuantuan-feishu-runtime`。
运行时须按 **Electron 的 process.arch** 选择；Rosetta 下选 x64，不按硬件型号或“哪个文件存在”猜测。
共享 speech helper 和共享目录中的其他 Mach-O 必须自己就是 Universal。
`x64ArchFiles` 例外仅覆盖上述两棵 native 树；它们在合并输入中保持相同字节，
不对固定哈希的飞书 CLI/Node 强行 lipo，也不把例外扩大到 Electron/Helpers。

```bash
APP_PATH="$REPO_ROOT/release/mac-universal/OpenMausBot.app"
RESOURCES="$APP_PATH/Contents/Resources"
APP_EXECUTABLE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist")
lipo -verify_arch arm64 x86_64 "$APP_PATH/Contents/MacOS/$APP_EXECUTABLE"
lipo -verify_arch arm64 x86_64 "$RESOURCES/OpenMausBot Speech.app/Contents/MacOS/speech-helper"
for arch in arm64 x64; do
  NATIVE_ROOT="$RESOURCES/native/darwin-$arch"
  expected_arch="$arch"
  if [ "$arch" = x64 ]; then expected_arch=x86_64; fi
  test -d "$NATIVE_ROOT/cua-sdk"
  test -f "$NATIVE_ROOT/browser-engine/manifest.json"
  test -f "$NATIVE_ROOT/tuantuan-feishu-runtime/manifest.json"
  test "$(lipo -archs "$NATIVE_ROOT/cua-driver")" = "$expected_arch"
  test "$(lipo -archs "$NATIVE_ROOT/cloudflared/cloudflared")" = "$expected_arch"
  test "$(lipo -archs "$NATIVE_ROOT/browser-engine/agent-browser")" = "$expected_arch"
done
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH"
codesign -dr - "$APP_PATH"
cat "$RESOURCES/app-update.yml"
```

这些原生命令是基础检查，不是完整放行器：还须按签名策略第 3 节枚举所有 Helper、Framework、
CUA SDK 原生模块、Chromium、飞书 CLI/Node 和其他 Mach-O，检查架构、签名、Team 及许可。
第 2.1 节应把完整检查接入自动门禁；不能只凭主程序和少数侧车抽查通过就放行。

浏览器检查也须先完成新资源布局适配，再运行以下已有脚本。`APP_ARCH` 从安装版/候选
Electron 的实际运行记录填写；原生 M 系列为 arm64，原生 Intel 为 x64，Rosetta 单列。
外部 Node 的架构必须与这次实测进程一致，不能按打包机器的 Node 推断用户应用架构：

```bash
APP_ARCH=arm64  # Intel 原生测试填写 x64；须与本次 Electron 运行记录一致
test "$(node -p process.arch)" = "$APP_ARCH"
NATIVE_RESOURCES="$RESOURCES/native/darwin-$APP_ARCH"
# 仅在本脚本已按第 2.1 节适配双树后执行；当前脚本仍读取平面 browser-engine。
node scripts/smoke-browser-bundle.mjs --resources "$RESOURCES" --target "darwin-$APP_ARCH"
OMB_SMOKE_DIST="$RESOURCES/server" node scripts/smoke-packaged-server.mjs \
  --browser-default-enabled --browser-bundle "$NATIVE_RESOURCES/browser-engine"
```

核对更新 owner WYunS；检查 ui/index.html、server/index.js、ruijie-computer-proxy.js、
companion/index.js、speech helper、cua-driver/cua-sdk、cloudflared、browser-engine、licenses。
Mac tuantuan-feishu 已接入主进程/预加载桥、arm64/x64 Mach-O 与 tar.gz、私有目录和包内依赖。
`build:feishu:mac` 为两个架构分别生成 `dist-native/feishu-runtime/darwin-<arch>`，
只准备当前架构可用 `node scripts/prepare-feishu-runtime.mjs --current`。
许可清单已有独立 Mac arm64/x64 精确记录，复核见 `connectors/feishu/licenses/MAC_AUDIT.md`；
包含 go-keyring 平台增量通知与两个限定 MPL 例外，不自动继承 Windows 或未来哈希。
许可工程复核不等于运行代码已在 Mac 验收通过；打包仍需原生与签名后证据。
包内 CLI/Node 不可缺失或借用 Homebrew/PATH；签名前验来源哈希，签名后验主 App 闭包和同 Team。
同时复测默认中文回复、浏览器后台恢复及 Harness“继续”上下文；不要只测启动页面。
中文规则存在与真实回复合格分开记录；欢迎语、进度、最终回复分别检查，不能只看最后一句中文。
浏览器额外执行通用指南第 2 节的 MCP 优先和 `--viewer-first` 两种启动顺序：
人工/机器人交替操作不得因 daemon 超时配置不同而重启或断流。arm64/x64 Actions 分别运行，
Windows 的通过不能替代 Mac；最终签名安装版仍须连续 60 秒原流和接管/交还验收。
公开插件服务地址可通过 `RUIJIE_COMPOSIO_BROKER_URL` 烘焙进包，必须与验收记录一致；
禁止把项目 API key、个人安装 token 或 VPN 配置写进元数据。
服务自身要求代理时允许用户使用代理；必须按通用指南验证离线首启、开启代理后点击重试、
连接入口恢复和只读调用，不以重新安装代替恢复，也不要求本轮部署自建服务。
按通用指南补运行时、资源、路径、架构和签名验证；其他功能逐项按 Mac 原生证据验收。

上述只验证 unpacked tree。必须挂载**最终 DMG**，从其中 `.app` 重做架构、资源和完整签名检查；
已公证包还要 `xcrun stapler validate` 与 `spctl --assess --type execute`。
把 DMG 内容安装到获授权测试账户的 Applications，再执行真人指南，不能启动源码替代。
M 系列与 Intel 必须测试 **SHA-256 相同的最终 DMG**；两份分别重打的包不能证明一个 Universal 包兼容两者。
签名后的原生文件哈希会变，不能拿签名前的 vendor 文件哈希判签名包损坏。
Finder/DMG 图标输入为 `build/icon.icns`，运行时 Dock 使用 `electron/resources/app-icon.png`；
两者均应为产品图标。Windows 开发运行时的 Electron 原子图标不属于 Mac 打包输入。

## 6. 交付和不能声称的结论

打包必须保留 `package:prepare` 生成的 desktop-build.json：beforePack 检查当前源码与构建内容，
afterPack 检查实际包内 UI/server，拒绝旧产物。开发预览与安装包共用编译内容/固定依赖，
但数据身份仍独立；Windows 预览不替代 Mac 原生和签名后的验收。

```bash
git rev-parse HEAD
git status --short
shasum -a 256 release/*.dmg release/*.zip
```

交付记录：完整 SHA、Bot 版本、Universal 目标及两个实际测试架构、Node/pnpm、构建配置、签名类型/Team ID、
公证状态、最终 DMG/ZIP SHA-256、静态审计与真人报告。不得包含私钥、token、账户信息。
需要自动更新时另交 post-staple 的最新 ZIP/blockmap/latest-mac.yml，并复核实际字节。
本轮仅更新指南，未实施 Universal、运行打包或创建/上传应用安装包 Release，也未替打包者完成 Mac 实机验收。

Windows 已验证的浏览器超时、删除、Harness 桥接修复不能冒充 Mac 已通过。
没有兼容 Harness 安装版或测试账号时标“未执行/环境阻塞”，不以空模型列表作为验收完成。
