# 锐捷云沙箱 CUA 接入

## 1. 目标形态

这里不是建设两套沙箱，也不是让两拨人分别开发两个桌面。仍然只有一个锐捷 Linux 沙箱、一个图形桌面：

- 现有 `vnc_proxy` 原样保留，继续供右侧 Computer 面板预览和用户 Take Control；这部分已经存在，不要求重新开发。
- 在同一桌面内新增 CUA，并增加一个可访问它的 `cua_proxy`，供智能体获取画面并执行鼠标、键盘、窗口和应用操作。

智能体正常操作优先走 CUA，不再通过隐藏的 noVNC 网页模拟输入。noVNC 保留为用户接管、实时预览和 CUA 故障时的降级通道。

之所以保留两种访问方式，是因为 CUA 是给智能体调用的操作接口，不是给人观看和接管的远程桌面；人控仍需要现有 noVNC。它们是同一个桌面的两种入口，不是两套环境，也不是两项重新开发任务。

仅在镜像中放入 `cua-driver` 文件不算完成。锐捷Bot运行在用户电脑上，无法直接访问沙箱内部的 Unix Socket；供应方还必须提供经过鉴权、能够从锐捷Bot所在网络访问的 MCP 代理端点。

## 2. 需要沙箱侧新增的内容

### 2.1 沙箱侧必须完成

1. 在沙箱镜像中安装并随桌面自动启动 Cua Driver。
2. 确保 CUA 与 noVNC 操作同一个 X11/XFCE 桌面。
3. 在沙箱进入 `finished` 前完成 CUA 健康检查。
4. 将 CUA 的 stdio MCP 服务转换为带鉴权的远程 MCP 端点。
5. 在 sandbox-manager 的任务查询结果中返回 CUA 连接信息。
6. 在沙箱重建、迁移和令牌轮换后返回新的有效连接信息。



### 2.2 以下由锐捷Bot源码适配，沙箱侧无需实现

1. 读取并验证 sandbox-manager 返回的 CUA 连接信息。
2. 在每次智能体任务开始时创建本地 MCP 适配进程并连接远程 CUA。
3. 将 CUA 工具挂载给 Codex、Claude Code、锐捷 Harness 等支持计算机工具的引擎。
4. 执行用户 Take Control 锁；用户接管期间拒绝新的智能体输入。
5. 任务结束后撤销本地能力令牌和远程连接。
6. CUA 不可用时显示明确错误，并可临时降级到现有 noVNC 控制桥。

供应方不需要修改锐捷Bot，也不需要适配具体模型供应商。

## 3. 沙箱内 CUA 能力要求

本文不限定沙箱侧使用哪个 CUA 版本、安装路径、进程管理器或内部通信方式。沙箱侧可以自行选择实现，只需保证交付结果满足：

- 沙箱启动后 CUA 自动可用；进程异常后能够自动恢复。
- CUA 操作的就是现有 noVNC 展示的那个桌面，而不是另一个隐藏桌面或会话。
- CUA 可获取完整、非空的当前桌面图像，并返回准确宽高。
- CUA 可完成本文第 6 节列出的操作，工具名称和参数符合返回的 MCP 工具定义。
- 中文、英文、数字、标点、组合键、鼠标和滚动输入均可正确执行。
- 桌面分辨率或缩放变化后，截图尺寸与操作坐标保持一致。
- 桌面包含可正常启动和联网的浏览器，下载及文件打开能力可用。
- CUA 与 noVNC 可以同时连接，不互相踢下线或造成黑屏。
- 沙箱重建后 CUA 自动恢复，不要求用户或锐捷Bot执行沙箱内部命令。
- 只有 CUA 和 noVNC 都通过健康检查，任务才可以进入 `finished` 状态。

CUA 的具体安装方式和镜像内部实现由沙箱侧自行决定，锐捷Bot只依据远程接口和验收结果判断是否可用。

## 4. 远程 MCP 控制端点



### 4.1 必选传输

首选且作为直接适配基线的传输为 **MCP Streamable HTTP**：

- 端点使用 HTTPS；内网联调可以暂时使用 HTTP。
- 接受 MCP JSON-RPC 请求：`initialize`、`notifications/initialized`、`tools/list`、`tools/call`。
- 至少兼容 MCP 协议版本 `2024-11-05`。
- 请求头接受 `Authorization: Bearer <token>`。
- Token 不得放在 URL 查询参数或 fragment 中。
- 如服务返回 `Mcp-Session-Id`，后续请求必须能使用同一会话 ID。
- 一次任务内的工具调用必须按顺序执行，不能让两个输入动作乱序进入同一桌面。

沙箱侧如何把内部 CUA 接到该端点由其自行设计；锐捷Bot只依赖这里规定的远程协议，不依赖其内部命令、路径或端口。

如果供应方确实无法提供 Streamable HTTP，必须在开发前与锐捷Bot研发方确认 WebSocket 双向 exec 的逐帧格式；不能开发完成后再用私有协议替换。

### 4.2 网络与鉴权

- `cua_proxy.url` 必须能从运行锐捷Bot的用户电脑访问，而不只是能从 sandbox-manager 容器访问。
- 每个 Token 只能访问一个 `client_id` 对应的沙箱。
- Token 应为短期随机凭据，推荐覆盖一次最长任务，最短不得少于 30 分钟。
- `/release` 后 Token 必须立即失效。
- 沙箱透明重建后旧 Token 和旧 URL 应失效，`GET /task/{client_id}` 返回新连接信息。
- 禁止通过接口访问任意其他沙箱、宿主机命令或宿主机文件。
- 日志不得记录完整 Token、VNC 密码、键盘输入文本或截图正文。



### 4.3 安装包连接要求

最终用户只安装锐捷Bot，不应再安装 SSH 客户端、CUA、浏览器插件、虚拟机运行时或锐捷专用 DLL。供应方端点必须满足：

- Windows 和 macOS 都能通过标准 HTTPS 访问。
- TLS 证书链受操作系统默认信任库信任；正式环境不接受自签名证书或要求用户手工导入根证书。
- 不依赖固定客户端 IP、手工 SSH 隧道、端口转发或开发人员 VPN。若产品本身要求企业 VPN，必须在销售和部署条件中提前写明，不能在联调后临时增加。
- DNS 名称、端口和路由在用户实际部署网络中可达；不能只在锐捷研发内网可达。
- 服务端允许桌面应用后端发起请求，不要求浏览器 Cookie 或网页交互式登录。
- 所需身份信息全部由 sandbox-manager 返回或由既有 SSO 换取；不能让用户再次登录一个 CUA 专用账号。



## 5. sandbox-manager 返回契约

现有 `/submit`、`/heartbeat` 和 `/release` 请求保持不变。`GET /task/{client_id}` 在任务就绪时增加以下结构：

```json
{
  "task_id": "openmausbot-xxxx",
  "status": "finished",
  "vnc_proxy": "https://sandbox.example/vnc/.../vnc.html",
  "openclaw_proxy": null,
  "hermes_proxy": null,
  "cua_proxy": {
    "transport": "streamable-http",
    "url": "https://sandbox.example/cua/tasks/openmausbot-xxxx/mcp",
    "token": "opaque-short-lived-token",
    "protocol_version": "2024-11-05",
    "expires_at": "2026-09-09T12:30:00Z"
  }
}
```

字段要求：


| 字段                 | 必填  | 说明                             |
| ------------------ | --- | ------------------------------ |
| `transport`        | 是   | 首轮固定为 `streamable-http`        |
| `url`              | 是   | 完整 MCP HTTPS 地址，不包含 Token      |
| `token`            | 是   | 当前沙箱专用的 Bearer Token           |
| `protocol_version` | 是   | 首轮返回 `2024-11-05`              |
| `expires_at`       | 是   | RFC 3339 UTC 时间；不得早于当前时间 30 分钟 |


当 CUA 仍在启动时，任务不能返回 `finished`；应继续返回 `queued` 或 `starting`。如果 CUA 启动失败，返回：

```json
{
  "task_id": "openmausbot-xxxx",
  "status": "failed",
  "error_code": "cua_not_ready",
  "detail": "可供研发定位、但不包含密钥的错误摘要"
}
```

不要返回一个存在但无法连接的 `cua_proxy`，也不要让 `finished` 同时表示“VNC 已好但 CUA 还没好”。

## 6. 必须提供的工具能力

首轮至少必须在 `tools/list` 中提供以下工具，并保持 Cua Driver 原生名称和参数语义：

- 观察：`get_desktop_state`、`get_screen_size`。
- 指针：`move_cursor`、`click`、`double_click`、`right_click`、`drag`、`scroll`。
- 键盘：`type_text`、`press_key`、`hotkey`。
- 应用与窗口：`list_apps`、`launch_app`、`list_windows`、`bring_to_front`。
- 健康与会话：`health_report`、`start_session`、`check_permissions`。

`get_desktop_state` 必须在 MCP `content` 中返回 `type: "image"` 的 PNG 或 JPEG base64 数据。所有坐标必须基于截图返回的实际像素宽高；桌面缩放或分辨率变化后，下一次截图必须立即反映新尺寸。

输入动作最好直接返回动作后的新画面。若驱动版本只返回文本，端点必须允许锐捷Bot紧接着调用 `get_desktop_state`，且不能返回旧缓存帧。

## 7. 同屏、并发与生命周期要求

- CUA、右侧小屏预览和用户 Take Control 必须看到同一个桌面、同一组窗口和同一鼠标状态。
- 至少允许一个 CUA 控制连接与一个 noVNC 观察/接管连接同时存在。
- noVNC 新连接不得踢掉 CUA，CUA 新连接也不得导致 noVNC 黑屏。
- 同一 `client_id` 在存活期间应复用同一个桌面。
- `/heartbeat` 续期不能中断 CUA 或 noVNC。
- 沙箱被回收并重建后，持久目录内容继续存在；旧的 CUA 会话不得错误控制新沙箱。
- 锐捷Bot在用户 Take Control 时负责停止发起新动作；供应方端点仍应保证单个动作原子执行并有明确超时。



## 8. 联调验收清单

以下项目全部通过，才视为“打开连接即可用”：

1. `/submit` 后轮询 `/task/{client_id}`，在 120 秒内得到包含完整 `vnc_proxy` 和 `cua_proxy` 的 `finished`。
2. 使用返回的 Bearer Token 完成 MCP `initialize` 和 `tools/list`。
3. `get_desktop_state` 在 2 秒内返回完整桌面图像。
4. 不打开 Take Control，智能体通过 CUA 启动浏览器、聚焦地址栏、输入关键词并提交搜索。
5. 每个输入动作后取得的新截图能看到对应变化，不能连续返回旧画面。
6. 同时打开 noVNC，能实时看到 CUA 执行的动作。
7. 用户 Take Control 后锐捷Bot停止新的 CUA 输入；交还后获取新截图并继续。
8. 保持心跳超过 30 分钟，CUA 和 noVNC 连接仍可用。
9. 释放并用同一 `client_id` 重建后，旧 URL/Token 不可用，新 URL/Token 可正常控制。
10. 两个不同 `client_id` 并行运行时，截图和输入不能串到另一台沙箱。
11. 在 Windows 安装包和 macOS 安装包各完成一次相同的端到端操作；两端不安装任何额外依赖。
12. 输入中文、英文、数字、标点和常用组合键，确认字符不丢失、不乱序、不乱码。
13. 改变桌面分辨率后，`get_screen_size`、截图坐标和 noVNC 点击位置保持一致。
14. CUA 进程被杀死后能自动拉起；重新查询任务并重连后无需重建整个客户端。
15. 网关断开、Token 过期和沙箱重建分别返回可识别的错误码，不能无限转圈或静默失败。

建议性能目标：

- `get_desktop_state`：局域网条件下 P95 不超过 1 秒。
- 单次点击/键盘操作到返回新画面：P95 不超过 1.5 秒。
- MCP 首次握手：P95 不超过 2 秒。



## 9. 当前锐捷Bot状态

当前源码已完成：

- sandbox-manager 创建、查询、保活、释放、排队等待和透明重建流程。
- noVNC Take Control、右侧小屏预览和基于 noVNC 的临时智能体控制桥。
- 用户接管锁和任务级临时能力令牌。

当前源码尚未完成：

- 解析 `cua_proxy` 返回结构。
- Streamable HTTP 到各模型引擎所需 stdio MCP 的本地适配器。
- CUA 优先、noVNC 降级及重连策略。

因此正确的开发顺序是：先冻结本文第 3～8 节的接口并由沙箱侧提供一个联调环境，再由锐捷Bot完成最后三项客户端适配。不要仅凭“镜像里已经安装 CUA”开始最终验收。

