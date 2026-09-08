# 锐捷沙箱桌面控制对接清单

## 已由 OpenMausBot 完成

- 调用 sandbox-manager 创建、查询、保活和释放沙箱。
- 处理排队、调度、透明重建和 30 分钟生命周期。
- 打开带密码的 noVNC 页面供用户 Take Control。
- 在 Computer 面板建立独立的只读 noVNC 连接并生成实时小屏预览。
- 隔离 VNC 凭据、限制可访问地址，并使用纯 ASCII User-Agent 兼容当前代理。

## 仍需一个程序化控制通道

OpenMausBot 的 Bot 至少需要以下四类原子能力：

1. 获取当前屏幕截图（PNG/JPEG，附宽高）。
2. 鼠标移动、单击、双击、右键及拖拽。
3. 键盘文本输入和组合键。
4. 垂直/水平滚动。

请提供以下方案中的任意一种，优先级从高到低。

### 方案 A：Cua Driver / MCP（首选）

- 允许在沙箱镜像中预装并启动 Cua Driver。
- 为其 MCP 通道提供经过鉴权的 HTTP、SSE 或 WebSocket 代理地址。
- `GET /task/{client_id}` 可返回 `cua_proxy`、协议版本及临时访问令牌。
- 代理地址在沙箱透明重建后能够重新获取。

### 方案 B：沙箱桌面控制 API

- 截图接口。
- 鼠标、键盘、滚动接口。
- 查询分辨率及缩放比例的接口。
- 接口按 `client_id` 隔离，并使用短期令牌鉴权。

### 方案 C：远程命令通道

- 暴露受控的 `sandbox.commands.run` 或等价接口。
- 支持 argv 数组、环境变量、超时、退出码、stdout 和 stderr。
- 如需运行长连接 MCP，需额外提供双向流式 exec（WebSocket）及端口代理能力。
- 允许 OpenMausBot 安装或启动自己的 Cua Driver，但不要求 root 权限。

### 方案 D：标准 RFB WebSocket

若只能提供 VNC，请确认：

- `vnc_proxy` 是标准 RFB-over-WebSocket，而非仅供网页使用的私有协议。
- 允许一个只读预览连接和一个程序控制连接同时存在。
- 明确密码、令牌、URL 的有效期及刷新方式。
- 支持读取 framebuffer、发送 pointer/key 事件、剪贴板和分辨率变化。
- 心跳续期或沙箱透明重建后可重新获取有效地址。

## 联调验收

1. 创建沙箱并等待 `finished`。
2. 不进入 Take Control 即可看到持续更新的小屏。
3. Bot 获取截图并识别桌面状态。
4. Bot 打开浏览器、输入关键词、提交搜索并返回操作后的截图。
5. 用户 Take Control 时 Bot 输入立即暂停；交还控制后 Bot 可以继续。
6. 沙箱回收后，同一 `client_id` 重建并重新连接，持久目录中的文件仍存在。

