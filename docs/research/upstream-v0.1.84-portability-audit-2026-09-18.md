# OpenMausBot v0.1.84 选择性升级：第一批可移植性复核

核验日期：2026-09-18。范围：只读审查用户方案、当前企业工作树及本地缓存的官方 Git 对象；只新增本报告，没有改产品源码、配置、Git refs，没有运行真实服务、安装、构建或发布。

## 结论

保留企业定制分支、按行为选择移植的方向正确，但原计划的“第一批小补丁”还需缩小。D07 的根目录技能 URL 错误已用当前解析器直接复现，适合优先修；R01 可以做独立安全补丁，但要完成 Windows 别名/大小写真实文件系统测试。U02 应改为“已有图库，只补截图放大等缺失项”。R02/R03 必须逐项去重、确认适用路线，不能按标题整体接入。H04 是跨驱动、事件、持久化、交互的完整功能包；U05 的稳定引用也应与编辑即时反馈分开排期。

目前不能宣称已核实官方 v0.1.84 的实际源码：用户报告给出的 SHA 是 `55af6c37aa6144dd7e976f2f600a25363ba20c4f`，本地对象缺失，GitHub 主站、REST API、raw 域名本次直连均失败。本报告将可以独立验证的企业现状与缓存官方提交，与尚待联网确认的 v0.1.84 差异明确区分。

## 1. 基线与证据范围

- 实际企业仓：`D:/ChatGPT/Bot/downloads/OpenMausBot-source`，HEAD `30924bab`，且有 14 个已跟踪文件未提交修改。那些修改是本次核对的组成部分，不能只比较 HEAD。
- 用户方案基于另一位置 `D:/Project/Ruijiebot/versions/v0.1.76` 的 `feb5cf28`。当前机器该目录不存在。`git merge-base feb5cf28 HEAD` 返回 `bd7002781504a3430928d9fbe8000b0d9e9aa163`，`git rev-list --left-right --count feb5cf28...HEAD` 返回 `3 3`。这是分叉的两条路线，不能简单认定当前仓包含旧方案仓全部内容。
- 当前企业仓中有官方 v0.1.79 提交 `793399b2` 及若干相关提交对象；研究克隆 `.research/OpenMausBot-upstream-20260914` HEAD 为官方 v0.1.78 `419a2814`。这些适合证明特定已缓存提交的行为，但不能替代 v0.1.84 全量比较。
- 本次请求 `git ls-remote` 到官方仓失败；访问官方 REST `git/ref/tags/v0.1.84`、raw 固定 SHA 文件均在 8 秒连接超时。未把用户提供的标签 SHA 当作已复核结果。

原方案 H01/H02 已明显滞后：当前工作树有内置 Harness、私密 SSO 继承、私有桥接目录，以及 `agentsMcp: true` 的新增挂载。应继续核验真实企业链路，而不是重新从“只发现外部安装 Harness、没有 agentsMcp”开始实现。版本锁定与两个企业分支的遗漏项由主审报告单独处理。

## 2. 第一批逐项判断

| 项目 | 当前证据 | 修订后的采用方式 |
|---|---|---|
| R01 检查点目录保护 | `server/checkpoints.ts:156` 使用 `realpathSync`，多个路径比较仍为大小写敏感 `===` | 优先独立修复；没有取到官方 `318d5c3c`，暂不能宣称可原样 cherry-pick。纳入 native realpath、Windows 等价路径、短路径/符号链接测试，不能仅换函数名就称保护完整 |
| D07 根目录技能 URL | `server/skill-fetch.ts:72` 的 `(.+SKILL\.md)` 不接受根目录 `SKILL.md`；当前解析器执行已复现 | 第一批最明确的小补丁。仅修导入 URL 解析和测试；不混入技能默认开启、工具挂载或公司技能发布策略 |
| R02 npx/npm 无 shell MCP 启动 | `server/mcp-gate.ts:152–161` 已有 `resolveCliSpawn`、`shell: false`、`windowsHide`；与缓存官方 v0.1.79 该文件无差异 | 改为“已有”，除非联网拿到 0.1.84 后发现新的实际缺陷 |
| R02 嵌套终端输出、PATHEXT | 官方 `8597137f`、`124cc3be`、`c47a3c93` 修改的是 `electron/shared-computer-access.mjs`，当前企业仓没有该文件 | 暂不移植。它属于共享电脑的 shell 执行路线，不是本地 Harness 的 `pwsh`。不能为了两个终端修复顺带接入默认暂缓的共享电脑功能 |
| R02 可输入安装终端 | 当前 `electron/terminal-launch.mjs:38` 用 `execFile` 启动 PowerShell；缓存 v0.1.79 与企业版本相同 | 可能存在尚未缓存的后续修复，需要取得官方目标补丁再确认。与后台 no-console 助手分别验收，不整份覆盖 Electron 主入口 |
| R03 数据目录 lease/PID | 本地已有 boot-aware lease，且另有 Windows 进程创建时间防 PID 复用 | 基础能力标“已有且带企业增强”。后续只合缺失场景，保留 Windows 检查。覆盖官方缓存 v0.1.79 会直接删除企业增强 |
| R03 CLI 退出后释放 | 既有 Windows 终止修复；当前 Codex settle 已等待 close。Harness 的 interrupt 仍立即本地 settle | 拆成具体引擎适配；Harness “确认停止”归 H03，不把官方 Codex 修复当作 Harness 已修 |
| U01 消息操作菜单 | 当前已有悬停/键盘焦点显现的编辑、复制、回复等按钮；没有独立 MessageActions 组件 | 可做局部表现优化，但目标应是“合并菜单及发现性”，不是从无到有。先取 0.1.84 组件及调用差异，保留企业简洁顶栏与远程客户端权限 |
| U02 附件图库/截图放大 | 当前已有 `AttachedImageGallery`、多图预览、Markdown 图片预览。聊天 `ScreenFrame` 仍是不可点击的图片 | 将截图灯箱单列为低风险补丁；已有图库不重建。附件路径解析、安全来源与工具详情折叠分别比较，不合成一个大组件覆盖 |
| U05 稳定线程引用 | 当前 `src/lib/thread-refs.ts` 根据标题、当前 Bot、最近活跃时间解析，再在 DOM 中写 ID | 不等于持久 ID 引用。稳定引用涉及消息表示、Markdown 解析、导航与旧消息兼容，应独立于小 UI 批次 |
| U05 编辑立即显示 | `src/state/store.tsx:1664` 的 editMessage reducer 只改变 mascot 状态，聊天仍等待服务端结果 | 可独立适配反馈，但必须覆盖服务端拒绝、切线程、分支消息、重复 Enter；不能直接原地修改历史消息破坏分支语义 |

## 3. H04 问题卡不是只换组件

原方案将 H04 放在阶段 1B 是正确的。应继续维持独立完整功能包，而不是提前作为首批 UI 小补丁。

当前 Harness 适配器的实际问题：

1. `server/drivers/ruijie-harness.ts:658` 读取全部 `frame.questions`，但只把第一题的题干和字符串选项发到 OMB；对象选项描述和后面的题都没有被完整呈现。
2. `server/drivers/ruijie-harness.ts:917` 回答时把同一 `decision.message` 写进所有问题 ID 的 `custom` 字段，且 `selected: []`。多题界面即使画出来，后端仍会把同一个答案广播给所有题。
3. `server/contracts.ts:144` 的 request 事件只有 flat `choices`；`server/store.ts:50` 卡片也以字符串 options 为主。只增加 QuestionCard 不会自动补全传输与历史恢复。

缓存官方提交 [2f91c462](https://github.com/milind-soni/OpenMausBot/commit/2f91c462926bee70242c42a4e3443b19d0a13a0c) 实际涉及 33 个文件、约 2996 行新增，包括桌面/手机、Claude permission proxy、审批自动化、contracts、store、thread-events、共享问答模型和前端 reducer。它不具有“一张卡片组件即可通用移植”的范围。

还有重要协议差别：该官方提交的 `shared/ask-question.ts` 用题目文本和数组顺序表达问题，`formatQuestionAnswers()` 格式化成一段文本，`questionAnswersByQuestion()` 再按题目文本恢复；不是 Harness 原生 `{id, selected, custom}` 的答案结构。要适配 Harness，需保留请求原始问题 ID 和选项映射，不应通过题目标题猜 ID，更不能把官方格式化文本整段写入每个题目。

建议 H04 的最小完整范围：

- 驱动识别/校验结构化题目，持有原始问题 ID；兼容裸字符串及 `{label, description}` 选项。
- request event、持久化卡片、前端 reducer、单聊/群聊渲染同步升级，并维护旧 options 历史可读。
- 回答以题目 ID 关联，安全审批与业务问答分开；一个叫 “Allow” 的业务选项不能变成授权。
- 对旧客户端单题兼容；无法承载多题时显式逐题或明确失败，避免同一回答灌入所有题。
- 取消、重启、已失效请求、重复点击、同名问题、缺失选项必须得到确定结果。

缓存后续提交 [00613a25](https://github.com/milind-soni/OpenMausBot/commit/00613a25be45f2cf931fec67c9e97a41ef579217) 的白屏防护可以与完整多题功能拆开：其核心是 choices 清洗、旧历史 options 清洗和 MessageBoundary。但它依赖前述共享模块；移植时提取可复用清洗逻辑，不能因为某驱动修了 choices 就认为 Harness 的多题答复已经正确。

本次未取得 v0.1.84 对上述协议的最终形态，实施前仍应核对固定目标是否已有进一步变化。

## 4. 可独立采用的明确例子：U02 截图灯箱

缓存官方提交 [4b7dbb86](https://github.com/milind-soni/OpenMausBot/commit/4b7dbb86c8317ed9b3799767feeb75718f3fb1e7) 只涉及：

- 把 ChatView 内的 ScreenFrame 拆出；
- 新建 `src/components/ScreenFrame.tsx`；
- 对 data URL 与 MIME、下载文件名增加测试。

新组件使用既有 `AttachmentPreviewDialog` 和 `PreviewImage`，使用已有 `chat.botScreen` / `attach.previewAria` 文案；当前企业仓已经有这些接口。因此这比“完整更新附件组件”更适合第一批，且不会天然要求引入新版团队、归档或企业管理页面。实施仍须核对企业预览接口并做可聚焦、点击放大、Escape 关闭、PNG/JPEG 下载的隔离 UI 验证。

## 5. R03 应保留的企业保护

`electron/data-dir-lease.mjs:99` 在 boot/PID 检查后调用 `windowsProcessStartedAt(owner.pid)`；`:175` 使用隐藏 PowerShell 查询 Win32_Process 的创建时间。若同 PID 当前进程比租约创建时间晚超过容差，则认定它不是原 owner。

`git diff HEAD 793399b2 -- electron/data-dir-lease.mjs` 明确显示：直接套用该官方缓存文件会删除 `spawnSync`、`PROCESS_START_TOLERANCE_MS`、上述函数和 owner 检查分支。这是“上游版本号较新不等于某个企业模块更完整”的具体例子。

官方 boot-aware lease 的 [c0596fa4](https://github.com/milind-soni/OpenMausBot/commit/c0596fa4) 已在当前 HEAD 历史中，不能再把它列为尚未采用的新能力。要复核 0.1.84 可能追加的 lease 修复，必须取得真实补丁并与企业增强合成，而不是替换整个文件。

## 6. 实际执行的检查与没有验证的内容

只读检查包括 Git status、merge-base、分叉计数、cached show/diff/log，以及当前文件读取。没有切分支、fetch 到主仓、重置、提交或推送。

执行过一次纯解析器检查（无服务、无下载、无用户数据写入）：

```powershell
node --experimental-strip-types --input-type=module -e 'import { parseSkillSource } from "./server/skill-fetch.ts"; console.log(JSON.stringify({root:parseSkillSource("https://github.com/owner/repo/blob/main/SKILL.md"),nested:parseSkillSource("https://github.com/owner/repo/blob/main/example/SKILL.md")},null,2));'
```

结果：根目录返回 `that does not look like a GitHub repository, folder, or SKILL.md URL`；子目录正确转成 raw URL。证明 D07 当前实际缺陷，不代表已经实施修复。

未执行检查点恢复、真实账户登录、真实 Harness 调用、云桌面操作或 GUI 启动。本报告不声称任何升级已通过运行时验收。

## 7. 建议调整后的首批任务边界

1. 先固定当前 HEAD + 14 个未提交文件的完整基线，核对分叉分支遗漏与 Harness 运行/CI 版本对应，建立可恢复检查点。
2. D07 URL 解析；R01 Windows 受保护路径；U02 截图灯箱可分别形成独立补丁。
3. U01 菜单与 U05 编辑反馈仅在取得 0.1.84 源码、确认企业接口依赖后进入局部 UI 批次。
4. R02/R03 按已存在/不适用/实际缺失拆表，再决定是否还需任何代码；共享电脑 shell 修复目前不进入员工主线。
5. H03 停止确认、H04 结构化问答、U05 持久 ID 引用各自作为端到端功能包，不合在“小修复”标签下。

本结论不依赖把未知 v0.1.84 源码当作已看过；联网恢复后，应补录目标标签解析、源提交及每个最小补丁的确切 diff，然后再开始移植。
