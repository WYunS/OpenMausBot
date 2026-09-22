# Grok Bot 云端运行与 Codex 集成边界：第一方资料核查

核查日期：2026-09-20。用途：给当前架构讨论提供证据，不代表已经修改或迁移任何实现。本记录之外未修改代码、配置、应用状态或 Git 状态。

这里的“未修改 Git 状态”指未执行分支、提交、暂存等 Git 操作；本研究文档自身是新增未跟踪文件。以下补充也仅为分析，不修改运行代码。

## 证据与版本边界

- 本次读取的是 Cursor 官方的 **Grok Bot** 文档，而不是普通 grok.com 聊天、Grok Build、第三方同名 Bot 或镜像站。官方 [下载页](https://cursor.com/download/bot) 链接 x.ai/bot，并列出桌面安装包；本次该页展示 0.57.1。
- 用户截图显示 0.30.0；当前公开文档不是 0.30.0 的逐版本历史档案。因此可用来确认产品架构与当前语义，不能声称每个最新功能都已存在于截图版本。
- 以下“事实”均指官方文档明确宣称的产品行为；未审计服务端实现。推论另行标明。搜索结果摘要仅作寻址，没有作为技术结论依据。

## 一、关机以后继续运行：有直接官方依据

官方 [Grok Bot 总览](https://cursor.com/docs/grok-bot) FAQ 明确写道：

> Work runs on the cloud computer. Closing the app, your laptop, or your phone doesn't stop a background turn or a routine.

同页说明：所有 Bot 共用账户的持久云电脑、文件、浏览器会话、应用登录；每个 Bot 有自己的屏幕，可并行推理、插件操作和文件工作，每个屏幕同时只执行一项 computer-use 任务。[Routines 帮助](https://cursor.com/help/grok-bot/routines) 也明确例行任务在笔记本关闭后继续于云端运行。

**可得结论：** 用户把“本机关闭仍跑例行任务”视为云端独立运行的证据是正确的。

**不可据此推出：** 全部模型权重、所有后台服务、聊天数据库和调度进程都安装在同一台云电脑。闭源内部进程拓扑仍未知。

## 二、已经能确认是分层产品，不是“一个虚拟机包全部”

官方 [Work with Grok Bot](https://cursor.com/docs/grok-bot/work#the-computer-and-apps) 明确区分：

1. 云电脑承载浏览器、命令行、文件系统和已登录会话，账户内共享。
2. 插件 OAuth token 保存在 Cursor connector backend；Bot 调用工具但不获得这些 token，token 不存于电脑。
3. 对话存于电脑之外，因此电脑重建/重置不会直接删除聊天历史。
4. 本机执行是另外的功能和授权边界，不等于云电脑操作。

**推论：** 对标时应分离产品的会话/任务/权限控制、Agent 执行运行时和计算机工具节点。不能用“把现有桌面进程搬到某一台云电脑”直接替代可靠云任务服务。是否单独存在聊天模型与执行模型，官方资料没有披露；不应断言一定是两个 Harness。

## 三、为什么用户要点“更新 Bot 的电脑”

官方 [电脑恢复帮助](https://cursor.com/help/grok-bot/computer-recovery) 给出的含义与截图相符：

| 操作 | 官方语义 | 风险/保留 |
| --- | --- | --- |
| Update | 迁移到最新电脑版本，可立刻执行或安排以后执行 | 保留已同步的 Bot、文件、登录；移除安装的应用与包；无法暂停的 turn 可能被丢弃 |
| Recover | 重建电脑并重新连接 | 保留 Bot、文件、登录；移除安装的应用与包 |
| Reset | 从上次保存快照恢复，并启动最新版本电脑 | 中断当前任务；只保留快照已有状态；最近未同步 Bot/文件可能丢失 |

官方还明确存在 `Backup not ready` 和 `Agent busy` 阻止更新的情况。前者等待备份，后者等待 Bot 可以暂停；不得用 Reset 强行推动更新。

[设置文档](https://cursor.com/docs/grok-bot/settings#updates) 区分桌面应用更新与 Agent Computer 镜像重建。[安全文档](https://cursor.com/docs/grok-bot/security#data-retention-and-deletion) 同时写明：过时系统镜像上的电脑会在新镜像上重建，并保留成员文件。

**有依据的解释：** 用户控制的是自己的有状态工作环境迁移/重建时机。该操作会影响已装软件和运行中任务，因而有备份与暂停边界；这不是要求用户替厂商维护云端 API 服务。

**不能确认：** 点击之外具体多久强制更新、安全补丁如何滚动发布、所有旧版本的自动更新时限。不点按钮不等于官方永远不维护这台电脑；官方已有 stale-image 重建说明，但未给出统一期限。

## 四、模型和本机控制：两个重要纠正

[设置文档](https://cursor.com/docs/grok-bot/settings#general) 明确没有模型选择器；[安全文档 Models and data](https://cursor.com/docs/grok-bot/security#models-and-data) 进一步明确：Cursor 管理模型选择，serving mix 可以随时间改变，**不保证固定模型供应商集合**；用量分析展示实际服务请求的模型，包括 fallback。

因此“没有模型选择器”不等于“内部只用唯一 Grok 模型”，也不能据产品名称推断具体 Harness。

[安全文档 Local execution](https://cursor.com/docs/grok-bot/security#local-execution) 明确 Bot 可经桌面 app 在用户本机运行命令、读取文件、云端和本机间移动文件。默认逐命令批准；可以 Ask every time / Always allow / Never。这与云电脑内部的 Auto Review 是不同控制。

**范围限制：** 上述证据能证明本机命令和文件能力；不能单凭该页证明任意本机 GUI 鼠标键盘自动操作已在截图版本提供。

此外，[Computer 设置](https://cursor.com/docs/grok-bot/settings#computer) 可以把云电脑出站网络经桌面转发。**推论：** 依赖这个转发才能访问的本地内网，在桌面关闭后不再具有该连通条件；不能把“云任务不依赖笔记本开机”解释成“所有需要本机网络/文件/工具的任务也完全不依赖它”。

## 五、地域与托管事实

[安全文档 Data residency / Hosting](https://cursor.com/docs/grok-bot/security) 明确当前电脑在美国运行，仅 Cursor 托管云电脑，不支持客户自托管或自带镜像。文档没有确认所有电脑均在 California。

这是当前供应商的产品部署约束，而不是我们的目标架构必须采用相同部署方式。

## 六、Codex 官方接口能提供什么，不能替我们解决什么

本节只使用实际抓取的 OpenAI 官方页面。未运行 Codex、未发起模型调用。

### 非交互执行

[Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/) 支持 `codex exec` 用于 CI、流水线和 scheduled jobs；`--json` 输出线程、turn、tool 等 JSONL 事件；支持恢复会话。默认只读沙箱，自动化需显式设置最小权限。官方建议自动化优先 API key，安全管理作用范围，不把长效凭证暴露给同作业中的不可信代码。

**推论：** Codex 可作为服务器 Worker 内的可替换 Agent 引擎；“CLI”不意味着必须运行在最终用户的桌面。但是定时任务持久化、任务去重、Worker 重试、租户隔离、结果通知、升级与可观察性仍要由 Bot 产品实现，不能仅凭启动一条 CLI 宣称具备了云服务。

### App Server

[Codex App Server](https://developers.openai.com/codex/app-server/) 面向自定义富客户端，提供认证、会话历史、批准请求及流式 Agent 事件；文档还描述远程连接与 remote Code Mode host。

当前页面明文提醒：

> The app-server command and WebSocket transport are experimental and aren’t supported for production workloads.

文档还警告非 loopback WebSocket 监听器在 rollout 中默认允许未认证连接，要求远程暴露前显式配认证并使用 TLS。

**建议/非既成事实：** 可研究 App Server 做深度客户端集成，但应固定版本、做适配层和协议测试；不要把裸 WebSocket 接口公开成我们多租户云控制面。官方对自动化 jobs/CI 指向 Codex SDK，而非单纯远程富客户端模式。

### Computer use 不是“装了 Codex 就自动会操作一切”

[OpenAI Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use/) 明确：

> You provide the environment and execute the model’s requests.

可以由模型编写 Playwright/PyAutoGUI 类操作代码，也可以用结构化 computer tool 返回键鼠动作；已有 function calling / remote MCP UI 工具接口也可继续使用。集成方负责实际环境、会话持续性、动作执行、截图返回、执行限制和权限。

**架构含义：** 模型能力、Agent 循环、电脑工具/操作权限是三个不同维度。选 Codex 或锐捷 Harness，都仍需验证其对我们浏览器/CUA 工具的适配。低成本聊天模型不自动等于没有电脑权限，也不自动具备稳定视觉定位能力；具体 DeepSeek 型号未明确，本次不推断其能力或价格。应把视觉/GUI 执行做成可路由的专长能力，按代表性任务测成功率、人工接管率、总成本，而不是只比较 CLI 品牌。

## 七、对当前讨论可安全采用的结论

1. 用户对云端持续工作的方向判断成立，而且已找到直接第一方证据。
2. 云端独立执行和本机可控并不冲突；Grok Bot 本身已经分别提供云电脑与本机命令/文件能力。
3. 对齐重点应是稳定的后台任务生命周期、隔离的云/本机执行目标、持久状态和审批边界，而不是先强制统一模型品牌。
4. 更新 UI 应清楚区分客户端、Agent runtime、云电脑系统镜像；镜像更新要展示是否重启、是否中断任务、保留什么、移除什么、能否恢复。
5. 未发现可公开证实 Grok Bot 使用哪一个具体 Harness、是否独立聊天模型与执行模型、精确服务器进程布局的第一方资料。以上不以逆向猜测补全。

## 八、本机 UI 尺度核查：不是拿手动调整后的截图当默认值

当前工作区是 `D:/ChatGPT/Bot/downloads/OpenMausBot-source`，包含原本未提交的 UI 修改。只读读取了本机 Grok Bot 0.30.0 安装包的布局与样式常量，没有修改/提取覆盖安装文件。其 package.json 名称 sand、作者 SpaceXAI、homepage 为 cursor.com；不要把用户早前那份 Mac 0.56.1 对比稿当成本机相同版本。

| 项目（逻辑尺寸，不是截图物理像素） | 我们当前锐捷模式 | 本机 Grok Bot 0.30.0 |
| --- | --- | --- |
| 无保存状态的窗口 | fallback 1100×780，而且最大化 | 普通路径 1040×760；特殊启动分支 1440×960；恢复计算不主动最大化 |
| 保存状态恢复 | 读取 normal bounds，却在 resolveWindowState 各分支返回 maximized=true | 按有效保存的 isMaximized 恢复，异常尺寸走 fallback |
| 左栏 | 常规 248、紧凑 224、图标 68；档位切换 | 默认 280、可拖范围 240–400、折叠 88 |
| 右栏 | 默认 260，最小 240，保存值可覆盖 | 默认 320，最小 280；有独立持久化 |
| 文字刻度 | UI 13/18，正文 14/22 | base 13/18，lg 14/22 |
| 字体策略 | 锐捷覆盖优先 Microsoft YaHei UI，也用于拉丁字符 | 系统字体栈，Windows 默认 Segoe UI 路径，中文再回退 |
| 回复样式 | chat-answer 强制透明背景，横向 padding=0，段距 10，最大 min(42rem,88%) | 灰底聊天气泡的视觉与语义令牌 |

本地证据：

- `electron/window-state.cjs` DEFAULT_BOUNDS、resolveWindowState；`electron/main.mjs` writeWindowState/createWindow/restore.maximized。
- 纯函数实测：输入 `{bounds:{x:50,y:50,width:1100,height:780},maximized:false}` 与正常屏幕，输出仍为 `maximized:true`。这足以反驳“完整按保存状态恢复”的说法，未修复。
- `src/components/Sidebar.tsx` 1809 附近；`src/components/ComputerPanel.tsx` PANEL 常量和 readPanelWidth；`src/styles.css` 字体刻度与 ruijie/chat-answer 覆盖。
- Grok 安装包 `dist/electron-main/main.cjs` 的 resolveSandWindowPlacement/窗口恢复函数，`dist/renderer/assets/index-B3DQqRUH.js` 的布局常量与 `sand.sidebar.width`/`sand.infoPane.width`，`index-BrN-auUU.css` 的字体 token。

限制：当前没有获取到两款应用同时运行时可靠的页面缩放值。旧 DevToolsActivePort 指向的端口不可用，没有为了测量而重启或改变应用。因此“当前实际渲染缩放完全一致”未获证明；系统 DPI、Electron zoom、窗口尺寸、面板保存宽度必须独立控制。两个截图消息内容也不同，不能直接据留白面积量化字号问题。

**设计建议而非修改：** 先在同一台 Windows/同一显示器、同 DPI、100% 页面缩放、同窗口内容区、同样消息与面板开关下比较；分别验收干净配置首启与自定义布局重启。默认参考左 280/右 320、正文 14/22，保留可读性和缩放设置；优先修恢复状态、字体回退与气泡/段距层级，不全局机械缩小字体。窄屏折叠面板，别强制三栏挤压聊天区。

## 九、我们现有代码与目标架构的差距

1. 本机 Electron `utilityProcess.fork` 启动 Bot server；`server/routines.ts` 的 start() 用本进程计时器驱动持久化任务，`server/index.ts` 调用 routines.start()。当前部署的常规定时调度依赖本机 server 存活。
2. 通常由本地 driver 承担 Agent 循环，模型推理可以调用云端 API，电脑工具再操纵远端环境。模型 API 在云端不等于整个 Agent 生命周期在云端。
3. 存在 BoxAgent/`runOn=cloud` 路径，已派发给外部引擎的工作可能在外部继续；但这不等于本机计时器停止后未来的例行任务仍有人触发。不可笼统说所有云路径都一样。
4. `docs/self-hosting.md`、`docs/plans/remote-workspace.md`、`electron/environments.cjs` 已有远程 server/客户端配对基础，不应把已有能力当成全无，也不应把文档宣称当成当前部署验收。
5. `electron/capabilities.cjs` 在 remote=true 时关闭本机控制/预览/听写。这是现有安全隔离，不能为了远程控制本机简单删除；需要独立设备注册、授权与执行桥接。
6. Harness 与 Codex adapters 均声明 computerMcp、localComputerMcp、browserMcp、images。当前 Harness 默认 model id 为 deepseek-vision::deepseek-v4-flash。它是路由标识与能力声明，不是该具体模型 GUI 成功率证明。
7. 当前 `scripts/build-ruijie-harness.mjs` 的已实现内置产物链只支持 Windows/macOS。这不证明 Harness 核心不能在 Linux 运行，但目前不能把桌面 sidecar 直接称为已验收的 Linux 云 Worker。

## 十、建议方案：云端常驻工作区 + 可选本机执行端

逻辑分层（不是要求一期立刻拆成多个微服务）：

1. **交互客户端**：桌面/网页/手机只提交意图、看进度、审批和收结果。客户端断线不取消已经提交的云任务。
2. **工作区任务模块**：持久保存 Bot 身份、指令、记忆、任务、日程、消息、权限与产物索引，拥有任务状态的唯一权威。持久时钟、去重 run ID、执行租约、断线恢复与审计都归这里，不交给语言模型靠对话记忆维护。
3. **Agent 执行模块**：按能力与租户策略选 Harness/Codex 等 adapter。对产品提供统一的启动/事件/取消/审批/恢复语义；固定版本，隔离凭据，不暴露裸 CLI 或 app-server 到公网。
4. **工具目标模块**：明确 cloud-computer、registered-device、browser、API 等目标。云电脑承载任务沙箱/工作文件/浏览器。云任务状态和密钥存储不能被任务内 shell 同权修改。
5. **本机设备连接模块**：电脑主动建立认证加密出站连接；设备绑定、可撤销授权、动作范围、短期租约、抗重放、停止开关、本机确认与桌面占用互斥。云端不能通过猜本地路径来获得电脑权限。

一个任务只有一个明确的调度/执行所有者。通常云端 Agent 直接通过授权设备桥调用本机 CUA，不要求再运行第二个本机语言模型；离线或隐私任务才显式选择本机 Harness，并处理任务移交和结果同步。不要把云端和本地同时设为同一日程的权威，以免重复下单/发消息。

电脑关机时，云任务继续；需要本机文件、内网或鼠标操作的步骤进入等待设备/超时/失败状态，不谎称完成、不静默改到另一台电脑。仅关闭聊天窗口时能否继续本机执行，取决于另行设计的用户会话后台连接器；锁屏/登录界面不承诺可控制。用户可在未来网页或手机客户端继续交流，不能把本机窗口视为唯一聊天渠道。

### 运行时与模型建议

- 本地短期保留已整合的 Harness，避免因架构分析再替换工作版本。
- 云端试点先选已经能以服务账号/隔离目录无头运行的 adapter。Codex CLI/SDK 是候选，适合快速验证服务器编码、shell、工具流程；它不是云调度平台本身，也不凭名称承诺 GUI 更强。
- 若决定统一 Harness，先分离/验证不依赖桌面壳的 headless 核心，补 Linux、私有认证、MCP、取消恢复、并发隔离和启动依赖验收。其桌面分发版可继续保持现有策略。
- 平价模型可处理聊天、分类、摘要、结构化 API/DOM 流程；复杂视觉定位、长链纠错交给已实测的更强执行模型。通过能力策略分工，不强迫聊天模型与 GUI 执行模型完全相同。
- 用同一批代表性任务评测模型×runtime×工具组合：完成率、误操作率、人工接管率、延迟、重试和每次成功任务总成本。不能只按单 token 价格或 CLI 品牌下结论。

### 递进实施与验收（均未执行）

1. UI 基线：修窗口持久化语义、标准化字体与三栏默认，干净配置和保存配置分别验收。与后端迁移解耦。
2. 最小云闭环：先一个测试工作区、一个执行器、一个隔离云电脑、一条例行任务；客户端断开/本机关机后仍按时触发，重连能读到持久日志和产物。先不启用本机控制。
3. 本机能力：增设备连接与明确授权，测撤权、离线、锁屏、用户抢占、危险操作审批，保证目标不会混淆。
4. 多引擎和运维：模型分层路由，按任务证据选引擎；将桌面客户端、Worker runtime、云电脑镜像、本机连接器分别版本化。镜像重建需停新任务、排空/检查点、备份验真、迁移、健康检查与回退；重要文件与会话在可持久恢复的存储中。

分布式执行一般按至少一次投递设计；通过去重、幂等与结果核对防重复副作用，不宣称鼠标点击、外部转账或发送天然具备 exactly-once。一期可以每租户一个常驻进程和持久库，并不要求从一开始搭建大型 Kubernetes/多微服务平台。
