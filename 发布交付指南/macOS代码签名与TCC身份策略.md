# 锐捷 Bot：macOS 代码签名与 TCC 身份策略

适用 Bot，不适用 Harness。版本事实来自 package.json（当前 0.1.71）；
签名/身份来自 electron-builder.yml、electron/main.mjs 与各原生组件。
本轮没有在 Mac 上验证最终 DMG，本文是要求与边界，不是 Mac 已验收证明。

## 1. 必须保持的身份

| 对象 | 当前身份/位置 | 约束 |
|---|---|---|
| Bot 安装版 | `com.openmausbot.app` / `OpenMausBot.app` | 窗口名锐捷Bot；不要临时改 Bundle ID |
| 开发入口 | 与安装版不同的开发身份和目录 | 不能用开发版的 TCC 成功替安装版验收 |
| 安装版 userData | appData 下 `锐捷Bot Installed` | 服务数据在 `server-data`，不复制个人开发缓存 |
| CUA | Resources/cua-driver + cua-sdk | 桌面截图/输入能力，独立检查原生代码 |
| 语音 helper | Resources/OpenMausBot Speech.app | 独立嵌套 bundle 与麦克风/语音权限 |
| 内置浏览器 | Resources/browser-engine | 独立 agent-browser/Chromium，非系统 Chrome |
| Harness | 另行安装的应用 | 不能借其签名、TCC 或许可证替 Bot 背书 |

已有 CuaDriver.app daemon 和包内 CUA 都可能影响 macOS 实际归属，
应按 `electron/cua.mjs` 运行分支与系统日志记录责任进程，不能一律猜权限归 Bot。
新电脑验收必须能靠安装包自身资源完成，不因打包者本机已安装 CuaDriver 而误放行。

## 2. 两条路线，不混称

**Developer ID + 公证：**由获授权发行者使用自己的 Apple Developer ID Application。
核对主 App、cloudflared、agent-browser、Chromium 等要求相同发行 Team 的对象；
保持合法第三方来源说明。源码关闭自动 notarize，须由发布流程明确执行提交、Accepted、
staple 和最终复验。不能复制上游作者的证书/Team ID 或宣称拥有它。

**内部 ad-hoc：**构建显式 `mac.identity=-`，DMG 容器不冒充正式签名，
准确标记 `ad-hoc signed, not notarized`。不等同于 unsigned，也不等同于 Developer ID。
签名完整后才允许进入实体测试；若 electron-builder 内置签名未覆盖真实代码闭包，
必须先修构建流程并产生新候选，不能以“命令退出 0”忽略。

不得设置 identity=null 完全跳过签名后仍称“已签名”；不新增内部 CA、安装根证书，
不禁用 Gatekeeper/SIP，不批量清 quarantine/TCC。需要新证书策略须另获明确决策。

## 3. 签名顺序与最终产物门禁

```text
固定源码 SHA / 锁文件 / 架构
→ 生成 Bot 代码与校验 native 资源
→ 内部原生代码和嵌套 bundle 签名
→ 外层 App 签名
→ DMG / ZIP
→ 最终 DMG 挂载复验
→ 如需公证则 Accepted / staple / 重做 ZIP 和元数据
→ 最终哈希与实体 TCC 验收
```

对真实 Mach-O 和 `.app/.framework/.xpc` 等代码对象枚举逐一执行
`codesign --verify --strict --verbose=2`，外层再执行
`codesign --verify --deep --strict --verbose=2`；`codesign -dr -` 必须有可验证 requirement。
不是给所有带可执行位的脚本盲签，也不是只看主 executable。

重点包含 Electron/Helper/Framework、speech helper、cua-driver、cua-sdk 的 `.dylib/.node`、
agent-browser、Chrome Headless Shell 与其 native 依赖、cloudflared、附带的其他原生工具。
记录实际组件清单、架构、签名类型、Team ID/CDHash；不能遗漏新加的原生组件。

最终 DMG 挂载后重复检查，不能只验 release 目录中的中间 `.app`。
签名后不得改 app.asar、替换 UI/server 或复制资源补丁。公证/staple 也会改变字节，
ZIP、blockmap、feed 与 SHA 必须对应最后版本。Mac 的 vendor 原始哈希检查在签名前，
签名后通过代码签名与功能检查，不拿上游未签名哈希机械比较。

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

## 6. 交付边界

报告包括候选哈希、SHA、签名路线、组件审计、真实权限归属和首装/升级结果。
普通 Mac 通过后再安排重要用户安装；重要用户不承担反复调试权限和证书的任务。
遇签名/权限根因不明的问题保留证据，明确阻断，不将指南或“已能编译”当保证。
该策略不授权发布安装器、上传证书或改变用户系统安全设置。
