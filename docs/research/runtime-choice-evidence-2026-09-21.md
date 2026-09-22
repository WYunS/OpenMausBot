# 执行引擎选择：源码证据与决策门槛

核查日期：2026-09-21。范围：Bot 现有适配、锐捷 Harness 本地源码、封装链，以及 Codex 官方资料获取情况。本次仅静态读取，不运行模型，不读取凭据，不验证线上服务，也不把源码中的测试存在等同于测试通过。

## 可以据此做出的产品判断

**应先决定任务由谁持续负责，再决定用哪个执行引擎。锐捷 Harness 可以作为第一候选，但必须通过同一组云端产品验收；当前证据不足以宣布它或 Codex 已经具备完整的云端托管产品能力。**

Codex CLI 本身也是 agent harness，包含模型调用、工具执行、会话和权限控制。这里比较的是“两种执行引擎及其接入方式”，不是“Harness 与一个聊天模型”。云端后台、云电脑和本机是部署位置及操作对象；它们不天然决定使用哪一种引擎。

用户看到一个 Bot，内部可以存在多个任务会话和多个执行进程。是否统一，取决于任务归属、可见记录、权限和结果能否统一，不要求所有工作挤进一个长会话，也不要求用户手动选择模型。模型切换是产品内部的能力策略；当前没有证据支持承诺“自动换模必然更优”。

## 版本证据必须分开

| 对象 | 本次实际读取的版本 | 能证明什么 |
|---|---|---|
| OpenMausBot 工作树 | package.json 为 0.1.84；HEAD `ecac4d337e414c0daffce7b409a4a70ad71c33c9`；存在大量未提交修改，含 Harness driver、打包脚本 | 本文行号指当前工作树，不能假定均已发布 |
| Bot 声明的锐捷 Harness 封装版本 | `2.1.10`，commit `f48fe5cb09e37c1bcb4ed2c19f75ce5e1bf8aeae`，capability `openmaus-server-v1` | 这是打包及运行时校验要求，见 [release 定义](../../shared/ruijie-harness-release.ts#L2) |
| 当前锐捷 Harness 源码 | 外层 HEAD `a7c71c4cadaad2db218d126146973e38649a6f43`；package 仍为 `2.1.10` | 与 Bot pin 不同，不能以相同版本号认定同一能力集合 |
| 当前 DeepSeek Harness 子模块 | `141eb6fef83422698aef7a981029e843e8161534`，`0.1.0-rc.8` | 底层能力探索的证据，不直接代表 Bot 封装能力 |

本地 Git 对象库无法读取 `f48fe5c…`，`git diff` 返回 bad object，因此未能核实两个外层 commit 的具体差异。不能断言差异无关紧要，也不能断言它导致某项故障。源码构建要求 HEAD 精确匹配、子模块正确初始化、版本匹配且不带意外修改，见 [构建校验](../../scripts/build-ruijie-harness.mjs#L66)。在重新确认发行 commit 与产物清单前，以下“锐捷底层具备”均不应写成“现有安装包已交付”。

## 事实矩阵：已接入与可开发的潜力

| 决策问题 | 锐捷 Harness 当前 Bot 适配 | Codex 当前 Bot 适配 | 产品含义 |
|---|---|---|---|
| 引擎怎样启动 | 本机进程默认 `--openmaus-server`；locator 只接受 loopback endpoint；HTTP 请求与 WebSocket 事件 | 通过 stdio JSON-RPC 调用 `codex app-server`；当前每个 turn 启动进程，再恢复或新建原生 thread | 两者当前都是 Bot 后台旁的执行引擎接入，均不是现成的远程调度系统 |
| 无窗口运行 | 桌面包装提供无 Renderer、BrowserWindow、tray 的运行分支 | app-server 子进程通过管道工作 | 无窗口只解决运行形态，不证明重启恢复、云端续期或租户隔离 |
| 模型选择 | `session.selectModel`；适配器标记 `in-session`；读取模型目录及合法推理级别 | 适配器标记 `unsupported`；恢复后若模型或 provider 不符则新建 thread | 锐捷已接入会话内选择；Codex 的这一限制属于本项目当前适配，不能扩大为 Codex 原生不支持 |
| 工具与电脑操作 | MCP：所选电脑、宿主机电脑、连接应用、浏览器、自定义工具；用 preset 组装 | 同类 MCP 工具；另声明 phone 能力 | 两者均有工具基础。真正能操作用户电脑还依赖设备代理、在线状态、授权及运行环境 |
| 用户授权 | 转换 permission / question 事件，并回传实际 receipt | app-server 的请求转换为统一请求卡片 | 有统一入口不代表所有引擎原生授权语义相同；要验收实际授权结果 |
| 停止 | 请求 `session.cancel`，检查终止事件和 session 非运行状态后才结束占用 | 当前调用 active turn 的 stop，并终止进程树 | 用户点击停止后的副作用控制不能只看 UI 是否变为完成 |
| 会话恢复 | 无工具集成且 cursor 合法时直接复用；工具集成需重建 scoped preset/session 的场景，以可见历史 recoveryText 恢复 | `thread/resume`，不适用时新建 thread | 可见对话恢复不是进程继续执行，也不是原环境和全部隐含状态无损迁移 |
| 正在运行时追加指令 | 当前 `queueing: false` | 当前未声明 queueing | 底层支持不等于当前产品可以随时追加指令；默认需由产品排队或明确中止后重做 |
| 认证 | 企业 OAuth；Bot 通过专用管道传入认证，接收更新；底层有 refresh token 更新 | 当前 driver 明确删去 `OPENAI_API_KEY`，检查 ChatGPT CLI 登录，报告 subscription | 不能把官方可能提供的其他认证方式算成当前实现，也不能直接承诺企业统一账单 |
| 随包封装 | Bot 有 pin、payload 校验及 Windows/macOS sidecar 链 | driver 提供 `npm install -g @openai/codex` 安装声明；本次未找到与 Harness 同等的固定版本内置链 | Codex 作为候选需补产品封装和版本兼容门槛；不能把“用户可安装 CLI”当成“已封装好” |
| Linux 云部署 | 当前 sidecar build 明确只支持 win32 / darwin；底层有独立 CLI / SDK | driver 声明 Linux 安装命令；实际云环境未跑验收 | 同一台 Windows 云电脑先部署有可行基础；Linux 生产镜像属于新增交付工程 |

关键源码定位：

- Bot 统一 Interface：[SendTurnInput](../../server/contracts.ts#L183)、[ProviderAdapter](../../server/contracts.ts#L268)。包含模型、恢复游标、工具、工作目录、事件与授权，但没有远程任务租约、节点分配、执行交接等承诺。
- 锐捷本地定位与启动：[loopback 校验](../../server/drivers/ruijie-harness-local.ts#L204)、[默认启动参数](../../server/drivers/ruijie-harness-local.ts#L301)、[认证专用管道](../../server/drivers/ruijie-harness-local.ts#L519)。
- 锐捷工具与恢复：[工具组装](../../server/drivers/ruijie-harness.ts#L246)、[RPC](../../server/drivers/ruijie-harness.ts#L357)、[能力声明](../../server/drivers/ruijie-harness.ts#L843)、[session 选择和换模](../../server/drivers/ruijie-harness.ts#L872)、[history replay](../../server/drivers/ruijie-harness.ts#L969)、[确认停止](../../server/drivers/ruijie-harness.ts#L1005)。
- Codex：[安装声明及认证环境](../../server/drivers/codex.ts#L489)、[app-server 启动](../../server/drivers/codex.ts#L578)、[进程停止](../../server/drivers/codex.ts#L688)、[初始化与恢复](../../server/drivers/codex.ts#L1044)、[模型一致性检查](../../server/drivers/codex.ts#L1085)、[能力声明](../../server/drivers/codex.ts#L1261)。

## 锐捷底层潜力与硬约束

以下路径均位于 `D:/ChatGPT/Bot/downloads/ruijie-harness-source`，是本次实际 checkout 的证据。

1. **已有两种不同的无界面形态，不能混为一个已完成方案。** 桌面外壳的 `--openmaus-server` 分支保留 Host、OAuth proxy 和 bridge，仍由 Electron 主进程承载，见 `dsh-plugin-desktop/src/main.ts:727`。底层 `dsh --profile headless` 创建新 agent，运行一次任务、flush session、输出结果并退出，无 HTTP 监听端口，见 `deepseek-harness/packages/bundle/headless/README.md:5`、`src/index.ts:96`。后者不能直接替代当前 HTTP/事件 driver。
2. **另有 stdio JSON-RPC SDK，但当前协议不是当前 Bot driver 的等价替换。** `deepseek-harness/packages/sdk/server/src/server.ts:192` 分发 initialize、session/prompt、shutdown；README `:44` 明示没有 per-session close 或 prompt-cancel，没有每个 prompt 的结果归属，自动 provider mounting 也有条件限制。若选择此路径，应先补足产品需要的取消、结果归属和授权通道，不能为了“云端轻量化”直接移植。
3. **认证续期已有实现，长期可用仍需实际场景验证。** `dsh-plugin-desktop/src/ruijie-auth.ts:409` 至 `:448` 实现 access token 过期/拒绝后的刷新、refresh token 轮换与保存；`main.ts:464` 在后台模式禁用交互登录，`ruijie-auth.ts:634` 无可恢复认证时明确失败。`ruijie-auth-store.ts:27`、`:52` 依赖 OS 加密服务。Bot 的认证管道是一条现成接入路径，但云端无人值守凭据托管、撤销后的用户可见等待状态和服务账号适用性没有完成验证。
4. **持久化会话不等于持久化执行。** 底层 `deepseek-harness/packages/core/agent/src/index.ts:418` 提供 resume persisted session；`packages/session/session-persistence-jsonl/src/index.ts:188` 提供 log load。此处不能推出进程崩溃后在原工具步骤自动继续，更不能推出外部操作不会重复。任务执行事实、结果核对和重试政策仍应由产品负责。
5. **打包“同版本”不足以建立交付信心。** 需要可复核的 commit、子模块 pin、平台、产物 hash、兼容协议能力，以及隔离环境验收记录。当前 build 支持 Windows/macOS，源码中 Linux 路径发现逻辑不代表 Linux sidecar 已经交付。

## Codex 官方事实核查边界

已依照 OpenAI Docs 技能优先查官方资料；本环境未暴露官方文档搜索或网页搜索工具。分别尝试直接请求以下官方主题页，使用 PowerShell 正常 TLS 和 `curl.exe --location --max-time 25 --fail` 正常 TLS，收到 SSL connection / connection reset，未获得可引用正文：

- [App Server](https://developers.openai.com/codex/app-server/)
- [Non-interactive mode](https://developers.openai.com/codex/noninteractive/)
- [SDK](https://developers.openai.com/codex/sdk/)

因此本次不把这三个链接当作“已阅读的官方佐证”，不声明当前协议的全部稳定性、原生换模能力或最新可用字段。Bot `codex.ts:1046` 为命名权限 profile 开启 `experimentalApi`，只能证明此适配用了相关实验字段，**不能据此称整个 app-server 仍是实验性接口**。

当前项目可直接证明的是：它实际选用了 app-server 双向会话协议，而非一次性 `exec`；它已做事件、授权和会话映射。设计上，一次性执行入口、程序 SDK、双向会话服务器回答的是不同接入需要；即使换成 SDK，任务权威状态、节点存活和重复操作防护也不会自动出现。后续选型应以实际拟封装的 Codex 版本生成/核对协议 schema，并补官方页面实证。此文不把 SDK 内部是否调用 exec 等未核实事实用于评分。

## 可替换切面：产品真正应该拥有的东西

建议保留已经有两种 Adapter 的 `ProviderAdapter` seam，收敛为一个深 Module 的 Interface：接受明确任务输入，给出可追踪事件，受控执行工具，回传授权结果，确认停止，产出结果。不要把某一引擎的 session id 或队列含义直接上升为产品任务定义。

产品应另外拥有：

- **任务身份与责任**：产品 task id、创建者、目标、时区和触发规则、状态、版本、取消意图及结果。引擎重启或换型时这些不变。
- **执行尝试**：每次 attempt 的目标环境、引擎与配置版本、模型策略、权限范围、起止事实、产物、失败类型。它引用原生 session/thread，原生 id 不是任务 id。
- **设备能力**：设备是否在线、哪些工具可用、当前用户是否接管、权限授予和撤销。在云端执行主会话也能通过此能力操作本机，不需要另设一个本地聊天总管。
- **恢复政策**：哪些步骤可重试，哪些必须核对外部状态，哪些只能等待用户确认结果。在收据不明时保留“不确定”，不把重复执行伪装成恢复。

首版可以把任务 Module、引擎和执行环境部署在同一台每用户云工作区内。逻辑分工有价值：未来能迁移执行节点，且任务状态不随进程消失；并不要求第一天拆成多个物理服务。选择哪个引擎不会消除这些职责。

## 可验收、可否决的选择规则

建议将锐捷 Harness 定为**首轮验证候选**：已有企业身份、模型目录、会话内选模和 Bot 封装工作，接续现有投资的理由充分。该建议可以被以下门槛推翻；不能以“自研可控”替代证据。

| 门槛 | 同一组验收情境 | 未通过时的决策 |
|---|---|---|
| 封装与供应 | 新建目标云工作区，从固定产物启动；无开发者机器依赖；记录完整版本和 hash | 无法重建或 pin 不一致，不进入默认交付 |
| 长期授权 | 覆盖 token 过期、轮换、主进程重启、会话撤销；撤销后任务进入明确等待状态 | 不允许把长期任务托管能力对外承诺；补认证工程或改候选 |
| 执行证据 | 相同文件整理、信息检索、浏览器操作和业务应用场景；核验真实结果及产物 | 文本回答不能替代操作，达不到验收的能力不开放 |
| 任务恢复 | 在“已接单未执行”“工具执行中”“外部已成功但结果未回传”三处故障注入 | 丢任务或重复不可重复的操作为否决项，不用更大模型掩盖 |
| 可确认停止 | 工具慢返回、队列尚未启动、网络中断时点击停止；确认旧执行不再发起新操作 | 停止事实不明时不能释放执行权或将任务标完成 |
| 本机能力 | 云端任务请求本机工具；断线、重新上线、用户接管、授权撤销均有确定行为 | 不依赖新增本地聊天代理补洞；先补设备协议与状态 |
| 模型封装 | 默认一条确定模型策略；只有某类任务有稳定收益时才加入能力路由；切换后权限和结果归属保持一致 | 不能完成切换并不自动否决整个引擎；先固定模型，隐藏不可兑现的切换 |
| 可维护性 | 固定版本升级后重复同样的关键场景；协议改变能被检查发现 | 无法建立升级回归和回退路径，不作为长期唯一引擎 |

Codex 应运行相同场景，另加两项补证：明确产品要采用的认证/计费方式并真实接入；建立固定 CLI 产物与 app-server 协议的封装、许可和升级维护记录。本次没有实测对比，不给出可靠性、成本、耗时或能力成功率分数。

两者都通过硬门槛后，再比较代表性用户旅程的可核验完成率、等待用户次数、恢复成功率、每个成功任务实际资源消耗及升级维护成本。初期不为用户提供引擎选择器；保留替换 seam 是为产品迭代负责，不是把选型责任交给用户。
