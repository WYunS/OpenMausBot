# 公司打包流程审计与 Bot 内置 Harness 拆分

时间：2026-09-20；本地基线 `ecac4d337e414c0daffce7b409a4a70ad71c33c9`，既有 UI 改动保留。
范围：只读公司 Actions / Releases / 源码；修改本地 Bot 构建代码。未推送、未触发工作流、未发布或改动公开 Harness 仓库。

## 远端证据

仓库：`AI-Applications-Team/OpenMausBot`。`gh` API 读取成功；本机 git HTTPS 代理指向已不可用的 127.0.0.1:7892，直接 fetch 也未成功。本次没有改变全局代理或认证。

| 运行 | 首要失败或结果 | 结论 |
| --- | --- | --- |
| [35329762278](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35329762278) | 检出 Harness：terminal prompts disabled / could not read Username | 仓库级 GITHUB_TOKEN 不足以检出另一个私有仓库；非打包内容缺失 |
| [35338906783](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35338906783) | macOS EMFILE，发生在复制/处理内嵌 Harness 的 `.js.map` 时 | 文件描述符耗尽；不是那个 `.js.map` 不存在 |
| [35343928683](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35343928683) | Harness source has unexpected uncommitted changes | 重复进入构建与生成图标后的源码校验不一致 |
| [35347474791](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35347474791) | Electron Framework 签名时 chrome_crashpad_handler 未签名 | 嵌套代码签名顺序问题 |
| [35350741318](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35350741318) | publish: Missing or duplicate platform manifests | 单平台 artifact 下载为平铺目录，旧 collector 只读子目录 |
| [35358753192](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/35358753192) | success，发布恢复 | 成功恢复已有产物的发布，不代表所有历史失败都不存在 |

`v0.1.840` 的 `RuijieBot-0.1.840-mac-universal.dmg` 实际大小为 **2,081,905,391 字节**；`v0.1.77` 为 697,317,536 字节。没有下载/挂载这份远端 DMG，因此不声称已逐文件测量体积占比。

源码已确认：Bot 的 Universal 合并脚本把两棵 Harness 资源都复制进去，而两棵源是同一份 Universal Harness。它构成明确冗余；拆分后的具体压缩大小仍待原生 Mac 构建。

远端 `main` 为 `9c3372b0725370bc770d5e62d2586c6d8aa2ba6e`，修复分支为 `239060ee7dda2c3d00246b1f499aec6e072f5063`。API compare 返回 diverged，修复分支独有 21 个提交、另一方向 329 个；main 上请求 Harness 构建脚本返回 404。不能把任一远端 main 与本地开发版视为相同源码，也不能整分支覆盖。

公司仓库已经配置 Secret 名称 `RUIJIE_HARNESS_READ_TOKEN`（只核查名称，未读取值）。当前本地工作流没有引用它，已补齐；个人公开镜像路径保留。

## 实施

- 按已检查的远端修复定向补齐：Windows Electron 安装、file: 锁文件稳定化、保留 vendor-sidebar、不重复构建已验收 Harness、先签嵌套代码、平铺/分目录产物收集。未整体合并远端业务代码。
- Bot Mac 发布拆为 `macos-arm64` / `macos-x64` 原生任务；`macos` 同时选中两者。
- Harness 仍固定 2.1.10 / `f48fe5cb09e37c1bcb4ed2c19f75ce5e1bf8aeae`。构建配置覆盖仅写在临时目录；公开 Universal 配置不修改。
- thin Harness 保留上游完整 runtime 检查，加校验目标 CPU 的实际 native 文件，签名后才生成摘要。缓存不因文件存在就直接信任。
- 新增最终包依赖检查：包内 Electron + 空 home/cwd + 清空 NODE_PATH，启动必需的包导出必须解析在包内，禁止借用开发环境。
- Mac 最终 DMG 的签名、CPU、浏览器/飞书/服务与 Harness 依赖检查在对应原生 runner 执行；保留原人工验收边界。

## 已执行验证及限制

- `node --test .release/toolkit/test/core.test.mjs`：修改前准确复现 `Missing or duplicate platform manifests`，修复后平铺/嵌套均可收集；重复、混合来源和改字节仍失败。
- Harness 构建、缓存和锁文件回归：修改前新用例失败；修改后通过，含两 CPU 参数、公开配置不变、原锁文件失败恢复、registry 版本不允许漂移。
- 构建配置/布局/签名排序/发布标签/包内依赖负例等 Node 测试通过；未用 mock 结果冒充 Mac codesign 实际成功。
- 本机执行 `node scripts/smoke-harness-bundle.mjs dist-native/ruijie-harness/win32-x64`：输出 `Harness boot exports resolved entirely inside bundle (x64)`。它证明导出解析独立于开发目录，不证明所有懒加载模块、登录后功能或用户旧安装包都已修复。
- 本次没有 macOS 环境，未生成新 DMG、未测量瘦包大小、未执行新远端流程；需要审核提交到正确发布分支后，在两种原生 runner 跑 `mode=artifacts`。

## 后续队列（用户要求排在本任务之后）

安装版飞书截图：本地 CLI 1.0.95，要求 >=1.0.96；npm 安装脚本向 registry.npmmirror.com 下载二进制超时，升级失败随后被归类 unauthorized 并禁用技能。
截图是待核查线索，不是本仓库已证实根因。后续检查升级/鉴权错误分类、离线内置 CLI、失败后的状态恢复与重试；不在本次打包改动中混入未验证修复。
