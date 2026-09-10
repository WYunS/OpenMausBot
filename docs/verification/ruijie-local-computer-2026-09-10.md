# 锐捷 Bot 本机电脑故障复验（2026-09-10）

## 范围与结论

本次仅修改 Bot，未修改或重打包 Harness。真实客户端测试由用户明确要求并授权；其他自动测试使用隔离 fixture，不读写真实账号或电脑。

本机工具挂载故障已在实际失败路径修复，并完成真实消息、实际工具调用、关闭重开与刷新验证。**插件网络与 Gmail 在线状态尚未验收，不代表全项通过。**

## 根因及回归

隐藏运行的 Harness 将不可写的 stderr 传给电脑代理。CUA 的版本提示写入 stderr 后，原 `child.stderr.pipe(process.stderr)` 引发未处理的 `EPIPE`，代理退出；外层错误表现为 `agent-presets ... failed to mount / Connection closed`。仅修正 JSON Schema 不足以解决此问题。

- 保留并持续消费 CUA stderr；诊断输出通道失败不能杀死 JSON-RPC 通道。
- `server/local-computer-proxy-gate.test.ts` 真正启动代理和假 MCP 子进程，主动关闭父进程的 stderr 读端。
- 修复前该测试失败：`computer proxy exited before discovery: 1`。
- 修复后完成 `tools/list`，且代理正常退出，退出码为 0。
- `scripts/smoke-packaged-server.mjs` 对移出仓库、无 `node_modules` 可用的打包服务副本重复此测试，防止仅在源码环境通过。

## 真实客户端验证

通过桌面 UI 向现有 Maple 对话发送明确的只读验收消息；工作位置为 `local`（这台电脑），未通过直接 API 绕过桌面写入鉴权。

| 操作 | 实际结果 | 从发出消息到完整回复 |
| --- | --- | --- |
| 简短问候 | 正常文本回复 | 9.7 秒 |
| 要求仅调用一次 `list_windows` | 工具记录 `ok: true`，回复窗口数量 | 4.5 秒 |
| 关闭 Bot、从原开发版启动器重开，再调用 `list_windows` | 新进程内工具记录 `ok: true`，回复“重启后电脑工具正常” | 9.3 秒 |
| Ctrl+R 刷新 | 成功回复仍在；未产生新的电脑挂载失败记录 | 不适用 |

旧失败消息仍属于历史对话，没有为了截图清理用户历史。
以上是有限场景的实测，不承诺所有模型与长任务均在相同时间内完成。

## 插件与凭据：纠正此前判断

- 旧 `OpenMausBot` 配置中的凭据未发现 Composio 身份；早期锐捷代码已使用 `锐捷Bot` 配置目录。没有证据支持“昨天改名导致 Gmail 丢失”的推断。
- 删除此前加入的跨配置目录凭据迁移逻辑；不迁移、不替换用户的真实凭据。
- 重启前后当前 Composio token 与 installation id 的散列一致；检查未输出密钥原文。
- 插件 UI 当前可显示 Gmail 的“工作”绑定，但这是可保留的历史缓存，不能证明在线授权仍有效。
- 服务端另一份旧缓存的身份与当前身份不同，不能拿它覆盖当前绑定或作为恢复依据。
- 官方连接服务 `openmausbot-composio.milindsoni201.workers.dev` 经现有代理仍 TLS 失败/超时，实时连接接口未返回权威清单。官方目录加载失败时仍走原版 favicon/字母回退；未嵌入自制替代图标。
- 待可用网络恢复后，必须检查权威连接响应、Gmail 状态及真实图标，不能靠缓存截图宣称修复完成。未改 VPN、未重新授权账号、未断开任何连接。
- 手动刷新实测：页面明确提示“显示的是上次的通用应用连接状态——刚才未能完成在线检查”，Gmail 历史绑定仍保留。

## 诊断清理

临时源码插桩及两份一次性检查脚本已删除。只读检查生成的五个 `omb-connector-inspect-*` 临时 Electron 配置副本位于用户 Temp 下，包含复制的 `Local State`，没有输出明文密钥；清理请求被执行环境策略拒绝，未绕过。原始用户配置目录未删除或修改。

## 自动检查

```powershell
pnpm exec vitest run server/local-computer-proxy-gate.test.ts server/local-computer-proxy.test.ts electron/secure-credentials.test.mjs electron/managed-composio.test.mjs server/composio.test.ts server/composio-availability.test.ts server/connected-apps-cache.test.ts src/components/PluginsPanel.test.ts src/lib/connected-apps-cache.test.ts
pnpm typecheck
pnpm build
pnpm test:packaged-server
node scripts/smoke-packaged-server.mjs
pnpm lint
git diff --check
```

9 个测试文件、77 项测试通过。类型检查、构建、隔离打包启动、12 个代理路径检查、MCP 最后帧排空、新增打包代理关闭 stderr 测试均通过。Lint 无错误，有现存警告；构建有现存 chunk size 提示。

未生成安装包，未进行 macOS 运行验收。
