# 固定原生制品许可复核

日期：2026-09-07。**结论：固定制品的模块/源码级许可工程审计通过，包含用户明确批准的两个限定 MPL 例外。** `engineeringClosureComplete=true`；`releaseApproved=true` 只表示此固定制品的许可候选门禁通过，不代表最终应用或安装功能发布批准。最终打包/安装验证由 runtime 代理完成。这里不是法律或可复现构建认证。

## 本轮已完成

- Node 固定版本 `deps/amaro/dist/index.js` 的 Base64 WASM 与 [Amaro 1.1.8](https://github.com/nodejs/amaro/tree/859befe9883c9f615806a5f9618e08a913170291) 的 `lib/wasm.js` 内嵌 WASM 完全相同，共 2,504,689 字节，SHA-256 为 `2c8132e2c965a6a10024bf83dcee287fe15a0cb90f987394d1f9f3d68053a851`。
- 同一 Amaro 提交包含 `deps/swc` 源码和 Cargo.lock，锁文件 SHA-256 为 `25330e75e6fbf0f73d71d7143d7293ee95d183e4104809fc2d797aae898a9e3b`。不再依赖仅凭包版本猜测 SWC 来源。
- 使用 `cargo metadata --locked --filter-platform wasm32-unknown-unknown` 和 `cargo tree --locked --target wasm32-unknown-unknown -p binding_typescript_wasm -e normal,no-proc-macro` 得到 **127 个普通依赖 crate**，逐项收集实际许可正文。`metadata` 下载的其他工作区依赖不计入此清单；host 构建工具和 proc-macro 不当作 WASM 运行时库。
- WASM producers 段记录 `wasm-bindgen 0.2.100`、`walrus 0.23.3`。上游 [构建脚本](https://github.com/nodejs/amaro/blob/859befe9883c9f615806a5f9618e08a913170291/tools/build-wasm.js) 固定 wasm-builder 容器摘要，SWC [patch.mjs](https://github.com/nodejs/amaro/blob/859befe9883c9f615806a5f9618e08a913170291/deps/swc/bindings/binding_typescript_wasm/scripts/patch.mjs) 解释 WASM 如何写入 JS。
- 原生 CLI 的 **45 个实际 Go 模块**保留各自完整 LICENSE/NOTICE/PATENTS。补充 Go 标准库的 BSD、Sun 和 public-domain 归属；不使用根 MIT 代替它们。
- `go-localereader v0.0.1` 的 README 明确声明 MIT；取得同一作者 [2491eb6c 提交的完整 LICENSE](https://github.com/mattn/go-localereader/blob/2491eb6c1c75720122ef321ed7acc3a8d9de95b1/LICENSE)。`git diff v0.0.1 2491eb6c -- '*.go'` 无差异，故以未改变源码及作者后续完整许可作为归属材料，保留原有 2022 年份，不伪造历史许可。
- Unicode [当前条款](https://www.unicode.org/copyright.html) 明确将 `Public/` 目录的数据文件置于 Unicode v3，除非具体发行另有说明。[Unicode 15 ReadMe](https://www.unicode.org/Public/15.0.0/ucd/ReadMe.txt) 及 uniseg 源码明确数据来源。同时保留 `unicode-id-start 1.3.1` 发布包中的完整历史 `Unicode-DFS-2016` 数据许可，不把旧数据原始许可冒称为 v3。这解决了通知收集缺口，不宣称对全部生成表做过逐字重建。
- Node 根证书的 **145 个证书全部匹配**固定 Node 源码 `tools/certdata.txt` 的 DER 证书数据。`DATA_PROVENANCE.json` 保存源/生成文件哈希及匹配结果。
- 生产新增内容严格限于本目录。`manifest.json` 对通知文件记录精确字节数与 SHA-256，便于运行时代理打包、复制、验证。未改动 runtime、下载器、包配置或认证行为。

## 两项 MPL 例外

### smartstring 1.0.1

`smartstring 1.0.1` 的 [原始清单](https://docs.rs/crate/smartstring/1.0.1/source/Cargo.toml.orig) 标注 `MPL-2.0+`，作者 [README](https://github.com/bodil/smartstring/blob/e407ca23c747257a812d2d2e70bf336412718c3a/README.md#licence) 和完整 `LICENCE.md` 明确 MPL。它不是 GPL，而是文件级 copyleft。用户现已明确批准它在固定 Node 24.15.0 Windows x64 中的单独例外，不扩展到其他 MPL crate。

实际源码链路为 `binding_typescript_wasm -> swc_ts_fast_strip -> swc_ecma_parser -> smartstring`。[lexer/mod.rs 的 read_jsx_entity](https://github.com/nodejs/amaro/blob/859befe9883c9f615806a5f9618e08a913170291/deps/swc/crates/swc_ecma_parser/src/lexer/mod.rs#L1224-L1279) 使用 `SmartString<LazyCompact>`。对上述**完全相同的 WASM**调用 `transformSync('const element = <p>&amp;</p>;', {parser:{syntax:'typescript',tsx:true},mode:'strip-only'})` 成功。来源、普通依赖链及功能探针共同支持运行时包含判断，不是仅在 Cargo.lock 中搜到名称。

已下载并复核原始发布源码归档，与 Cargo 锁文件 checksum 相符。归档、完整 MPL 及作者归属随运行时提供；具体获取方式、URL、SHA-256 和权利说明见 `SOURCE_AVAILABILITY.md`。政策冲突由用户明确授权解决，不是通过改许可、删除依赖记录或忽略功能选项解决。官方二进制和随附源码不作团团修改。

### 根证书的 MPL 来源

Node [更新脚本](https://github.com/nodejs/node/blob/v24.15.0/tools/dep_updaters/update-root-certs.mjs) 从 NSS 下载 `certdata.txt`，再由 [mk-ca-bundle.pl](https://github.com/nodejs/node/blob/v24.15.0/tools/mk-ca-bundle.pl) 转换为 `src/node_root_certs.h`。固定来源文件开头为 MPL-2.0。curl 对同类转换的 [第一方说明](https://curl.se/docs/caextract.html#CA_certificate_store_license) 明确认为转换后的 PEM 仍使用 MPL-2.0。

用户现已明确批准固定 Node 中该证书数据的第二项 MPL 例外。本次采取保守合规方式，不依赖“证书不受版权保护”的排除论证：直接提供完整 `certdata.txt`、实际生成的 `node_root_certs.h`、完整 MPL 和源码获取说明。上游转换已明确说明，不把证书数据冒称为 MIT/public domain，也不将整个 Node 或团团改为 MPL。

## 工程闭环与边界

- 工程验收采用固定哈希、同提交源码/锁/WASM 对应关系、目标平台依赖图及保守完整通知，不要求逐符号链接证明。127 个 SWC 普通依赖已全部有实际许可材料；其许可表达式中唯一 MPL 项是 smartstring 1.0.1，已获得精确例外。没有把其他工作区 crate 或构建器的 GPL 文本转为已批准运行时依赖。
- 另收集 **35 个构建/proc-macro 依赖的补充通知**，以保守覆盖可能贡献的生成代码；它们不是新增 35 个已确认链接的运行时库。对应许可为 MIT/Apache/Unicode，没有新增 MPL/GPL/AGPL/SSPL 例外。
- 补充 Rust 标准库 MIT/Apache/COPYRIGHT，以及 **13 个 wasm32 标准库候选依赖**的完整通知。来源依据是同一 SWC 的 `rust-toolchain` 所指 `nightly-2025-05-06`，Rust 提交 `2e6882ac5be27a73293d6f7ae56397fdf32848de` 和官方校验过的 wasm32 std 归档；标准库依赖不是 127 个 SWC crate 的替代品。`RUST_PROVENANCE.json` 保存逐包来源/checksum，选 MIT/Apache 路径并保留 LLVM 例外、Unicode 及原有补充归属。
- 未复现原始构建，也没有断言 127 个 crate 等同于精确链接符号清单。构建脚本未强制 `--locked`，原始 Rust 编译器调用未独立证明；这些是明确保留的可复现性风险，而非本次约定模块/源码级工程审计的未完成门禁。审计使用的 stable 1.98.1 不是所宣称的原始构建器或产品依赖。
- `dragonbox_ecma` 提供 `Apache-2.0 WITH LLVM-exception OR BSL-1.0`，本清单保留 Apache 加例外全文；这不是新的 copyleft，但不得将表达式简写成不带例外的 Apache。其他双许可按 MIT/Apache/BSD 选项处理，Unicode 数据条款仍需同时保留。
- 尚未验证最终安装目录的通知/源码复制、打包完整性及哈希检查。由 runtime 代理集成；本目录只提供材料。`releaseApproved=true` 是许可候选门禁，必须结合固定制品匹配和全部 `noticeFiles` 校验；`integrationVerification.finalApplicationReleaseApproved=false` 仍明确保留。应用许可证不得限制这些 MPL 源码权利。

## 许可材料说明

`NODE_LICENSE.txt` 与官方固定版本原文保持字节一致。补充材料保留完整 Python 历史条款、SipHash CC0、SQLite/Sun 归属、MIT 子依赖等。smartstring/NSS 仍按 MPL 提供；`copyleftExceptionGranted=true` 必须与恰好两条 `copyleftExceptions` 一起解释，不能当作放开全部 copyleft。归档中的构建脚本属于所提供的来源材料，不因此认定这些脚本的许可代码进入官方运行时。

缺少独立 LICENSE 的 `base64-simd`、`vsimd`、`bytes-str`、`par-core` 已通过各发布包 `.cargo_vcs_info.json` 的精确提交取回对应仓库根许可，不使用浮动最新版。来源 URL 与文本哈希在 `components.json` 中可核对。

本次闭环覆盖已列明模块、补充归属与两个精确 MPL 来源。GPL/AGPL/SSPL 禁令不变；新增组件、证据变化、平台/版本/哈希变化必须重新审核。不能以本次工程通过推导对未知依赖、完整 OS 或全部版权问题的认证。
