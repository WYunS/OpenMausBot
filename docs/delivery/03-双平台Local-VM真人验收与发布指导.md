# OpenMausBot 双平台 Local VM 真人验收与发布指导

用途：验证最终 Windows/macOS 安装产物，而不是验证开发目录。目标是证明一名没有预装 Docker/Podman 的同事能够完成安装、看到完整中文 Linux 桌面，并让 Bot 安全、稳定地使用它。

## 1. 验收对象

每次报告首先记录：

- Git commit、`package.json` 版本和构建流水线 run ID。
- Windows bootstrapper/NSIS 或 macOS PKG/DMG 的文件名、大小、SHA-256。
- Managed Podman 版本、Machine profile 版本。
- VM 镜像完整 digest、目标架构、Cua Driver 和中文层版本。
- 测试机器型号、OS 版本、CPU 架构、内存、磁盘、网络/代理。
- 测试账户是否全新，是否预装过 Docker/Podman/WSL/Homebrew。

只允许四种结果：`通过 / 失败 / 因环境阻塞 / 未执行`。未执行和阻塞不能写成通过。

## 2. 测试机器矩阵

最低矩阵：

| 编号 | 平台 | 初始状态 | 必测内容 |
|---|---|---|---|
| W1 | Windows 11 x64 | 无 Docker/Podman；WSL2 未启用 | 提权、重启恢复、完整在线安装 |
| W2 | Windows 11 x64 | 无 Docker/Podman；断网 | 离线完整版安装与 OCI 导入 |
| W3 | Windows x64 | 已有用户 Docker/Podman | 不接管、不覆盖，Managed/External 选择明确 |
| M1 | Apple Silicon | 无 Homebrew/Docker/Podman | PKG、Machine、linux/arm64 镜像、TCC |
| M2 | Apple Silicon | 断网 | 离线完整版安装与恢复 |
| M3 | Intel Mac（若支持） | 无 Podman | x64 App、linux/amd64 镜像与真实启动 |

至少 W1 和 M1 必须在非开发人员日常机器以外的干净测试账户执行。开发机已有缓存不能证明首次安装成功。

## 3. 固定安装基线

### 3.1 Windows

1. 确认 PATH 中无 Docker/Podman，记录 WSL/虚拟化状态。
2. 启动最终 bootstrapper，验证发布者、版本和日志目录。
3. 接受系统提权；如果要求重启，重启后应自动恢复到下一阶段，而不是从头下载。
4. 验证只创建 OpenMausBot 专用 Machine，没有修改用户其他发行版或 Machine。
5. 启动安装后的正式快捷方式，不能使用源码开发快捷方式。
6. 打开 App Settings → Local VM，状态应准确落到 ready 或明确的可操作步骤。

### 3.2 macOS

1. 确认无 Homebrew/Docker/Podman 残留，记录 CPU 架构。
2. 使用最终下载字节安装签名、公证并 staple 的 PKG/DMG。
3. Gatekeeper 不得报“已损坏”或来源不明；不得指导用户关闭 Gatekeeper 或删除 quarantine。
4. 验证专用 Podman Machine 创建并启动，架构与安装包匹配。
5. 未选择受保护目录前不应出现 Desktop/Documents/Downloads 权限框。
6. 从 Applications 启动正式 App，不使用构建目录 `.app`。

## 4. Local VM 功能验收

每个平台至少执行：

1. **准备镜像**：显示可理解的下载/导入/校验进度；中断一次后可以安全重试。
2. **创建 Shared VM**：容器 owner、driver、base、locale、workspace label 完整。
3. **Viewer 网络**：端口只监听 `127.0.0.1`，不能从局域网访问。
4. **安全限制**：4 GB、2 CPU、512 PID、512 MB shm、非 privileged、无 host namespace/device、仅所需 capabilities。
5. **持久化**：在 `/home/cua/workspace` 创建中文文件并保存浏览器登录状态；删除并重建容器后仍存在。
6. **空闲回收**：达到策略后容器可被回收，workspace 不被删除；下一次任务能按规则重建。
7. **Per bot**：创建两个 Bot 桌面，目录、容器、viewer 端口和 lease 不串线；资源不足时阻止第三个并说明原因。
8. **重启**：退出 App、重启宿主机、重新启动 App 后能够恢复 Machine 并重新创建可用桌面。
9. **修复**：人为停止 Machine 后界面显示“启动运行时”，修复不删除工作区。
10. **冲突保护**：创建同名但无 OpenMausBot label 的容器，应用拒绝接管或删除。

## 5. 中文桌面验收

不能只检查软件包列表，必须保存截图。桌面至少显示以下内容：

```text
锐捷网络
中文文件名：培训资料（最终版）.pdf
网址标题：产品使用说明与常见问题
混排：OpenMausBot 本地虚拟机 2026
```

检查：

- XFCE 面板、文件管理器、系统菜单无方框、乱码或断字。
- 浏览器网页、标签标题、下载对话框和中文文件名正常。
- 中文字符可复制、粘贴并由 Cua 直接输入。
- 若产品承诺手工拼音输入，验证 IBus/libpinyin 切换、候选框和重启自启动。
- `locale`、字体 fallback、时区和日期格式符合发布定义。
- arm64 与 amd64 分别留证，不能共享一张截图。

任何一个页面“偶尔能显示中文”不等于桌面汉化通过。字体、locale、桌面语言包和输入链路要分别判定。

## 6. 在线、离线与异常路径

### 在线版

- 正常网络首次安装。
- 公司代理/PAC/自签企业证书环境。
- 下载中断、磁盘不足、registry 429/5xx、哈希不匹配。
- 重试时复用已验证完整缓存，不复用部分文件。

### 离线完整版

- 彻底断网仍能安装 runtime、初始化 Machine、导入镜像并启动桌面。
- 安装包内载荷与 manifest 哈希一致。
- 离线版不得在关键步骤偷偷访问 registry 才能继续。

错误信息必须指出失败层：系统虚拟化、runtime、Machine、镜像、容器、Cua Driver、viewer 或工作区。不得统一显示“Retry”。

## 7. 升级、回滚与数据保护

至少从上一个正式版本执行一次保留数据升级：

- App 更新不删除或重建 Machine。
- runtime 不需要升级时保持不动。
- 镜像升级后新容器使用新 labels，旧 workspace 和浏览器 profile 保留。
- 新镜像启动失败时可回退旧镜像，不把半成品标为 ready。
- Windows 重启中断和 macOS 安装取消都可以重新进入正确阶段。
- 用户已有 Docker/Podman、WSL 发行版和非 OpenMausBot 容器不受影响。

卸载分两条验证：

1. 默认卸载：App 消失，workspace 保留并明确告诉用户位置。
2. 明确选择“删除所有 Local VM 数据”：只删除 OpenMausBot 管理的 Machine、镜像、容器和指定 workspace；保留证据确认未触碰其他资源。

## 8. 签名、安装包和更新门禁

### Windows

- 验证最终 bootstrapper、内层 NSIS、辅助程序签名和时间戳。
- 如果当前仍未签名，必须在报告首页写明 SmartScreen 风险，不得称为无警告安装。
- updater 的 `latest.yml`、EXE、blockmap 大小和哈希一致。

### macOS

- 验证 App、PKG、DMG、所有嵌套原生代码的签名身份。
- 公证状态 Accepted，最终 App/DMG/PKG 的 staple 可验证。
- 不清除 TCC 做旧版覆盖升级；同一动作反复弹权限框即失败。
- `latest-mac.yml` 同时准确列出 arm64/x64 ZIP/DMG，staple 后重新计算 feed。

## 9. 动态增量矩阵

固定基线之外，每版必须读取上次已验收 commit 到当前 HEAD 的真实变化：

```text
git log --oneline <last-accepted>..HEAD
git diff --name-status <last-accepted>..HEAD
git diff --stat <last-accepted>..HEAD
```

Git diff 与用户说明取并集。每项记录：`编号 / 功能或风险 / 变更依据 / 平台 / 操作 / 预期 / 证据 / 结果`。

相邻影响示例：

- 改 runtime 探测：回归 Managed 与 External、PATH 污染、daemon 停止和升级。
- 改镜像：回归两个架构、中文、持久化、安全 labels 和离线导入。
- 改工作区路径：回归 Windows 大小写/WSL 路径、macOS TCC、升级保留和卸载。
- 改签名/安装器：回归 Gatekeeper/SmartScreen、自动更新、重启恢复与权限身份。
- 改 Cua Driver：回归版本、MCP、截图、点击、键盘输入和长任务稳定性。

## 10. 证据与阶段结论

每个平台保存：

- 安装全过程截图或录屏。
- bootstrapper/PKG/App/runtime/Machine 日志。
- `podman info`、`podman machine inspect`、镜像与容器 inspect 的脱敏输出。
- 中文桌面截图。
- 最终产物、runtime 载荷和 OCI archive 的哈希。
- 失败的首次时间、精确步骤、错误码和是否可重试。

最终只能给出：

| 结论 | 条件 |
|---|---|
| 允许内部发布 | 两个平台的目标架构和安装模式全部通过，或仅有已记录且不影响安装、数据、安全、Local VM 核心链路的低风险瑕疵 |
| 阻断发布 | 无法安装/启动、需要未声明的预装软件、中文不可读、数据丢失、权限循环、安全边界失效、架构错配或证据不足 |

自动测试通过只能允许进入真人验收。开发版成功、`win-unpacked` 成功、构建机已有 Podman 时成功，都不能替代最终安装包在干净电脑上的结果。

## 11. 每次发布后的维护

只有发现可复现的新坑并有明确根因与验证方法时，才更新本指南。一次性网络抖动留在当次报告，不写进永久步骤。更新后检查四份指南之间的版本、路径、命令和术语一致，并把新增门禁与对应自动化测试一起提交。
