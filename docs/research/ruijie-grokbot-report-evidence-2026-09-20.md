# 锐捷 Bot 对标调研：依据与核验记录

2026-09-20｜VERDE-0920-1615  
与《锐捷 Bot 对标 Grok Bot：调研结论与升级方案》配套。正文的 [L]、[P]、[G]、[O] 编号在此对应。

## Alpha｜核验范围与可信度

### 本次实际做了什么

- 重新只读检查回滚后的本地工作树，包含桌面启动、定时任务、自托管、远程连接、本机权限、模型接法和内置 Harness 构建代码。
- 重新只读检查已安装的 Windows Grok Bot 0.30.0 包内代码和样式。仅在内存中读取相关文本，没有解包覆盖安装目录。
- 运行窗口状态的无副作用函数，确认保存 `maximized:false` 后仍返回 `true`。没有启动窗口，没有改用户设置。
- 尝试重新访问 5 个官方页面，均发生 SSL 连接失败。公开产品事实沿用同日此前成功完成的第一方核查，明确保留这一时间和网络限制。
- 本次只新增/整理 Markdown 报告及下载目录副本，不改运行代码、不构建、不重启、不调用真实 Bot、不发布。

### 源码基线

活动仓库：`D:/ChatGPT/Bot/downloads/OpenMausBot-source`。  
分支：`codex/chat-profile-artifacts`。  
HEAD：`ecac4d337e414c0daffce7b409a4a70ad71c33c9`。  
这是 HEAD 加既有未提交修改，不能把 HEAD 单独当成全部评估内容，也不是最新公司远端分支的复核。

本次读取的运行/发布相关源码指纹：

```text
61e3a180b1e1287a0156a0b716d74690f45e2798e175d9bf212970a520506498
```

指纹由仓库既有 `releaseSourceFingerprint` 计算，包含其定义的源码和发布文件范围，不包含这些研究文档。行号对应本次工作树，后续整合代码时可能变化；可以按下表中的函数或关键字定位。

### 结论用什么口径

| 证据类型 | 能支撑什么 | 不能替代什么 |
| --- | --- | --- |
| 当前源码与配置 | 当前实现路径、已有能力入口、安全限制、打包范围 | 真实部署、用户权限、模型完成率、长期稳定性 |
| 已安装产品文件 | 本机这个版本的布局和窗口设置 | Grok Bot 闭源云端内部结构、其他版本全部行为 |
| 官方产品说明 | 供应商对产品行为的明确描述 | 服务端源码审计、所有历史版本保证 |
| 方案判断 | 在上述基础上建议怎么推进 | 已上线、已验收、已证明的性能结论 |

## Beta｜逐项依据

### L1：当前本地桌面后台与任务调度

| 源码位置 | 关键事实 | 对正文的支撑 |
| --- | --- | --- |
| [electron/main.mjs:127](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:127) | `OWNS_LOCAL_SERVER` 包含打包模式及 `OMB_DESKTOP_SERVER` | 存在由桌面拥有后台的运行方式 |
| [electron/main.mjs:1208](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:1208) | `utilityProcess.fork(entry, [], ...)` | 本机桌面启动本机后台进程 |
| [server/index.ts:5948](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5948) | 创建 `RoutineManager` | 定时任务属于后台，不是只在页面上计时 |
| [server/routines.ts:1294](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/routines.ts:1294) | `start()` 内启动 `setInterval(..., 10_000)` | 调度依赖承载它的进程持续运行 |
| [server/routines.ts:733](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/routines.ts:733) | 使用 `DATA_DIR/routines.json` | 已有持久保存，不能说任务全是临时内存状态 |
| [server/index.ts:4902](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:4902) | `runOn === "cloud"` 选择 BoxAgent | 已有外部执行分支，但选择它不等于本机调度器已迁走 |

最短关键片段：

```ts
start() {
  if (this.timer) return;
  void this.tick();
  this.timer = setInterval(() => void this.tick(), 10_000);
  this.timer.unref?.();
}
```

限制：这里能判断主机关机后本机计时器不能触发；不能据此判断外部服务收到任务后必定停止，也不把关窗口、休眠和整机关机混为一谈。

### L2：已有远程工作区、自托管和设备配对基础

| 源码/配置位置 | 已有内容 | 必须保留的限制 |
| --- | --- | --- |
| [deploy/docker-compose.yml:11](D:/ChatGPT/Bot/downloads/OpenMausBot-source/deploy/docker-compose.yml:11) | 完整后台部署、重启策略、持久数据卷、反向代理 | 当前镜像地址是上游地址；不能照抄后声称部署的就是公司本地版 |
| [docs/self-hosting.md:21](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/self-hosting.md:21) | 文档描述在常驻服务器运行后台及执行引擎 | 文档能力清单不是当前公司环境的验收记录 |
| [electron/environments.cjs:3](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/environments.cjs:3) | 已保存远程工作区、配对和切换 | 不是两套工作区数据自动合并 |
| [electron/desktop-companion-client.mjs:235](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/desktop-companion-client.mjs:235) | 远程转发及身份凭据处理 | 保留本地界面的 Companion 模式，与加载远端界面的 Server 模式需区分 |
| [companion/src/routes.ts:233](D:/ChatGPT/Bot/downloads/OpenMausBot-source/companion/src/routes.ts:233) | 身份检查与允许路由范围 | 设备配对不自动赋予任意本机操作权限 |
| [server/index.ts:5284](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5284) | 注释明确 VPS 是本地 Agent 的电脑工具挂载，不是远程 Agent 执行器 | “能操作远程电脑”与“助手已经整体在远端运行”不同 |

因此，方案第一阶段建议验证和利用现有常驻部署路径，而不是先重建整个任务系统。

### L3：本机工具已存在，远端页面权限限制也确实存在

| 位置 | 关键事实 |
| --- | --- |
| [electron/capabilities.cjs:151](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/capabilities.cjs:151) | `remote` 时将本机电脑、预览、听写等设为不可用 |
| [electron/preload.cjs:17](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/preload.cjs:17) | 远端页面只获得安全子集 |
| [electron/local-origin.cjs:33](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/local-origin.cjs:33) | 主进程拒绝非可信本地来源的敏感操作 |
| [server/index.ts:5195](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5195) | `mountHostComputer()` 检查引擎能力、电脑工具和占用情况 |
| [server/index.ts:5219](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5219) | 挂接 `observedLocalComputer(...)` |
| [server/local-computer.ts:32](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/local-computer.ts:32) | 本机调用已有权限门控 |
| [server/local-computer-proxy.ts:27](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/local-computer-proxy.ts:27) | 已有本机电脑工具与 Harness 的格式适配 |

方案判断：复用已有工具和配对，补齐“远端工作区被授权使用哪台客户端电脑”的关系。不删除既有保护，不把开发者电脑已配置的权限当成所有安装用户都有。

### L4：模型接法、Harness/Codex 和内置构建范围

| 位置 | 当前实现事实 |
| --- | --- |
| [server/drivers/openai-compat.ts:135](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/openai-compat.ts:135) | 通用请求为 `model/messages/stream` 等聊天参数，没有工具定义 |
| [server/drivers/openai-chat.ts:281](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/openai-chat.ts:281) | 能力声明只有会话模型切换，没有电脑/浏览器等工具能力 |
| [server/drivers/ruijie-harness.ts:824](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:824) | 声明本机、电脑、浏览器、Agent 等工具接入能力 |
| [server/drivers/ruijie-harness.ts:895](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:895) | 向执行器选择 provider/model，不是将模型权重打包到本机的证据 |
| [server/drivers/codex.ts:1263](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/codex.ts:1263) | 同样声明上述工具能力 |
| [server/drivers/codex.ts:579](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/codex.ts:579) | 现有本地接法使用 `app-server`；不能因此承诺它可原样公开成云端生产平台 |
| [scripts/build-ruijie-harness.mjs:47](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:47) | 内置 Harness 只覆盖 Windows/macOS，目标为 Windows x64、Mac arm64/x64 |
| [scripts/build-ruijie-harness.mjs:142](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:142) | Bot 专用临时打包覆盖，不修改独立 Harness 公开 Universal 配置 |
| [scripts/build-ruijie-harness.mjs:157](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:157) | Mac 薄包签名和架构检查；仍需原生 Mac 实跑 |

不能把适配器的 `images` 或工具声明解释为所有可选模型都同样擅长图像识别和电脑操作。本次没有比较实际任务完成率，也没有核查用户当前默认模型。模型 ID 的解析兜底值，不等于用户模型选择事实。

### L5：回滚后当前 UI 源码

- [electron/window-state.cjs:1](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/window-state.cjs:1)：基础窗口 1100×780；`resolveWindowState` 各分支返回最大化。
- [electron/main.mjs:191](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:191)：保存窗口普通尺寸和最大化标记；[2127](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:2127) 根据恢复结果最大化。
- [src/components/Sidebar.tsx:1811](D:/ChatGPT/Bot/downloads/OpenMausBot-source/src/components/Sidebar.tsx:1811)：锐捷模式左栏常规 248、紧凑 224、图标 68。
- [src/components/ComputerPanel.tsx:148](D:/ChatGPT/Bot/downloads/OpenMausBot-source/src/components/ComputerPanel.tsx:148)：右栏最小 240、默认 260，读取已有保存值。
- [src/styles.css:78](D:/ChatGPT/Bot/downloads/OpenMausBot-source/src/styles.css:78)：界面 13/18、正文 14/22 刻度。
- [src/styles.css:584](D:/ChatGPT/Bot/downloads/OpenMausBot-source/src/styles.css:584)：字体优先 Microsoft YaHei UI；回复透明底、横向无内边距、段间距 10。

本轮无副作用函数调用结果：

```json
{
  "input": {"bounds":{"x":50,"y":50,"width":1100,"height":780},"maximized":false},
  "restored": {"bounds":{"x":50,"y":50,"width":1100,"height":780},"maximized":true}
}
```

这确认“恢复时保留非最大化状态”的说法不成立。本轮没有修它；上一轮相关修改已按要求回滚。

### L6：先前 Harness 与打包问题的关系

[server/drivers/ruijie-harness-local.ts:20](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness-local.ts:20) 保留了 Electron 环境使用 `original-fs` 读取实体归档字节的修复，普通 Node 路径不变。这是先前本地误判“缺失/损坏”的已查明原因，不代表朋友安装版的所有缺模块问题都已定位。

同日先前公司打包审计记录列出了不同失败类型：私有仓库读取权限、文件描述符耗尽、重复构建后的脏源码校验、Mac 嵌套签名、产物清单收集。这些不能全部概括成“漏了一个依赖”。本轮没有重新查询公司 Actions，也没有重跑远端打包。

原始记录：[公司打包审计](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/research/company-package-audit-2026-09-20.md)。其中记录的 Universal DMG 体积为 2,081,905,391 字节；未下载挂载做逐文件占比分析，新的薄包大小也未实测。

### P1：本机 Grok Bot 0.30.0 的窗口和布局

只读文件：[已安装 app.asar](<C:/Users/Yunsh/AppData/Local/Programs/Grok Bot/resources/app.asar>)。本轮读取的包元数据为 `name=sand`、`version=0.30.0`；文件大小 31,765,314 字节。

包内路径与本轮再次读取的关键片段：

1. `dist/electron-main/main.cjs`，`resolveSandWindowPlacement` 附近：

```js
{width:t?1440:1040,height:t?960:760}
```

这里存在特殊启动分支，不能把 1040×760 宣称成所有模式唯一尺寸。恢复函数无已保存状态时返回 `maximize:false`；保存使用 `normalBounds` 和 `isMaximized`。恢复还涉及 `setContentBounds`，所以不能只用窗口外框尺寸作严格像素对照。

2. `dist/renderer/assets/index-B3DQqRUH.js`，`sand.sidebar.width` 附近：

```js
const zA=280,qk=240,z4=400,O3e=88,$A=320,zp=280;
const D3e={expandedWidth:zA,isCollapsed:!1};
const L3e={isOpen:!1,width:$A};
```

左栏默认 280，范围 240–400，折叠 88；右栏默认 320、最小 280。右栏默认打开状态是 false；正文尺寸对比描述的是“右栏打开时使用的默认宽度”，不是首次启动一定出现三栏。

3. `dist/renderer/assets/index-BrN-auUU.css`：

```css
--cursor-font-family-sans: var(--cursor-font-family,
  var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif));
--cursor-font-size-base: 13px;
--cursor-font-size-lg: 14px;
--cursor-line-height-base: 18px;
--cursor-line-height-lg: 22px;
```

字号刻度接近，并不能消除字体、列宽、段距与分组的差别。实际观感还受系统缩放、页面缩放、内容和面板开关影响，本轮没有声称完成双应用统一条件下的最终视觉验收。

### G1–G4：Grok Bot 官方说明

下列内容来自 2026-09-20 此前成功完成的第一方核查记录；本轮重访网络失败。官方文档对应版本可能新于本机 0.30.0，因此产品当前说明不能无条件追溯到截图版本。

| 编号 | 官方来源 | 能确认的结论 | 不应扩大的结论 |
| --- | --- | --- | --- |
| G1 | [Grok Bot 总览](https://cursor.com/docs/grok-bot) | 关闭应用、笔记本或手机不停止后台工作和例行任务 | 不能证明所有内部程序部署在同一台 VM |
| G2 | [Work with Grok Bot](https://cursor.com/docs/grok-bot/work) | 云电脑提供浏览器、文件和登录环境；对话在电脑外保存；插件授权凭据在连接后台 | 不能反推出特定数据库、模型或 Harness 品牌 |
| G3 | [Computer recovery](https://cursor.com/help/grok-bot/computer-recovery)、[Settings](https://cursor.com/docs/grok-bot/settings) | 区分桌面更新和电脑环境更新；更新/恢复可能重建环境，受备份和任务忙碌状态约束 | 不承诺所有已安装软件保留，也不编造统一强制更新时限 |
| G4 | [Security](https://cursor.com/docs/grok-bot/security) | 模型组合可变；有本机命令/文件授权；文档描述美国托管和过时环境重建 | 不证明所有电脑在 California，不证明截图版本任意本机 GUI 操作都已支持 |

G1 在先前记录中的原文：

> Work runs on the cloud computer. Closing the app, your laptop, or your phone doesn't stop a background turn or a routine.

G3 的具体区别：Update/Recover 保留相应已同步状态，但安装的软件和包会移除；Reset 从已保存快照恢复，最近未同步内容可能丢失。报告借鉴的是“用户应知道更新影响”，不是照搬每一个恢复行为作为我们的产品承诺。

### O1：Codex 和电脑操作的官方资料

同样沿用同日此前已核查的官方页面，本轮未能再次在线确认：

- [Codex non-interactive](https://developers.openai.com/codex/noninteractive/)：支持用 `codex exec` 等方式在自动流程中执行任务，输出事件并恢复会话。它不替产品提供完整的定时调度、用户隔离、费用管理和升级平台。
- [Codex SDK](https://developers.openai.com/codex/sdk)：是自动执行接入候选；不能用“有 SDK”代替公司账号、运行环境和工具适配验证。
- [Codex App Server](https://developers.openai.com/codex/app-server/)：此前核查的页面对命令和 WebSocket 传输有实验性及生产支持警告。现有本地 driver 用了它，不代表应把这个裸接口直接开放到公网。
- [Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use/)：集成方仍需提供环境并执行模型提出的操作。换模型或执行器，并不会自动补齐电脑权限、截图反馈和动作限制。

本报告没有进行最新模型排名、实时价格比较，也没有把 Codex 称为 GUI 操作的确定赢家。

## Gamma｜从依据到方案：为什么这样建议

| 建议 | 对应依据 | 做到之前必须验证 |
| --- | --- | --- |
| 先利用已有后台、自托管路径做常驻试点 | L1、L2，结合 G1 | 指定源码版本、公司认证、目标引擎、关机后触发、重启后状态恢复 |
| 不把“挂了云电脑”当作完整迁移 | L1 的调度位置、L2 的 VPS 工具挂载 | 任务发起者和执行者是否真能独立于用户电脑 |
| 后续补受控本机连接，不删除现有安全限制 | L3，结合 G4 | 设备身份、逐能力授权、撤销、离线、接管、目标不混淆 |
| 保留本地 Harness，云端候选按实际任务评估 | L4、O1 | 指定系统可运行、真实登录、所需工具、错误恢复、成本与完成率 |
| 模型接法和模型强弱分开讨论 | L4 | 先有工具通路，再测具体模型的识图、工具使用与纠错 |
| 分开管理客户端、引擎、电脑环境和连接端更新 | G3 与 L4 的平台/打包范围 | 配套版本、新机器安装、更新中断提示、备份与恢复 |
| UI 单独评估，不算成已交付 | L5、P1及用户回滚要求 | 同设备、同内容、同缩放的对照；干净配置与保存配置分别检查 |

尚未验证的事项：公司常驻服务是否上线、任意具体模型成功率、朋友旧安装包全部问题是否修好、Mac 新包最终体积与签名/升级、所有本机权限场景、Grok Bot 的真实闭源执行引擎。

这些缺口不是报告省略了结论，而是目前没有证据，不能替它们下结论。

### 原始材料索引

- 同日早先第一方资料及架构分析：[原始调研记录](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/research/grokbot-cloud-runtime-sources-2026-09-20.md)。
- 本轮独立源码复核：[源码复核明细](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/research/report-source-recheck-2026-09-20.md)。
- 历史远端打包证据：[公司打包流程审计](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/research/company-package-audit-2026-09-20.md)。

独立源码复核按 research 技能执行；方案按已有实现的分工整理，而非据文档标题或产品名称推断能力。所有本轮修改限于报告。
