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
