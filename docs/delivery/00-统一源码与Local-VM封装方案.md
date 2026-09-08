# OpenMausBot 统一源码与 Local VM 封装方案

用途：定义 OpenMausBot 在同一套源码中为 Windows 和 macOS 提供“安装后即可准备 Linux 桌面”的总体方案。本文件是实施蓝图，不代表当前安装包已经内置 Podman。

## 1. 结论

保持一套业务源码和一套 Linux 桌面定义，不复制 Windows、macOS 两个长期仓库。

推荐交付结构：

```text
OpenMausBot UI / Bot / 会话（完全共用）
            │
LocalVmService（共用状态机和安全契约）
            │
ManagedRuntimeProvider（共用接口）
       ┌────┴────┐
       │         │
 Windows       macOS
 WSL2          Apple Virtualization Framework
 Podman        Podman Machine
       └────┬────┘
            │
同一份多架构 OpenMausBot Cua Linux 桌面镜像
  linux/amd64 + linux/arm64
```

产品默认使用由 OpenMausBot 管理的 Podman。开发者已经安装的 Docker/Podman仍可作为“外部运行时”兼容入口，但正式安装包不得要求普通同事预装 Docker Desktop 或 Podman Desktop。

源码也已识别 macOS 的 Apple `container` CLI。它可以保留为新系统上的实验性外部运行时，但当前固定 viewer 端口使它不支持 Per bot 多桌面，因此不能替代本方案默认的 Managed Podman。

不建议把 Docker Desktop打进安装包：它体积大、交互和更新由另一款桌面产品控制，并存在企业授权与后台服务边界。Podman 的 CLI、Machine 和 rootless 容器模型更适合作为产品托管运行时，但第三方二进制仍须固定版本、校验哈希并附许可证。

## 2. 当前源码的真实基础

唯一构建根目录：

```text
C:\Users\Yunsh\Documents\ChatGPT\Bot\downloads\OpenMausBot-source
```

版本号唯一来源：`package.json`。

当前已经存在：

- `server/container-computer.ts`：Docker、Podman 与 Apple `container` 的探测、镜像构建、容器生命周期、安全限制、持久化挂载和回环 viewer。
- 固定 Cua 基础镜像 digest、Cua Driver 版本、镜像标签和 4 GB / 2 CPU / 512 PID 限制。
- Windows 上优先选择 Podman，并校验 Windows 路径映射到 Podman Machine 后的精确挂载源。
- macOS arm64/x64 两套 Electron 产物和 Cua 原生资源。
- Windows x64 NSIS、macOS arm64/x64 DMG、自动更新 feed 和 GitHub Actions 发布流水线。
- `vm-image/Containerfile` 已成为可审阅的正式镜像源；包含 `zh_CN.UTF-8`、Noto CJK/Emoji、IBus/libpinyin、固定 Cua Driver 校验和及镜像标签。
- `pnpm build:local-vm-image -- --runtime=<docker|podman> --platform=<linux/amd64|linux/arm64>` 可生成按架构拆分的 OCI archive、SHA-256 sidecar 和 manifest。
- 运行时优先校验并导入随包 OCI archive；开发目录没有 archive 时仍保留动态构建兼容路径。

当前尚未具备：

- 安装包自动交付并管理 Podman；目前 UI 仍提示用户自行安装/启动容器运行时。
- Windows 自动启用 WSL2、处理重启并恢复安装。
- macOS 随产品交付受信任的 Podman CLI/Machine 组件。
- CI/发布机实际生成并签收两种架构的 OCI 大文件（源码只包含构建定义，不提交数 GB 产物）。
- XFCE 与浏览器的逐项人工汉化验收；locale、字体和中文输入法依赖已经进入镜像。
- 对“无任何预装运行时的新电脑”的最终安装包验收门禁。

因此不能只在 `electron-builder.yml` 增加几个 `extraResources` 就声称完成。运行时安装、系统能力启用、Machine 创建、镜像导入、版本迁移和卸载是一个独立生命周期。

## 3. 建议增加的模块边界

后续实现时保持现有 `container-computer.ts` 的容器安全契约，把“宿主机运行时准备”放进独立深模块：

```text
desktop-runtime/
├─ contract.ts                 # 状态、错误码、进度事件、取消语义
├─ manifest.json               # Podman/辅助程序/镜像版本与 SHA-256
├─ manager.ts                  # 幂等状态机，不包含平台命令细节
├─ external-runtime.ts         # 兼容开发者已有 Docker/Podman
├─ windows/
│  ├─ prerequisites.ts        # 虚拟化、WSL2、管理员权限、重启检测
│  ├─ installer.ts            # 受控安装/修复 Podman
│  └─ machine.ts              # init/start/stop/inspect
└─ macos/
   ├─ prerequisites.ts        # 系统版本、架构、虚拟化能力
   ├─ installer.ts            # 受控安装/修复 Podman
   └─ machine.ts              # init/start/stop/inspect

vm-image/
├─ Containerfile              # 正式、可审计的桌面派生镜像
├─ locale/                    # locale、字体、XFCE/浏览器设置
└─ manifest.json              # 多架构 digest、SBOM、许可证
```

不要继续把正式镜像完全拼成 `managedImageDockerfile()` 字符串。短期可以保留该函数兼容开发模式；正式发布应使用仓库内可审阅的 `Containerfile`，CI 构建多架构镜像并把不可变 digest 写进 manifest。

`LocalVmService` 只依赖以下稳定接口：

```ts
interface ManagedRuntimeProvider {
  inspect(): Promise<RuntimeStatus>;
  installOrRepair(): Promise<ProvisionResult>;
  initializeMachine(profile: MachineProfile): Promise<void>;
  startMachine(): Promise<void>;
  importImage(source: ImageSource): Promise<ImageIdentity>;
  removeManagedResources(options: RemoveOptions): Promise<void>;
}
```

状态必须至少区分：`unsupported / needs-admin / needs-reboot / runtime-missing / runtime-stopped / image-missing / ready / repairable / failed`。界面根据稳定错误码翻译，不能解析英文 stderr 决定下一步。

## 4. 运行时选择与隔离策略

### 4.1 正式版默认

- 使用产品固定版本的 Podman，运行时来源、目标平台、签名身份和 SHA-256 记录在 `manifest.json`。
- 使用专用 Machine 名称，例如 `openmausbot-machine-v1`，不得接管用户已有的默认 Podman Machine。
- 容器、网络、volume 和 label 使用 `openmausbot` 命名空间。
- 优先调用产品解析出的绝对 CLI 路径，不依赖用户 PATH，也不因用户另装 Docker 而切换镜像仓库。
- 只管理带有正确 owner、版本和工作区 label 的资源；同名但无标签的容器必须拒绝删除。

### 4.2 开发模式

- 允许继续使用机器上已有的 Podman/Docker，便于本地开发。
- 通过显式配置选择 `managed` 或 `external`，不要用“PATH 里先找到谁”作为正式版最终决策。
- 开发 Machine、正式 Machine、Electron userData 和持久化工作区完全隔离。

### 4.3 资源预算

当前每个桌面容器上限是 4 GB、2 CPU，但多个容器共享同一个 Podman Machine。Machine 资源不能简单等于单容器上限。建议：

- Shared 模式：Machine 至少 4 GB / 2 CPU。
- Per bot 2 个：Machine 建议 8 GB / 4 CPU，同时保留物理机余量。
- 根据物理内存计算可选上限；资源不足时阻止创建并给出中文解释。
- 空闲回收只删除可重建容器，不删除持久化工作区或整台 Machine。

## 5. 中文 Linux 桌面标准

“安装中文字体”只解决不显示方框，不等于完成汉化。正式镜像至少分四层验收：

1. **字形**：安装 Noto CJK 与 emoji 字体，执行 `fc-cache -f`，验证简体中文样本文字。
2. **locale**：生成 `zh_CN.UTF-8`，默认设置 `LANG=zh_CN.UTF-8`、`LANGUAGE=zh_CN:zh`；避免写死无效的 `LC_ALL`。
3. **桌面与应用翻译**：安装与基础发行版匹配的 XFCE、GTK 和常用应用中文语言包；Chrome/Chromium设置 `zh-CN` 首选语言。
4. **输入法**：如果用户会在 noVNC 里手工输入中文，再安装并启动 IBus + libpinyin；如果只由 Cua 直接注入 Unicode，可把输入法做成可选层，避免增加后台复杂度。

同时设置 `TZ=Asia/Shanghai` 只能改变时区，不能替代 locale。镜像必须在 amd64 和 arm64 上分别构建、运行并截图验证，不能因为 manifest 是 multi-arch 就假设两个架构内容相同。

建议把中文层变更纳入新的 `IMAGE_LAYER_VERSION`，并用 label 记录：

```text
com.openmausbot.image-layer
com.openmausbot.locale=zh_CN.UTF-8
com.openmausbot.fonts=noto-cjk
com.openmausbot.cua-driver
com.openmausbot.cua-base
```

旧容器发现 label 不匹配时提示“重建桌面”，保留 `vm-home`，不要原地修改正在使用的容器。

## 6. 在线版与离线完整版

建议每个平台都形成两类交付物，但共用同一源码和版本：

| 版本 | 安装包包含 | 首次运行 | 适用场景 |
|---|---|---|---|
| 在线版 | OpenMausBot、运行时引导器、固定 manifest | 下载/安装 Podman 和镜像 | 普通办公网络 |
| 离线完整版 | 上述内容 + 固定 Podman 安装载荷 + OCI 镜像归档 | 本地校验并导入 | 内网、培训、批量部署 |

离线镜像使用 `oci-archive` 或双方运行时都验证过的 archive 格式，通过 `podman load` 导入，文件名带版本和架构。不要把 amd64 与 arm64 层无差别塞进每个安装包。`podman machine init --image` 配置的是 Podman Machine 自己的 Linux 系统镜像，不是 OpenMausBot 的中文 XFCE 容器镜像，禁止混用。

所有载荷必须有：来源 URL、版本、目标平台/架构、SHA-256、签名身份、许可证和 SBOM。Podman 主项目采用 Apache-2.0 不代表其完整运行闭包、Machine 镜像、字体和基础容器层可以不经审计直接再分发。首次准备时先完成许可证/NOTICE 审计并校验载荷，再安装/导入；失败不得继续使用部分文件。

## 7. 更新与卸载边界

把三类版本分开：

- App 版本：`package.json`。
- Managed runtime 版本：Podman/辅助程序 manifest。
- VM image 版本：基础 digest + Cua Driver + 中文层版本。

应用自动更新不能无提示替换正在运行的 Machine。推荐流程：检测新镜像 → 后台下载/校验 → 等所有 Local VM 停止 → 创建新容器 → 验证桌面 → 切换；失败回退旧镜像。持久化工作区始终独立于容器和镜像。

默认卸载只移除应用。卸载器应明确提供可选项“同时删除 OpenMausBot 管理的虚拟机、镜像和工作区”，并显示预计大小；未经用户明确选择不得删除工作区。

## 8. 实施顺序

1. 把当前动态 Dockerfile 固化为可审查的多架构镜像，并完成中文显示/locale 验收。
2. 引入运行时 manifest 与 `ManagedRuntimeProvider`，保持现有外部 Docker/Podman路径通过。
3. 先完成 Windows 的 WSL2 + Podman 幂等引导和重启恢复。
4. 再完成 macOS Podman Machine、双架构载荷和签名公证闭包。
5. 增加在线下载与离线镜像导入两条路径。
6. 最后接入安装器、自动更新、修复和卸载入口。
7. 只有第四份指南的最终安装包真机矩阵通过，才能写“无需预装 Docker/Podman”。

## 9. 不采用的方案

- 不复制 `OpenMausBot-Windows`、`OpenMausBot-Mac` 两套业务源码。
- 不把宿主机 Docker daemon 暴露给桌面容器。
- 不静默接管或删除用户已有 Docker/Podman 资源。
- 不把联网 `pull` 成功当作离线可交付证明。
- 不在 Windows 上交叉生成最终 macOS 包，也不在 macOS 上把未安装验证的 Windows EXE 判为通过。
- 不复制锐捷 Harness 的 Bundle ID、证书、TCC 身份、数据目录或产品命名；只复用它“唯一源码、固定版本、最终产物复验、真人门禁”的发布原则。

## 10. 相关指南

- [01-Windows一体化打包指导.md](01-Windows一体化打包指导.md)
- [02-macOS一体化打包指导.md](02-macOS一体化打包指导.md)
- [03-双平台Local-VM真人验收与发布指导.md](03-双平台Local-VM真人验收与发布指导.md)
- [research-cross-platform-vm.md](research-cross-platform-vm.md)：官方资料和 Harness 参考研究记录。
