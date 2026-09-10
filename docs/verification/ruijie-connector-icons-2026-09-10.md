# 官方应用图标恢复验收（2026-09-10）

## 原因及纠正

图标与连接状态不是同一请求。当前官方连接 broker 不可达，并不代表官方图片服务不可达。

对比昨日 checkpoint `fbc0574a`：

- 原图标渲染链路仍是官方 logo → Google favicon → 首字母，并非这版删掉了原图文件。
- 本次之前将目录超时从 15 秒缩短为 4 秒，加剧慢网络下的退化。4.3 秒响应的隔离测试在修复前返回 `curated`，修复后正常读取官方目录。
- 固定备用目录的 `logo` 原来为空，目录不可达时只能请求 Google favicon；Google 请求也失败，于是全部变成字母。
- 图标组件把失败状态绑定到整个卡片，得到新图标地址后不重置；手动刷新只刷新账号状态，不刷新目录和图片。

此前“必须恢复代理才能解决图标”的结论过早。本次确认 `logos.composio.dev` 可访问，使用 Composio 官方仓库公布的原始 URL。没有自制/内嵌替代图案，没有更改网络安全策略或代理配置。

官方地址来源：ComposioHQ/composio 的 `docs/public/data/toolkits-list.json`，blob `612ee303458928322b64a1d61a2df9ee924670bd`；Zapier 图标端点另经实际 HTTP 200 / SVG 检查。

## 实现范围

- 常用 24 个应用直接提供官方品牌图标 URL，不依赖账号 broker 成功才能显示图片。
- 快速读取已缓存目录/常用目录，完整目录在后台更新，恢复原 15 秒请求容限，不阻塞登录或聊天。
- 持久保存同一后端身份的官方目录元数据；暂时断网不丢弃已有图标地址，不跨账号合并。
- 新图片地址、手动刷新或网络恢复后，重新尝试加载图标；分页中途断线时保留已读取页面。
- 没有修改 Harness、凭据、Gmail 授权或飞书授权。

## 已执行验证

1. `server/composio-catalog-regression.test.ts`：修复前出现 logo 为 null、4.3 秒目录被放弃的失败；修复后通过，覆盖过期缓存保留和后续分页断线。
2. `scripts/verify-connector-icons.mjs`：隔离 Chromium 中使用真实 React 组件，HTTP 404 后换为正常 URL、原 URL 手动重试均成功解码。临时去掉修复的组件 key 时，新地址恢复测试确实失败；恢复修复后通过。
3. 实际读取本机 Bot 的公开图标元数据：24/24 官方端点 HTTP 200，均返回非空图片。
4. 同一组件在独立 Chromium 中实际加载全部 24 张官方图片，刷新前后均为 `naturalWidth > 0`，来源保持 `https://logos.composio.dev/api/`。
5. 关闭重开真实 Bot 后，在原插件界面看到 Slack、GitHub、Gmail 官方图标恢复，Gmail“工作”记录仍在。随后用户正在操作飞书/输入消息，没有继续抢占其客户端；完整 24 图标的刷新验收在独立浏览器完成。
6. 相关 6 个测试文件、56 项测试通过；构建、类型检查、打包服务检查通过。新增打包断言确保全新配置无需等待 broker 即返回 24 个官方图标 URL。

运行浏览器复验需提供已安装的 Playwright 模块及 Chromium 路径：

```powershell
$env:OMB_VERIFY_PLAYWRIGHT = '<Playwright 的 index.mjs 绝对路径>'
$env:OMB_VERIFY_CHROME = '<已有 Chromium/Edge 可执行文件绝对路径>'
# 可选，仅用于读取本机公开目录，不读取或写入账号凭据：
$env:OMB_VERIFY_CATALOG_URL = 'http://127.0.0.1:38799/api/connectors/catalog?cached=1'
node scripts/verify-connector-icons.mjs
```

图标恢复不等于 Gmail 远端 OAuth 在线校验通过。连接 broker 的网络可达性仍是独立限制；本次没有靠重新绑定或清空数据恢复图片。未生成安装包、未做 macOS 实机验收。
