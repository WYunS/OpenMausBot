# 锐捷Bot：Windows 打包指导

## 最新修复与验收入口（2026-09-21）

当前默认是 all + release；仅测试 Windows 修复请显式选 windows + artifacts。工作流分支选 0.1.86，source_ref 固定审核后的新 SHA。
0.1.86 整批正式交付选择 all + release，必须等 Windows、两种 Mac、Linux 全部成功再统一发布；Windows 修复候选通过不等于整批版本已交付。source_ref 使用完整 40 位 SHA，短 SHA 可能被 checkout 当作分支名而失败。
本轮发现旧安装器漏掉长路径依赖，源码已改为固定 7za 直接解压、正常卸载进度、按安装目录关闭组件和长路径删除。
工作流新增最终 EXE 的实际安装、逐文件摘要、安装目录 smoke、覆盖安装、卸载及数据保留门禁。
详见 [现行流程](../.release/README.md) 和 [故障与验证记录](../docs/verification/windows-installer-2026-09-21.md)。
旧 v0.1.85 附件没有被替换，下载时务必核对修复候选的源码 SHA 和验收结论。


更新：2026-09-21。本篇适用于公司企业内测的 Windows x64 安装器。

## 0. 0.1.85 本轮执行方式

用户已授权适配工作流并实际打包。使用公司 `0.1.86` 分支的最新工作流，`source_ref` 填本轮确认的完整提交 SHA。
已有 `refs/tags/0.1.85` 保持原指向；不移动旧标签，也不假定该标签包含后续流程修复。
`platforms=desktop` 一次构建 Windows、Mac arm64、Mac x64；`mode=artifacts` 只保存可下载测试产物。
artifacts 模式要求 package.json 与请求版本一致，prepare 不写远程候选提交；运行器生成元数据，三平台都使用同一 SHA。
本地旧 0.1.84 的 dist、缓存或停止的候选不能作为本轮安装器。

本轮实际运行发现 Node 24 的同步临时目录删除遇文件占用会直接 EPERM；
cloudflared 已改为有界异步重试，并用真实 Windows 文件锁回归。不是跳过下载摘要或版本检查。

## 1. 打包者先确认这五件事

1. 仓库是 `AI-Applications-Team/OpenMausBot`，使用审核后的发布源码 SHA；不假设 main 已与本地同步。
2. 工作流为 `.github/workflows/package-release.yml`，Actions 名称“打包发布”；
   `Use workflow from` 与 `source_ref` 均指向包含完整新实现的版本。
3. 公司 Secret `RUIJIE_HARNESS_READ_TOKEN` 可只读检出固定 Harness 提交及所需子模块。
   Secret 名称存在不代表 token 未过期或组织访问已授权；不要在日志中输出值。
4. `.release/`、Harness 构建/校验脚本、enterprise builder、底层资源配置及锁文件已一起提交。
   只复制 YAML、四份指南，或遗漏未跟踪的新脚本都不够。
5. 选择企业内测，不准备正式发布的真人验收 JSON、沙箱预置或签名证书。
   但源码、哈希、许可、资源和 smoke 检查均不能跳过。

本篇当前基线：构建 Node `24.20.0`、Bot `pnpm@10.33.0`，
以 `.release/config.json` 和 `package.json` 为准。
运行器为 `windows-2025`；本机诊断命令使用 PowerShell 7.4+。
不要为了跑通而升级包管理器、删除锁文件或从个人电脑复制依赖目录。

## 2. 推荐操作：公司“打包发布”

完成集成且获得运行授权后，在
[公司 Actions 入口](https://github.com/AI-Applications-Team/OpenMausBot/actions/workflows/package-release.yml)
填写：

| 字段 | Windows 候选填写方式 |
| --- | --- |
| Use workflow from | `0.1.86` 分支 |
| source_ref | 含全部配套代码的同一审核分支或固定提交 |
| version | 留空使用源码版本；若另指定，须由负责人确认未占用 |
| platforms | `windows`，不要误选含 Linux/Mac 的 all |
| mode | `artifacts`，只保留 Actions 产物 |

界面默认 mode 是 `artifacts`，不会创建 Release 或候选源码分支；
已有同版本 Release（包括草稿）仍会阻断。版本和 SHA 规则详见通用指南第 2 节。

不要改跑以下旧入口来“试一下”：

- `pnpm package:win` 仍走正式品牌回执门禁，不等于企业候选命令。
- `.github/workflows/package-win.yml` 虽然叫 Package Windows，仍调用上述旧路线，
  还带旧超时、资源路径和更新源检查；不是本次推荐入口。
- 不要直接执行默认 `electron-builder.yml`，它有上游发布身份。
- 本文不提供绕过 prepare 元数据、指纹和资源准备的裸 electron-builder 命令。

本轮执行结果以对应 Actions run 与最终 manifest 为准，不以指南本身宣告通过。

## 3. 新流程实际会准备什么

| 步骤 | 实际行为与应看到的结果 |
| --- | --- |
| prepare | 校验集成文件/Windows vendor 可达性，固定版本、源码与 toolkit，输出最终构建 SHA |
| Harness 检出/准备 | 检出固定源码，恢复或构建 `dist-native/ruijie-harness/win32-x64`；完整校验后才能复用 |
| Bot 构建 | 获取固定 Windows 浏览器，运行 `package:prepare` 构建当前 UI/server/companion/updater 等资源 |
| Windows 资源 | 准备 CUA、飞书 CLI/Node；完成资源准备后记录构建指纹 |
| 包装 | 企业配置生成 NSIS 安装器，不附带开发者账号 |
| 自动 verify | 校验资源、Harness 包内导出、飞书 Node/CLI、浏览器、打包服务端和未签名状态 |
| 收集 | 生成该平台 manifest，校验最终大小/哈希；不混入旧 release 目录产物 |

### Harness 不再是“用户另装”

内置 Harness 固定 `2.1.10` /
`f48fe5cb09e37c1bcb4ed2c19f75ce5e1bf8aeae`，以共享 pin 为准。
空 runner 首次需要构建；已有缓存也要核对完整目录摘要、版本和提交，不能只检查 exe 存在。
Windows 脚本显式安装锁定 Electron；Harness 的 Yarn/file: 元数据由脚本稳定化，
不重建已提交的 vendor-sidebar，不手工改它的公共发行配置。
公开独立 Harness 的 Universal 下载不受这次 Bot 打包调整影响。

### 浏览器、飞书及其他资源

- Windows 浏览器由 `.release/windows-browser.json` 和 `.release/fetch-windows-browser.mjs`
  获取已批准的 `0.36.0-omb.2` vendor，验证 ZIP/EXE 摘要与来源。
  不要求维护者提供某个 D 盘目录，不回退 `.1` 或任意 npm 最新版。
- 飞书 staging 为 `dist-native/feishu-runtime/win32-x64`；
  当前源码 pin 是 CLI 1.0.93 / Node 24.15.0，详见 `connectors/feishu/runtime-artifacts.mjs`。
  它与构建 Node 24.20.0 是不同用途，不应统一替换。
- CUA、cloudflared、浏览器、Android 工具等按自己的固定准备脚本处理；
  不需要为正常打包从零编译 Chromium，也不能只复制一个 exe 而漏掉 manifest/许可。
- 首次安装运行不应靠开发机 PATH、全局 npm、开发 node_modules 或个人已安装 Harness 补缺。

网络/缓存故障按 [通用失败表](04-通用回归与发布门禁.md#5-失败时先查第一条错误不要反复重打) 定位，
不能关闭 TLS/哈希检查，也不能让安装用户全局 npm install 来修“缺模块”。

## 4. 构建资源与交付物核对

本次工作流的构建目录是 `release/win-unpacked/resources`。
至少应含当前构建的 `app.asar`、`ui/`、`server/`、`companion/`、
CUA、cloudflared、完整 `browser-engine/`、`tuantuan-feishu/`、
`tuantuan-feishu-runtime/`、`ruijie-harness/`、许可证及 `enterprise-release.json`。

不要再用旧文档硬编码的 CLI 子目录清单替代版本 manifest 检查。
在**构建该候选的同版检出**中、获得诊断运行授权后，可补查已有资源：

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$repoRoot = (git rev-parse --show-toplevel).Trim()
$resources = Join-Path $repoRoot 'release/win-unpacked/resources'
$previousRepository = $env:GITHUB_REPOSITORY
try {
  $env:GITHUB_REPOSITORY = 'AI-Applications-Team/OpenMausBot'
  node scripts/check-enterprise-package.mjs $resources
  node scripts/smoke-harness-bundle.mjs (Join-Path $resources 'ruijie-harness')
  node scripts/smoke-feishu-package.mjs $resources
  node scripts/smoke-browser-bundle.mjs --resources $resources
} finally {
  $env:GITHUB_REPOSITORY = $previousRepository
}
```

这些 smoke 使用隔离临时数据，但不是安装向导或真人账号验收；源码检出必须与候选版本一致。
服务端 smoke 已由 workflow adapter 运行；不要改用固定端口启动服务污染用户正在使用的客户端。

公司包 `app-update.yml` 应为 GitHub / `AI-Applications-Team` / `OpenMausBot`，
没有 token 或 publisherName；个人 WYunS 包才匹配 WYunS。
包内存在更新配置不等于企业入口提供自动更新 feed。

交付安装器为 `RuijieBot-<版本>-setup.exe`。
从 `release-windows-x64-<run>` artifact 取已自动验证的包与 manifest，
并保留汇总 `SHA256SUMS.txt` / `BUILD-MANIFEST.json`。
`candidate-windows-x64-<run>` 的 pending 包不能冒充通过包。
本企业入口不要求便携 ZIP、latest.yml 或 blockmap；这些不在本次交付资产清单中。
安装器当前应报告 `NotSigned`，不能填写虚假的 publisherName 或“已签名”。

## 5. 安装版真人验收：候选生成后再做

使用获授权的专用 Windows 系统账户；安装/覆盖前记录测试数据，禁止操作日常真实账户。
从候选安装器安装后，通过安装快捷方式打开，不从源码或本地开发快捷方式启动。

1. 记录版本、最终安装器 SHA-256、实际 exe/resources 路径和签名状态；
   不安装开发 Node/pnpm/Harness 也能冷启动。窗口/卸载入口品牌为锐捷Bot，兼容 App ID 不变。
2. 空配置连续建两个 Bot，退出重开再建一个，均默认“这台电脑”；
   旧 Bot 的既有电脑选择保留，不索要沙箱配置。
3. 用包内 CUA 截图、点击、键盘输入。放大/缩小或仅鼠标移动不应误接管，
   真实用户操作后暂停、交还后继续。首次授权由测试者完成。
4. 内置 Harness 使用测试者在 Bot 中的授权，实际发送普通消息及无害工具请求；
   不无故弹独立 Harness GUI，不从其他安装/源码目录取依赖。
   未登录、额度不足、网络失败应分别说明；图片用实际支持的模型，不凭空要求账号拥有某个型号。
5. 浏览器两种启动顺序、三轮接管交还、60 秒原流、超时取消/网络恢复，
   按通用指南第 4 节执行；Windows 冷启动/重启不能弹额外终端。
6. 飞书用包内固定 CLI/Node，实际授权、只读调用及重启恢复；IM 发送仅面向明确授权的测试接收方。
   首次连接不能靠临时下载或全局 npm 升级。
   用户反馈的升级下载超时/误报未授权仍需专项核查，不因 smoke 通过就写成已解决。
7. 已有插件连接、测试聊天、设置在重启/覆盖升级后保持；离线首启恢复网络后可重试，
   不靠清缓存或重装恢复。没有测试账号就标环境阻塞，不能提前伪造人工回执。
8. 普通/窄窗口和 Windows 缩放下，设置能关闭、输入及工具输出可读、主要控件不遮挡。
   临时 Bot 删除/归档/恢复正常，离线电脑不阻断本地删除，独立远端资源不被顺带销毁。
9. 开发与安装服务数据分别为 `~/.openmausbot`、`~/.ruijiebot`；不复制加密凭据或浏览器 cookie。
   Local VM/云电脑按本版承诺及真实环境另测，不默认要求安装器自带 Podman 或 VM 镜像。

这些真人项目不会由当前 Windows `verify-windows.ps1` 自动完成；
该脚本只检查安装器的未签名状态，其他自动 smoke 也不能替代安装/升级验收。

## 6. 留证与重试

记录仓库、工作流版本、最终构建 SHA、工具版本、运行时 pin、安装器大小/SHA-256、
自动检查结果、人工“通过/失败/环境阻塞/未执行”及未测边界。
公司内测使用手动下载安装器升级，不用临时发布 Release 来验证更新。

缺正式 receipt 时先确认是否走错入口；缺集成脚本时先修源码版本；下载故障才重试对应步骤。
源码修复后发起新运行，旧 Run 的 Re-run 不会自动采用新提交。
本地预览通过不能替代新安装器；真正缺依赖、核心工具失败、数据损坏或安全问题必须阻断交付。
