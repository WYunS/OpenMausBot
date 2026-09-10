# 锐捷 Bot：macOS 打包指导

这是 Bot 的 Mac 指南，不是 Harness 的 universal DMG 指南。
Bot 当前为 **0.1.71**，以 package.json 为准；按源码分别构建 arm64 / x64，
不要照搬 Harness 2.1.6、Yarn 或 `cn.com.ruijie.dsh.desktop` 身份。
先读本目录签名策略，最终交付按 `03-macOS真人验收测试指导.md` 验收。

## 1. 源码与环境

公开仓库 <https://github.com/WYunS/OpenMausBot>，交付分支
`codex/openmaus-upgrade-0.1.71-ready`。从交付人取得完整 SHA；Mac 与 Windows 一致。
当前最低功能基线为 `580b38a8`，打包时必须包含此后指南/配置提交。
可在自己的任意可写路径检出，以下从仓库根目录执行：

```bash
git clone --branch codex/openmaus-upgrade-0.1.71-ready https://github.com/WYunS/OpenMausBot.git OpenMausBot
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
不要直接执行原始 `pnpm package:mac` 或上游 Release 工作流，它们仍有上游更新源、
证书/镜像仓库假设。不要替换 appId；当前安装包仍叫 OpenMausBot.app，窗口叫锐捷Bot。
`enterprise/` 是单独许可，构建时会纳入；生产使用/分发许可须由发布负责人核实。

当前代码不会因“有 Harness 许可证”自动获得 Bot Enterprise 许可。不得移除许可证
或绕过 feature gate；如要改为纯 OSS 发行，那是另一次明确的发行配置变更和验收。

## 3. 构建共用资源

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
node --test electron/ruijie-package-config.node-test.mjs
corepack pnpm test:packaged-server
corepack pnpm package:prepare
corepack pnpm build:speech
corepack pnpm build:cua
```

默认准备两种架构；pnpm 10 从 package.json 的 supportedArchitectures 安装对应原生包。
缺 `@trycua/cua-driver-darwin-*` 时检查包管理器/锁文件，不复制 Windows 的 `.node`。
浏览器默认为 Mac 的 0.37.0；Windows `0.36.0-omb.1` 不能拷进 Mac。
`afterPack` 必须核对完整资源、架构、manifest 与许可证，不能禁用。

变更了 Bot UI/server/companion/updater 就重建这些 JS；不用重编译 Harness。
只有 SHA、锁文件、平台/架构、配置和前序生成物全部可核对时才能复用构建断点。
同一 DMG 的验收脚本修正可续验；产品或依赖变更则是新候选，不能继承旧 DMG 结论。

## 4. 选择准确的签名路线

### A. 已有自己的 Developer ID（正式分发）

发布人员在受保护构建环境中配置自己获授权的 Developer ID；不要复制上游作者证书
或 Team ID。以下命令不会自动完成公证：

```bash
corepack pnpm exec electron-builder --config electron-builder.ruijie.mjs --mac --publish never
```

源码 mac.notarize=false：先验证 `.app` 和全部嵌套代码签名，再由发布人员通过自己的
notarytool Keychain profile 提交 DMG/ZIP，等待 Accepted，staple `.app` 和 DMG。
staple 后按仓库 release.yml 的**相关步骤**重新生成 ZIP、blockmap、latest-mac.yml，
不要执行里面向上游/旧镜像发布的步骤。最终哈希必须在所有字节变化结束后计算。

### B. 无 Developer ID（内部测试候选）

明确使用 ad-hoc，而不是把 identity=null 的完全未签名产物称为已签名：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false corepack pnpm exec electron-builder \
  --config electron-builder.ruijie.mjs --mac --publish never \
  -c.mac.identity=- -c.dmg.sign=false
```

该路线准确状态为 `ad-hoc signed, not notarized`，不是正式公证分发。
必须逐个验签真实 Mach-O、外层 `.app`，并通过普通实体 Mac 的 TCC 验收。
electron-builder 成功退出不证明签名闭包通过。若内嵌 CUA/浏览器缺签或权限循环，
停止放行，记录问题，不把关闭 Gatekeeper/删除 quarantine/重置所有 TCC 当修复。
内部包能否给员工安装由发布负责人决定，本指南不默认授权改变系统安全策略。

## 5. 产物及安装形态检查

按当前配置：`release/mac-arm64/OpenMausBot.app` 和 `release/mac/OpenMausBot.app`，
产物为 `OpenMausBot-<版本>-arm64.dmg/.zip`、`OpenMausBot-<版本>-x64.dmg/.zip`。
没有 universal 主 App。仅发布 ARM 时也要明确范围，不用 ARM smoke 代替 Intel 验收。

```bash
case "$(node -p process.arch)" in
  arm64) APP_PATH="$REPO_ROOT/release/mac-arm64/OpenMausBot.app" ;;
  x64) APP_PATH="$REPO_ROOT/release/mac/OpenMausBot.app" ;;
  *) echo 'Unsupported test host'; exit 1 ;;
esac
RESOURCES="$APP_PATH/Contents/Resources"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH"
codesign -dr - "$APP_PATH"
cat "$RESOURCES/app-update.yml"
node scripts/smoke-browser-bundle.mjs --resources "$RESOURCES"
OMB_SMOKE_DIST="$RESOURCES/server" node scripts/smoke-packaged-server.mjs --browser-bundle "$RESOURCES/browser-engine"
```

核对更新 owner WYunS；检查 ui/index.html、server/index.js、ruijie-computer-proxy.js、
companion/index.js、speech helper、cua-driver/cua-sdk、cloudflared、browser-engine、licenses。
Mac 不附带 Windows 的 tuantuan-feishu 本机连接器；其他渠道/连接器按实际平台支持验收。

上述只验证 unpacked tree。必须挂载**最终 DMG**，从其中 `.app` 再验签和核对架构；
已公证包还要 `xcrun stapler validate` 与 `spctl --assess --type execute`。
把 DMG 内容安装到获授权测试账户的 Applications，再执行真人指南，不能启动源码替代。
签名后的原生文件哈希会变，不能拿签名前的 vendor 文件哈希判签名包损坏。

## 6. 交付和不能声称的结论

```bash
git rev-parse HEAD
git status --short
shasum -a 256 release/*.dmg release/*.zip
```

交付记录：完整 SHA、Bot 版本、目标架构、Node/pnpm、构建配置、签名类型/Team ID、
公证状态、最终 DMG/ZIP SHA-256、静态审计与真人报告。不得包含私钥、token、账户信息。
需要自动更新时另交 post-staple 的最新 ZIP/blockmap/latest-mac.yml，并复核实际字节。
本轮只准备源码和指南，不创建/上传 Release，也未替打包者完成 Mac 实机验收。

Windows 已验证的浏览器超时、删除、Harness 桥接修复不能冒充 Mac 已通过。
没有兼容 Harness 安装版或测试账号时标“未执行/环境阻塞”，不以空模型列表作为验收完成。
