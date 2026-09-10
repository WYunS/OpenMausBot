# 锐捷 Bot 浏览器、删除与 Harness 状态回归（2026-09-10）

## 改动范围

仅 Bot 源码；未修改 Harness、未生成安装包、未上传远程。

- 删除本地 Bot 不再依赖 VPS SSH、Box LIST/inspect、Docker daemon 在线。
  保留正在执行任务、创建电脑、保存凭证等生命周期互斥。独立电脑不随 Bot
  删除；先原子保存非敏感归属，Box/VPS 可作为已删除 Bot 的遗留资源识别。
  Local VM 的 vm-homes 保留；其独立管理列表扩展不在本次验收范围。
- 浏览器已确认的网页失败不再污染控制锁；未知中断仍要求显式重启。
  地址导航使用同一 native session 的活动 target，通过独立 CDP 连接在
  15 秒期限后确认 Page.stopLoading，再判定完成失败。不注入网页脚本，
  不让前端指定 CDP 地址或 target，不把直接杀 CLI 当作确认完成。
- Harness 被动探测不启动程序、不把已安装未运行伪装成未安装；显示按需启动。
  主动刷新与被动探测并发时，会在被动失败后执行主动启动，不复用错误结果。
  未连接前不伪造登录或余额；实际模型刷新、对话仍须校验真实账号。
- Windows 源码启动选择完整的 staged browser bundle，保留显式路径覆盖。
  已核对引擎版本 0.36.0-omb.1，不用未带 Windows stdio 修复的上游替换品。

## 实机证据

`scripts/verify-browser-live-control.ts` 使用隔离服务和临时 Bot：

- 初始画面、接管、鼠标、文字输入通过。
- 本地不可达地址失败后，仍可继续操作。
- 永不返回 HTTP headers 的 `/slow` 在 15,305 ms 后确认取消。
- 随后交还、重新接管、正常网址导航、输入框实际内容 `Recovered`、Enter 通过。
- 最终服务日志：
  `C:/Users/Yunsh/AppData/Local/Temp/openmausbot-verification-evidence/server-1789037070078-19992.log`。

真实 BrowserPanel fixture `http://127.0.0.1:20411`：

- 不可达地址之后交还/接管，输入 Ada 并 Enter，画面实际显示 `Hello, Ada`。
- 刷新外层面板后画面与输入保留，恢复到只读且可重新接管。
- `verify-browser-fullscreen.mjs` 在真实 Electron 中同按钮进入/退出全屏通过。
- 日志：`C:/Users/Yunsh/AppData/Local/Temp/openmausbot-verification-evidence/server-1789036569452-28624.log`。

开发客户端正常重启后，服务 PID 34724，`/api/config` 报告引擎
`0.36.0-omb.1`；13 个原有 Bot（含 Rocket）仍在。Harness 未被启动，
被动 snapshot 为 available 且未冒充 authenticated。

## 自动检查与边界

最终执行结果：

- `pnpm exec vitest run server/index.test.ts --reporter=dot`：206 通过、1 跳过。
- 浏览器 runtime/live/navigation/engine、BrowserPanel、Sidebar 与归属存储：170 通过。
- Harness 定位/驱动、模型选择、VPS、浏览器代理/路由等：92 通过、2 跳过。
- Windows 启动器：11 通过；`pnpm typecheck`、改动文件 oxlint、diff 检查通过。
- `pnpm test:packaged-server`：通过。仅编译服务端供隔离冒烟，未创建安装器；
  验证无 node_modules 启动、13 个代理路径、MCP stdio、电脑代理 stderr 关闭、
  24 个原生连接器品牌 URL。

中间一轮全文件回归的资料保存测试失败（初始 PATCH 当时未断言返回状态）；
已补上初始化状态断言，该 15 项组独立连续两轮通过，最终整文件 206 项通过。
未把单独重跑通过当作整组通过，也不据此声称其他所有模块已全量验收。

导航协议覆盖确认取消、未确认取消保持 fail-closed、活动 target 隔离、
错误端点拒绝与发送失败清理。BrowserLive 回归检查失败后交还/接管。
离线删除走真实隔离 HTTP 路由，断言不调用电脑服务，并保留归属/创建日志。

未用用户真实 Bot 做删除/发送测试，未清除账号、插件授权或浏览器登录。
Google 在当前网络不可达不属于程序可保证的连通性。macOS 安装包与真实远程
机器删除不在本次实机验收范围；不能据此宣称安装包全平台已验收。
