# 锐捷 Harness 还是 Codex CLI：怎么选

VERDE-0920-1615｜2026-09-20｜架构图补充，属于建议，不是新一轮代码改动。

## Alpha｜不要把两个选择绑在一起

**本地 Bot 内置谁，与云端用谁干活，可以分别选择。** 现有源码已有两种接法，不必为了上云，先把本地稳定的锐捷 Harness 换掉。

| 评估关键词 | 锐捷 Harness | Codex CLI |
| --- | --- | --- |
| 公司接入 | 当前已有公司 SSO 状态、账号匹配和多提供方模型目录接入 | 已有 Codex 接法；公司账号、模型接入与额度不能默认等同于锐捷 SSO |
| 本地封装 | 已有内置构建和运行定位；Mac 按芯片准备的方向可以继续 | 有执行接法不等于每种安装包已完整内置；仍需验证下载、授权、更新和新机启动 |
| 云端常驻 | 当前内置构建覆盖 Windows/macOS；Linux、无桌面运行不能先当作已支持 | 官方有无交互执行入口，可优先试点；仍要接入任务调度、公司认证和电脑工具 |
| 电脑操作 | 源码已有工具接入，但效果取决于模型、工具与权限配合 | 同样有工具接入，不能由写代码强直接推定操作桌面更强 |
| 维护成本 | 继续维护公司封装、依赖和登录兼容 | 跟进 CLI 版本、接入协议和公司认证兼容；不是免维护 |
| 包体积 / 使用费用 | 新薄包、真实任务费用未对照实测 | 同样没有本项目同条件实测；不先许诺一定更小或更便宜 |

## Beta｜我的当前建议

- **本地默认：保留锐捷 Harness。** 主要依据是已有公司接入和封装基础，变动范围更小；不是宣布它能力必胜。
- **Codex CLI：保留可选接法。** 是否也默认塞进安装包，等确认目标用户、授权和包体积后决定，不默认双引擎都打进去。
- **云端试点：优先验证 Codex CLI 的无交互执行路径，同时保留锐捷候选。** 优先验证是因为有明确的官方自动执行入口，不是已经证明更强、更便宜或更适合公司账号。
- **如果锐捷 Harness 能在目标环境稳定无窗口启动，且公司登录更顺，它完全可以继续当云端引擎。** 目标不要求本地和云端品牌不同，也不要求必须相同。

图中的“可替换的执行引擎”表示沿用已有接法、隔离差异；不承诺两种引擎可以任意搬移正在运行的会话。云端任务记录、权限和结果归 Bot 管理，不只寄托在某个引擎内部。

## Gamma｜用这五项决定，不靠印象

1. **公司账号能否顺利登录并持续运行？** 包括过期、续期和用量归属。
2. **同样一组任务，谁真正做完？** 浏览器、文件、桌面操作分别测，不只测写代码。
3. **失败时谁更好处理？** 中途停下、断网重连、重启后恢复，外发操作不能盲目重复。
4. **装到新电脑上是否省心？** 没有开发环境也能启动，升级后数据保留；Mac 两种芯片分别验收。
5. **成功完成一件事花多少钱？** 计算模型、云电脑、重试和人工接管，不只比单次调用价格。

两个引擎都不能替代本机授权连接。无论选谁，都必须让用户知道正在控制哪台电脑、能撤权、能停止；也不能把“本地装了执行器”解释成“模型离线运行、数据绝不外发”。

### 依据（备查）

- 当前锐捷接入：[SSO 与账号检查](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:374)、[提供方与模型目录](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:498)、[工具能力](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/ruijie-harness.ts:824)。
- 当前 Codex 接入：[app-server 启动](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/codex.ts:579)、[工具能力](D:/ChatGPT/Bot/downloads/OpenMausBot-source/server/drivers/codex.ts:1263)。注意：当前接法是 CLI 的 app-server 模式，云端试点改用 `codex exec` 不是直接改名字，需要验证接法差异；不把裸 app-server 开到公网。
- 内置构建平台：[脚本支持范围](D:/ChatGPT/Bot/downloads/OpenMausBot-source/scripts/build-ruijie-harness.mjs:47)。
- 官方自动执行说明：[Codex non-interactive](https://developers.openai.com/codex/noninteractive/)。沿用同日此前已核查的官方资料；本轮重访仍为 SSL 失败，不作新增实时支持或价格承诺。
- 总体证据：[报告依据](D:/ChatGPT/Bot/downloads/OpenMausBot-source/docs/research/ruijie-grokbot-report-evidence-2026-09-20.md)。

本补充未重新启动 UI 工作，也未改动、构建或重启 Bot。
