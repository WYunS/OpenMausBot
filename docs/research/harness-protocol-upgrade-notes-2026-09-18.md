# Harness 停止确认与结构化问题卡：固定源码适配笔记

日期：2026-09-18。只读研究；没有更改产品源码、Git refs 或 Harness 子模块，没有启动服务。

本次官方目标已取得：OpenMausBot `v0.1.84` = `55af6c37aa6144dd7e976f2f600a25363ba20c4f`。企业升级工作树以 `f2d500b4` 为检查起点。Harness 外仓 `a7c71c4cadaad2db218d126146973e38649a6f43`，固定子模块 `141eb6fef83422698aef7a981029e843e8161534`（dsh-v0.1.0-rc.8）。以下 Bot 当前行号取本次读取，主代理后续编辑可能移动。

## 1. H04 最小完整范围

官方问题卡的布局、题目分页、单选/多选、Other、提交中去重和失败后恢复可复用；官方的**答案文本协议不能原样当作 Harness 答案协议**。

### 两端实际协议

官方固定目标 `shared/ask-question.ts:35` 定义 `AskQuestion`：题目文本、header、multiSelect、options，没有问题 ID、detail 或 intent。`:168` 把多个答案转成 `Q: … / A: …` 文本；`:203` 再按题目文本恢复。相同题干会碰撞，包含逗号的选项与自由文本也不适合从格式化字符串逆推。

Harness 原生 `deepseek-harness/packages/interaction/user-questions/src/types.ts:35` 定义 `{ id, question, detail?, header?, options?, multiSelect?, intent? }`；答案是 `{ answers: [{ id, selected: string[], custom? }] }`。其中 `detail` 可承载完整计划，`intent.kind=plan-review` 只是呈现意图，不改变回答协议。不能丢掉 detail 后只显示“是否批准计划”。

Harness `packages/host/apiproxy/src/api-proxy.ts:661` 的 `matchesQuestions()` 进一步要求：

- 答案数量必须等于请求问题数；
- 答案必须按原请求顺序排列，且每项 ID 精确相等；
- selected 不重复且必须为原有选项标签；
- custom 如果存在，trim 后不得为空；
- 单选题最多一个 selected，且不能同时含 selected 与 custom；
- 跳过某题可以 `{id, selected: []}`，不能少一个数组项。

因此不应直接使用官方默认“最多 6 题、每题 12 项，静默丢弃非法项/截断”的解析结果回答 Harness：截断题目会导致 batch 数量不匹配，截断选项 label 后作为 selected 回传也会不匹配。UI可以限制展示量，但应显式拒绝不支持的请求，或保留原始 ID/标签映射，不能悄悄改变协议值。

### 当前企业实现缺口

- `server/drivers/ruijie-harness.ts:656–672`：仅呈现第一题，且仅接受字符串选项；原生 `{label, description}` 选项实际上会被丢弃。
- `server/drivers/ruijie-harness.ts:906–922`：把同一 `decision.message` 填进每题 custom，selected 总为空。
- `server/contracts.ts:144`、`server/store.ts:47`、`src/state/store.tsx` 的卡片数据尚无完整 questionRequest 契约。
- `src/state/store.tsx:2385` 用按钮标签 Allow/Deny 判断权限行为；业务选项恰好叫 Allow 会被误判。`:2409` dismiss 总发 deny，同样不适合问题。
- 当前 adapter 只处理 requested，不处理原生 `question/resolved` / `approval/resolved`；另一个客户端答复或取消后，本地卡可能继续显示待回答。

### 建议的最小实施清单

| 文件/接口 | 需要吸收或适配的内容 |
|---|---|
| `shared/ask-question.ts`（新文件） | 复用题目显示与 choices 校验；为 Harness 添加可选原始 ID、detail、intent 和独立结构化答案类型。保留无 ID 的 Claude/旧卡兼容 |
| `server/contracts.ts` | request.opened 添加 questions；respondToRequest decision 添加可选结构化答案。保留 message 给原生 Claude/旧客户端 |
| `server/thread-events.ts` | 为新增 question shape 做边界验证，持久化/回放保留所需字段；参考官方 `:151` 与 `:215` |
| `server/store.ts`、`src/state/store.tsx` 本地卡类型 | 添加 questionRequest、answeredText（必要时结构化回答快照）；只移植字段，不为此整体引入官方 shared/wire 大迁移 |
| `server/index.ts` request.opened fold | `permission = requestType === permission && !questions?.length`；卡保存 questionRequest，业务题不可 Full Access 自动作答；参考官方 `:4352`、`:4443–4458` |
| `server/index.ts` answerRequest / 两条 respond 路由 | 验证并传结构化答案，校验请求所属线程/实例；成功后保存回答文本供历史阅读。当前入口 `:2983`、`:13331`、`:13374`；官方 answeredText 保存逻辑 `:3317–3324` |
| `src/components/QuestionCard.tsx`（新文件） | 复用官方布局、draft、pending/onError；`:113` 的 submit 改成优先结构化答案，保留人工可读 message。不要从 formatter 文本倒推 selected/custom |
| `src/components/ChatView.tsx`、`GroupView.tsx` | 在 options 分支先分流 questionRequest；含 MessageBoundary；参照官方 `:728`、`:249`。群聊必须按 threadId 回答 |
| `src/lib/card-answer.ts`（新文件）与 store action | 复用“按卡片类型判断权限”的规则；`decideRequest` action / HTTP body 增加结构化字段；失败时卡恢复可答 |
| `src/components/OptionCard.tsx` | choices 清洗旧历史数据，避免对象作为 React child；这是独立防白屏保护，不能代替完整 H04 |
| `server/drivers/ruijie-harness.ts` | 保留原始问题与顺序，按 ID 填 native selected/custom；单题旧文本可降级，多题旧文本应拒绝或显式处理；处理 resolved 广播与重复答复竞争 |
| `src/locales/en.json`、`zh-CN.json` 等实际员工语言 | 移植官方 question.* 文案并补中文；Harness detail 文本必须可读，不能只翻译按钮 |

不需要为完成 Harness H04 同时移植官方 iOS/Android、组织登录、全部 Claude permission-proxy 或共享 wire 重构。若本轮也更新 Claude AskUserQuestion，则单列其代理识别与返回 answers 字段的适配，不能假设 Harness 的修改自动覆盖 Claude。

### 取消问题本身

Harness `api-proxy.ts:3625–3635` 接受 client-response `result.ok=false` 且 `error.code='cancelled'`，会拒绝原 ask、广播 `question/resolved:cancelled`。现有 Bot `respond()` 固定 `ok:true`，无法表达真正取消。

产品上可选择“跳过此题/整批”还是“取消询问”：前者发送全量 `{id,selected:[]}`，后者使用原生 cancelled 错误；不要把权限 deny 当作两者。官方默认“关闭问题后让模型自行判断”的文本适合旧文本型协议，不等价于 Harness 的原生取消。

### H04 回归边界

1. 单题、两题、相同题干不同 ID、选择标签包含逗号/换行、自由文本、多选加 Other；原生 host 必须接受且正确对位。
2. 超出 UI 数量/长度上限、非法选项、重复 ID、缺失 ID；要明确拒绝，不能截断后答错。
3. Full Access 下问题仍等待人；名为 Allow/Deny 的业务选项仍为 answer；真实权限卡不混入模型自造选项。
4. request/resolved 先于 HTTP receipt、取消后晚到回答、重复点击、同请求多客户端竞争、单聊/群聊串线。
5. 刷新后的旧字符串 options 卡、历史对象 options 卡、已答 questionRequest、无请求 owner 的旧卡均不白屏。
6. plan-review detail 不丢失；其批准只答原生问题，不改变 Bot/Harness 全局权限级别。

## 2. H03 实际可用的停止确认

### accepted 只是受理

Harness `packages/host/apiproxy/src/api-proxy.ts:2534–2548` 调 `agent.cancel({kind:'user'}, {keepInbox:true})` 后立即返回 `{accepted:true}`，没有 await。`api/sessions.ts:371` 和 `sessions.schema.ts:351` 也只定义受理回执。

`packages/core/agent-loop/src/agent.ts:134` 的 cancel 只触发 AbortSignal；`:303–319` 在异步执行退出时才记录 `turn/end`；`:210–222` 再退回 idle。`packages/core/agent/src/runtime-types.ts:44–50` 明确 running 覆盖 drain/close/checkpoint，idle 表示没有活动 driver；真正 `whenIdle()` 还包括 maintenance，但该方法没有直接暴露为 session RPC。

### 可以观察到什么

| 信号 | 能证明的内容 | 不能据此推断 |
|---|---|---|
| session.cancel `{accepted:true}` | Host 已接收取消意图 | 工具已经停止、锁可立即释放 |
| 匹配 sessionId + turn 的 `session/event` → `turn/end` | 这个 turn 已经终结。用户取消通常是 `{kind:'aborted',reason:{kind:'user'}}` | 所有后续排队 work 或后台任务都终止 |
| `host/session-status` running:false | 当前 agent driver 已退回 idle | 不是现有 mux 的一部分；必须接 events.host 且处理竞态/后续 running |
| `session.list` 精确 sessionId 条目 running:false | 一次权威 live/cold 状态快照，list 不会 resume agent | 缺失条目不是等同 false；旧 endpoint/重启实例不能混用 |
| `session.history` 对应 turn 的终态 | mux 丢帧后的持久终态恢复 | 最新某个旧 turn 的结束不能证明当前 turn 已停 |

`packages/core/session/src/types.ts:155–173` 区分：`aborted` 是 live cancel；`interrupted` 是持久层重载时修补崩溃留下的 turn，正常 agent loop 不发这个 marker。因此测试不应只构造 interrupted 来假装用户 Stop。

Host 的状态通知在 `api-proxy.ts:3474` 的 **events.host**；Bot 当前 `server/drivers/ruijie-harness.ts:546` 只连 **events.mux**。mux 只含 session/event、订阅基线、问题、队列、jobs 等，不能等待一个永远不会从该 socket 来的 host/session-status。轻量实现可以保留 mux，在 cancel 后用 session.list 有界确认；更完整实现需增加 host 状态订阅与初始 list baseline。

### 最小正确改动范围

1. pending turn 记录其原 endpoint、sessionId、providerTurn、事件 seq/起始基线和 generation。Stop 标记 cancelling，持有现有事件连接；不能先 abort pumpEvents 再等待终态。
2. 向原 endpoint 发送取消并等受理；继续等待这个 turn 的 turn/end，并在需要桌面重新分配时确认当前 session 已非 running。重复 Stop 复用同一 promise，避免迟到 cancel 殃及同一 session 的下一轮。
3. cancel 受理丢包/事件断流时用同 endpoint 的 session.list/history 检查；不要把连接错误或 RPC 超时当作“停止成功”。保留原生成号，不让旧事件清掉新任务。
4. 等待超时将执行状态标为“停止未确认”，禁止该物理桌面被下一任务取得，保留可重试确认路径；不要仅发普通 turn.completed 然后宣称已停。
5. 修改服务端释放兜底，否则 adapter 等待仍不充分：`server/index.ts:3196` stall 与 `:7031` room timeout 都会在 6 秒后释放资源/忙碌；`:6982` cancelled room 也会主动清状态。Harness 分支应按停止确认或有效工具能力已撤销且在途操作排空来释放，不能沿用任意计时器作为终态证明。
6. `session.cancel` 的 keepInbox:true 是重要约束：保留的队列和取消后送入的新 work 可能继续；Bot 当前 queueing:false，但不能依赖此字段证明原生 inbox 永远空。最小策略是在确认停止前不发新 prompt，并检查/限定 Bot 所有会话的队列所有权。不要全局改变 Harness cancel 语义，也不清理安装版用户会话。

这里无需修改 Harness 子模块即可利用既有状态/历史接口完成 Bot 的停止确认。若想新增一个服务端强语义 `cancelAndWait`，属于独立 Harness 桌面层扩展，需要明确协议及超时回执；本次没有实现或要求新增。

### H03 回归边界

- 延迟 8 秒以上才真正停止：界面可显示“正在停止”，第 6 秒不能释放桌面。
- accepted 后没有 turn/end：list running:false 与 history 匹配时可恢复；running:true/不可达时不伪造成功。
- 取消遇到自然完成竞态：合法终态只结算一次；不能重复计费/重复恢复队列。
- 工具执行中停止、等待问答中停止、sendTurn 还未取得 providerTurn 时停止。
- 取消前/后已有原生排队项、连续 Stop、立即新输入、晚到旧 turn/end；不误取消新轮，不释放新 generation 的锁。
- 两个 Bot 共用同一物理企业桌面：旧操作确实排空或能力有效撤销后才能交接。仅测 adapter event 不足以证明跨 Bot 桌面无重叠。
- mux 断线、Host 崩溃、endpoint 重建、session-not-found；结合明确 Host/进程归属核验，不能根据同端口重新上线就认为旧会话可重放。

这些是源码支持的设计与待执行验收项，不是对已升级应用的运行通过声明。
