# Grok Bot 执行归属：官方已知与内部未知

日期：2026-09-20。范围：说明客户端、云端工作、本机工具和 Bot 协作的公开语义；不评模型、不修改代码、不启动/停止应用、不测试、不构建。本轮只新增本文件。

## 资料来源与本轮访问状态

1. 已完整读取此前 [第一方资料记录](./grokbot-cloud-runtime-sources-2026-09-20.md)。其中总览、设置、安全及帮助页为此前实际成功访问的记录；本轮没有重复访问这些页面。
2. 本轮仅尝试一次 [Work with Grok Bot](https://cursor.com/docs/grok-bot/work)，访问成功（curl exit 0，提取正文 16,804 字符）。下文标为“本轮复核”的结论来自该次实际正文，不是搜索摘要。
3. 用户截图为 0.30.0，此前官方当前下载页为 0.57.1；这里是当前公开产品行为，不保证每条功能均在截图版本存在。

## 官方明确的行为

| 问题 | 事实与原文要点 | 来源与证据时间 |
| --- | --- | --- |
| 关闭 app 或电脑，会否停止云工作？ | `Work continues while your laptop is closed`；`closing the app doesn't stop cloud work`。例行任务在云端运行 | [Work：电脑与例行任务](https://cursor.com/docs/grok-bot/work#the-computer-and-apps)，本轮复核；[总览 FAQ](https://cursor.com/docs/grok-bot)，此前成功访问 |
| 桌面一定要有另一套“本地聊天 Agent”才能聊天吗？ | 文档描述通过发消息与持久 Bot 工作；同一 Bot 可从桌面和 iOS 进入。没有要求客户端另运行一套独立语言模型 | [总览](https://cursor.com/docs/grok-bot)，此前成功访问。后一项是文档没有提出此要求，**不是已经证实客户端内部没有模型** |
| 各 Bot 能协作吗？ | Bot 可以发异步消息，唤醒另一 Bot 处理，稍后答复；交接在会话中可见。官方建议每阶段一个 owner，避免重复工作 | [Work：Hand work between Bots](https://cursor.com/docs/grok-bot/work#hand-work-between-bots)，本轮复核 |
| 用户发消息能干预正在做的任务吗？ | 用户 direct message 优先于 background work，可 redirect 当前 turn；停止不撤销已完成操作 | [Work：Messaging and collaboration](https://cursor.com/docs/grok-bot/work#messaging-and-collaboration)，本轮复核 |
| 云电脑与本机是同一目标吗？ | 明确分开。调用本机命令走 local execution policy，默认逐命令批准，可 always allow / ask every time / never；这与云电脑批准是独立控制 | [Work：Your local computer is separate](https://cursor.com/docs/grok-bot/work#your-local-computer-is-separate)，本轮复核 |
| 本机能力公开到什么范围？ | 通过桌面 app 运行命令、读取文件、在云电脑与本机间移动文件 | [Security：Local execution](https://cursor.com/docs/grok-bot/security#local-execution)，此前成功访问；本轮 Work 重新确认了命令与独立授权，但未重新读取 Security |
| Bot 的状态是否全装在一台 VM？ | 账户内共享云电脑的文件/浏览器/登录，不同 Bot 有不同屏幕；对话存电脑之外，插件 OAuth 在 connector backend | [Work：电脑、插件、更新恢复](https://cursor.com/docs/grok-bot/work#the-computer-and-apps)，此前记录及本轮复核相关正文 |

## 官方没有公开、不能补成定论的内部实现

- 不能确认一次任务内部有几个模型调用、几个 Agent/子 Agent，或者一定存在一个聊天模型和另一个执行模型。
- 不能确认内部使用锐捷 Harness、Codex CLI、Cursor 私有 runtime，或者其他具体执行器组合。没有模型选择器也不能证明仅有一种模型/执行器。
- 不能确认客户端开机时把云任务迁回本地、关机时再迁回云端。公开的“关客户端仍继续”只证明云工作不依赖客户端在线，并不证明存在这种热迁移。
- 不能确认本机操作通过何种 RPC、队列或隧道协议完成，也不能把“Bot 之间可发异步消息”当成异构 runtime session 原样迁移协议。
- 不能仅凭本机命令/文件功能，承诺任意本机 GUI、锁屏、登录界面或关机设备仍可被操作。

## 对我们方案的启示（建议，不是 Grok 内部实现事实）

**不应该按电脑开关机切换 Harness/Codex。应该先确定任务归谁执行，再选择它所需的工具目标。**

- 默认常驻任务可以由云工作区拥有，云端 Codex 是它的一个执行器。用户桌面只是同一任务的消息/审批入口；开关这个窗口，不改变任务 owner，也不用让本地 Harness 接管它。
- 云任务若要用本机文件或操作宿主机，可请求有明确授权的本机连接器。这个连接器可以只做工具执行，不必每次再启动一个本地语言模型。设备离线时，该步骤等待/超时/明确失败，其他不依赖设备的步骤才可继续。
- 本地 Harness 可以继续负责显式选择在本机运行的任务。若确需把任务移交云端 Codex，应在明确边界先暂停原 owner，传递任务目标、摘要、文件/产物、已执行动作和待办，云端确认接管后再继续。不能把两个 runtime 的内部会话或思考状态当成天然兼容。
- 统一产品侧 task ID、消息/事件记录和 Bot 身份；单任务一次只有一个有效执行 owner/租约。协同通过显式任务委托与结果回传，不让本地和云端因“都看见同一条消息”各自执行一遍。

上面是可取的产品协议方向，**不是声称当前本地代码已经有完整云-本机交接，也不是声称 Grok 就采用该内部实现**。

## 可以直接回答用户的话

“不用开机换 Harness、关机再换 Codex。把常驻任务固定交给云端负责，本地窗口只是找它说话；需要碰你这台电脑时，再走本机授权工具。你关机以后，云任务继续，必须用本机的那一步等设备回来。我们也保留纯本地 Harness 任务，但如果要转交云端，得做明确交接，不能两边各跑一遍。Grok 的公开资料能确认前面的使用效果，不能确认它内部究竟用了几套 Agent 或哪套执行器。”
