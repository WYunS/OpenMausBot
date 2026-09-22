# 本地架构事实复核：桌面、常驻服务、电脑工具与 Harness

日期：2026-09-20。活动源码根：`D:/ChatGPT/Bot/downloads/OpenMausBot-source`；复核时 HEAD 为 `ecac4d33`，包含已有未提交修改。本记录仅依据当前工作树只读检查；未运行测试、未启动/停止应用、未构建、未修改代码或配置、未提交 Git。新增内容仅本 Markdown 文件。

本轮 UI 已回滚；本文不宣称任何新 UI 已实现。Grok Bot 的第一方外部证据另见 [原调研记录](./grokbot-cloud-runtime-sources-2026-09-20.md)，本次未改该文件。

## 1. 当前桌面正常模式会启动本机 server，例行任务由该 server 调度

**源码事实。** [electron/main.mjs:127](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:127) 定义 `OWNS_LOCAL_SERVER = app.isPackaged || process.env.OMB_DESKTOP_SERVER === "1"`。[同文件:2974](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:2974) 在非 desktop-companion-client 分支启动 server：

```js
} else if (OWNS_LOCAL_SERVER) {
  await startServerPackaged();
}
```

[同文件:1164](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:1164) 取得 server entry、数据目录与端口，并在 [1208](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:1208) `utilityProcess.fork(entry, [], { env: childEnv, ... })`。所以“桌面 Electron 与本机 server 子进程”不是推测。

[server/index.ts:5948](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5948) 创建 `new RoutineManager(...)`；[15328](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:15328) 本机监听成功后调用 `routines!.start()`。

[server/routines.ts:1294](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/routines.ts:1294)：

```ts
start() {
  if (this.timer) return;
  void this.tick();
  this.timer = setInterval(() => void this.tick(), 10_000);
  this.timer.unref?.();
}
```

[同文件:733](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/routines.ts:733) 默认将状态放在 `join(DATA_DIR, "routines.json")`，并从文件恢复；[1352](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/routines.ts:1352) 将超过 12 小时的迟到任务标为 `missed`。不是纯前端计时器，也不是没有持久化的临时任务。

**由源码可得的限制。** 这份调度器依赖承载它的 server 进程存活。把远程电脑作为操作目标，不会把该定时器自动迁到远程。主机真正关机时，它不能现场触发未来任务。本文未实测“关窗口”是否退出应用、操作系统睡眠行为或已发送给外部服务的任务能否继续，不能把它们等同于关机。

**已有云执行分支。** [server/index.ts:4902](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:4902) 对 `runOn === "cloud"` 选择 `boxAgent`，不是普通 Bot 选定的 Harness/Codex；[5163](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5163) 亦明确 cloud routines 用 Box/BoxAgent。这个分支仍由上述 RoutineManager 创建/触发，不能据名称称已有独立于桌面的云调度服务。

## 2. 远程工作区、自托管、Companion 已有基础，不能描述成从零造

| 能力 | 当前源码或配置证据 | 可复用与限制 |
| --- | --- | --- |
| 自托管完整 server | [deploy/docker-compose.yml:11](D:/ChatGPT/Bot/downloads/OpenMausBot-source/deploy/docker-compose.yml:11)：`omb` 服务、`restart: unless-stopped`、`data:/data`；Caddy 共网络空间提供 TLS | 可将工作区 server/调度/引擎放在常驻主机；镜像地址仍指向上游 `ghcr.io/milind-soni/openmausbot:latest`，不能原样承诺就是公司版部署方案 |
| 远程工作区/Server 切换 | [electron/environments.cjs:3](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/environments.cjs:3)：保存 `{id,name,origin}`、加载远端自己的 UI、HttpOnly 配对 cookie；[28](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/environments.cjs:28) 解析配对链接 | 可复用连接、配对、工作区选择；不是将两台机器的数据自动合并 |
| 桌面对桌面 Companion | [electron/main.mjs:2960](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:2960)：建立 `startDesktopCompanionRelay`；[electron/desktop-companion-client.mjs:235](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/desktop-companion-client.mjs:235) 转发 API 并注入 bearer | 已有保留本地打包 UI 的远程客户端模式；不要与加载远端 UI 的 Server 模式混为一谈 |
| 配对设备的默认拒绝边界 | [companion/src/routes.ts:233](D:/ChatGPT/Bot/downloads/OpenMausBot-source/companion/src/routes.ts:233)：未认证 401；仅 `ALLOWED` 匹配允许；其余 403/404 | 可复用设备准入和窄接口设计，不能直接扩大为远端任意控制客户端宿主机 |
| VPS 作为电脑工具 | [server/index.ts:5284](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5284)：`A VPS is a local-agent computer mount, never a remote agent runner`；[5301](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5301) 挂载 `vpsComputerMcp` | 已有远程电脑生命周期、SSH/工具挂载；它不等于把本地 Agent 或调度器部署过去 |

[docs/self-hosting.md:21](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/self-hosting.md:21) 文档也描述在服务器安装/认证 engine CLI，聊天、协作、例行任务全在 server 上运行。[docs/desktop-companion.md:3](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/desktop-companion.md:3) 区分 host/client，[44](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/desktop-companion.md:44) 描述按设备授予 VPS 云桌面查看/接管能力，默认关闭。

**未实测边界。** 这些是已有实现入口及部署配置，不证明公司云服务已上线、生产 SLA 成立、现有账户已配好，或任一 CLI 在 Linux 都可原样运行。可以沿这些接口升级，无需推倒重建，但必须另做目标环境验证。

## 3. `remote=true` 是已有安全边界；本机也已有真实 CUA 工具路径

[electron/capabilities.cjs:151](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/capabilities.cjs:151)：

```js
if (remote) {
  const unavailable = { reasonCode: "remote-server" };
  Object.assign(screenPreview, { available: false, interaction: "none" }, unavailable);
  Object.assign(dictation, { available: false, engine: "none", onDevice: false }, unavailable);
  Object.assign(localComputer, { available: false, support: "unsupported", enabled: false, status: "unavailable" }, unavailable);
}
```

这不只是 UI 隐藏。[electron/preload.cjs:17](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/preload.cjs:17) 将远端页面限制为 `REMOTE_SAFE` 桥接子集；[electron/local-origin.cjs:33](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/local-origin.cjs:33) 在主进程再次检查：

```js
if (!isLocalSender(event))
  throw new Error(`${channel} is only available while using the local server`);
```

**区分。** 这里的 `remote` 是对请求页面信任来源的判定，不能笼统说“联网就没有本机功能”。Companion 客户端保留本地打包 UI 并有独立 `--openmausbot-remote-client` 标记，见 [electron/desktop-companion-client.mjs:24](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/desktop-companion-client.mjs:24)。若未来让云端任务安全调用客户端宿主机，应做明确配对与逐能力授权的 Host Connector，而不是删除 `remote`/`localOnly` 限制。

**本地已有执行路径。** [electron/main.mjs:2953](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron/main.mjs:2953) 启动支持平台的 `startCua()`。[server/index.ts:5195](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5195) 的 `mountHostComputer()` 检查 provider 能力、读取 CUA、取得电脑使用队列，再于 [5219](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/index.ts:5219) 挂载：

```ts
integrations.localComputer = observedLocalComputer(currentCua, bot.id, threadId, dispatchClaimId);
```

[server/local-computer.ts:32](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/local-computer.ts:32) 的 `gatedLocalComputer` 将调用接入带 `OMB_CONTROL_URL`/`OMB_CONTROL_TOKEN` 的门控；[server/computer-tools.ts:2](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/computer-tools.ts:2) 列出了 click/type_text/press_key 等变更动作。[server/local-computer-proxy.ts:27](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/local-computer-proxy.ts:27) 已有 CUA JSON Schema 到 Harness 支持子集的兼容层。

**未实测。** 存在以上路径不等于当前每个模型都能可靠视觉定位；也不证明用户每台电脑的 CUA 权限、驱动、目标应用状态均正常。本次未发起任何电脑操作。

## 4. 必须分开“通过 Harness 选 DeepSeek”和“直接 API-key 聊天连接”

### 4.1 直接 OpenAI-compatible/API-key 路径目前是聊天

[server/drivers/openai-compat.ts:135](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/openai-compat.ts:135) 的请求体是 `model/messages/stream` 及可选 provider 路由，没有 tools；[server/drivers/openai-chat.ts:97](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/openai-chat.ts:97) 调用 `/chat/completions`。[同文件:281](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/openai-chat.ts:281)：

```ts
adapter: {
  provider: options.driverKind,
  capabilities: { sessionModelSwitch: "in-session" },
  sendTurn,
  // ...
}
```

该 adapter 没有声明 computer/localComputer/browser/agents MCP 能力。与 [docs/self-hosting.md:51](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/self-hosting.md:51) 的“API-key connections currently support chat, not agent tools or computer use”相符。这里描述的是这条连接实现，不是说所有使用 API key 的 Agent 天生都不能用工具。

### 4.2 Harness/Codex 是已经挂工具的 Agent 适配路径

[server/drivers/ruijie-harness.ts:824](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:824) 声明 `agentsMcp/computerMcp/localComputerMcp/composioMcp/browserMcp` 为 true；[241](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:241) 将当前 turn 的本机/远程电脑 integration 传入运行时；[895](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:895) 通过 `session.selectModel` 选择 provider/model。

[server/drivers/codex.ts:1263](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/codex.ts:1263) 同样声明电脑、本机、浏览器、Agent 等能力；[579](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/codex.ts:579) 采用本机 `app-server` 适配并按 turn 挂 MCP，而不是一个纯文本请求接口。

**准确表述。** 通过 Harness 选模型，保留的是 Harness 适配器的工具通路；具体模型是否善用工具、支持图片、任务成功率怎样，还要针对该模型验证。不能将 `images: true` 的适配器总能力视为目录里每个模型都原生视觉的证明。直接 API-key 聊天连接目前则连上述工具通路都没有。

“本地 Harness”在这些源码里意味着定位/启动执行器进程和连接其服务（[ruijie-harness.ts:201](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:201)），**不等于模型权重部署本地、不等于离线推理**。模型推理实际由何端提供，应按所选 provider 和 Harness 配置核验，本次未审计 Harness 内部推理服务。

本文不判断用户当前默认模型。[ruijie-harness.ts:403](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:403) 中 `gpt-5.6-luna` 是模型 ID 解码兜底，不能拿它替代模型选择器或当前用户配置的事实。

## 5. Harness 当前内嵌构建范围与 Mac 单架构改动

**源码事实。** [shared/ruijie-harness-release.ts:2](D:/ChatGPT/Bot/downloads/OpenMausBot-source/shared/ruijie-harness-release.ts:2) 固定 `2.1.10`、提交 `f48fe5cb09e37c1bcb4ed2c19f75ce5e1bf8aeae`、schema 2、`openmaus-server-v1`。

[scripts/build-ruijie-harness.mjs:47](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:47)：

```js
assert(['win32', 'darwin'].includes(platform), 'Bundled Harness supports Windows and macOS');
// 指定 arch 时仅接受 Windows x64 / Mac arm64,x64
return platform === 'darwin' ? ['darwin-arm64', 'darwin-x64'] : ['win32-x64'];
```

[scripts/prepare-ruijie-harness.mjs:93](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/prepare-ruijie-harness.mjs:93) 同样只允许 `darwin-arm64/darwin-x64/win32-x64`。这是 **Bot 内嵌 Harness 的既有构建覆盖**；不等于整个 Bot 不支持 Linux，也不能拿它证明 Harness 项目永远无法支持 Linux。现阶段若目标常驻服务器用 Linux，需单独解决可用运行时，不能承诺原样搬运此二进制。

**本地已有 Mac 拆分改动。** [scripts/build-ruijie-harness.mjs:127](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:127) 按目标架构循环构建；[142](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:142) 创建 Bot 专有临时打包覆盖，明确不改 Harness 公开 Universal 配置；[172](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:172) 排除另一架构 native 包；[157](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:157) 签名薄包并用 `lipo -archs` 断言单架构。[198](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:198) 缓存校验会拒绝旧 Universal sidecar。

[electron-builder.yml:88](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron-builder.yml:88) Bot 本体已有 arm64/x64 两套 dmg/zip，[122](D:/ChatGPT/Bot/downloads/OpenMausBot-source/electron-builder.yml:122) 按 `${arch}` 选择内嵌 Harness。复核时此配置并不显示为未提交修改，不能把所有单架构配置都算作本轮新改动。

复核时 `git status --short` 显示以下既有本地修改：`scripts/build-ruijie-harness.mjs`、`.github/workflows/package-release.yml`、`.github/workflows/package-win.yml`、`.github/workflows/release.yml`。本次不改它们。[package-release.yml:96](D:/ChatGPT/Bot/downloads/OpenMausBot-source/.github/workflows/package-release.yml:96) 已写跨私有仓库读取 token 的提前校验、固定 Harness 提交，[129](D:/ChatGPT/Bot/downloads/OpenMausBot-source/.github/workflows/package-release.yml:129) 用 target 和脚本哈希区分 thin 缓存，[135](D:/ChatGPT/Bot/downloads/OpenMausBot-source/.github/workflows/package-release.yml:135) 传 `--arch`。

**未实测。** 当前 Windows 只读复核没有运行 macOS 打包、签名、公证、下载升级或远程 CI；不能宣称产物大小已下降到某值、Mac 安装包全部通过验收或公司远端已经采用这些本地未提交修改。

## 可用于口语方案的四句话

1. 不是没有云端基础：完整自托管、远程工作区、Companion 都已存在，应该复用；当前日常桌面 host 模式才是主要由本机 server 承担调度。
2. 远程电脑只是“手放在哪里”；常驻 server 决定“谁在持续接任务、记状态和触发计划”，这两件事要分开。
3. Harness/Codex 工具适配、本机 CUA 已有；不能因为要云端化就直接拆掉远端页面不得调用本机的安全限制。
4. 选择便宜模型不等于必然没有工具，也不等于能做好电脑任务；先区分接入路径，再验证具体模型与工具的组合。
