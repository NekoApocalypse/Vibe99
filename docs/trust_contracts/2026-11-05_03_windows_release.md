# Vibe99 0.9.0：图片查看与稳定启动入口

此 Windows 版本汇总图片粘贴、普通点击终端 URL、非活动 pane 首次点击只激活，并新增 **Markdown 图片全窗放大、缩放与拖动**。它还提供固定快捷方式 `artifacts/release/Vibe99.lnk`：将其固定到任务栏后，后续本机发布可替换目标程序而无需重建任务栏固定项。

图片查看复用 Mermaid 已有的顶层模态框、Fit、实际尺寸、滚轮缩放、拖动与键盘控制。点击图片（包括作为链接的图片）或聚焦后按 Enter / Space 即可展开。展开内容保留当前图片字节；文档或图片更新不会打断阅读，重新打开才取最新内容。导航、清空或关闭所属 pane 会关闭查看器。图片仍来自既有本地／SSH 只读加载器，保留原有格式与大小限制；不新增网络图片或 SVG 图片支持。

稳定入口指向 `artifacts/release/Vibe99/Vibe99.exe`，使用正常 Vibe99 配置。`npm run release:local` 构建并更新它；`scripts/stage-local-release.ps1` 可发布已经验证的生产程序，并检查产品名、版本与文件哈希。替换时先改名旧程序，不终止现有会话；若 Windows 阻止改名，则报错要求关闭该窗口后重试。**这是 Owlet 式本机发布，不是启动时从 GitHub 自动下载更新。** 需要保持仓库目录不变。脚本不修改安装版快捷方式，也不会自动固定任务栏。

新增范围集中在共享媒体查看器及本地发布脚本。PNG 粘贴和 URL 行为与限制见 [图片粘贴验收](2026-11-05_01_image_paste.md)、[URL 点击验收](2026-11-05_02_terminal_url_clicks.md)。本次未扩大远端连接或文件读取权限。

验收已完成：

- Mermaid 与图片浏览器测试覆盖缩放、拖动、Fit、实际尺寸、键盘入口、焦点、刷新快照与关闭清理；pane 和文档回归通过。19 项逻辑测试、34 项 Rust 测试通过。
- 最终生产 EXE 用真实本地 Markdown / PNG 文件验证展开、缩放、拖动、Fit、实际尺寸与关闭。测试使用单独 WebView2 缓存，未替换正在运行的安装版。新增查看器没有单独重跑真实 SSH 图片传输；它使用同一个既有加载结果。
- 实际通过 `.lnk` 启动 v0.9.0、保持窗口运行时重新发布、关闭测试窗口并再次从同一 `.lnk` 启动，全部通过。最新生产窗口已保留给用户；未自动固定任务栏，尚未实际点击固定后的任务栏图标。
- MSI 和 NSIS 安装包构建完成，MSI 解包验证产品名及版本。安装包仍未签名；未声称 SignPath 申请已获批。GitHub 发布在本验收之后执行。

证据：`artifacts/release-0.9.0-{media-viewer,ui,document,node,rust-tests,build}.log`，`artifacts/release-0.9.0-native-image-viewer.json`，`artifacts/release-0.9.0-shortcut-test.json`，`artifacts/release-0.9.0-msi-verification.json`。稳定 EXE SHA256：`67fc8d9aafb87865c89d53bfa4b722296a786aa73687c5ddf048d0a6e3937150`。

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated token-zero audit subagent
- **Model**: Inherited; exact model ID unavailable
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9.5/10 | EASILY READABLE: 9/10
