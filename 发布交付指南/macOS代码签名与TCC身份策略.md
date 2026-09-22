# 锐捷 Bot：macOS 代码签名与 TCC 身份策略

更新：2026-09-21。适用公司 OpenMausBot 0.1.85 企业内测，与四份编号指南一致。
交付两份 thin DMG：arm64 / x64。同一 Bot 源码 SHA，各自架构、签名审计和哈希。
内置 Harness 固定 2.1.10，其独立 Universal 发行保持不变；用户无需另装 Harness。
本轮可以在 Actions 原生 runner 构建和验签，不能借此宣布真人登录、TCC 或升级验收完成。

## 1. 固定身份与资源布局

| 对象 | 当前路径/身份 | 约束 |
| --- | --- | --- |
| Bot 安装版 | com.openmausbot.app / OpenMausBot.app | 保留 Bundle ID，显示品牌锐捷Bot |
| 安装版服务数据 | ~/.ruijiebot | 开发版 ~/.openmausbot，两者隔离 |
| Electron 状态 | Application Support 下锐捷Bot Installed | 不与服务数据混用 |
| CUA | Resources/cua-driver、cua-sdk | 本 App CPU 对应版本 |
| 浏览器 | Resources/browser-engine | 对应 CPU，保留来源/许可与哈希检查 |
| 飞书 | Resources/tuantuan-feishu-runtime | 使用固定 CLI/Node，保留已审核签名字节 |
| Harness | Resources/ruijie-harness | 对应 CPU 的完整 sidecar；签名后才生成 manifest |
| 语音 helper | Resources/OpenMausBot Speech.app | 独立嵌套 bundle，按实际责任进程检查麦克风权限 |

不再生成两棵 native 树或要求主 App 同时拥有两个 CPU。小型通用 helper 可以保留，但必须支持目标架构。
不得从 PATH、Homebrew 或开发 node_modules 补足缺失资源。许可批准按平台分别核验。

## 2. 企业内测和正式签名

本轮采用 ad-hoc signed, not notarized。electron-builder 中 identity=null 只用于暂停其并行签名，
随后必须由 scripts/enterprise-macos-sign.mjs 串行完成实际 ad-hoc 签名与验证，不能省略最终签名后仍称已签名。
固定 Harness/飞书资源保留其已验证字节；主 App、其余 Mach-O 和嵌套 bundle 按闭包签名。
飞书的正式 Developer ID 同 Team 变更字节信任规则不放宽；ad-hoc 没有 Developer ID Team。

正式 Developer ID + 公证需要另行授权、真实证书和 Accepted/staple/最终哈希验证；本轮不宣称具备这些条件。
不安装内部 CA，不关闭 Gatekeeper/SIP，不批量清 quarantine/TCC。

## 3. 签名和最终产物门禁

固定源码/锁文件/CPU → 准备并校验运行时 → 生成 thin App → 串行签名嵌套代码与外层 App
→ 验 CPU/完整签名 → 生成 DMG → 只读挂载 → 再验签名、包内资源、真实导出和服务端运行 → 最终 SHA-256。

使用 scripts/package-enterprise-macos-thin.mjs 与 scripts/enterprise-macos-sign.mjs。
Helpers/Libraries 必须先于框架和 App，不能只签外壳。主程序及 Harness 的 lipo 应仅有目标 CPU。
最终检查在挂载 DMG 的 App 上执行，不只检查中间构建目录。所有产物失败即停，不拿另一架构结果替代。
签名后不得换 app.asar、UI/server 或补资源；发生字节变化须重新完整构建/校验。

## 4. 权限是用户行为的结果，不是启动探测手段

- 普通启动/登录/展示模型列表不得预先访问受保护目录或弹桌面控制授权。
- 用户主动选择目录或电脑功能后，才让系统处理相应权限；拒绝、取消后停止。
- 访问 Downloads/Documents/Desktop 的文件授权、辅助功能、屏幕录制、麦克风与语音
  是不同权限，分别验证，不能以“全盘访问已开”替代正确实现。
- Harness 按需后台启动不能成为额外 GUI、目录选择或权限循环的来源。
- 不盲目增大 entitlements；当前 `build/entitlements.mac.plist` 的 JIT/native SDK
  兼容项不是读取一切文件或操纵一切应用的授权。

## 5. 实体 Mac 与升级要求

使用普通测试 Mac 和专用获授权账户，先验首装，再验同版本重复操作/退出重启，最后验
旧安装版覆盖新候选。不把 GitHub Actions 的临时系统当持久 TCC 数据库证明。
同一安装版本某个已允许动作反复弹 Allow、持续 requirement mismatch，或拒绝后不断重试，
都必须阻断；不能要求用户不断重置权限来维持可用。

ad-hoc 的 CDHash 随代码变化，跨版本可能重新授权一次，不能承诺永久零提示。
Developer ID 稳定身份也要用真实覆盖升级验证，不能只看 Team ID 推导成功。
同一 SHA 的 Windows 验收不能代替 Mac 权限验收，ARM smoke 不能代替 Intel 实机。

### 5.1 屏幕录制重复授权的定向诊断

用户反馈已明确为“屏幕录制”，不是飞书/锐捷登录或钥匙串。签名、公证与 TCC 是不同检查：
签名证明代码身份/完整性，公证和 Gatekeeper 检查分发安全，屏幕录制仍由系统按实际身份授权。
“有签名”不证明权限持久，“只改显示名”也不能代替安装版原生验收。

先取得完整弹窗、macOS 版本、出现频率和第一次出现的动作，区分首次申请、升级后重授、
系统规定的周期性复核与同版每次操作的循环。没有实际复现记录时，只列待排查分支，不宣布根因：

- 身份变化：比对出问题的前后版本，而非只看最新构建，核对 Bundle ID、签名类型、Team ID、
  designated requirement 与 helper。ad-hoc 重建、换 Team 或改 requirement 均需重点核实。
- 安装副本/责任进程：记录真正运行的 App 路径与父子进程。固定 Applications 中的候选；
  不能同时从 DMG、下载目录、源码 Electron 或旧副本启动后把权限条目混为同一应用。
- CUA 路径切换：当前 `electron/cua.mjs` 首选 embedded，失败后可尝试已有 CuaDriver.app。
  记录实际模式及失败原因；Bot 与独立 CuaDriver 不是同一授权身份，也不能借已授权 daemon 通过首装验收。
- 请求时机/恢复：确认只在用户主动启用电脑功能时请求；拒绝/取消后停止，后台状态查询不能
  无限重发请求。授权后按系统要求重启，再测状态、截图与三轮退出重开，而非仅看权限开关已亮。

在受影响 Mac 上只读采集签名信息（路径按真正安装位置替换）：

```bash
APP_PATH="/Applications/OpenMausBot.app"
sw_vers
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Contents/Info.plist"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH"
codesign -dr - "$APP_PATH"
# 当前分架构包的 embedded CUA 路径。先用运行日志确认实际责任进程。
# 每份 thin App 使用其目标 CPU 的平面资源布局。
CUA_PATH="$APP_PATH/Contents/Resources/cua-driver"
codesign --verify --strict --verbose=2 "$CUA_PATH"
codesign -dv --verbose=4 "$CUA_PATH"
codesign -dr - "$CUA_PATH"
```

同样核对实际责任 helper；若实际运行 standalone，单独采集 CuaDriver.app 的身份，不能冒充包内结果。
需要 TCC 日志时只提取对应时段/进程并脱敏；不上传整份系统日志、密钥或私人屏幕内容。
以上命令不修改权限，不等于修复。完整通过标准见真人验收指南 2.1；同版三轮操作、三次重开
仍循环，或拒绝后继续请求，均阻断。不能以清空 TCC、关闭 SIP/Gatekeeper、全盘访问或手工重签来放行。

受影响用户的 Mac 尚无日志/签名对照，权限循环根因仍未确认。
GitHub Actions 可证明构建与签名检查，不证明该用户权限已经保持，也不承诺升级永远没有系统复核。

## 6. 交付边界

报告包括候选哈希、SHA、签名路线、组件审计、真实权限归属和首装/升级结果。
普通 Mac 通过后再安排重要用户安装；重要用户不承担反复调试权限和证书的任务。
遇签名/权限根因不明的问题保留证据，明确阻断，不将指南或“已能编译”当保证。
该策略不授权发布安装器、上传证书或改变用户系统安全设置。
