# 飞书连接与运行时复验（2026-09-10）

## 真实环境检查

使用 Bot 自己固定的 lark-cli 1.0.93 和现有连接上下文，经 `createCli` 调用；没有借用全局 CLI 的其他账号，没有导出密钥，没有重置或重新授权。

- `inspect({ timeoutMs: 8000 })`：应用身份、用户身份均为 ready / available / verified；复验耗时 1095 ms。
- `validateTool('feishu_calendar_list', { calendarId: 'primary', start: '2026-09-10T14:00:00+08:00', end: '2026-09-10T14:01:00+08:00' })` → `cli.run(request.args)`：真实只读调用 `ok: true`；复验耗时 1068 ms。不记录日程内容。
- Bot 现有 `tuantuan-feishu` MCP 注册项已启用，使用已安装 Node 和源码版 MCP 入口。没有私有 Node 副本并不代表缺少运行时：兼容的现有 Node 可以复用。

边界：上述检查证明现有授权和真实只读 API 可用，不等于模拟用户重新扫码授权，也不等于对所有飞书产品都有权限。未向真实联系人发消息、未创建文档/日程。实际写入仍需用户指定业务对象与操作。

## 本次修复

1. Windows 发布已校验运行时时，文件/目录可能被短暂占用，原先一次 `rename` 的 EPERM 就会终止安装。新增仅针对 Windows EPERM / EBUSY / EACCES 的有界退避：50、100、200、400、800 ms，最多重试 5 次。不跳过校验、不关闭安全软件、不删除非本程序拥有的文件。
2. 退避期间取消仍返回连接器约定的 `ABORTED`，不泄漏底层 `ABORT_ERR` 分类，也不返回安装成功。持续失败仍明确失败，清理自己的 staging。
3. MCP 子进程回归测试改为相对测试文件解析入口，兼容仓库根目录与 `pnpm --filter` 的包目录，不再拼出重复的 `connectors/feishu`。

## 红绿验证与结果

- 注入两次 EPERM：修复前失败，修复后正常发布；持续 EBUSY 共尝试 6 次后失败；取消退避测试先出现 `ABORT_ERR` / `ABORTED` 不一致，修复后通过。
- `pnpm --filter @tuantuan/feishu-connector test`：325 项，319 通过，6 跳过，0 失败。跳过项包含 Windows 无符号链接权限及未提供离线官方制品的测试，不计入已验收。
- `node --test electron/tuantuan-feishu.node-test.mjs`：117 项通过。
- 图标、电脑代理、飞书 UI 合并回归：10 个文件、168 项通过。
- 修改文件定向 oxlint、`git diff --check` 通过。
- `pnpm build` 通过（已有大 chunk 警告，不是构建失败）。
- `pnpm test:packaged-server` 通过：独立打包目录启动、12 个代理入口、MCP stdio、关闭父 stderr 后电脑代理发现工具、全新配置的 24 个官方图标地址均通过；这是打包目录冒烟，不是安装包实机验收。
- `node --experimental-strip-types connectors/feishu/fixture-smoke.mjs`：真实隔离 Bot 服务、真实 MCP 子进程、假的飞书传输。配对/任务创建、幂等投递、5 个工具注册、允许/拒绝调用、断开撤权、EOF 和子进程清理均通过。这不是对真实飞书收件人的写入验收。

本机隔离证据：

```text
C:\Users\Yunsh\AppData\Local\Temp\feishu-fixture-evidence-2sHlmR\verification.json
C:\Users\Yunsh\AppData\Local\Temp\openmausbot-verification-evidence\server-1789020792378-34080.log
```

只修改 Bot 仓库；没有修改或打包 Harness，没有生成 Bot 安装包，未进行 macOS 实机验收。
