# Windows 安装、启动与卸载回归

日期：2026-09-21。适用入口：公司 `0.1.85` 分支的 `package-release.yml` 和
`electron-builder.enterprise.mjs`。历史 `v0.1.85` 已发布附件仍是旧字节；本文件不是新 Release 已发布的声明。

## 现场原因与可重复证据

- 原 EXE 的 `app-64.7z` 包含 `getMachineId.js`，安装后却缺失。该依赖在用户默认目录下的路径长 262 字符。
- 最小真实 NSIS 复现：`Nsis7z::Extract` 返回 0，短文件存在、长文件不存在；同一归档用固定 7za 返回 0 且两者都存在。
- 直接加载安装后的 `HostDetector.js` 报 `Cannot find module './machine-id/getMachineId'`；从完整独立解压目录加载成功。
- 原始完整归档用固定 7za 解压耗时 507.84 秒。旧安装还会逐文件复制约 3.9 万个文件，增加磁盘与扫描工作；
  此数据只证明解压耗时，不能拿它当作新版完整安装时长。
- 普通 NSIS `RMDir /r` 会留下长路径；使用 `\\?\` 扩展路径前缀后同一复现目录完整删除。
- one-click 模板在确认卸载后执行 `SetSilent silent`，所以用户看不到卸载进度。
- 32 位 PowerShell 的 `Get-Process.Path` 不能可靠读取 64 位进程路径；改用 CIM 查询并核对 PID、创建时间和路径。
- GitHub runner 的 `RUNNER~1` 及用户目录的 8.3 别名会与长路径混用。必须对安装目录和进程路径两边都展开后比较；
  本地回归现显式使用短路径别名，能复现只剩运行中 bundled.exe、卸载无法完成的问题，归一化后通过。
- 覆盖安装前必须将父安装器的当前工作目录移出 `$INSTDIR`，否则子卸载器会删除文件但无法删除父进程占用的根目录。

## 实现

1. `patches/app-builder-lib@26.15.3.patch` 通过 pnpm 锁文件应用，只对定义
   `RUIJIE_LONG_PATH_7ZA` 的企业 NSIS 包启用。不要单独升级 electron-builder 或遗漏该 patch。
2. `scripts/prepare-windows-installer.mjs` 使用 builder 已固定的 7zip 工具集，额外核对 7za.exe SHA256：
   `223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3`。
   可执行文件嵌入安装器，许可进入资源目录；不要求用户安装 7-Zip。
3. 直接解压到安装目录，删除原来的临时展开后 `CopyFiles` 整包复制。解压非零退出即安装失败，不能继续登记成功。
4. 企业 NSIS 改用 assisted 页面，显示安装/卸载过程和完成页。保留 `/S` 供 CI 和升级调用。
5. `build/ruijie-stop-installed.ps1` 先核对企业安装标记，再只停止该目录下的可执行程序。
   不按进程名称关闭程序；独立 Harness、开发版 Bot 及其他任务应保持运行。
6. 卸载用长路径方式移除程序目录，残留时报错并保留注册入口供重试；不默认删除聊天、账号或工作区数据。
7. Harness smoke 除导出路径解析外，实际加载 telemetry 的 HostDetector 及其间接依赖；全目录摘要校验仍保留。

## 验证与发布门禁

本地回归命令：

```powershell
node --test scripts/windows-installer-lifecycle.node-test.mjs scripts/smoke-harness-bundle.test.mjs electron/enterprise-package.node-test.mjs
node --test .release/toolkit/test/tagged-release.test.mjs .release/toolkit/test/core.test.mjs
```

真实小型 NSIS 测试覆盖旧解压器漏文件、修复后长路径保留、损坏归档失败、安装标记错误时停止、
关闭本目录组件、独立进程继续运行、长路径删除和数据保留。另已用实际 electron-builder 编译企业 include，确认模板可以生成安装器。
实际 electron-builder 生成的独立小包还完成了安装、覆盖安装及卸载，长路径为 343 字符；测试注册项和程序目录已清理。

`.release/verify-windows-install.mjs` 只允许运行在 GitHub-hosted Windows runner：

1. 确认 VM 没有既有 Bot 安装，在足够长的专用目录运行最终 EXE。
2. 对比 `win-unpacked` 的每一个文件摘要；从**实际安装目录**运行 Harness、browser、Feishu、server smoke。
3. 再次运行安装器，验证覆盖安装以及用户数据保留。
4. 等待真实卸载进程退出，核对程序目录和注册项消失、用户数据哨兵仍在。
5. 保存 `windows-installer-lifecycle.json`，含安装器摘要、源码 SHA、各阶段耗时与结论。

只要任一步失败，不上传“已验证”安装包，不自动 Release。`candidate-*` 只是失败排查材料。
本地小型回归通过不等于完整安装验收通过；最终结果以对应 Actions 的证据为准。

## 修复候选与边界

使用 `windows + artifacts` 可为同一显示版本构建新的修复候选，manifest 绑定新源码 SHA。
artifacts 模式不读写发布标签或创建 Release；正式发布仍拒绝重用已发布的版本。
不要覆盖历史 0.1.85/v0.1.85 标签、替换原附件或未经评审合并 main。随后用户明确要求整批四平台交付，因此新版本应使用 all + release，各平台单独验收，不能仅凭 Windows 候选成功发布整批。

完整 Windows 修复候选 [Run 35586637648](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35586637648) 已通过，源码为 `8e7722cef75528ca460a31e998d30b9567018d2c`。GitHub Windows VM 实测：安装 93.998 秒、覆盖安装 111.524 秒、卸载 25.751 秒，两次 39,039 个文件全部哈希一致，卸载清理注册项和程序目录并保留数据。该耗时不代表用户原电脑的耗时。
安装器 SHA256：`dab5bff759085b8aca57ef0e25b8d96eadb992d6f445701bee2b45e363743d84`，大小 523,564,914 字节。此候选显示版本仍为 0.1.85，不替换旧 Release；新版本请以四平台正式发布记录为准。

本次没有删减 Harness 的固定依赖，也没有关闭 Defender/其他安全软件。大量散文件的扫描开销仍可能存在。
真人账号、完整业务流程、Mac TCC/签名与 Linux 发布验收不由 Windows 安装测试替代。
