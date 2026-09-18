# 锐捷 Bot 选择性升级：首轮交付记录

日期：2026-09-18。本文是实施结果；前两份审查文档中的“网络不可用、尚未修改”是审查当时的记录，不代表当前状态。

## 已落地范围

官方参考固定为 `v0.1.84 / 55af6c37aa6144dd7e976f2f600a25363ba20c4f`，不是整仓合并，也没有把企业版本号直接改为 0.1.84。

本地已有企业修改先保存到 `f2d500b4`，再在独立工作树实施。已验证产品代码提交如下：

| 企业提交 | 范围 | 来源/企业取舍 |
|---|---|---|
| `4f0035af` | Windows 本地预览补齐 CUA staging，修旧启动器断言 | 选择企业 `aa25d499` 的必要增量，保持 CUA 0.28.1 |
| `167f4f00` | 接受仓库根目录和子目录的精确 SKILL.md blob URL | 官方 `3621c6fe`，不扩大技能默认授权 |
| `d086d9cd` | Windows 检查点保护使用规范化、大小写等价路径 | 官方 `318d5c3c` |
| `68063646` | 聊天截图可点击放大、Escape 关闭 | 官方 `4b7dbb86`，复用现有附件预览和视觉样式 |
| `bc9b36cb` | 内置 Harness 真实来源与构建入口统一 | 固定 2.1.10、源提交与运行时身份，不能把旧包重新标成新版本 |
| `1ac671cc` | H03 停止确认、C03 单电脑/Off、H04 多题问答、I03 拒绝分类 | 复用官方布局，按企业 Harness 原生协议重做端到端适配；共用 contracts/index/driver，作为一个经过联合验证的核心包提交 |

### 停止和电脑边界

`session.cancel accepted` 不再等于停止成功。Bot 等待当前会话对应的 turn/end，以及精确 sessionId 的 running:false；丢失通知时从原生 `{event, view?}` 历史条目恢复。保留同线程占用直至确认；超时明确失败并保留占用，允许重试 Stop。

启动未派发、重复 Stop、旧 turn 迟到、电脑自动补发尚未受理等情况都有保护；更新 provider 配置也先确认 sidecar 停止。Explicit Off 不挂载 Bot 的电脑/浏览器工具；显式选择云端或 VM 不会因一句“本机”被覆盖，不会因云端不可用自动降级操控宿主机。

这里的 Off 是 Bot 电脑/浏览器选择，不是禁用所有 Harness 原生命令工具的操作系统沙箱。群组仍沿用现有 VM 路由范围，没有借此新增所有类型的群组电脑支持。

### 多题问答与授权/额度

保留原始问题 ID、顺序、完整计划 detail、选项及描述；支持单选、多选、Other 和原生取消。回答经服务端校验，按 ID 发送 selected/custom，并保存到历史。旧单题文本兼容；旧客户端用一条文本回答多题会明确拒绝，不再把同一答案复制到全部题。

业务选项 Allow/Deny 不是权限授权。界面提交中去重，失败后可重试；实际原生 resolved 先于回执也能正常保存回答。

只按 Harness 既有结构化 AUTH/QUOTA/HTTP 状态分类；Bot 不自动补发被拒任务，不从错误文案猜币种、不把未知余额当零。没有新增人民币预算硬限额，也没有修改 Harness 内部模型重试策略。Harness 的原生权限仍由 Harness 管理，Bot 没有新增 Full 权限入口。

### 企业功能保留

保留私有内置 Harness、SSO 继承/账号匹配、人民币用量路径、agents MCP、飞书、CUA 0.28.1、企业云端边界和现有简洁界面。自然语言 setup 和资料确认卡保持原有机制；资料字段不齐不增加阻断使用的门槛。

## 验证证据

测试在独立 HOME/临时数据库中执行，没有用当前用户账号、真实桌面或飞书消息做测试写入。命令与边界详见 [隔离验证说明](../verification/selective-harness-upgrade.md)。

| 检查 | 结果 |
|---|---|
| 26 文件定向 Vitest（含企业配置/存储、agents、driver/locator、问题卡协议、路径与用量等） | 656 通过、3 跳过；`regressions.json` |
| 技能 URL 专项 | 7 通过；`skill-url.json` |
| 最终 driver + 服务端复验 | 40 个 driver 用例通过；3 个真实 Bot 服务端/模拟 Harness 传输用例通过，含追加的 provider reload；与上面有重叠，不重复累计 |
| 5 文件桌面 Node 测试 | 33 通过：启动入口、SSO、Universal 布局、企业资源配置与可信权限通道 |
| 无窗口 React/store 测试 | 截图打开/关闭、完整计划、多题/Other、Allow 业务选项、失败重试、取消通过；无意外 console error |
| UI/server TypeScript、修改范围 lint、diff 空白检查 | 通过 |
| 编译后服务端脱离 node_modules 启动 | 通过：HTTP health、14 个代理路径、MCP 初始化/健康/退出刷新、关闭 stderr 后电脑代理发现，以及 24 项连接器目录；测试的是新编译目录，不是安装包 |

JSON、截图与 fixture 日志保存在升级工作树 `D:/ChatGPT/Bot/worktrees/OpenMausBot-selective-0.1.84/.omb-scratch/verify-evidence/selective-upgrade/`，不是发布验收凭证。

### 单独发现的既有失败

`server/group-local-vm.e2e.test.ts` 中 “queues a second room on the shared desktop until the first turn releases it” 未通过：第二个房间会得到占用错误，并没有自动排队。已在未升级的 `f2d500b4` 实际本地目录上复验，同样失败；基线证据为该目录 `.omb-scratch/verify-evidence/selective-upgrade/baseline-room-queue.json`。本轮没有篡改这条测试使其变绿。

该文件另外 6 项通过。它归后续团队/排队批次；本轮验证的是**不重叠操控、确认停止后可以重新发起**，不是宣称已有自动排队功能。不能据此写“全部验收通过”。

## 本地入口与肉眼验证

实际目录仍为 `D:/ChatGPT/Bot/downloads/OpenMausBot-source`；已将产品代码快进合入，原有未跟踪诊断脚本、报告与缓存保留。桌面快捷方式“锐捷Bot（本地开发版）”仍指向此目录，不要求使用升级工作树。

本轮只编译 UI/server 和校验原生资源，不运行安装包构建、不启动 Actions、不推送 Bot、不自动打开窗口或结束当前进程。当前已经打开的旧进程不会凭磁盘编译自动升级，测试前请从托盘**完全退出**，再打开“锐捷Bot（本地开发版）”。

建议使用一个临时 Bot/新对话做可恢复测试：

1. 查看屏幕后点击聊天截图，验证放大和 Escape 返回。
2. 说“先用问题卡问我两个问题：方案选简版或详版；输出形式可以多选表格或文字。等我回答再继续。”应能分题选择和自填。模型不一定每次主动使用问题工具，若没有弹卡，不能只凭这一轮文本认定协议失败；隔离脚本可确定性重现卡片。
3. 将电脑选择设为 Off，再说“打开本机浏览器”。Bot 不应挂载自己的电脑/浏览器工具；这不是对所有原生 shell 命令的安全沙箱测试。
4. 在可中止、无保存/发送后果的浏览器查看任务中点停止，等任务结束后再发下一条；不要用付款、发送邮件等不可逆任务测试取消。
5. 空白 Bot 用普通中文描述用途、风格，确认资料卡后正常聊天，不需要手写 name/title/soul。

## 仍需单列的验收/后续批次

Windows/macOS 最终安装包、macOS 双架构与签名、真实 SSO 刷新/退出/切账号、真实额度拒绝、飞书操作，以及外装 Harness 未安装/未打开/运行任务/托盘驻留四种状态，不能由这些离线源码测试代替。本机源码预览使用同目录体系下的 Harness 源码编译入口，不等于已制作了新的分发安装包。

团队/线程批次（含上述房间自动排队）、上下文增量、备份与日志清理、共享设备/语音等没有混入本轮。应按原审核方案继续逐包实施；尤其计量解耦之前不默认清理事件日志。

## 构建收据

`node scripts/prepare-local-preview.mjs` 已在实际本地目录成功完成（没有安装包），`node scripts/desktop-build-receipt.mjs` 独立复核通过。产品源码为 `1ac671cc4fa81ebc05b9c25a015c27d4f3849c66`。构建记录：

- 时间：`2026-09-18T05:55:26.972Z`（北京时间 13:55）。
- source fingerprint：`1f3dfeb118a0e6ec21df2b91f58d300532600ad6033173d09b9767d8dd86e9d3`。
- UI SHA256：`a9bd4156c54c364494234748241e394db9654d30a81c765ac7fdc8fb73d085ca`。
- server SHA256：`788ba9151412555edbf3ac5f2787f58d87779d616cea4479316a126f5e729d10`。

构建仅有现存大 chunk 体积提示，不是编译失败。收据证明磁盘源码与 UI/server 一致，不证明目前尚未重启的旧进程已经加载新代码。后续仅新增 docs 记录不改变产品源码指纹。
