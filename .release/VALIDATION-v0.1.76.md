# RuijieBot v0.1.76 企业测试版交付记录

- 日期：2026-09-15
- 仓库：`AI-Applications-Team/OpenMausBot`，可见性 internal；操作账号 `liukaiwen_ruijie`。
- 源码：从 main 准备版本提交 `984f99191aeb56990170309a5141ac289216cd1e`；未注入沙箱预设或账号密钥。
- [成功的工作流运行](https://github.com/AI-Applications-Team/OpenMausBot/actions/runs/34945576728)
- [已发布的内部测试版 v0.1.76](https://github.com/AI-Applications-Team/OpenMausBot/releases/tag/v0.1.76)，不是草稿。

## 已核对的交付物

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| RuijieBot-0.1.76-mac-universal.dmg | 697345233 | a08a79d6796de8c027bda8c1dfc4c422ba4db8568ea1110f84b484d02b490ad7 |
| RuijieBot-0.1.76-setup.exe | 255540526 | 58320861e55585c7a0ce6671bacbac49488669bd8f646716c6c955330b2832e9 |
| RuijieBot-0.1.76-x86_64.AppImage | 272666449 | 76e6df81736cdf2886b464b1ea7f7a7d9106925be395192204dff7ff71fa7b57 |
| RuijieBot-0.1.76-amd64.deb | 230995348 | a45612d8293e8b0162acb1b3d2198f5154bbdf154bf4361777af6f9cb24204d8 |

Release 同时附有 BUILD-MANIFEST.json 和 SHA256SUMS.txt。发布后读取 GitHub 资产的大小与摘要，与下载的构建清单逐项核对成功。

## 验证结果与边界

本地 99 项相关测试、类型检查及 actionlint 通过。最终 CI 中 Windows、Linux、Apple Silicon 构建验证、同一 DMG 的原生 Intel 验证及发布任务全部成功。macOS 签名审计检查了 45 个 Mach-O 文件和 10 个 bundle；arm64/x64 分别运行了飞书 CLI、浏览器和打包服务。Linux 完成 AppImage/安装后的 DEB、退出清理、强制终止后重启、X11 崩溃重试及 Wayland 安全限制检查。

首次接入发现原 Linux 验收脚本沿用旧窗口标题和旧用户数据目录，已改为验证源码标题并使用安装版的“锐捷Bot Installed”和 `.ruijiebot` 隔离配置。应用的实际缓存路径及默认行为未因此修改。

Windows 为未签名包；macOS 为 ad-hoc 签名、未 Apple 公证。真人账号登录、Keychain 和持久 TCC 接受情况仍需真人测试；未生成生产人工验收回执。后续操作见 [企业一键打包发布](README.md)，填写新的版本号后运行即可。
