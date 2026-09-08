# OpenMausBot macOS 一体化打包指导

用途：从与 Windows 相同的提交分别构建 Apple Silicon 和 Intel 版本，并交付不要求用户预装 Docker Desktop/Podman Desktop 的 Local VM。本文适配 OpenMausBot 当前 Electron/Cua/Updater 结构，不复制 Harness 的应用身份或证书策略。

## 1. 唯一事实来源

- 仓库：当前 Windows 开发副本为 `C:\Users\Yunsh\Documents\ChatGPT\Bot\downloads\OpenMausBot-source`；Mac 构建机使用该仓库的同一提交，而不是复制另一套源码。
- 版本：`package.json`。
- App ID：`com.openmausbot.app`。
- 当前命令：`pnpm package:mac`。
- 当前产物：arm64/x64 的 DMG、ZIP、blockmap 与 `latest-mac.yml`。
- Cua 分架构准备：`scripts/prepare-cua.mjs`、`scripts/cua-mac-arches.mjs`。
- 签名、公证、staple 和 feed 重算：`.github/workflows/release.yml`。

当前 DMG 已能打包 OpenMausBot，但不携带 Podman。完成一体化运行时开发前，不能把现有 DMG 描述为“全新 Mac 直接可用 Local VM”。

## 2. 架构与交付物

保持两个 Mac 安装产物：

- Apple Silicon：应用 `arm64`，Local VM 镜像 `linux/arm64`。
- Intel Mac：应用 `x64`，Local VM 镜像 `linux/amd64`。

不要给每位用户下载 universal App 加双架构 OCI 镜像；体积和升级成本过高。两个架构仍由同一提交、同一流水线、同一版本生成。

若要真正做到“一个安装入口把运行时也装好”，推荐增加一个签名并公证的 Distribution PKG：

```text
OpenMausBot-macOS-<version>-<arch>.pkg
├─ OpenMausBot.app
├─ 固定版本的 Podman 官方安装载荷（保持原始签名/来源）
├─ OpenMausBot runtime manifest
└─ 可选同架构 OCI archive（离线完整版）
```

现有 DMG 可以继续作为“已具备运行时/开发者版”下载，PKG 作为普通同事的一体化入口。若不采用 PKG，也可以让 DMG 中的 App 在首次启动时打开随包附带的官方 Podman 安装器，但用户会经历两个明确安装步骤，不能称为完全静默。

## 3. macOS 平台边界

- macOS 提供 Virtualization Framework/Hypervisor 能力，但不自带 Podman CLI 或 Linux guest。
- Podman 在 macOS 上通过 Podman Machine 运行 Linux VM；OpenMausBot 的桌面容器再运行在这台 Machine 中。不同 Podman 版本和文档对 Apple Silicon 默认 provider 的描述可能不同，因此必须锁定 Podman 版本、显式指定已验收 provider，并用 `podman machine inspect/info` 复验，不能依赖默认值。
- 当前源码还支持 Apple `container` CLI，但它只适合作为可选外部运行时：现有固定 viewer 端口无法创建 Per bot 多桌面，不能作为本次默认交付路径。
- 不要把 Homebrew 作为正式用户前置条件，也不要在安装脚本里自动安装 Homebrew。
- 不要控制用户已有的默认 Podman Machine；使用专用 Machine 名称。
- 首次安装可能出现系统安装授权、网络或文件访问提示。应用必须解释原因，不能循环弹窗。
- Apple Silicon 与 Intel 的运行时载荷、Machine guest 和 OCI 镜像必须各自验证架构。

最低支持系统版本必须依据选定 Podman 版本和 OpenMausBot Electron 版本的共同支持范围写进 manifest 和安装器；不能只检查“darwin”。

## 4. Managed Podman 安装策略

优先级：

1. 已安装且由 OpenMausBot 管理、版本匹配的运行时。
2. 一体化安装载荷安装/修复的固定版本。
3. 用户明确选择的外部 Podman/Docker（开发兼容）。

禁止顺序：扫描 PATH → 发现任意 `podman` → 自动接管其默认 Machine。

运行时 provider 应使用绝对路径和专用 Machine，执行：inspect → init（仅不存在时）→ start（仅未运行时）→ health check。每个阶段都要幂等并有稳定错误码。

如果公司不允许再分发 Podman PKG，可把固定版本官方安装载荷作为首次启动下载项；仍要校验 SHA-256 和 Apple 签名身份。Podman 主项目采用 Apache-2.0 也不代表 helper、Machine image、字体和容器镜像的完整闭包无需 NOTICE/SBOM 与再分发审计。不要把未经许可的二进制直接复制进 `.app/Contents/Resources` 后重新签成 OpenMausBot 自己的代码。

`podman machine init --image` 指的是 Podman Machine 的 Linux OS，不是 OpenMausBot 的中文桌面。中文 XFCE 必须作为普通 OCI 容器镜像按架构 pull/load，并独立验证 digest。

## 5. 中文镜像与持久化

macOS 与 Windows 使用同一份 `Containerfile`，区别只在目标架构。正式发布前在 arm64 和 amd64 两边分别验证：

- Noto CJK 字体、`zh_CN.UTF-8` locale、XFCE/GTK 中文资源。
- Chromium/Chrome 中文网页、中文下载文件名和中文剪贴板。
- 如果需要人工在 noVNC 中输入中文，验证 IBus + libpinyin 的启动和切换。
- `/home/cua/workspace` 精确映射到 OpenMausBot 专用持久目录。

沿用源码当前的 `~/.openmausbot` 数据根，不为了 Mac 单独迁移目录：

```text
~/.openmausbot/runtime
~/.openmausbot/vm-home
~/.openmausbot/vm-homes/<bot-id-digest>
```

不要默认把 Local VM 工作区放在 Desktop、Documents 或 Downloads，从而无意义触发 TCC。用户主动选择受保护目录时才申请对应权限。

## 6. 构建前检查

在真实 Mac 构建机或受控 macOS CI 上执行：

```bash
git status --short
git branch --show-current
git rev-parse HEAD
node --version
pnpm --version
/usr/bin/xcodebuild -version
/usr/bin/security find-identity -v -p codesigning
```

要求：

- Node 满足 `>=24`，pnpm 使用项目锁定版本。
- `package.json`、runtime manifest、镜像 manifest 来自同一提交。
- Developer ID Application、notarytool API key 和 Team ID 均来自 OpenMausBot 自己的发布身份。
- 不复制 Harness 的 Bundle ID、证书、provisioning profile、entitlements 或 TCC 记录。

## 7. 当前 App 构建与签名顺序

当前正式流程已经遵循：

```text
清理旧输出
→ 安装冻结依赖
→ 构建 UI/server/helpers/Cua
→ 分别生成 arm64 与 x64 App/DMG/ZIP
→ 验证签名闭包
→ 公证所有候选
→ staple 最终 App/DMG
→ 重新生成 ZIP、blockmap 和 latest-mac.yml
→ 对最终字节计算哈希
```

本地命令：

```bash
pnpm install --frozen-lockfile
pnpm clean
pnpm test
pnpm package:mac
```

最终发布优先使用现有 GitHub Actions 流水线。Mac 产物只能在 macOS 构建环境生成和验签。

加入 Managed Podman 后，签名闭包必须扩展到新增 helper，但保持原始第三方安装包不可变。不要在签名后修改 `.app`、PKG 或 DMG；staple 会改变文件字节，因此 feed 和 SHA-256 必须在 staple 后生成。

## 8. TCC 与代码身份

稳定 Bundle ID 和 Developer ID 是权限连续性的基础。最终 App 必须通过：

```bash
codesign --verify --deep --strict --verbose=2 OpenMausBot.app
spctl --assess --type execute --verbose=4 OpenMausBot.app
xcrun stapler validate OpenMausBot.app
```

最终 PKG 还要使用 Developer ID Installer 签名；App 与自有 helper 使用 Developer ID Application，并分别通过 `pkgutil --check-signature`、Gatekeeper 和公证票据检查。如果自有代码直接调用 Virtualization Framework，还必须把 `com.apple.security.virtualization` entitlement 放在真正调用它的最小签名主体上，不能为了省事扩大整个 Electron 主进程的权限。

TCC 验收原则：

- 未经用户操作不扫描 Desktop/Documents/Downloads。
- 用户选择目录后最多出现系统预期的一次授权。
- 拒绝或取消后停止，不重复打开选择器。
- 覆盖升级时不主动清除 TCC；出现每次启动循环询问即失败。
- CI 静态签名通过不能替代实体 Mac 权限测试。

## 9. PKG/DMG 与自动更新边界

应用内更新只更新 OpenMausBot App，不自动重装 Podman 或重建 Machine。runtime manifest 发现不兼容时，进入单独的受控升级流程，并在更新前停止受影响的容器。

PKG、DMG、ZIP 和 updater feed 的职责必须清晰：

- PKG：首次一体化安装和系统级运行时依赖。
- DMG：已具备依赖时的手工安装/修复入口。
- ZIP + `latest-mac.yml`：Electron App 自动更新。
- OCI archive/registry：Linux 桌面镜像更新。

不要让 App 自动更新下载到一半时替换 Podman，也不要让 PKG 升级删除 `~/Library/Application Support/OpenMausBot`。

## 10. 必须增加的门禁

- 两个架构的 PKG/DMG/ZIP 与各自 OCI 镜像一一对应。
- Podman 载荷、helper、镜像、许可证、SBOM 和 manifest 完整。
- 挂载最终 DMG、展开最终 PKG 后复验内容；不能只验 staging 目录。
- App、所有嵌套原生代码和自有 helper 签名有效，公证 Accepted，票据已 staple。
- updater feed 中两个架构的 URL、大小和 SHA-512 与最终文件一致。
- 全新 Apple Silicon Mac 无 Homebrew/Docker/Podman 时，一体化安装成功。
- 如果继续支持 Intel，必须另有真实 Intel Mac 或可信硬件环境完成安装和 Local VM 验收；Rosetta 不能证明 linux/amd64 Machine 路径完整。

## 11. 放行条件

只有最终 PKG 在干净 Mac 上完成 App 安装、Podman Machine 创建、同架构中文镜像导入/拉取、Local VM 创建与重启持久化，才能对外写“无需预装容器软件”。完整真机矩阵见下一份指南。
