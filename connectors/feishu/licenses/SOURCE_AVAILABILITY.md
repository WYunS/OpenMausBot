# MPL 源代码获取说明

本说明随固定 Node.js 24.15.0 Windows x64 原生运行时提供，适用于其中的 `smartstring 1.0.1` 和 NSS 来源根证书数据。它们继续适用 **Mozilla Public License 2.0**；用户批准的是本产品的限定依赖政策例外，不是修改上游许可。完整条款见同目录 `MPL-2.0.txt`，特别是第 3.1、3.2、3.3、3.4 节。

## 无需联网的随附源码

本目录下 `sources/` 随运行时一并交付。无需账户、付费或另行申请即可取得：

| 文件 | 内容 | SHA-256 |
| --- | --- | --- |
| `sources/smartstring-1.0.1.crate` | 原始发布源码归档，tar.gz 格式；包括 `src/`、Cargo.toml、README、LICENCE.md | `3fb72c633efbaa2dd666986505016c32c3044395ceaf881518399d2f4127ee29` |
| `sources/node-v24.15.0-certdata.txt` | Node 固定版本中的完整 NSS 来源证书/信任数据及原有 MPL 标头 | `3b98d4e3ff57a326d9587c33633039c8c3a9cf0b55f7ca581d7598ff329eb1f3` |
| `sources/node-v24.15.0-node_root_certs.h.txt` | Node 实际生成的证书头文件，保留原字节；`.txt` 只为便于查看 | `b8381bf64c65982dc9e93e87489e98f25cc660cfe46bd0f53ffaf99154ac6aac` |

`smartstring-1.0.1.crate` 可用支持 tar.gz 的归档工具打开；例如 `tar -xzf smartstring-1.0.1.crate`。其发布清单标注 `MPL-2.0+`；本次依据所附 MPL 2.0 条款提供源码，不借此批准未来版本或其他 MPL 组件。

## 上游固定来源

- smartstring 发布归档：[直接下载](https://static.crates.io/crates/smartstring/smartstring-1.0.1.crate)，SHA-256 同上；[对应源码提交](https://github.com/bodil/smartstring/tree/e407ca23c747257a812d2d2e70bf336412718c3a)。作者归属 `Copyright 2020 Bodil Stokke` 保留在源码 README 和第三方通知中。
- NSS 来源数据：[Node v24.15.0 原始文件](https://raw.githubusercontent.com/nodejs/node/v24.15.0/tools/certdata.txt)，SHA-256 同上。
- 实际生成文件：[node_root_certs.h](https://raw.githubusercontent.com/nodejs/node/v24.15.0/src/node_root_certs.h)，SHA-256 同上。
- 包含这两个 Node 文件及转换脚本的[完整 Node 源码归档](https://nodejs.org/dist/v24.15.0/node-v24.15.0.tar.xz)：SHA-256 `a4f653d79ed140aaad921e8c22a3b585ca85cfdab80d4030f6309e4663a8a1c8`。
- SWC/Amaro 对应源码：[Amaro 固定提交](https://github.com/nodejs/amaro/tree/859befe9883c9f615806a5f9618e08a913170291)，其中 `deps/swc`、Cargo.lock 和 `lib/wasm.js` 与本审计关联。它不是对全部 SWC 代码适用 MPL 的声明。

## 修改与权利

团团交付官方固定哈希的 Node/CLI 二进制，不修改这些二进制、smartstring 源码或上述 Node 源文件。上游已将 NSS 数据转换为 Node 证书头文件；转换后的文件和转换前数据均提供，不把上游转换误称为“从未发生修改”。对应脚本位于 Node 源码的 `tools/mk-ca-bundle.pl` 和 `tools/dep_updaters/update-root-certs.mjs`。

接收者可以按 MPL 2.0 获取、使用、修改和分发这些受覆盖源码。团团的其他产品条款不得限制这些源码权利；这些文件不要求接收者购买额外服务。没有将 smartstring、证书集合或整个应用重新标为 MIT，也没有要求整个应用改用 MPL。

发布方必须保持本说明、完整 MPL、源码和原有归属可用，并将它们与运行时一并交付；若改用仅网络提供源码，必须持续保证合理、及时、费用不超过分发成本的访问，不能只保留失效链接。当前方案直接随附源码，不依赖未来兑现的书面承诺。
