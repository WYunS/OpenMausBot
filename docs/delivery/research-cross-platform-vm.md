# OpenMausBot 双平台 Local VM 封装研究笔记

> 调研日期：2026-09-07  
> 范围：只研究统一源码、Windows/macOS 安装交付、Podman/WSL/Apple 虚拟化、Linux 桌面中文化和签名公证；不在本文中实施产品代码，也不把 RuijieDSH 的实现机械迁移进 OpenMausBot。

## 结论摘要

OpenMausBot 不需要拆成 Windows、macOS 两套业务源码。适合它的结构是“一套产品与 Local VM 领域逻辑 + 两个平台运行时适配器 + 两条原生打包流水线 + 同一份多架构 Linux 桌面镜像”。Windows 和 macOS 安装包分别在原生系统构建，但都来自同一 commit。

当前 OpenMausBot 已经具备大部分“管理已有容器运行时”的能力：运行时探测、镜像构建、容器生命周期、固定资源限制、仅回环端口、持久工作区、镜像/容器标签校验、共享与 per-bot 模式以及 amd64/arm64 Cua Driver 选择。真正缺少的不是容器业务逻辑，而是一个受产品控制、可恢复、可升级的 **host runtime bootstrap 层**。目前安装包携带 Cua Driver，却没有携带或安装 Podman；设置页仍要求用户先安装并启动容器运行时。

推荐第一阶段把 Podman Machine 作为 Windows 与 macOS 的统一产品级后端：

- Windows：Podman Machine 默认使用 WSL 2 provider 提供 Linux VM；首次启用 WSL/Virtual Machine Platform 可能需要管理员权限和重启。
- macOS：Podman Machine 使用受支持的本地虚拟化 provider 提供 Linux VM；不同 Podman/Podman Desktop 文档对 arm64 新 machine 的默认 provider 表述并不完全一致，因此产品必须显式选择并验证 provider，不能依赖默认值；不要求 Docker Desktop。
- Apple `container` 可以保留为满足条件机器上的可选后端，但不能成为第一版共同基线：Apple 官方项目当前要求 Apple silicon 与 macOS 26，而 OpenMausBot 仍发布 Intel x64 包。

“下载安装到一台什么都没装的电脑上就能用”可做到接近一体化，但不能承诺绝对零前置：Windows 可能需要启用系统组件并重启；两平台都要满足硬件虚拟化和系统版本要求；macOS 外部分发必须完成 Developer ID 签名、公证和 stapling。安装器应把这些状态明确呈现为可续跑的初始化步骤，而不是把失败统称为“请先启动 Docker”。

Linux 桌面汉化也不应只理解为“安装中文字体”。当前派生镜像已经安装 `fontconfig` 和 `fonts-noto-cjk`，这能解决大多数方框字，但还缺少 `zh_CN.UTF-8` locale、XFCE/GTK 中文翻译、浏览器首选语言，以及在确有人工输入需求时的中文输入法。正确做法是发布预构建、digest 固定的多架构中文镜像，避免让每个终端用户首次运行时现场执行 `apt-get`、从 PyPI 下载 wheel 再构建镜像。

## 1. 当前 OpenMausBot 的真实基线

### 1.1 已有能力

源码事实来自当前工作树：

- [`server/container-computer.ts`](../../server/container-computer.ts) 将 Local VM 的容器、镜像、端口、工作区、资源限制和 Cua socket 集中管理。
- 基础镜像已经固定到 `docker.io/trycua/xfce-cua` 的 manifest digest；派生镜像同时处理 `x86_64` 和 `aarch64` Cua Driver wheel，并校验 SHA-256。
- Windows 的运行时优先级已是 Podman → Docker；macOS 还会识别 Apple `container` CLI。
- 容器只把 viewer 绑定到 `127.0.0.1`，只挂载一个精确的持久目录，并验证 memory/CPU/PID/capability/namespace 等安全条件。
- 默认持久目录来自 [`server/config.ts`](../../server/config.ts) 的 `~/.openmausbot`，共享桌面使用 `vm-home`，per-bot 桌面使用按 bot id 摘要派生的 `vm-homes/<digest>`。
- [`electron-builder.yml`](../../electron-builder.yml) 已经按平台放置 Cua Driver 和其他原生资源；macOS 分别构建 arm64/x64，Windows 构建 x64。
- [`scripts/prepare-cua.mjs`](../../scripts/prepare-cua.mjs) 和 [`scripts/prepare-cua-windows.mjs`](../../scripts/prepare-cua-windows.mjs) 已经体现了正确的供应链思路：版本固定、下载资产固定、SHA-256 校验、架构校验、放在 ASAR 外。
- [`apps/docs/content/docs/computers/local-vm.mdx`](../../apps/docs/content/docs/computers/local-vm.mdx) 明确说明当前仍要求 Docker/Podman 已安装且健康。

### 1.2 目前不能支撑“一体安装”的缺口

1. `package:win` 和 `package:mac` 只准备 Cua Driver 等应用资源，没有准备 Podman CLI、Podman Machine helper、Linux machine image 或安装器 bootstrap。
2. 设置页给出的安装动作仍是 `winget install ...Podman-Desktop` 或 `brew install podman; podman machine init; ...`。这依赖用户已有 winget/Homebrew、联网成功并理解命令，不是普通安装包体验。
3. `containerComputerStatus()` 只区分“命令存在/daemon 健康”，没有表达“系统能力缺失、待提权、待重启、machine 未创建、machine 损坏、镜像正在导入”等安装态。
4. `prepareManagedImage()` 在用户电脑上临时生成 Dockerfile并在线执行 `apt-get`、下载 PyPI wheel、build。首次使用速度、代理、上游可用性和构建结果均不可控。
5. 当前中文化仅安装 Noto CJK 字体并检查 `fc-list :lang=zh`；没有生成中文 locale，也没有验证 XFCE、文件管理器、终端、浏览器语言或输入法。
6. 当前 Podman Machine 的总资源预算没有与“每个容器 4 GB、2 CPU，最多多个 per-bot desktop”形成统一容量模型。VM 本身资源不足时，容器级参数并不能创造额外内存或 CPU。

## 2. 从 RuijieDSH 可以借鉴什么

调研基线：`D:\ChatGPT\RuijieDSH\发布交付指南` 下四份文件，以及对应的 `dsh-plugin-desktop` 构建实现。

### 2.1 值得迁移的方法，而不是产品代码

1. **唯一源码、平台适配器**  
   RuijieDSH 明确让 Windows/macOS 共用 `main`，并通过 `ElectronPlatformStrategy`、平台专属模块与平台打包脚本隔离差异。OpenMausBot 应借鉴这个边界，把运行时安装/检测抽象成接口，而不是复制整个仓库或在 UI 与 server 各处散落 `process.platform`。

2. **原生平台构建，不做假跨编译**  
   RuijieDSH 的 `package-win.ts` 在 Windows 主机校验平台和架构；`package-mac.ts` 在 macOS 主机完成 universal 合并、签名与最终 DMG 验证。OpenMausBot 同样应由 Windows runner 产出 EXE、macOS runner 产出各架构 DMG/ZIP，并绑定同一源码 commit、版本和镜像 digest。

3. **打包闭包验证**  
   Harness 不以“源码里有文件”为完成，而是验证最终 `app.asar`/`app.asar.unpacked`、原生二进制、图标和安装副本。OpenMausBot 的 runtime bootstrap、Podman 资产 manifest、OCI 镜像归档（离线版）和许可证也必须在最终安装物中验证。

4. **固定基线 + 动态增量矩阵**  
   每版固定测试首次安装、升级、重启、数据保留、网络异常等，再根据上个已验收 commit 到当前 commit 的差异补充测试。Local VM 尤其需要覆盖 BIOS/系统虚拟化关闭、WSL 待重启、machine stopped、镜像损坏、端口占用、空间不足和旧版本迁移。

5. **候选物不可变与证据化**  
   产物以 SHA-256、源码 commit、架构、签名状态和验收报告绑定。验收失败若只修改验收工具，可复用完全相同哈希的候选；产品、依赖、镜像或打包配置变化必须产生新候选。

6. **macOS inside-out 签名和最终镜像复验**  
   Harness 的内部 ad-hoc 方案会枚举 Mach-O 和嵌套 bundle，从内到外签名，最后挂载 DMG 复验。OpenMausBot 正式外发应使用 Developer ID + hardened runtime + notarization，但同样必须保证任何新增 Podman/helper/VM 工具在签名前进入 `.app`，签名后不再修改，并对最终 DMG 中的 `.app` 复验。

7. **开发态与安装态隔离**  
   Harness 把开发 profile 与安装版 profile 分开。OpenMausBot 应继续让开发 VM、正式 VM 的 machine 名、data dir、容器 label 和 workspace 互不冲突，防止测试安装包接管开发容器或覆盖真实数据。

### 2.2 不能照搬的部分

- Harness 主要把 Node/Electron/业务依赖放进应用，并不负责安装操作系统虚拟化能力。Local VM bootstrap 是 OpenMausBot 特有的新交付层，不能靠复制 Harness 打包脚本获得。
- Harness 的 macOS internal ad-hoc、not notarized 路线适合受控内部验证，不适合“同事下载后双击即用”的正式体验。正式 OpenMausBot 应延续自身现有 Developer ID、公证和 stapling 流水线。
- Harness 选择 universal DMG；OpenMausBot 当前有意发布 arm64/x64 两套 Mac 包以控制体积。加入 Podman/OCI 资产后体积更敏感，不应为了外观统一强行改成 universal。
- Harness 的 profile、插件、登录、TCC 用例可借鉴方法论，但不能把 DSH 的目录、bundle id、模型、更新接口或具体脚本路径带进 OpenMausBot。
- Apple `container` 的能力模型和 Docker/Podman 并不完全一致；当前 OpenMausBot 已因动态端口限制禁止它用于 per-bot 模式。不能用统一接口掩盖真实能力差异。

## 3. 推荐的统一源码架构

建议把现有 `container-computer.ts` 中的“容器领域规则”与“宿主运行时安装/命令细节”拆开，但保持业务层只面对一个 contract：

```text
Renderer / Settings
        │
        ▼
LocalVmOrchestrator（共享状态机、进度、锁、恢复、诊断）
        │
        ├── WindowsPodmanAdapter
        │     └── WSL 2 → managed Podman machine
        │
        ├── MacPodmanAdapter
        │     └── Apple virtualization → managed Podman machine
        │
        └── ExistingRuntimeAdapter（高级/兼容模式）
              ├── 用户已有 Docker
              ├── 用户已有 Podman
              └── Apple container（能力受限）
        │
        ▼
LocalVmContainerService（现有安全 label、mount、port、lease、idle）
        │
        ▼
固定 digest 的 zh-CN Cua Linux desktop image（amd64 + arm64）
```

适配器至少提供：`probeHost()`、`probeRuntime()`、`installOrRepairRuntime()`、`machineStatus()`、`ensureMachine()`、`ensureImage()`、`start()`、`stop()`、`diagnostics()`。UI 不解析 CLI 文本，也不自行拼命令；平台 adapter 返回稳定的领域状态和本地化错误码。

初始化应是持久化、幂等、可续跑的状态机，例如：

```text
unsupported
→ host-prerequisite-required
→ elevation-required
→ reboot-required
→ runtime-installed
→ machine-missing/stopped
→ image-missing/importing/pulling
→ ready
```

安装器和应用都只能推进状态，不能用固定 sleep 猜测成功；中途重启、断网或关闭应用后应从已完成阶段继续。所有外部命令必须以可执行文件 + argv 调用，不拼 shell 字符串；日志删除 token、密码和账号信息。

## 4. 两个平台的封装边界

### 4.1 Windows

推荐默认：固定版本 Podman + 专用 Podman Machine + WSL 2 provider。

- 安装前检测 Windows 版本、CPU 虚拟化、WSL 状态和是否存在待重启状态。
- 启用 WSL/Virtual Machine Platform 属于系统级变更，安装器必须显示说明并请求管理员权限；若需要重启，保存 bootstrap checkpoint，重启后继续。
- 普通在线 bootstrap 可采用 `wsl --install --no-distribution`，避免额外安装与产品无关的 Ubuntu，再执行 `wsl --update`、重启和 `wsl --status` 验证。不要假设 Podman MSI 会代为安装 WSL；Podman 当前 Windows 文档已明确把它作为独立前置。
- Windows 最低版本必须按实际锁定的 Podman 版本确定。Microsoft 的通用 WSL 页面支持较新的 Windows 10/11，但 Podman 6 当前 Windows 指南写的是 Windows 11+；因此不能用 WSL 的较低门槛替代所选 Podman 版本的支持矩阵。
- 不要把 Podman Desktop GUI 作为产品必需组件。优先评估官方 Podman Windows installer/CLI 的可再分发方式，只携带运行 Local VM 所需的最小闭包；若法律或维护成本不合适，则由 bootstrap 下载固定版本的官方签名安装器并校验 SHA-256。
- 使用产品专属 machine 名，不接管用户已有的默认 Podman machine；显式设置 machine CPU、内存和磁盘。per-bot 只是 machine 内的多个容器，不应误写成每个 bot 一台底层 Linux VM。
- 安装器应生成 per-user 应用；系统组件启用和 Podman 安装可通过带签名的 elevated helper 完成。不要让高权限 helper 常驻，也不要把 renderer 输入直接传给它。
- Windows 正式外发需要 Authenticode。当前 `electron-builder.yml` 明确还是 unsigned；如果未来设置 `publisherName`，必须同时完成真实签名并保持证书 subject 的升级兼容，避免 updater 拒绝后续版本。

### 4.2 macOS

推荐默认：固定版本 Podman Machine。Apple `container` 只作为符合条件机器的可选加速路径。

- arm64 与 x64 安装包可继续分别发布；每个包只携带本架构的 helper/runtime 资产和对应 OCI image archive（如果做离线版）。不要让 x64 包包含 arm64 VM 镜像，反之亦然。
- Podman Machine 会管理 Linux guest；应用负责专用 machine 名、资源参数、provider、生命周期和版本迁移。不要依赖 Homebrew，因为普通用户未必安装 Homebrew，它也不是应用安装器的稳定 contract。arm64 与 x64 应分别把已验收 provider 写入 manifest，而不是运行时任意漂移。
- Podman Desktop 的 machine 创建页与 Rosetta 页对 arm64 默认 provider 的描述存在差异。实现中应显式传 `--provider`、锁定 Podman 版本，并用 `podman machine inspect/info` 验证实际 provider；发布原生 arm64/amd64 OCI 镜像，不把 Rosetta 当作 Local VM 的必要运行路径。
- 如果把任何 CLI/helper 放进 `.app`，它们属于签名闭包：先固定并校验来源，再放入 Resources，完成嵌套代码签名，最后签主 App、生成 DMG、notarytool 公证、staple，并从最终 DMG 复验。若直接调用 Virtualization.framework，还需审计并签入 `com.apple.security.virtualization` entitlement；不要把上游 helper 的权限无差别加给 Electron 主进程。
- 不要把 ad-hoc 签名路线描述为正式一键安装。Apple 官方建议在 Mac App Store 外分发的软件使用 Developer ID 并完成 notarization；Gatekeeper 的首次体验和后续更新都依赖稳定代码身份。
- 当前 entitlement 含 JIT、unsigned executable memory、disable library validation 等较宽权限；引入 VM runtime 时应单独做 entitlement 审计，不应因 helper 启动失败继续扩大主应用权限。能在独立、最小权限 helper 中完成的能力，不放入 renderer 或主进程通用权限面。

## 5. 镜像交付与中文化

### 5.1 从“用户现场构建”改成“发布阶段预构建”

推荐在 CI 中从固定基础镜像构建 OpenMausBot 桌面镜像，分别验证 amd64/arm64，再发布 OCI manifest list，并把解析后的内容 digest 写入应用版本 manifest。客户端只做：

- 在线版：拉取固定 digest；
- 离线版：从安装包外置或同包携带的压缩 OCI archive 导入，再核对 image ID/labels/digest。

Podman `machine init --image` 指的是底层 Podman Linux machine 的 OS 镜像，官方只支持 Podman 提供的 machine image；不能把 OpenMausBot 的中文 XFCE 桌面塞到这里。桌面和汉化应始终位于普通 OCI 容器镜像；离线导入使用官方 `podman load` 路径。

不要把 mutable tag 当信任依据。版本 manifest 至少记录：基础镜像 digest、派生层版本、Cua Driver 版本、目标架构、OCI digest、构建 commit、SBOM 和许可证清单。

预构建能消除当前用户侧 `apt-get`/PyPI/build 的长耗时和失败面，也避免 Windows 与 Mac 因镜像源、DNS、代理或时间差得到不同内容。

### 5.2 “汉字能显示”与“桌面已汉化”必须分开验收

镜像应分四层处理：

1. 字形：保留 Noto CJK，并验证 fontconfig 的中文字体匹配。
2. locale：生成 `zh_CN.UTF-8`，设置 `LANG`/`LANGUAGE`，不要引用系统未生成的 locale；谨慎使用全局 `LC_ALL`，避免覆盖用户或进程的合法 locale 选择。
3. 桌面翻译：安装与基础发行版相匹配的 XFCE、GTK、文件管理器和常用应用中文资源；浏览器默认语言设为 `zh-CN`。
4. 输入法：若产品承诺用户可在 noVNC 中手工输入中文，再加入并验证 IBus/libpinyin（或基础镜像正式支持的输入法）；若 Cua 只注入 Unicode，输入法可以作为可选能力，但必须在文档中说清。

镜像门禁至少验证：`locale -a`、`fc-match`/`fc-list :lang=zh`、中文网页、中文文件名、XFCE 菜单、终端显示、浏览器渲染、剪贴板 Unicode；若承诺输入法，还需验证候选框、切换热键与重启自启动。

## 6. 安装包形态建议

“两个平台版本”与“在线/离线交付”是两个维度：

| 平台 | 推荐普通包 | 可选离线包 |
|---|---|---|
| Windows x64 | EXE/MSI：应用 + bootstrap；首次初始化获取固定 Podman/runtime 与镜像 | 应用 + WSL MSI（按官方离线流程需要时使用）+ Podman MSI + amd64 OCI archive，体积可能数 GB |
| macOS arm64 | signed/notarized DMG/PKG：应用 + bootstrap；首次初始化获取固定 runtime 与 arm64 镜像 | signed/notarized 包 + arm64 OCI archive |
| macOS x64 | signed/notarized DMG/PKG：应用 + bootstrap；首次初始化获取固定 runtime 与 amd64 镜像 | 仅仍需支持 Intel 时提供 |

不建议把多 GB 镜像直接塞进日常 Electron auto-update 资产。应用版本、runtime 版本和 VM image 版本应可独立升级；更新旧镜像时创建新容器并复用持久工作区，成功后再清理旧镜像。这样 UI 小版本更新不必重复下载整套桌面镜像。

## 7. 关键避坑

- **不要检测到系统已有 Docker 就静默换后端。** 当前 Windows 已优先 Podman，这是正确方向；正式版应保存并显示所选 provider，切换前确认其 image store 与 machine 身份。
- **不要用 PATH 作为唯一发现机制。** GUI 启动时的 PATH 与终端不同；应保存受管理 runtime 的绝对路径，并用版本/签名/hash 校验。
- **不要复用用户默认 Podman machine。** 产品专属 machine 才能安全控制资源、升级和卸载边界。
- **不要把 Podman Machine 与 bot 容器混为一层。** machine 是宿主上的 Linux VM；shared/per-bot 是这台 VM 内的容器策略。
- **不要让每个容器声明 4 GB，却只给 machine 4 GB。** 最大实例数、machine 总内存和容器限制必须联合计算并在 UI 中阻止超配。
- **不要先发布版本元数据再上传完整资产。** EXE/DMG、对应 updater feed、runtime manifest、镜像/归档和哈希应全部就绪并远端复验后，才提高渠道版本。
- **不要让卸载器默认删除 `~/.openmausbot` 或 VM workspace。** 删除应用、删除 runtime、删除 machine/镜像、删除用户数据是四个不同动作。
- **不要把“镜像存在”当作可用。** 需校验架构、labels、base digest、driver version、中文 locale/font、自检截图和 Cua socket。
- **不要在 Mac 签名后改 Resources。** 修改一字节都可能破坏签名；公证和 staple 后重新计算最终哈希与 updater metadata。
- **不要把 WSL 重启需求伪装成失败。** 把它设计成安装状态，重启后自动续跑；若企业策略/BIOS 禁止虚拟化，则给出明确阻断原因。
- **不要承诺 Apple `container` 覆盖 Intel Mac。** 它当前是 Apple silicon/macOS 26 路线；通用产品基线仍应由 Podman Machine 承担。
- **不要把开源许可证等同于可随意复制二进制。** 对 Podman、machine image、Fedora CoreOS、Cua 基础镜像及其传递依赖做法务确认、NOTICE/SBOM 与漏洞更新策略；优先使用官方发布资产并校验签名/哈希。

## 8. 建议的交付门禁

最小发布证据应同时覆盖：

- 同一 commit 的 Windows/macOS 构建，版本、架构和 runtime/image manifest 可追溯。
- Windows 全新机：无 Docker/Podman、WSL 未启用；提权、重启、续跑、machine 初始化、镜像获取、中文桌面、重启复用。
- Windows 已有 Podman/Docker：不污染用户默认 machine/image/container，开发版与安装版隔离。
- Mac arm64 全新账户：Developer ID、notarization、stapling、首次 bootstrap、machine/image、中文桌面。
- Mac x64：若继续发布，必须用真实或可信 CI 证明 x64 runtime、machine image 和 Cua Driver 全链路；Apple `container` 不作为替代证明。
- 在线/离线、代理、断网恢复、磁盘不足、镜像下载中断和 hash mismatch。
- 全新安装、保留数据升级、应用卸载后数据保留、用户明确选择后的彻底清理。
- shared/per-bot、资源上限、空闲回收、并发锁、端口只在 loopback、workspace 仅精确挂载、容器 label/镜像 digest 不匹配时拒绝复用。
- 中文网页、中文路径、中文剪贴板、桌面菜单和（若承诺）输入法。

## 9. 官方资料与本地依据

### 官方资料

- Podman 安装总览：[Podman Installation](https://podman.io/docs/installation)
- Podman Machine 初始化参数、machine image 与资源配置：[podman-machine-init(1)](https://docs.podman.io/en/latest/markdown/podman-machine-init.1.html)
- Podman Machine 启动：[podman-machine-start(1)](https://docs.podman.io/en/latest/markdown/podman-machine-start.1.html)
- Podman Desktop Windows 安装与 WSL/Hyper-V 前置：[Windows installation](https://podman-desktop.io/docs/installation/windows-install)
- Podman Windows 当前平台与 MSI 行为：[Podman for Windows](https://github.com/containers/podman/blob/main/docs/tutorials/podman-for-windows.md)
- Podman Desktop macOS 安装：[macOS installation](https://podman-desktop.io/docs/installation/macos-install)
- Podman Desktop 创建 machine：[Creating a Podman machine](https://podman-desktop.io/docs/podman/creating-a-podman-machine)
- Podman Desktop Rosetta 说明：[Using Rosetta](https://podman-desktop.io/docs/podman/rosetta)
- Microsoft WSL 安装与系统要求：[Install WSL](https://learn.microsoft.com/windows/wsl/install)
- Microsoft WSL 离线安装：[Offline install](https://learn.microsoft.com/windows/wsl/install#offline-install)
- Apple Virtualization framework：[Virtualization](https://developer.apple.com/documentation/virtualization)
- Apple Virtualization entitlement：[com.apple.security.virtualization](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.virtualization)
- Apple `container` 官方项目及系统要求：[apple/container](https://github.com/apple/container)
- Apple 外部分发代码签名：[Signing Mac Software with Developer ID](https://developer.apple.com/developer-id/)
- Apple 公证流程：[Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- Apple 公证工作流与 stapling：[Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- Electron 官方签名说明：[Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- Podman OCI/Docker archive 导入：[podman-load(1)](https://docs.podman.io/en/latest/markdown/podman-load.1.html)
- Podman 许可证（Apache-2.0）：[containers/podman LICENSE](https://github.com/containers/podman/blob/main/LICENSE)

### 本地一手依据

- OpenMausBot：`server/container-computer.ts`、`electron-builder.yml`、`scripts/prepare-cua.mjs`、`scripts/prepare-cua-windows.mjs`、`apps/docs/content/docs/computers/local-vm.mdx`、`.github/workflows/release.yml`。
- RuijieDSH：`发布交付指南/01-Windows打包指导.md`、`02-macOS打包指导.md`、`03-macOS真人验收测试指导.md`、`macOS代码签名与TCC身份策略.md`。
- RuijieDSH 实现：`dsh-plugin-desktop/src/electron-platform.ts`、`scripts/package-win.ts`、`scripts/package-mac.ts`、`scripts/sign-mac-internal.ts`、`.github/workflows/macos-internal-build.yml`。

## 10. 对后续四份指南的约束建议

后续交付文档宜分别覆盖：统一架构决策、Windows 一体化构建、macOS 一体化构建、双平台最终安装验收。四份文档应共享同一术语和版本事实来源，但不能互相复制易过期的命令清单。每份都要明确：唯一源码位置、允许修改的边界、不可破坏的用户数据、正式产物定义、固定门禁、动态增量、证据格式和“通过/阻断”判定。

最重要的验收原则来自 Harness，但需要改写成 OpenMausBot 的事实：**本地开发时能启动容器，不等于同事拿到安装包后能创建底层 Linux machine；源码里写了中文字体，不等于最终镜像完成汉化；生成 EXE/DMG，不等于一体化 Local VM 已经交付。**
