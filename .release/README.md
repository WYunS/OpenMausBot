# 企业一键打包发布

入口：[Actions → 打包发布](https://github.com/AI-Applications-Team/OpenMausBot/actions/workflows/package-release.yml) → **Run workflow**。

1. 工作流分支和 `source_ref` 通常都选 `main`。
2. `version` 填一个未发布过的版本，例如 `v0.1.76`。留空读取所选源码的 `package.json`；不会自动增加版本号。
3. `platforms` 默认 `all`；也可以只选 `macos`、`windows` 或 `linux`。
4. `mode` 默认 `prerelease`，全部检查通过后自动发布到本企业仓库的 Releases；`draft` 保留草稿，`artifacts` 只上传 Actions 产物。

无需个人账号 token、沙箱密钥、Apple 证书或 Windows 签名证书。工作流使用仓库内置 `GITHUB_TOKEN`，只在准备源码和发布任务中取得 `contents: write`。仓库当前是 **internal**，下载权限由企业仓库权限控制。

## 最终文件

| 平台 | 交付物 |
| --- | --- |
| macOS | `RuijieBot-版本-mac-universal.dmg`，一个文件包含 Apple Silicon 和 Intel |
| Windows x64 | `RuijieBot-版本-setup.exe` |
| Linux x64 | AppImage 和 DEB |

Release 同时提供 `SHA256SUMS.txt`、`BUILD-MANIFEST.json`。Actions 页面也保留安装包：已验证产物 30 天，尚未完成验收的候选和诊断产物 14 天。上传候选不等于验收成功。

## 源码与配置

每次运行固定所选分支当时的提交；工作流只在独立 `release-candidates/` 分支上调整包版本并生成无密钥的构建说明，不回写业务源码或覆盖 main。所有平台、Intel 验证和 Release 都核对同一提交与 SHA256。重复版本会在开头停止，避免覆盖已发布文件；使用新版本，或先由维护者处理已存在的草稿/标签。

构建使用仓库锁定的依赖和实际代码。没有沙箱预设时不会要求补密钥；不添加旧账号配置、不改变新 Bot 默认使用“此电脑”的源码设置、不迁移或清空现有用户数据。应用身份与缓存路径沿用源码，安装包名称为 RuijieBot。首次登录、模型账号和其他服务配置由使用者在应用内完成。

Windows 浏览器使用新版指南批准的 WYunS 上游依赖 Release，并在 `.release/windows-browser.json` 锁定下载地址、大小与 SHA256；仍执行仓库原有来源验证。其余原生资源依照仓库脚本准备。更新依赖版本时需要同步这些锁定信息，外部依赖下架、GitHub runner 故障或组织策略变化仍可能使构建停止。

本工作流不依赖私人账号的 release-kit 仓库。通用发布模块位于 `.release/toolkit`，本项目的构建与验证位于 `.release/adapter.mjs`；其他项目可复用通用模块并提供自己的适配器，不能把本项目原生资源检查直接用于任意软件。

## 签名、Universal 与验收范围

- Windows 使用未签名测试安装包。macOS 使用 ad-hoc 签名，**没有 Apple Developer ID 签名或公证**；系统可能要求手动确认打开，TCC 授权无法承诺跨版本稳定保留。
- Universal 流程合并 Electron、辅助程序与共享原生组件，同时保留 browser/Feishu 的 `darwin-arm64`、`darwin-x64` 独立树，运行时按实际 CPU 选择。它并非新版指南中规划的统一 `Resources/native/darwin-*` 全量迁移。
- 在 Apple Silicon 构建、逐个检查 Mach-O 架构和签名、挂载最终 DMG 复验，再把**同一个哈希的 DMG**交给原生 Intel runner 运行浏览器、飞书 CLI 和服务冒烟验证。Windows/Linux 同样执行资源与实际程序冒烟，Linux 还检查 DEB 安装/升级和桌面集成。
- 自动化通过不代表真人账号登录、Keychain、持久 TCC 或全部 GUI 业务验收已完成。生产 `electron-builder.ruijie.mjs` 的验收门禁保持不变；本工作流显式使用 `electron-builder.enterprise.mjs` 内部测试配置，不生成虚假的人工验收回执。
- 本企业流程只发布安装包，不提供自动更新 feed。后续版本从本仓库 Releases 下载并安装；原上游发布流程仍保留，不用于此企业入口。

## 失败处理

查看失败任务的具体步骤和 `evidence-*` Artifact。依赖下载或 runner 临时故障可重试失败任务；源码修复后应从 main 重新 Run workflow，避免把不同提交的产物混装。首次启用若组织禁止某个 Action、没有 runner 额度或禁止工作流写仓库，需要企业管理员调整对应策略；其余正常发布不需要额外 Secrets。
