# 企业打包发布

**个人仓库入口：** 在 `WYunS/OpenMausBot` 中请选择 `main` 分支运行「打包发布」，默认 `all + release`。此仓库的应用源码对应公司已验收的 v0.1.86，个人仓库发布可使用 job 的 `GITHUB_TOKEN`，无需复制公司 Secrets。具体步骤见 [个人仓库打包入口](../发布交付指南/05-个人仓库打包入口.md)。下文及公司交接手册中的 `0.1.86` 工作流分支是公司仓库的入口。

更新：2026-09-21。公司仓库 AI-Applications-Team/OpenMausBot；新流程位于 0.1.86 分支，尚未合入 main。

## 推荐入口

[Actions → 打包发布](https://github.com/AI-Applications-Team/OpenMausBot/actions/workflows/package-release.yml)。
工作流分支选 0.1.86，source_ref 填已经审核的完整提交 SHA。必须同时包含 YAML、.release、脚本、builder 配置、锁文件和 patches。

- platforms 默认 all：Windows x64、Mac arm64、Mac Intel x64、Linux x64 原生并行，最多四个任务。
- mode 默认 release：全部选定平台通过后，汇总同版本/同 SHA 的产物，上传草稿并逐项验证远端大小与摘要，然后发布 Latest。
- prerelease 为预发布，draft 保留草稿，artifacts 只保存 Actions 附件，不创建 Release 或标签。
- version 留空读取 package.json。正式发布使用未发布的新版本；准备阶段可生成独立 release-candidates 分支上的版本提交，不改 main。
- artifacts 要求显示版本与源码一致。修复候选允许重用现有显示版本，但绑定新的源码 SHA；不覆盖旧 Release 或移动历史标签。
- 正式发布仍拒绝已存在的 Release/草稿和指向另一提交的标签。已经上传的旧附件不会随着改源码自动修复。

发布凭据为 Secret RUIJIE_RELEASE_TOKEN（Bot 仓库 Contents/Workflows 读写）；artifacts 只需要当前仓库 GITHUB_TOKEN。
公司 Windows/Mac 另需 Secret RUIJIE_HARNESS_READ_TOKEN，只读固定的私有 Harness 源码及子模块。
管理员交接时确认令牌所有者、有效期、组织/SSO 授权与离职影响；不要将令牌写入源码、文档或日志。

## 版本与当前历史

历史 v0.1.85 Release 的真实源码是 021c4455c4b3c96527e2b103ba12b3c534c9dbdc，只有 Windows、Mac arm64、Mac Intel 三平台。
裸标签 0.1.85 是另一历史引用，不能混用；两者均保留不动。
8538face 提交新增四平台默认自动发布；6a46cf5d 提交修复 Windows 长路径安装/卸载并增加真实安装验收。
后续文档提交不等于历史安装包重建。四平台全流程是否通过，看对应运行和最终 manifest，不能仅根据 YAML 宣称成功。

## 本轮 Windows 修复

旧 NSIS7z 会漏掉超过 260 字符的路径却返回成功，导致 Harness 缺少 machine-id/getMachineId；
one-click 模板在确认卸载后自动静默，用户看不到进度。详见
[Windows 安装回归记录](../docs/verification/windows-installer-2026-09-21.md)。

新实现通过 pnpm patch 精确修改 app-builder-lib 26.15.3，仅企业安装器启用：

- 将校验过固定 SHA256 的 7za.exe 嵌入安装器，直接解压到目标目录，避免临时解压后再次逐文件复制。不依赖用户安装 7-Zip。
- 启用正常安装/卸载进度和完成页。/S 只用于自动化验收或升级。
- 只关闭安装目录里的 Bot 和内置组件；不按进程名误关开发版、独立 Harness 或其他任务。
- 使用长路径删除，残留或进程关闭失败时明确失败；默认保留账号、聊天和工作区数据。
- 保留完整 Harness 依赖和版本锁定，不关闭安全软件。近四万散文件仍有扫描成本，不能承诺所有电脑秒装。

每次 Windows 工作流会在 GitHub-hosted 临时 VM 上运行真正的最终 EXE，检查长安装路径、所有文件摘要，
从安装目录运行 Harness/Feishu/browser/server smoke，再覆盖安装、卸载并核对注册项清理及用户数据保留。
任何一项失败都阻止 Release。证据是 evidence-windows-x64-运行号 内的 windows-installer-lifecycle.json。
该脚本禁止在普通开发电脑运行；不要伪造 GITHUB_ACTIONS 来绕过限制。日常本地回归使用隔离的小型 NSIS 测试。

## 架构、资源与工具链

- Node 24.20.0、pnpm 10.33.0，冻结锁文件；不要删锁或临时升级依赖来掩盖错误。
- Harness 固定 2.1.10 / f48fe5cb09e37c1bcb4ed2c19f75ce5e1bf8aeae；不改变独立 Harness Universal 的源码/发布方式。
- Mac 使用 macos-15 与 macos-15-intel，分别构建原生 arm64/x64；各自只带本 CPU 的 Harness、browser、Feishu。
  最终 Bot 签名串行执行，挂载 DMG 后复核签名和 CPU。不能把两种架构文件混在一起验收。
- Windows 使用 windows-2025；Linux 使用 ubuntu-24.04，交付 AppImage 与 DEB，当前不内置 Harness。
- Windows 浏览器从 .release/windows-browser.json 锁定的 WYunS vendor Release 下载，验证地址、大小和 SHA256。
  这是个人仓库外部依赖，离职交接时须确认长期可用性；迁移源后必须重新审核锁定信息。
- Harness 缓存按目标 CPU 和固定提交分开；命中缓存也执行版本、完整目录摘要及 Mac 签名/CPU 检查。
- macOS ad-hoc 签名、未公证，Windows 未签名。真人账号、Keychain、TCC 与完整业务验收仍须另做；不伪造人工回执。
- 企业流程不发布自动更新 feed。企业入口是 electron-builder.enterprise.mjs；生产 ruijie 配置的人工门禁保持独立。

## 交付与失败处理

| 平台 | 交付文件 |
| --- | --- |
| Windows x64 | RuijieBot-版本-setup.exe |
| Mac arm64 | RuijieBot-版本-mac-arm64.dmg |
| Mac Intel | RuijieBot-版本-mac-x64.dmg |
| Linux x64 | AppImage 和 DEB |

Release 同时提供 SHA256SUMS.txt 与 BUILD-MANIFEST.json。Actions 已验证附件保存 30 天，候选/诊断保存 14 天。
candidate-* 不是已经验收通过的安装包；release-* 才是平台门禁通过后的附件。

失败先找最早报错，不把后续 Artifact not found 当根因。网络/runner 临时故障可重试失败任务；
源码修复后重新固定 SHA 发起运行，不能把旧运行的安装包和新运行的其他平台混装。
上传中断时优先恢复同一草稿并核对所有远端字节；不要删标签重跑或覆盖公开 Release。

原始三平台构建：[35568352927](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35568352927)。
原产物上传验证：[35577075995](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35577075995)。
Windows 修复验收：[35586637648](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35586637648)，安装、覆盖安装、卸载及 39,039 个文件哈希校验全部通过。仅代表此 Windows 候选，不能替代四平台发布验收。

### 0.1.86 四平台修复门禁

已实跑成功：[Run 35589546915](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35589546915)，四个平台及自动 publish 全部通过。
[v0.1.86 Release](https://github.com/AI-Applications-Team/OpenMausBot/releases/tag/v0.1.86) 已发布为 Latest，5 个安装包与 2 个审计附件齐全，共同源码 `1648996ffded608efe73627cd8fa8aa0ac171efa`。
完整交接见 [打包发布交接手册](../docs/打包发布交接手册.md)；生命周期验收 JSON 与构建清单已归档到 `docs/verification/release-0.1.86/`。

选择 `platforms=all`、`mode=release`，四路全部成功后才自动发布新 Release；不覆盖 v0.1.85，不把不同源码的各平台包拼在一起。
Windows 实际执行最终 EXE 的安装、覆盖安装和卸载；Mac 两种 CPU 分别复制最终 DMG 中的应用到带中文和空格的隔离 Applications 目录，检查全部文件哈希、符号链接与权限，再校验签名和包内 Harness/浏览器/飞书/服务端运行。
Mac 还执行替换安装（旧文件必须消失）及应用删除，验证隔离用户数据和独立应用未被删除；耗时与结果归档到各自 `macos-*-install-lifecycle.json`。这是文件安装生命周期验收，不代表已完成 Finder、Gatekeeper、真人账号或 TCC 的人工验证。
Linux 沿用最终 AppImage/DEB 校验、DEB 安装/升级及隔离桌面启动验证；Linux 当前仍不内置 Harness。
任一路失败均保留诊断并阻止发布，修复后使用一个共同源码重新验收。

四份具体指南位于发布交付指南目录，真人 Mac 验收必须分别记录两种 CPU。
