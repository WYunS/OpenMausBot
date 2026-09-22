# OpenMausBot 上游更新只读审计（2026-09-14）

## 结论

官方最新稳定版已实时确认是 **v0.1.78**，tag 和 `main` 同时指向 [`419a28149700093ac61750de1541df56cb8df981`](https://github.com/milind-soni/OpenMausBot/commit/419a28149700093ac61750de1541df56cb8df981)，GitHub Release 时间为 2026-09-13 22:25 UTC（北京时间 2026-09-14 06:25）。

当前锐捷分支的上游基线是 [`ca611187`](https://github.com/milind-soni/OpenMausBot/commit/ca61118787f687749eb1251bc3007e4d7d7bdd93)：它已经包含 v0.1.71 以及随后三个 usage/key/budget 提交。当前源码显示的 `0.1.73` 是下游自行设置的包版本，不代表已经合入官方 v0.1.73。

**建议升级，但不建议整库直接合并。** v0.1.78 有值得引入的稳定性、安全、Windows CUA 和多工作区功能；然而从当前基线到 v0.1.78，上游改动 601 个文件，其中 73 个与已提交下游定制重叠、16 个与当前未提交修改直接重叠。应逐功能组审核并手工融合。

本次没有修改产品代码，没有在当前仓库执行 `fetch`、`pull`、`checkout` 或 `merge`。实时上游检查和源码比较在独立研究目录中完成。

## v0.1.72—v0.1.78 新增内容

| 版本 | 主要新增与修复 | 对当前项目的价值 | 初步建议 |
| --- | --- | --- | --- |
| [v0.1.72](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.72) | 多工作区 Fleet；Settings → Workspaces；Settings → People；完整工作区备份恢复；每 Bot MCP；skill authoring；登录与浏览器控制修复 | 后台管理基础价值高，但和 server/index、设置、账号链路重叠 | 分拆审核，不能整版照搬 |
| [v0.1.73](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.73) | VPS 预览恢复与帧压缩；iOS 线程/文件夹；Codex helper 生命周期修复 | VPS/Codex 修复有价值 | 可优先评估，远程桌面需融合 |
| [v0.1.74](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.74) | 新手引导；原生审批级别；updater 错误说明；服务崩溃自动恢复；webhook 去重；follow-up 持久化 | 服务恢复和 webhook 去重价值高 | 推荐吸收；updater 保留锐捷更新源 |
| [v0.1.75](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.75) | Provider 图片/认证/线程审批修复；打开 Bot 设置前关闭 Computer 面板；AskUserQuestion 使用模型选项；Bot 上下文连续性 | 与设置关闭、ComputerPanel、账号状态直接重叠 | 高风险手工融合 |
| [v0.1.76](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.76) | Windows 原子写重试；消息 SQL 性能；权限 broker 隔离；团队/Chief 完整化；协调回执；预算、模型切换、连接器权限修复；繁中和 Android | 大量正确性与性能修复值得采用 | 按 server、UI、账号拆分 |
| [v0.1.77](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.77) | 托管工作区基础；桌面工作区切换；可选电脑共享；团队交互画布和共享 Box 电脑；归档 Bot 删除；OpenRouter 校验；共享目录安全修复；乌克兰语 | 后台/工作区能力主体，但与锐捷电脑、路由和 UI 高度冲突 | 独立专题审核 |
| [v0.1.78](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.78) | Windows 本机 CUA；月/年/时区定时；Windows 无边框标题栏；Full Access 真正免重复审批；Bot 间持久会话；iOS Walkie | Windows CUA、Full Access、协调修复很有价值 | Windows CUA 只取通用部分，不能替换锐捷远程 CUA |

完整范围：`ca611187...v0.1.78`，约 601 个文件。若从 v0.1.71 tag 计算，则为 618 个文件、58,675 行新增、5,833 行删除。

## “通用后台管理系统”到底有什么

这个消息**部分属实**。v0.1.72—v0.1.77 已经把原来标记为 planned 的 `admin` entitlement 改为 shipped，但它由几部分组成：

1. **Fleet 管理层**：在一台 Linux 服务器上创建多个隔离工作区，每个工作区有独立 OS 用户、数据、端口、服务和站点；支持 list/create/users/suspend/resume/delete/upgrade。
2. **Settings → Workspaces**：管理员可查看状态和月度费用、创建工作区、管理用户、暂停、恢复、删除和批量升级。
3. **Settings → People**：邀请成员、设置 admin/member、查看 last seen 和月度费用、删除成员并撤销其会话。
4. **托管工作区登录协议**：工作区可对接一个外部身份服务，支持 PKCE、一次性 code、角色和会话撤销。
5. **桌面工作区切换及可选电脑共享**：桌面可连接不同托管工作区；电脑共享默认关闭并受安全 gate 控制。

但它**不是完整开箱即用的通用后台**：

- 官方 [`hosted-workspaces.md`](../verification/hosted-workspaces.md) 明确说仓库只提供 workspace-side adapter，**不包含 hosted administration console**。
- 独立控制台、邀请服务、Provider gateway 和部署自动化需要另行部署。
- Fleet 的真实隔离依赖 Linux、root、systemd、nftables、Caddy 和泛域名；官方测试并未证明生产环境的 root/tenant 隔离。
- `admin` 功能属于 `enterprise/` source-available 层，需要有效 entitlement/license；不是普通开源桌面安装后自动出现。
- 它解决的是“同一服务器托管多个客户工作区”，不是替代锐捷沙箱管理平台，也不是直接管理现有飞连节点。

因此，如果目标是“集中管理多个客户的 Bot 工作区”，这套基础值得评估；如果只是想解决当前单机 Bot、远程桌面和 CUA 稳定性，不应为了后台功能整体升级。

## 与本地补丁的冲突

当前仓库相对 `ca611187` 已有 409 个文件的已提交下游差异；工作区还有 44 个 tracked 修改和 14 个 untracked 条目。新上游与下游的热点如下：

| 审核项 | 上游变化 | 本地变化 | 风险 | 建议 |
| --- | --- | --- | --- | --- |
| Windows CUA | v0.1.78 打包并启动官方 Windows CUA driver | 锐捷远程沙箱使用 HTTP→MCP bridge、远端 socket、鉴权和 noVNC 兜底 | 极高 | 保留两种后端；只移植官方本机 CUA，不替换锐捷 adapter |
| Browser/Computer | helper 无界面运行、焦点修复、VPS 帧压缩、电脑共享 | 已有浏览器接管、全屏、路由、鼠标映射、自动拉起修复 | 极高 | 逐提交三方融合并跑真实交互回归 |
| 设置弹窗 | v0.1.75 增加 ComputerPanel→Bot Settings 的互斥关闭 | 本地修复重复 React key、完整 pointer 关闭和 HMR 多 root | 极高 | 保留本地机制，再吸收新的面板互斥行为 |
| Electron 生命周期 | 嵌入 server 崩溃恢复、Windows 标题栏、CUA 生命周期 | `electron/main.mjs` 有大量锐捷 SSO、飞书、浏览器、发布改动且当前未提交 | 极高 | 拆成 supervisor/CUA/window 三项审核 |
| 多工作区后台 | Fleet、People、Workspaces、hosted adapter | 当前有锐捷账号、SSO、云沙箱和产品 feature gate | 极高 | 先做架构适配方案；不要直接打开 entitlement |
| Bot 协调 | 团队、Chief、持久 pair 会话、Full Access | 本地 Harness、system prompt、bot bridge 均有定制 | 高 | 优先保留上游语义，手工接回锐捷工具 |
| 飞书/连接器 | connected apps 按 Bot、远端自助断开 | 本地独立飞书 runtime、broker、凭据和状态恢复 | 极高 | 独立批次，禁止覆盖本地 runtime/凭据策略 |
| updater/打包 | Windows CUA 资产、updater 错误提示 | 锐捷仓库更新源、品牌、签名、构建收据、浏览器/飞书资产 | 极高 | 仅移植错误提示和必要资源，保留下游发布配置 |

当前未提交且与新上游直接重叠的 16 个路径包括：`electron/main.mjs`、`server/index.ts`、`server/system-prompt.ts`、`src/App.tsx`、`BotSettingsDialog.tsx`、`ChatView.tsx`、`ComputerPanel.tsx`、`Sidebar.tsx`、`AccessSection.tsx`、`src/main.tsx`、`src/styles.css` 等。这些正是最近修复过的高风险区域。

## 设置 X“修好又回退”的证据

上游曾在 [`d72edfa8`](https://github.com/milind-soni/OpenMausBot/commit/d72edfa89304a1e46c067affc4df038db330ae97) 修复设置关闭，约五分钟后又由 [`fdb52aeb`](https://github.com/milind-soni/OpenMausBot/commit/fdb52aebc41538ed6d4e6af684971b5b5ea74a08) 完整回退。当前本地修复处理的是更深层的重复 key、pointer 生命周期和 HMR 多 root。

因此任何新版 Settings/App/入口代码都不能直接覆盖；必须继续以源码 fixture、生产 bundle、连续开关 30 次和多次 HMR/reload 为验收门禁。

## 建议的逐项审核顺序

每项只允许四种结论：**采用上游 / 保留本地 / 手工融合 / 暂缓**。未经用户批准不进入下一项。

1. **服务恢复、Windows 原子写、消息性能、安全修复**：价值高、相对容易隔离，建议优先。
2. **Full Access、审批和 Bot 协调**：建议采用上游语义，融合本地 Harness/system prompt。
3. **Windows 本机 CUA**：作为新的本机后端加入，保留锐捷远程 CUA 与 noVNC。
4. **Browser/Computer/远程桌面**：逐条验证人工接管、鼠标映射、断线重连、关闭不自启。
5. **设置、HMR、账号状态**：保留本地关闭/HMR/SSO补丁，吸收上游互斥面板和 UI 改进。
6. **多工作区 Fleet、People、Workspaces**：先确认商业目标、Linux 部署和 license，再决定是否引入。
7. **飞书及 connected apps**：保持本地 runtime、凭据、事件链路，选择性融合按 Bot 权限。
8. **品牌、打包、updater**：最后处理，绝不覆盖锐捷更新仓库、图标、签名和发布门禁。

实施时应在新的隔离 worktree 中，以 `v0.1.78` 的完整 SHA 为目标。每个批准组形成一个独立提交、单独验证；全部通过后才切换当前运行版本。

## 最终建议

- **值得更新到 v0.1.78 的能力**：稳定性/安全修复、消息性能、Bot 协调、Windows 本机 CUA、定时任务增强。
- **应谨慎评估再决定**：Fleet/People/Workspaces、桌面电脑共享、团队画布。
- **必须保留或手工融合**：锐捷远程 CUA、noVNC、飞书、SSO、设置关闭、HMR root、品牌与 updater。
- **不建议**：在当前 dirty `main` 上直接 pull/merge，或者只凭版本号覆盖安装。

建议进入逐项审批流程，而不是一次性批准整个 v0.1.78。
