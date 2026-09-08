# Reviewed enterprise desktop packages

The Local VM image can preinstall Feishu and Feilian without trusting mutable
`latest` download links. Put the vendor-provided Debian packages here using
these exact names:

- `feishu-amd64.deb`
- `feishu-arm64.deb`
- `feilian-amd64.deb`
- `feilian-arm64.deb`

When both packages for the requested architecture exist, the normal image
build computes their SHA-256 values, passes them into the isolated build, and
requires both apps. `OPENMAUSBOT_REQUIRE_ENTERPRISE_APPS=1` makes missing
packages a hard error in release automation. The image verifies both hashes
and Debian architectures before installing anything.

Feilian packages are commonly tenant-scoped. Do not commit private download
URLs, credentials, or unsigned installers to this repository.

## Reviewed x64 release inputs (2026-09-08)

The local Windows x64 release image was built from these official inputs:

- Feishu `7.72.23-0` (`bytedance-feishu-stable`, `amd64`)
  - Metadata: `https://www.feishu.cn/api/package_info?platform=10`
  - SHA-256: `7c744ce101e29f50d8d0fc099788b64cb389dde3178178a7fce9ffcdbf296e13`
  - Official MD5: `e7303dfa07c4b6a5e6ef7f92756bee94`
- Feilian `3.2.16` (`com.volcengine.feilian`, `amd64`)
  - Product download page: `https://www.volcengine.com/product/feilian/download`
  - Official package: `https://cdn.isealsuite.com/linux/FeiLian_Linux_amd64_v3.2.16_r8362_0d182a.deb`
  - SHA-256: `0ecaf5a41960a35679d1a715b73dadab1703b65decf13dbd689f8e1cc946a9d3`

The binary packages remain ignored by Git. Keep them beside this file when
rebuilding; the generated OCI archive and release manifest are the inputs used
by desktop packaging.
