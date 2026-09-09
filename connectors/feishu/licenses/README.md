# 飞书原生运行时许可材料

2026-09-07：用户已批准固定 Node 24.15.0 Windows x64 / CLI 1.0.93 Windows amd64 的已列明非 copyleft 例外，并额外批准仅在该 Node 中的 **smartstring 1.0.1 与 NSS 来源根证书数据**两项 MPL 例外。GPL/AGPL/SSPL 禁令及其他未经批准的 copyleft 限制不变。

本目录只保存许可、来源及审计材料，不修改运行时逻辑。许可正文保留上游原文，不翻译、不改写、不删除不符合白名单的词句。

- `manifest.json`：运行时集成入口。包含固定二进制哈希、各许可文件路径/哈希/大小、审计状态及阻断项。
- `NODE_LICENSE.txt`：Node 固定版本完整多方许可，保持原始字节。
- `NODE_ADDITIONAL_NOTICES.txt`：SQLite、SipHash、Python TimSort、fdlibm 等补充许可及归属。
- `CLI_THIRD_PARTY_NOTICES.txt`：CLI 根许可、实际 Windows 二进制内 45 个 Go 模块的许可/NOTICE/PATENTS、Go 标准库补充归属。
- `SWC_THIRD_PARTY_NOTICES.txt`：127 个 SWC 普通依赖的许可及归属，不是逐符号链接证明。
- `SWC_GENERATED_NOTICES.txt`、`RUST_THIRD_PARTY_NOTICES.txt`：生成代码贡献者和 Rust 标准库补充许可。
- `MPL-2.0.txt`、`SOURCE_AVAILABILITY.md`、`sources/`：完整 MPL、源码获取说明及随附源码；必须一同交付。
- `UNICODE_NOTICES.txt`：Unicode 当前 v3 正文及历史数据许可，附明确的来源和范围。
- `components.json`：Go 模块及 SWC crate 版本、来源、许可正文哈希，供核对。

## 集成约定

负责运行时的代理应读取 `manifest.json`，按目标的 `noticeFiles` 将文件与二进制一起放入私有安装目录，并校验清单中的 SHA-256。打包时也必须包含这些文本，不能只分发根 MIT 许可。相对路径均以本目录为根；不要将审计工具或临时目录作为生产依赖。

**`engineeringClosureComplete=true`，`releaseApproved=true` 为固定制品的许可候选门禁通过。** 最终应用/安装发布仍须完成 runtime 集成和验证，不能仅凭这两个值发布。`integrationVerification` 明确标记待验证状态。`copyleftExceptionGranted=true` 只对清单内两条精确 `copyleftExceptions` 有效，CLI 未增加 MPL 例外。

Node 的 `noticeFiles` 包含嵌套 `sources/` 文件，集成时需保留路径结构，验证二进制、每份通知和源码的 SHA-256/字节数。不得只复制 `.txt`、遗漏 `.crate` 或源码获取说明；有缺失就不能将安装标为合规完成。官方二进制哈希不得变更。

完整结论见 `AUDIT.md`；研究原始报告为 `/tmp/opencode/feishu-native-license-audit.md`。后续关闭阻断项时必须更新来源证据、清单哈希和发布状态，不能仅修改状态布尔值。
