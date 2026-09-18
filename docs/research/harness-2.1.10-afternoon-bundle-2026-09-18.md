# Harness 2.1.10 下午补丁与 Bot 内置运行时

## 升级判断

应更新 Bot 内置 Harness 的源码锁定和实际运行时，无需修改 Bot 的会话协议适配。

- 原锁定：`a7c71c4cadaad2db218d126146973e38649a6f43`，2026-09-18 11:42 +08:00。
- 新锁定：`f48fe5cb09e37c1bcb4ed2c19f75ce5e1bf8aeae`，2026-09-18 15:38 +08:00。
- 两者产品版本均为 `2.1.10`。不能只比较版本号判断是否包含下午修复。
- 实际构建来源：`D:\ChatGPT\RuijieDSH` 的 `main`。构建前后检查 tracked tree 干净；保留原有未跟踪的 PDF 验收 Markdown。
- upstream 子模块仍为 `141eb6fef83422698aef7a981029e843e8161534`，未修改。
- 本地缓存的 `company/main` 与 `ruijie/main` 均指向该下午提交；本轮没有成功联网刷新远端，不能据此断言远端此刻没有更新。

## 审查范围与行为

两个提交间仅 7 个文件变化：新增 `dsh-tool-fs` 与 `dsh-tool-bash` 的 Yarn 补丁、resolutions/lockfile、工具回归测试与说明。没有修改桥接协议、RPC、events mux、会话/停止/提问、模型目录、认证或 upstream pin。

在实际会话已经是 `danger-full-access` 时，`write/edit/bash` 对 schema 接受的冗余提权字段不再提前报错。原先可能出现尚未写入文件就失败，随后模型重试或换工具，令 Bot 看起来迟迟没有产物。此补丁并不证明此前所有响应慢的问题都来自这里。

受限会话仍执行原权限校验；普通参数校验没有取消。`pwsh` 原有修复保留并扩大回归覆盖。无需让 Bot 删除模型参数或修改权限策略。

## Bot 修改

1. `shared/ruijie-harness-release.ts` 与三个 CI 打包工作流统一锁定下午完整提交。
2. Windows 本地启动器优先选择 `dist-native/ruijie-harness/win32-x64`。显式 `OMB_RUIJIE_HARNESS_SOURCE` 仍可覆盖；未暂存 bundle 时保留旧源码后备入口。已存在但损坏的 bundle 交给运行时校验，不静默退回旧源码。
3. `build-ruijie-harness.mjs` 使用 Harness 官方 Windows 打包入口的 `npmRebuild=false`、本地 Electron 分发与 unsigned 设置；通过 Node argv 调用 builder，避免路径被 shell 拆分。保留 afterPack 依赖闭包校验，新增 vendor 副本一致性与构建后源码检查。
4. 实际 EXE 的 ConPTY、后台桥接、空会话查询和退出清理仍待后续获准打包时验证。准备中的验证脚本未执行，已移入本地 `.omb-scratch/verify-evidence/harness-f48fe5c/`，不作为已验证源码提交。

首次真实构建在 Electron Builder 默认重编译 `node-pty` 时失败，错误为找不到 Visual Studio。与 Harness 自有 `scripts/package-win.ts` 比对确认 Bot 构建遗漏了原生 Windows 参数。修复使用正式入口已有的预编译模块路径；参数回归及目录打包通过，但实际包内 ConPTY 执行尚未验证。没有安装编译器或修改 Harness 源码。

## 验证矩阵

基线是上述上午 pin。用户明确本次只处理源码，因此在内置副本的暂存/校验阶段停止了打包及排队的 EXE 验证。此表区分已完成的源码检查与未完成的运行时交付。

| 范围 | 操作与预期 | 结果 |
|---|---|---|
| Bot 协议、停止、提问与包校验 | 真实 Bot 隔离服务器及离线 Harness 协议夹具，5 个测试文件 | 71/71 通过 |
| 启动器与资源路径 | 真实 PowerShell 隔离目录选择，含损坏 stage 和显式源码覆盖 | 17/17 通过 |
| Windows 构建参数回归 | 先复现缺少原生打包参数，再修正 | 修复前 1 项失败；修复后 3/3 通过 |
| Harness 工具与 bridge | 原生 PowerShell 写回临时中文 Markdown；write/edit/bash/pwsh 的完整/受限权限回归 | 75/75 通过 |
| 源码构建 | immutable install、market、vendor、desktop、原生 Windows 目录打包及 afterPack 检查 | 完成；未生成 Setup EXE |
| 实际 bundle | 元数据、提交、完整目录 SHA-256 与新增补丁字节 | 原始目录包三个工具模块与构建来源逐字节一致；Bot 暂存及完整校验被停止，未切换运行时 |
| 实际 EXE | 两个终端副本、后台启动、session.list、owner 清理 | 未执行，排队的验证已停止 |
| Bot 本地预览 | TypeScript、Vite、server bundle 与来源回执 | 编译与当时的回执校验通过；日常运行实例未重启 |

验证日志保存在 `.omb-scratch/verify-evidence/harness-f48fe5c/`。

后续明确需要打包时的构建入口（本次不继续执行）：

```powershell
node scripts/build-ruijie-harness.mjs --source D:\ChatGPT\RuijieDSH
```

## 交付边界

用户随后授权推送最新源码；本次提交只包含源码和说明，不包含二进制、暂存副本、本地诊断脚本或用户数据。不发布新版本，不生成/安装 Bot 或 Harness 的 Setup EXE，不触发安装包工作流。Mac CI pin 一并更新，但 Mac 内置 runtime 必须由原生 Mac 工作流重新构建验证。本轮不代表生产 SSO、真实模型请求或独立安装版全量验收。

日常 Bot 的配置、聊天、登录和正在运行的任务不作为测试夹具。本次没有完成可用内置运行时的暂存，也没有切换日常实例；仅重启不能视为已升级。后续完成内置运行时的构建、校验和暂存后，才通过完全退出并重新打开开发版快捷方式加载它。
