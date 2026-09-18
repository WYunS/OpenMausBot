# 锐捷 Bot 选择性吸收官方 v0.1.84：按当前本地源码复核后的实施计划

核验日期：2026-09-18。审查对象为用户提供的《RuijieBot-v0.1.84-选择性升级方案.md》，并与本机实际工作树、历史对象、发布脚本核对。

结论：保留企业分支、分功能吸收官方改进的方向正确；原方案不能直接作为当前实施清单。先归并两个企业分支的有效改动，固定内置 Harness 2.1.10 的完整基线，再实施小修复和核心执行适配。官方 v0.1.84 是参考目标，不是要求把企业版本号改成 0.1.84，也不是允许覆盖企业配置的升级包。

本次只新增审查文档，未合并升级、修改产品代码、切换本地入口、打包或发布。执行了现有隔离测试与纯函数检查；不把这些结果称为最终安装包或真实企业服务验收。

## 1. 真实基线：两个企业分支加未提交改动

| 项目 | 本次读到的事实 |
|---|---|
| 本机主开发与本地入口目录 | `D:/ChatGPT/Bot/downloads/OpenMausBot-source`；当前 Electron 进程的可执行路径也在此目录的依赖树内 |
| 本机 Git HEAD | `30924bab592cee1c5f21ff588bff64f88bba3a79`，分支 `main`；本地记录跟踪 `ruijie-team/main` |
| 同 SHA 的另一工作树 | `D:/ChatGPT/Bot/worktrees/OpenMausBot-bundled-harness` 没有主目录的 14 个已跟踪文件修改，不能拿它替代最新本地状态 |
| 原报告基线 | `feb5cf284314550fe02214b96d04f4ed8fd8e2b8`，另一企业分支；报告中的 `D:/Project/Ruijiebot/...` 本机不存在 |
| 两条企业线的共同祖先 | `bd7002781504a3430928d9fbe8000b0d9e9aa163`；双方各有 3 个不同提交，不是单纯“当前比报告多几个提交” |
| 当前未提交产品改动 | 14 个已跟踪文件：内置 Harness 登录继承、隔离目录、协作工具、启动入口、连接器交互及对应测试。升级必须包含它们 |
| 版本区别 | 当前 `package.json` 为 `0.1.73`，原报告分支为 `0.1.77`；企业发布工具可以生成版本提交，不能凭 package 数字判断功能新旧 |
| Harness 本地源码 | `a7c71c4cadaad2db218d126146973e38649a6f43` / `2.1.10`；本轮联网仍失败，未完成远端推送确认 |
| Windows CUA | 企业 SDK/准备脚本固定 `0.28.1`，保留 exe、UIA、光标 sidecar 与哈希校验 |
| 当前 UI/server 构建对应性 | `node scripts/desktop-build-receipt.mjs` 通过；收据时间为 `2026-09-18T02:43:36.514Z`，source fingerprint 为 `279be8db09d57e556090b5b5570004e1c4e9aa5fd9aaadc7c2c1e6247221c0d7`。它证明本地 UI/server 与本地源码一致，不证明 Harness 安装包来源或用户流程正确 |

官方目标 SHA `55af6c37aa6144dd7e976f2f600a25363ba20c4f` 来自用户报告。本机未缓存该对象，GitHub 主站、API、raw 请求均失败，不能声称已重新核实目标标签、300 个提交或 209 个重叠路径。可核实的官方历史证据和首批移植范围详见 [官方补丁可移植性复核](./upstream-v0.1.84-portability-audit-2026-09-18.md)。联网恢复后固定该目标，重新计算 merge-base、改动交集和每个补丁的实际依赖。

## 2. 升级前必须先处理的基线问题

### B01：Harness 版本锁、真实运行时和发布入口没有完全对齐

当前 `server/drivers/ruijie-harness-local.ts:15` 与 `scripts/prepare-ruijie-harness.mjs:7` 已要求 **2.1.10**，但以下 6 处仍指向 **2.1.9 的提交 `38fc3f4a79a5bab30a6a07d852c4ed3ef832d3b3`**：

- `.github/workflows/release.yml:111,156,303,329`：Mac、Windows checkout 及来源元数据。
- `.github/workflows/package-win.yml:35,64`：Windows 单独构建入口。

更关键的是，`prepare-ruijie-harness.mjs:56` 用脚本常量填写 manifest.version；校验只比对该 manifest 和可执行文件哈希，没有独立验证复制进来的 app.asar/运行时实际版本、补丁和来源提交。因此“manifest 写成 2.1.10”不能证明真的带入 2.1.10。

企业一键“打包发布”还走另一入口：`.github/workflows/package-release.yml` → `.release/adapter.mjs:39`。该 adapter 调用 `package:prepare` 后准备 CUA/飞书再直接执行 electron-builder，没有相应的 Harness checkout/build/staging；`scripts/after-pack.mjs:108` 却要求实际存在可验证的 Harness bundle。只修旧 release.yml 不足以修好当前企业发布入口。

实施要求：先确认 Harness 2.1.10 源提交可从团队仓库获取；统一各有效构建入口的版本、SHA、平台资源来源；校验内置运行时代码身份/真实版本及依赖闭包，拒绝把旧运行时重新标记为新版；确认企业 Universal Mac 产物中的 Harness 路径、架构和 manifest 选择匹配。Linux 是否交付内置 Harness 应单列支持范围，不能由 Windows/Mac 结果推断。

### B02：报告所在企业分支有一个本机尚未带入的实用补丁

企业 `aa25d4997f5a2bf6ff82cae227282013071c159b` 给 `scripts/prepare-local-preview.mjs` 加上 Windows `prepareCuaWindows({ root })`。当前主目录缺少这段，而启动器 `scripts/start-local-windows.ps1:415` 仍使用 staged CUA 路径。

实施时选择性补齐该准备步骤及测试，保持当前内置 Harness 启动方式。不能整条覆盖启动器测试，也不能因为本机恰有旧的 `dist-native` 缓存就认定新 checkout 可以复现。原分支另外两条版本准备提交不应机械合入。

### B03：先保全当前本地工作，再建立升级分支

当前工作树不是干净 HEAD。先审阅并分别提交已有内置 SSO/协作/启动/连接器改动；`scripts/debug/`、Python 缓存、飞书诊断工具等未跟踪文件不自动加入升级提交，不删除用户文件。建议从整理好的本地基线建立 `codex/selective-upstream-0.1.84` 隔离工作树；不要直接在当前运行入口上执行官方 merge 或整文件覆盖。

### B04：基线有一个测试断言需要同步

`electron/local-windows-launcher.node-test.mjs:90` 要求 `serverReady = await startServerPackaged()`；当前 `electron/main.mjs:2974` 是 `await startServerPackaged()`，就绪状态由 `serverSupervisor.onReady/onUnavailable` 更新（`:329`）。此次 Node 测试 19 通过、1 失败，失败原因是旧字符串断言。先把测试对齐当前监督器职责，保留启动恢复行为验证；不要为满足旧断言改回产品控制流。

## 3. 原方案需要改写的判断

| 原编号 | 当前审核结论 | 对计划的影响 |
|---|---|---|
| H01 / I01 | 已有 Bot 自持内置 Harness、私密 SSO 管道、Bot 私有 DSH/userData/bridge；不会按原逻辑复用外装 Harness | 改为保留和验收当前架构。测试未安装、安装未启动、正在工作、仅托盘驻留四种外装状态；登录刷新、退出、切账号与旧子进程迟到回传同测 |
| H02 | 已有 `agentsMcp:true` 和 agents stdio preset，缺失时启动失败；不是只改 capability 开关 | 从“从零接工具”改为验证真实 profile 保存/委派/回报/权限与新版工具契约。`customMcp`、`phoneMcp` 仍未声明，不能据此声称全部工具已接通 |
| H03 | 仍有缺陷：发出 `session.cancel` 后立即 `settle`，取消失败被吞掉（`ruijie-harness.ts:907`） | 保留高优先级；RPC `accepted` 不等于工具停止，需终态/可验证空闲状态；未知状态不得提前释放桌面锁 |
| H04 | 仍只呈现第一题字符串选项，回传时把同一文本填给全部题目 ID（`:658,917`） | 单独做完整协议包：原始问题 ID → 事件/存储 → 卡片 → 按 ID 回答。不能只复制官方 QuestionCard |
| C03 | 当前 Off 仍可挂浏览器；`server/index.ts:5160` 的本机意图还能直接覆盖 off/cloud 选择 | 需同时调整 resolver 和实际 dispatch 优先级，不是只改 `surface.ts`。明确 Off、选择、自然语言切换的规则；工具和预览来源一致。这里的 Off 指电脑/浏览器选择，不等于所有 Harness 原生工具都被禁用 |
| C06 | Windows owned embedded-host 已存在（`electron/cua.mjs:247`），0.28.1 及 sidecar 也已存在 | 不再列“新增私有 daemon”；只比较后续真实生命周期缺口，优先补干净源码预览 staging |
| R02 | npm/npx MCP 的无 shell 启动已有（`server/mcp-gate.ts:152`） | 从首批新功能删除；嵌套终端/PATHEXT 的部分官方补丁属于尚未接入的 shared-computer 路线，不应顺带带入 |
| R03 | boot-aware lease 及 Windows PID 创建时间防复用已有（`electron/data-dir-lease.mjs:99`） | 保留企业增强，仅补未覆盖场景；官方某文件“更新”不等于可替换本地文件 |
| U02 | 已有附件图库和图片预览（`AttachmentPreview.tsx`、`ChatView.tsx:60`） | 首批缩为聊天截图点击放大等缺失增量；缓存官方 `4b7dbb86` 是可审查的小范围实现 |
| U05 | 编辑反馈和稳定线程引用是不同工作 | 编辑反馈可独立做；ID 引用涉及持久消息、解析、导航及旧记录兼容，不与几个 UI 按钮一起处理 |
| D07 | 根目录 SKILL.md blob URL 当前确实不接受，纯函数已复现 | 首批局部修复；与自然语言编写技能、默认启用和团队发布分开 |
| D02 / I04 | 用量补账确实读取事件日志并整体替换统计（`usage-reconciliation.ts:62`） | 保留原报告判断：独立用量/session 索引与完整性保证就绪前，不默认开启日志截断/过期清理 |
| I03 | 本地美元预算不能替代企业人民币余额；Harness 当前主要回传通用错误 | 先约定结构化的授权/额度拒绝结果再做不重试和恢复；不按错误文案随意猜币种或把未知金额当 0 |

自然语言 setup 仍由“空白 Bot 自动引导 + propose_profile 确认卡”实现（`server/setup-mode.ts:35`）。遵循已确认的产品要求：用户不需写固定格式，资料字段不齐不应阻断正常使用；不为凑齐 name/title/description/soul 增加繁琐门槛。升级要保持已有引导和确认卡行为。

## 4. 修订后的执行顺序与批次边界

| 批次 | 做什么 | 交付/进入下一批的条件 |
|---|---|---|
| 0：完整企业基线 | B01–B04；保全已有本地补丁、补 CUA 预览准备、修陈旧测试、对齐 Harness 真实版本及企业构建入口、联网固定官方目标 | 一条可追溯企业源码基线；现有功能测试通过；无意外版本倒退。Harness 源先可获取，Bot 再锁定该 SHA |
| 1A：明确小修 | D07 URL；R01 Windows 检查点路径等价性；U02 截图放大，分别提交 | 各自回归及隔离 UI/临时目录测试通过；不引入新 Provider、第二套登录或共享电脑 |
| 1B：核心执行 | H03 真停止和锁释放 → C03 单场所/Off/不降级本机 → H04 按题目 ID 问答；I03 授权/额度错误分类作为独立子包 | 在企业 Harness 真实接口上验证取消、迟到事件、连续任务、旧问答和权限；假 Codex 测试不能代替这些证据 |
| 2：协作与线程 | 先验证已有 H02；再吸收 T01–T04、T06–T08、U03/U04；U05 稳定引用独立；H05 URL MCP 独立且可后置 | 每对 Bot 会话/委派回报去重、并发与重启、停止范围、旧数据读取、工具作用域通过；T06 重试上限需服务端持久化 |
| 3：效率和数据 | T05 上下文增量、C04 延迟占用、C05 自然语言选择、D01 完整备份；D02 在计量解耦后再做 | `strictResume`/真实接收语义明确；不丢上下文、不重复外部动作；统计稳定、共享桌面锁正确、恢复后的身份以当前 SSO 为准 |
| 4：有场景才扩展 | I06/I07 管理和托管、D03 云备份、D04 共享设备、D05/D06 语音/移动端 | 有对应企业服务与客户端能力后独立实现，不占首轮升级范围 |

U01 消息菜单、U05 编辑反馈可按实际收益穿插在小 UI 子包；U07 团队画布可随团队批次选择采用；U10 优先覆盖新增简体中文。U08 完整官方 onboarding、U09 窗口换皮不列为首轮目标。

其余原报告方向保持：I02 官方公司网关、H06 个人 Claude 配置继承、C02 BoxAgent 全面替换均不进入企业默认路径；I05 保留底层而不扩充员工计费入口；I08 品牌素材按需；H07/C08 仅针对实际开放引擎/后端；C01/C07 保留企业持久沙箱与浏览器路由；T09 不自动把 Chief Full Access 传播给所有队友；R04 保留原生飞书/代理并单独融合权限；R05 数据契约随每个功能包同步；R06/R07 保留企业发布/浏览器依赖闭包，只更新必要差异。

首轮完成定义：第 0 批、1A、1B，以及已有 agents 工具的企业链路验证。不要把“完成 0.1.84 升级”定义成移植全部 50 多项或只换版本号。

## 5. 具体实施与验收清单

- [ ] 固定本机 HEAD + 当前修改内容；评估 `aa25d499`，排除纯版本准备提交；先形成可回退基线。
- [ ] 从实际远端获取官方目标，确认 tag/SHA；用共同祖先和当前工作树判断“已有/缺失/不适用”，不照搬原报告路径计数。
- [ ] 完成 Harness 2.1.10 团队仓库同步；Bot 有效发布入口全部锁同一来源，实际 bundle 版本、补丁与架构必须可验证。
- [ ] 在临时空数据与合成旧数据目录运行；保持用户当前安装、快捷方式、账号和数据库不动。
- [ ] 每个功能包一个独立可检查提交，记录官方来源/企业适配/测试证据；高耦合文件按功能片段合并。
- [ ] 测试企业数据 parse/save 不丢字段：`ruijieHarness`、`ruijie-sandbox`、线程模型、SSO 当前身份、用量未知值、队列/回执和私有预设标记。
- [ ] 保留 GPTAuth 登录、余额暂不可用状态、默认模型/努力档、图片、自然语言 setup、飞书、代理、浏览器接管、电脑执行证据校验及简洁 UI。
- [ ] 首轮隔离源码验收通过后，按用户要求构建本地预览并验证 build receipt；无需主动打开 GUI，也不自动制作安装包或启动 Action。
- [ ] 发布前另行验证最终包：无外装 Harness、外装四种状态、SSO 刷新/退出、Win/Mac 资源闭包、覆盖升级和旧数据兼容。源码测试通过不代替安装验收。

回退应回到同一源码批次及该批迁移前的数据副本；不能只退 exe 而让旧版本读取未经保证的新 schema。用量/自动任务/队列变化尤其需要先规定回退兼容。

## 6. 本次实际检查结果

| 检查 | 结果和边界 |
|---|---|
| Git status、双方历史/差异、版本与构建脚本 | 已核对；主产品工作树未改动 |
| UI/server 本地构建 receipt | 通过；未重新编译或启动窗口 |
| 7 文件 Vitest：Harness driver/locator、setup、PluginsPanel、usage reconciliation、local routing、surface | 119 通过 |
| `scripts/prepare-ruijie-harness.test.mjs`（Vitest） | 2 通过；现有测试不等于已验证真实运行时来源 |
| Node tests：SSO account、desktop layout、Windows launcher | 19 通过、1 旧断言失败；未修产品代码 |
| 技能 URL 纯解析 | 根目录失败、子目录成功，确认 D07 当前症状 |
| Off 路由纯函数与实际 dispatch 源码 | `destination: off, browserOn: true` 返回 `browser: true`；本机意图分支可覆盖 plan，确认需联合改造 |
| 官方 v0.1.84 远端和 Harness 远端状态 | 连接失败，目标源码和推送状态未复核；未以旧的 remote-tracking ref 冒充最新远端 |
| 安装包、真实 SSO/计费、云桌面、飞书发送、真实模型、取消执行验证 | 本轮未执行 |

合计有效测试：**140 通过、1 失败**，不能写成“当前 Bot 全量验收通过”。一次误用 Node runner 执行 Vitest 文件产生 runner 错误，已改用 Vitest 单独重跑通过，不计为产品失败。

主要检查命令（工作目录为本机主开发目录）：

```powershell
git status --short --branch
git merge-base HEAD feb5cf284314550fe02214b96d04f4ed8fd8e2b8
git log --left-right --oneline HEAD...feb5cf284314550fe02214b96d04f4ed8fd8e2b8
node scripts/desktop-build-receipt.mjs
node node_modules/vitest/vitest.mjs run server/drivers/ruijie-harness.test.ts server/drivers/ruijie-harness-local.test.ts server/setup-mode.test.ts src/components/PluginsPanel.test.ts server/usage-reconciliation.test.ts server/local-routing.test.ts server/surface.test.ts
node node_modules/vitest/vitest.mjs run scripts/prepare-ruijie-harness.test.mjs
node --test electron/ruijie-sso-account.node-test.mjs electron/desktop-runtime-layout.node-test.mjs electron/local-windows-launcher.node-test.mjs
```

## 7. 后续维护记录

实施表建议逐包记录 `上游来源 SHA → 选择的行为差异 → 企业适配提交 → 测试命令/结果 → 是否进入本地预览/安装包`。企业发布号单独递增，准确写“选择性吸收官方 v0.1.84 的哪些功能”。这样以后同步官方时能按补丁去重，而不再依赖两个产品碰巧相同的版本数字。
