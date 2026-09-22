# OpenMausBot v0.1.78 升级前最终决策摘要

查询日期：2026-09-15（Asia/Shanghai）  
范围：只读核验，不修改产品代码。详细逐版本和冲突清单见同目录 [`upstream-update-audit-2026-09-14.md`](./upstream-update-audit-2026-09-14.md)。

## 1. 基线与最新状态

- 当前仓库：`origin=https://github.com/milind-soni/OpenMausBot.git`（官方上游），`ruijie=https://github.com/WYunS/OpenMausBot.git`（锐捷 fork）；当前 `main` 跟踪 `ruijie/main`，HEAD 为本地锐捷提交 `75b72d44b0af98079f3d33658df391d9341bbaff`。
- 当前已合入的精确上游基线是 [`ca61118787f687749eb1251bc3007e4d7d7bdd93`](https://github.com/milind-soni/OpenMausBot/commit/ca61118787f687749eb1251bc3007e4d7d7bdd93)：包含 v0.1.71，以及 v0.1.72 发布前的 usage ledger、workspace provider keys、budget 三项提交。
- 最新正式稳定版是 [`v0.1.78`](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.78)，tag/发布目标为 [`419a28149700093ac61750de1541df56cb8df981`](https://github.com/milind-soni/OpenMausBot/commit/419a28149700093ac61750de1541df56cb8df981)，发布时间 2026-09-13T22:24:26Z。官方比较显示 `ca611187...v0.1.78` 向前 128 commits、无反向提交：[compare](https://github.com/milind-soni/OpenMausBot/compare/ca61118787f687749eb1251bc3007e4d7d7bdd93...v0.1.78)（查询：2026-09-15）。
- 官方 `main` 已越过 v0.1.78，HEAD 为 [`503983373aad5ef0b360f314a1f69d5d2175776b`](https://github.com/milind-soni/OpenMausBot/commit/503983373aad5ef0b360f314a1f69d5d2175776b)，其中已有 [`793399b`](https://github.com/milind-soni/OpenMausBot/commit/793399b21810c038c3255855459adf11429f0747) 将版本写为 0.1.79，但截至查询时没有 0.1.79 正式 Release。**升级目标仍应锁定 v0.1.78，不应直接追 main。**（查询：2026-09-15）
- `git fetch origin` 两次失败：一次因本机 `127.0.0.1:7892` 代理不可达，一次清空代理后 GitHub:443 直连失败；因此实时状态改用官方 GitHub REST API、Release、Compare API 和 v0.1.78 官方 zipball 核验。旧的本地 `origin/main` 引用不能当实时上游状态。

## 2. 从当前上游基线到 v0.1.78 的主要增量

| 领域 | 上游新增/修复 | 判断 | 官方证据（均查询于 2026-09-15） |
|---|---|---|---|
| 后台/工作区 | Fleet 多租户工作区；Settings → Workspaces；People 邀请、角色、last seen、月消费；工作区备份恢复；桌面工作区切换；共享 Box computers | 能补齐“托管工作区基础”，但不是完整通用后台 | [v0.1.72](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.72)、[v0.1.77](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.77)、[PR #1147](https://github.com/milind-soni/OpenMausBot/pull/1147) |
| 账户/权限 | 每 Bot MCP、每 Bot connected apps；远端用户可断开自己的账号；权限 broker 按 bot 隔离；provider 原生审批模式；Full Access 不再重复审批；模型/provider 切换原子化；channel turn 预算强制执行 | 权限正确性价值高，宜采用上游语义后接回锐捷 SSO/Harness | [v0.1.72](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.72)、[v0.1.74](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.74)、[v0.1.76](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.76)、[v0.1.78](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.78) |
| 远程电脑/Computer | VPS preview 恢复与远程帧压缩；helper 无界面和浏览器稳定性；桌面端 opt-in computer sharing，且默认关闭；共享目录做 filesystem identity/包含 home 的安全修复 | 可吸收稳定性和安全修复；不能覆盖锐捷远程 CUA/noVNC/鉴权链路 | [v0.1.73](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.73)、[v0.1.77](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.77)、[PR #1162](https://github.com/milind-soni/OpenMausBot/pull/1162)、[PR #1165](https://github.com/milind-soni/OpenMausBot/pull/1165) |
| Windows 本机 CUA | v0.1.78 首次正式打包 Windows x64 CUA，Electron 持有自己的 embedded host，不采用共享 daemon | 方向正确，但官方版本落后于本地正在准备的 0.28.1 | [v0.1.78](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.78)、[PR #1160](https://github.com/milind-soni/OpenMausBot/pull/1160) |
| 飞书/连接器 | 上游只增强通用 connected-app 权限与自助断开；v0.1.72—0.1.78 Release 未新增锐捷现有的独立飞书 runtime、凭据恢复和事件链路 | **无可直接替代本地飞书实现的上游模块**；仅选择性融合通用 per-bot 权限 | [v0.1.76](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.76)、[PR #1067](https://github.com/milind-soni/OpenMausBot/pull/1067)、[PR #1129](https://github.com/milind-soni/OpenMausBot/pull/1129) |
| 部署/打包 | Windows CUA 资产；Windows CLI/PowerShell 终止与输出修复；Windows 原子 rename 重试；updater 可操作错误；embedded server 崩溃恢复；npm 发布权限隔离 | 打包正确性值得吸收，但不能覆盖锐捷更新源、品牌、签名、飞书与浏览器资产 | [v0.1.74](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.74)、[v0.1.76](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.76)、[v0.1.77](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.77)、[v0.1.78](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.78) |
| 其他高价值修复 | 消息分页改为 SQL 读取最新 N 行；webhook 跨重启去重；follow-up 持久化；Bot 协调持久 pair conversation；月/年/时区 cron；团队/Chief 完整化 | 可拆成低耦合批次优先吸收 | [v0.1.74](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.74)、[v0.1.76](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.76)、[v0.1.78](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.78) |

### 删除/语义迁移

- 上游 v0.1.71 已暂时删除 “Teach a skill recorder”，其后以 Verify card / Save as skill / 完整 run recording 形成新路径；升级时不能恢复旧录制器入口并同时启用新 authoring 流程。[v0.1.71](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.71)、[v0.1.72](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.72)（查询：2026-09-15）。
- v0.1.76 引入 lean room coordination 与 handoff receipts，v0.1.78 又改为每对 Bot 一个持久 conversation；这是协调数据语义迁移，不只是 UI 改动，必须带原线程/团队数据做回归。[v0.1.76](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.76)、[v0.1.78](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.78)（查询：2026-09-15）。
- provider/审批改为“透传 provider 原生模式”，Full Access 的含义在 v0.1.78 被修正为真正免重复审批；本地 system prompt、permission broker、Harness approval 不应继续保留与旧语义绑定的分叉。[v0.1.74](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.74)、[v0.1.78](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.78)（查询：2026-09-15）。

## 3. v0.1.78 Windows CUA 与本地 0.28.1 的关键差异

| 项目 | 官方 v0.1.78 | 当前本地未提交升级工作 | 结论 |
|---|---|---|---|
| Cua SDK/Driver | `@trycua/cua-driver` **0.22.1**；`prepare-cua-win.mjs` 固定下载 `cua-driver-rs-0.22.1-windows-x86_64-binary.zip`，只把 `cua-driver.exe` 与 SDK DLL/node runtime 放入包 | package 已改为 **0.28.1**；准备脚本改用完整 `cua-driver-rs-0.28.1-windows-x86_64.zip` | 本地版本更新，不能用上游旧 pin 覆盖 |
| sidecar | Windows extraResources 仅显式放 `cua-driver.exe` + `cua-sdk` | 同时放 `cua-cursor-theme.exe`、`cua-driver-uia.exe`，并逐文件 SHA-256 校验 | 保留本地完整 runtime 资产策略 |
| runtime 所有权 | Windows 强制 owned embedded host，不采用无关共享 daemon；SDK 与 executable 要求版本一致 | 沿用 owned embedded host，同时升级 SDK/CLI/sidecar | 采用上游生命周期，保留本地 0.28.1 资产升级 |
| modern MCP/Skills | 0.22.1 不含 0.28.0 新增的 modern stdio MCP + embedded Skills resources | 0.28.1 含 modern MCP/Skills 与 0.28.1 修复 | 0.28.1 有明确能力增量，但宿主仍需消费 resources 才能受益 |

上游 v0.1.78 源码证据：[`package.json`](https://github.com/milind-soni/OpenMausBot/blob/v0.1.78/package.json)、[`scripts/prepare-cua-win.mjs`](https://github.com/milind-soni/OpenMausBot/blob/v0.1.78/scripts/prepare-cua-win.mjs)、[`electron/cua.mjs`](https://github.com/milind-soni/OpenMausBot/blob/v0.1.78/electron/cua.mjs)、[`electron-builder.yml`](https://github.com/milind-soni/OpenMausBot/blob/v0.1.78/electron-builder.yml)（查询：2026-09-15）。Cua 0.28.1 能力和资产证据见 [`cua-v0.28-upgrade.md`](../../../../docs/research/cua-v0.28-upgrade.md) 与 [Cua 0.28.1 Release](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.28.1)。

## 4. 后台管理与许可/部署边界

1. 上游已把 admin entitlement 从规划状态推进到 shipped，但 `enterprise/` 是 source-available/entitlement 边界，不等于 MIT 开源桌面版自动开放全部后台功能。使用前必须核对商业许可和 entitlement。[`enterprise/README.md`](https://github.com/milind-soni/OpenMausBot/blob/v0.1.78/enterprise/README.md)、[`LICENSING.md`](https://github.com/milind-soni/OpenMausBot/blob/v0.1.78/LICENSING.md)（查询：2026-09-15）。
2. 仓库提供的是 workspace-side hosted adapter 与 Fleet 基础，不包含完整 hosted administration console；独立控制台、邀请服务、provider gateway 与部署自动化仍需要外部组件。[`docs/verification/hosted-workspaces.md`](https://github.com/milind-soni/OpenMausBot/blob/v0.1.78/docs/verification/hosted-workspaces.md)（查询：2026-09-15）。
3. Fleet 的真实多租户隔离依赖 Linux、root、systemd、nftables、Caddy、域名/DNS 与逐工作区 OS 用户；不能直接套在现有 Windows 云桌面上，也不能替代锐捷现有云沙箱控制面。[v0.1.72 Release](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.72)、[`enterprise/README.md`](https://github.com/milind-soni/OpenMausBot/blob/v0.1.78/enterprise/README.md)（查询：2026-09-15）。
4. computer sharing 在 v0.1.77 被安全 gate 默认关闭；即使获得 admin entitlement，也不能默认开启共享电脑或共享目录。[PR #1165](https://github.com/milind-soni/OpenMausBot/pull/1165)、[v0.1.77 Release](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.77)（查询：2026-09-15）。

## 5. 重复、更优实现与冲突结论

- **可直接优先吸收**：Windows 原子写重试、消息 SQL 分页、webhook 去重、embedded server 崩溃恢复、updater 错误解释、共享目录安全修复。
- **采用上游语义、手工融合本地**：Full Access/审批、permission broker、Bot 协调、provider 切换、connected-app per-bot 权限。
- **上游已有但本地更高版本/更完整**：Windows CUA。上游 v0.1.78 仅 0.22.1，当前本地升级为 0.28.1 并补齐 cursor/UIA sidecar 和离线哈希门禁；应保留本地 0.28.1 资产实现，同时复用上游 owned embedded-host 生命周期。
- **本地独有，必须保留**：锐捷 SSO/GPTAuth、飞书独立 runtime 与凭据/事件恢复、远程 CUA HTTP→MCP bridge、远端 socket/鉴权、noVNC 兜底、锐捷品牌/更新源/私有交付和沙箱预置。
- **最高冲突面**：`electron/main.mjs`、`electron/cua.mjs`、`server/index.ts`、`server/system-prompt.ts`、Settings/ComputerPanel/App/Sidebar、`package.json`、`pnpm-lock.yaml`、`electron-builder.yml`。当前这些区域仍有未提交的 Cua 0.28.1 工作，禁止直接 merge/pull。

## 6. 审批清单

升级只能按批次审批，每批选择“采用上游 / 保留本地 / 手工融合 / 暂缓”：

1. **批准目标 SHA**：只允许 `v0.1.78` / `419a281`，不批准未发布 main/0.1.79。
2. **批准低耦合修复批**：原子写、消息性能、webhook 去重、server recovery、安全补丁。
3. **批准账户权限批**：确认 Full Access、Auto、Ask、per-bot MCP/connected apps 与锐捷 SSO/Harness 的最终语义。
4. **批准 Windows CUA 批**：确认“上游 embedded-host 生命周期 + 本地 Cua 0.28.1 完整资产/哈希/sidecar”，禁止回退到 0.22.1。
5. **批准远程 Computer 批**：逐项验收本机 CUA、锐捷远程 CUA、noVNC、人工接管、断线重连、关闭不自启和 computer-sharing 默认关闭。
6. **批准飞书批**：保留本地 runtime/凭据/事件链路，只融合 per-bot 通用权限；用真实飞书账号和重启恢复门禁验收。
7. **批准后台批**：在确认 enterprise 许可、entitlement、Linux/root/systemd/nftables/Caddy/DNS 与目标租户模型后，才允许引入 Fleet/People/Workspaces；否则暂缓。
8. **批准发布批**：保留锐捷品牌、更新源、签名、Cua/浏览器/飞书资产和私有交付收据；Windows 安装、离线构建、升级覆盖、回退均要验证。
9. **批准数据迁移批**：使用旧线程、团队、预算、账号、connected apps、定时任务、备份恢复和协调会话的副本做升级/回退测试。
10. **最终切换审批**：所有批次在隔离 worktree 形成独立提交并通过对应 verification 后，才允许切换当前运行版本；不得在 dirty `main` 上直接合并。

## 最终建议

**升级到 v0.1.78 值得做，但必须是选择性、分批、可回退的手工融合。** 低耦合稳定性/安全修复应先上；权限与协调采用上游语义；Windows CUA 保留本地 0.28.1 的更优实现；飞书、锐捷 SSO、远程 CUA/noVNC、品牌更新和交付链路必须保留；Fleet/People/Workspaces 需先过许可与 Linux 部署审批。未发布 main/0.1.79 只作为后续观察项，不进入本轮升级。
