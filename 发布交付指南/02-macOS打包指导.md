# 锐捷Bot：macOS 分架构打包指导

## 当前发布入口（2026-09-21）

统一 workflow 默认 all + release，包含两个原生 Mac 任务以及 Windows、Linux；单测 Mac 可选 macos + artifacts。
公司新流程仍在 0.1.86 分支；不要自动改选 main。Windows 修复不改变 Harness 2.1.10 或独立 Universal 发布。
最新入口、权限、候选/正式发布区别见 [现行流程](../.release/README.md)。
历史 v0.1.85 两份 DMG 已完成原生构建和自动检查；这不代表下文真人验收已完成。


更新：2026-09-21。本篇替代旧 Bot Universal 实施清单，不保留可照抄执行的旧合包步骤。
本轮交付 Apple Silicon、Intel 两份 DMG；仅 Bot 内置 Harness 随之分架构。
独立下载的 Harness Universal 版本及其源码/发行流程不修改。

先完成 [通用指南的工作流更新清单](04-通用回归与发布门禁.md#1-维护者怎么更新公司工作流)。
本地已准备的脚本不等于公司远端已同步，更不等于 Mac 最终 DMG 已构建、验签或真人通过。
0.1.85 本轮已获授权更新工作流并执行原生 Mac 双包构建。实际通过状态以运行日志和最终 manifest 为准。

## 0. 首次分架构发布的准备状态

源码已准备 `macos-arm64` / `macos-x64` target、对应 runner 映射、thin App/DMG 包装、
Harness 单架构覆盖配置、串行签名、包内依赖解析检查和分平台 manifest 收集。
这些是首次双包发布的基础，不代表两种 CPU 的原生构建已实测。

公司 `0.1.86` 分支工作流已接入固定 Harness 检出、分架构缓存/准备、单 CPU 校验、Mac 句柄限制和 metadata_local 输出。
使用更新后的工作流分支，source_ref 固定本轮新提交 SHA；原 0.1.85 tag 不移动。

挂载 DMG 的路径可能同时以 `/var` 和 `/private/var` 表示同一目录。
Harness 导出 smoke 对 bundle 根目录与解析结果都使用 realpath 后检查包含关系；
目录别名应通过，真正链接到包外或借用父目录依赖仍须失败。

共同准备：同一 Bot 0.1.85 源码 SHA、同一 toolkit tree SHA、Harness 2.1.10 固定提交、
私库只读访问和相同依赖锁文件。分开准备：原生 runner、Node/Electron CPU、Harness/CUA/浏览器/飞书运行时、
缓存键、暂存目录、签名审计、DMG、manifest 和真人验收记录。
一次 `platforms=macos` 的未来矩阵可以同时生成两包；“分两包”不要求手工运行两次或维护两条源码分支。
若分次构建，也必须固定同一最终构建 SHA，不能把不同候选提交的产物拼到一起。


## 1. 先确定目标、原生机器和交付路径

| 项目 | Apple Silicon | Intel |
| --- | --- | --- |
| Actions platforms 单选 | `macos-arm64` | `macos-x64` |
| 企业矩阵 target | `macos-arm64` | `macos-x64` |
| 运行时/staging target | `darwin-arm64` | `darwin-x64` |
| 原生 runner | `macos-15` | `macos-15-intel` |
| Node / Electron process.arch | `arm64` | `x64` |
| lipo 主程序期望 | `arm64` | `x86_64` |
| 构建中 App | `release/mac-arm64/OpenMausBot.app` | `release/mac/OpenMausBot.app` |
| 最终安装器 | `RuijieBot-<版本>-mac-arm64.dmg` | `RuijieBot-<版本>-mac-x64.dmg` |

`platforms=macos` 在同一次运行构建并验证两份。
两包共用 Bot 版本与 prepare 输出的最终构建 SHA，但包字节、大小和 SHA-256 本来就应分别记录，
不再要求相同 DMG 哈希。不要使用 `release/mac-universal` 或 `Resources/native/darwin-...` 的旧目标布局。

Mac 需要对应 CPU 的 Node、Xcode Command Line Tools 和 Swift 工具链；
Node 当前固定 24.20.0，Bot pnpm 当前固定 10.33.0，以本次源码配置为准。
M 系列用 x64 Node/Rosetta 跑通不能替代 Intel runner/实机验收。
Windows 不能代替 Mac 的 codesign、DMG 挂载、Keychain 和 TCC 验证。

## 2. 维护者须一起同步的 Mac 配套内容

除通用清单之外，逐项核对以下连接关系，不是只给 YAML 改两个 target：

1. `.release/config.json` 包含 arm64/x64；toolkit 的平台选择、runner 映射、签名说明和 collector 支持新 target。
2. `package-release.yml` 的 Mac 选项、矩阵、Harness `--arch`、缓存键、原生签名/CPU 验证均已更新。
   新流程不依赖旧 Universal `intel` 复验 job；该 job 跳过正常，Intel 由自身 build/verify 负责。
3. `.release/adapter.mjs` 按当前 CPU 准备 Harness、CUA、飞书；
   使用 enterprise builder 生成单架构 App，然后调用 `scripts/package-enterprise-macos-thin.mjs`。
4. `scripts/build-ruijie-harness.mjs` 支持两种 `--arch`；
   使用 Bot 临时覆盖配置，保留 Harness 自己的打包运行时校验，再签名、验证并 staging。
5. `scripts/enterprise-macos-sign.mjs` 支持平面资源布局及由内到外的串行签名，
   保留固定 Harness/飞书字节，检查 Bot 和 Harness 主程序只有目标 CPU。
6. 最终 DMG 必须只读挂载后重新验签/验资源，并在对应原生 runner 执行包内 smoke；
   不是只检查构建目录中还没装进 DMG 的 App。

旧 `scripts/package-enterprise-macos.mjs` 和历史 Universal 识别代码可为旧包保留，
不作为本轮新构建入口。不修改独立 Harness 仓库的 Universal 配置，也不从中移除公开支持。

## 3. 工作流参数和前置条件

在获得运行授权后打开
[公司“打包发布”](https://github.com/AI-Applications-Team/OpenMausBot/actions/workflows/package-release.yml)：

- `Use workflow from` 选含新 YAML 的审核分支；`source_ref` 选含全部配套源码的同一审核版本。
  不用旧 main/旧标签替代，尤其不要让新 YAML 检出缺新脚本的老源码。
- `version` 留空读取源码，或使用负责人指定的未占用版本。
  已存在同版本 Release、标签指向错误提交均应停止，不移动标签、不覆盖资产。
- `platforms=macos` 生成两份；只验一种 CPU 可单选，但不能宣称另一种通过。
- `mode=artifacts` 为默认值，只存测试产物，不发布 Release、不创建候选源码提交。
  默认 `platforms=desktop` 还包括 Windows；只需要两份 Mac 时选 macos。

公司 Harness 私库使用 `RUIJIE_HARNESS_READ_TOKEN` Contents 只读，固定提交并递归检出 submodule。
不需要个人账号、沙箱配置、Apple Developer ID、公证密钥来生成此企业内测候选。
组织必须允许所需 Actions/cache/artifact、原生 runner 和 YAML 所列 job 权限。

不要改跑 `pnpm package:mac` 或旧 `release.yml` 来代替：
它们仍带正式回执/旧发布路径，不与企业分包入口等价。
临时本机复现也应参照同版本 adapter 的完整准备顺序，不省略 prepare 的版本元数据和构建指纹。

## 4. 构建、缓存和包内布局

内置 Harness pin：
`2.1.10` / `f48fe5cb09e37c1bcb4ed2c19f75ce5e1bf8aeae`。
第一次在干净 runner 上构建对应 CPU；后续可复用验证后的缓存。
缓存键含 target、Harness SHA 与构建脚本摘要；命中后仍核对完整目录、pin、签名和单 CPU。
不能把 Universal 缓存改目录名后冒充 thin。

Harness 源码的 file: 锁元数据稳定化由脚本处理，禁止 registry 依赖漂移，结束时恢复锁文件。
已提交的 vendor-sidebar 只验证，不重新生成；只允许明确列出的生成图标变动。
不要因“dirty”直接删除他人改动，也不能放开任意源码变更。

每个 App 的实际资源在 `Contents/Resources`，是**本架构平面目录**：

```text
Contents/Resources/
  app.asar
  app-update.yml
  enterprise-release.json
  ui/                         当前 Bot UI
  server/                     当前 Bot 服务
  companion/
  cua-driver
  cua-sdk/
  cloudflared/cloudflared
  browser-engine/             本架构完整浏览器及清单
  tuantuan-feishu/            连接器代码
  tuantuan-feishu-runtime/    本架构固定 CLI / Node
  ruijie-harness/             本架构完整内置 Harness 及清单
  OpenMausBot Speech.app/
  licenses/
```

不要要求一份 App 同时带两棵 browser/Feishu/Harness，也不要检查不存在的
`Resources/native/darwin-arm64` / `darwin-x64`。
CUA 的单架构准备是本轮正常行为，不能沿用“partial 一律禁止”的 Universal 标准。
小型 speech 等辅助程序可保留 Universal；它们必须兼容目标 CPU，
但 Bot 和 Harness 主程序必须精确为单 CPU。

UI/server/companion/updater 必须由当前源码构建；desktop-build 指纹与包内复制结果均要验证。
修改指南/配置也可能使旧指纹失效；先完成交付内容再构建，不单独写 receipt 掩盖旧 dist。

## 5. 签名标准：内部候选不等于正式公证

本入口的实际顺序是：

1. enterprise electron-builder 先生成 thin App，`identity:null`，不做外层并行签名。
2. thin 包装脚本更新必要元数据、检查结构，然后串行签名：更深的 Helpers/Libraries 先于框架和主 App。
3. Harness 在自己的 staging 前已签名/算摘要；飞书使用批准的固定制品。
   Bot 最终签名步骤保留这些字节，不强行 lipo 或重签。
4. 完整验证目标 CPU、固定资源摘要和外层/嵌套代码签名，再制作 DMG。
5. 挂载最终 DMG，重新验签；adapter 再从挂载内容运行 Harness、飞书、浏览器及服务端 smoke。

因此，仅 electron-builder 返回 0、只验一个主 exe、或只看到配置中 identity:null，都不是最终结果。
最终准确状态为 **ad-hoc signed, not notarized**，不是完全未签名，也不是 Developer ID 正式发行。

企业流程不要求所有固定供应商侧车与 Bot 同 Team ID。
保持原字节时按固定摘要/供应商策略校验；若擅自重签会破坏 pin，不能靠删哈希断言解决。
正式 Developer ID 重签/公证路径须另做签名前来源、签名后身份及许可验收，不在本指南里“自动降级”通过。

`spctl` 或 stapler 拒绝未公证内测包不能直接判为本流程“忘了公证”；
但 signatures 不完整、架构不符、资源被改仍必须失败。
按组织策略由测试者确认首次打开；禁止把全局关闭 Gatekeeper、批量删除 quarantine、
重置全局 TCC 当成标准安装步骤。

[Mac 签名与 TCC 策略](macOS代码签名与TCC身份策略.md) 可用于责任进程/TCC 诊断；
其中面向正式签名或旧 Universal 的要求不能套到本轮企业内测。
本文不修改该独立策略文件，也不宣称已经完成正式签名改造。

## 6. 最终 DMG 怎么验，什么不算通过

自动脚本会在原生 runner 挂载并验证最终 DMG；人工复核必须使用
交付给测试者的**同一文件及其 SHA-256**，不能从另一次本机重打的 App 取证。

需补做只读基础诊断时，先从实际挂载位置选择 App，不把下面路径当成自动挂载结果：

```bash
set -euo pipefail
APP_PATH="/填写实际挂载位置/OpenMausBot.app"
test -d "$APP_PATH/Contents"
APP_ARCH="$(node -p process.arch)"
case "$APP_ARCH" in
  arm64) EXPECTED_CPU=arm64 ;;
  x64) EXPECTED_CPU=x86_64 ;;
  *) echo "需要对应架构的原生 Mac Node"; exit 1 ;;
esac
test "$(lipo -archs "$APP_PATH/Contents/MacOS/OpenMausBot")" = "$EXPECTED_CPU"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH"
```

这只是辅助诊断；完整检查由 `verifyAdHocThin` 及 workflow 的最终 verify 执行，
不可把四条命令当成整个验收器。不要调用不存在的 `verify-mac-universal.mjs`
或给旧脚本添加它不支持的 `darwin-universal` 参数。

包内 `app-update.yml` 公司 owner 应为 `AI-Applications-Team`，无 token/publisherName。
本流程只交分架构 DMG，不生成/发布自动更新 ZIP、latest-mac.yml 或 Universal 下载别名；
不能因缺这些资产让两份正确内测 DMG 失败。需要自动更新是另一项实现/验收任务。

自动化现在会将最终 DMG 中的 App 复制到隔离 Applications 目录，在两种原生 CPU 上逐一验证文件哈希、符号链接、权限、签名和包内运行依赖；随后测试替换安装、旧文件消失及移除 App 后保留数据，记录各阶段耗时。
证据为 `evidence-macos-<arch>-<run>/macos-<arch>-install-lifecycle.json`。任一步失败阻止该平台交付与整批自动发布。
自动化仍不代替 Finder 交互、Gatekeeper、模型/飞书账号、IM、Keychain、屏幕录制、辅助功能与真实历史用户数据升级。
两种 CPU 都必须再按 [真人验收指南](03-macOS真人验收测试指导.md) 测最终安装 App。
没有 Intel 实机或账号就如实写环境阻塞，不继承 Windows/arm64 的结果。

## 7. 失败与交付

先按 [通用失败表](04-通用回归与发布门禁.md#5-失败时先查第一条错误不要反复重打) 找首个失败阶段。
EMFILE 不是 js.map 缺失；签名时缺 chrome_crashpad_handler 的签名不是缺其源文件；
publish 缺 manifest 先查 build/verify 是否成功及 collector 版本，不重编译 Harness 来修收集问题。

thin 包装要求新的 staging 目录；失败后保留证据，在独立干净检出重试，
不要对工作区执行无差别清理。新代码必须新发起运行，旧 Run 的重试不会切换新提交。

交付两份 DMG、各自大小/SHA-256、同批 BUILD-MANIFEST、运行日志和分别的真人报告。
不要承诺拆分后固定大小；历史 Universal 约 2 GB，不代表新包实测值。
CPU 不符、缺依赖、签名不完整、同版权限循环或数据问题必须阻断；
ad-hoc 升级可能重新授权须如实说明，不宣传正式签名的持续身份保证。
