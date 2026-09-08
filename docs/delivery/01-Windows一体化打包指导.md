# OpenMausBot Windows 一体化打包指导

用途：从唯一源码构建 Windows x64 安装包，并最终交付“用户没有预装 Docker/Podman 也能完成 Local VM 准备”的版本。本指导区分当前已有命令和未来一体化安装门禁，禁止把普通 NSIS 包误报为一体化包。

## 1. 唯一事实来源

- 仓库：`C:\Users\Yunsh\Documents\ChatGPT\Bot\downloads\OpenMausBot-source`
- 版本：根目录 `package.json`
- Electron 配置：`electron-builder.yml`
- 当前 Windows 构建：`pnpm package:win`
- 当前输出：`release\OpenMausBot-<version>-setup.exe`
- Local VM 安全契约：`server\container-computer.ts`
- 正式发布流水线：`.github\workflows\release.yml`

Windows 与 macOS 共用业务源码。平台差异只能放在运行时 provider、安装脚本、资源选择和打包配置中。

当前 `package:win` 只打包 OpenMausBot 和 Windows Cua Driver，不安装 WSL2 或 Podman。`package:win:local-vm` 会先强制校验 x64 OCI archive 再打包，但宿主运行时 bootstrap 尚未完成，所以它仍不能单独宣称“无需预装 Podman”。

## 2. 推荐交付形态

保留 Electron Builder 生成的每用户 NSIS 应用包，在外层增加正式 bootstrapper：

```text
OpenMausBot-Windows-<version>-x64-Setup.exe
├─ 前置检查器
├─ OpenMausBot NSIS 安装包
├─ 固定版本 Podman Windows 安装载荷
├─ 可选离线 OCI 镜像（离线完整版）
└─ 安装状态/重启恢复逻辑
```

外层可使用 WiX Burn 等支持依赖链、退出码、提权、重启续装和日志的 bootstrapper。不要把启用 WSL、安装 MSI、导入镜像全部塞进 Electron `afterPack` 或首次渲染页面；`afterPack` 是构建期，不是用户机器部署期。

在线版允许 bootstrapper 或首次启动引导器从官方/公司镜像源下载固定载荷。离线版必须携带同版本载荷，二者执行同一校验和状态机。

## 3. Windows 前置条件与结果分类

安装前只读检测：

- 锁定 Podman 版本明确支持的 Windows 版本与 x64 架构。不能仅凭 Microsoft WSL 的系统要求宣称兼容 Windows 10；例如 Podman 6 当前 Windows 指南以 Windows 11+ 为支持基线。
- CPU 虚拟化可用；被 BIOS 或企业策略关闭时给出明确说明。
- WSL2 与 Virtual Machine Platform 状态。
- 是否需要管理员权限。
- 是否存在待处理重启。
- 可用磁盘、物理内存和公司代理/证书环境。

安装器必须区分：

| 状态 | 行为 |
|---|---|
| 已满足 | 不重复修改系统，继续安装 |
| 可自动修复 | 请求一次管理员权限并执行 |
| 需要重启 | 保存阶段状态，重启后从下一阶段恢复 |
| 被策略阻止 | 停止并显示具体组件/策略，不循环重试 |
| 架构或版本不支持 | 在安装前阻断 |

不要承诺“任何 Windows 都零权限、零重启”。第一次启用 WSL2 时需要提权，部分机器需要重启，这是系统边界。

## 4. Managed Podman 规则

- 固定 Podman 版本、安装包 URL、SHA-256、签名发布者和许可证；再审计 helper、Machine OS、字体与镜像依赖的完整再分发闭包。
- 使用专用 Machine 名称，例如 `openmausbot-machine-v1`。
- `podman machine init/start` 必须幂等；已创建时先 inspect，不要盲目重新 init。
- 配置资源上限后读取实际 Machine 配置复验。
- 使用产品解析出的 Podman 绝对路径，不能因 PATH 顺序误用另一套 Podman。
- 用户已有 Podman/Docker 只能在明确选择“外部运行时”时使用。
- Machine 创建失败时保留诊断日志，但不得记录登录凭据、viewer 密码或代理密码。

建议把状态保存在现有数据根目录 `%USERPROFILE%\.openmausbot\runtime\state.json`，只记录阶段、版本、Machine 名称和非敏感错误码。程序二进制、Electron userData、Managed runtime 状态与 VM workspace 应分开；不要为了封装运行时另行迁移现有 `~/.openmausbot`。

## 5. 镜像交付和汉化

在线版：从公司控制的 registry 拉取已在 CI 构建的多架构镜像，按 digest 验证。不要在普通用户电脑上每次运行 `apt-get` 重新构建中文层。

离线版：携带官方离线流程要求的 WSL MSI、Podman MSI，以及 Windows 使用的 `linux/amd64` OCI archive。安装后执行校验和 `podman load`；导入后必须 inspect 镜像的 digest/labels，不能只相信 tag。

`podman machine init --image` 的 image 是 Podman Machine 的 Linux OS，只能使用所锁版本正式支持的 Machine image。OpenMausBot 中文 XFCE 桌面必须作为普通 OCI 容器镜像 pull/load，不能拿桌面镜像替换 Machine OS。

正式镜像至少验证：

- `fc-list :lang=zh` 非空，中文网页和文件名无方框。
- `locale -a` 包含 `zh_CN.utf8`。
- XFCE/GTK 常用界面和浏览器优先显示简体中文。
- Cua Driver 版本、基础镜像 digest、中文层版本与 manifest 一致。
- amd64 容器截图真实显示指定中文样例。

修改中文层后提升镜像层版本并重建容器；保留 `%USERPROFILE%\.openmausbot\vm-home`，不要通过删除工作区完成升级。

## 6. 构建前保护现场

```powershell
Set-Location -LiteralPath 'C:\Users\Yunsh\Documents\ChatGPT\Bot\downloads\OpenMausBot-source'
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
(Get-Content -Raw .\package.json | ConvertFrom-Json) | Select-Object name,version,packageManager
node --version
pnpm --version
```

要求：

- Node 满足 `package.json` 的 `>=24`。
- pnpm 使用项目锁定版本。
- 记录工作区已有修改，禁止用 reset/checkout 删除用户工作。
- 根据上次已验收发布 commit 到当前 HEAD 的真实 diff 生成增量测试项。
- App、runtime manifest 和镜像 manifest 指向同一发布批次。

## 7. 当前应用包构建

在 Windows x64 构建机执行：

```powershell
Set-Location -LiteralPath 'C:\Users\Yunsh\Documents\ChatGPT\Bot\downloads\OpenMausBot-source'
pnpm install --frozen-lockfile
pnpm clean
pnpm test
pnpm package:win
```

不得用开发快捷方式或 `release\win-unpacked` 代替最终 Setup EXE 验收。

一体化版本开发完成后，在上述产物之外构建 bootstrapper。其输入必须来自固定 manifest；bootstrapper 生成后再次计算 SHA-256。不要从开发电脑的 Program Files 临时复制 Podman 文件凑包。

## 8. 一体化安装顺序

推荐顺序：

1. 检查系统与资源。
2. 安装 OpenMausBot 应用，但先不自动创建容器。
3. 按所锁 Podman/Windows 支持矩阵启用 WSL2 和 Virtual Machine Platform；在线路径可使用 `wsl --install --no-distribution`，避免额外安装与产品无关的 Ubuntu。Podman MSI 不会替你安装 WSL，不能省略这一阶段。
4. 如果系统要求重启，保存可验证的 resume token 后退出。
5. 安装固定版本 Podman 载荷。
6. 创建并启动专用 Machine。
7. 在线拉取或离线导入固定镜像。
8. 调用应用的只读 health check，确认 runtime、Machine、镜像和挂载能力。
9. 启动 OpenMausBot，允许用户点击“创建 Local VM”。

不要在安装器中预创建带随机 viewer 密码的长期容器。容器应继续由应用现有生命周期创建，以保留 owner label、安全参数和每 Bot 隔离逻辑。

## 9. 必须增加的构建门禁

一体化功能实现后，CI/打包脚本至少检查：

- bootstrapper、NSIS、Podman 载荷和 OCI archive 均存在且非空。
- manifest 中的版本、大小和 SHA-256 与最终字节一致。
- 安装包架构是 Windows x64，镜像架构是 linux/amd64。
- Podman 与所有再分发组件的许可证/NOTICE 已进入产物。
- 最终安装后的 `resources` 包含正确 Cua Driver，不含开发机绝对路径。
- runtime helper 的命令行参数使用 argv，不拼接用户输入形成 shell 字符串。
- viewer 只绑定 `127.0.0.1`，容器安全限制和唯一工作区挂载通过 inspect 复验。
- 未签名时明确记录 SmartScreen 风险；签名后校验 Authenticode 发布者，并保持升级证书身份稳定。

## 10. 升级、修复与卸载

- 应用小版本升级默认不重建 Machine。
- runtime 升级先停止 OpenMausBot 管理的容器，再升级，并验证可回滚。
- 镜像升级创建新容器、复用工作区；成功后再清理旧镜像。
- “修复 Local VM”只修复专用 Machine/镜像，不碰用户其他 Podman Machine。
- 默认卸载保留 workspace；删除虚拟机与数据必须由用户单独确认。
- 企业批量部署需提供静默参数、退出码表和日志位置，但不能静默绕过系统重启或安全策略。

## 11. 放行条件

只有在一台没有 Docker、Podman、WSL 发行版和 OpenMausBot 数据的新 Windows 测试机上，用最终 bootstrapper 完成安装、必要重启、Machine 创建、中文桌面启动和 Bot 操作，才允许宣传“无需预装容器软件”。

完整矩阵见 [03-双平台Local-VM真人验收与发布指导.md](03-双平台Local-VM真人验收与发布指导.md)。
