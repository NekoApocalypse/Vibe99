# Vibe99：终端 URL 点击修复

Review 10 让活动 pane 内的 HTTP(S) URL 像 Markdown 路径一样，**普通左键点击即可打开浏览器**；Ctrl+点击兼容，Shift+点击留给选择文字。非活动 pane 第一次点击仍然只激活。此版本同时包含 Review 9 的图片粘贴功能。

旧代码要求 URL 必须 Ctrl+点击，且 URL 的鼠标按下事件会先传给 SSH / tmux 中的程序，再尝试打开链接。现在 URL 复用 Markdown 链接已有的捕获阶段处理：同一链接上按下、松开且两次位置相距不足 6 像素才打开，手势不进入远端鼠标流。无需改 SSH 服务，也无需改变终端布局。显式终端超链接（OSC8）和可见的普通 URL 都接入此逻辑；仅允许原有 HTTP(S) 浏览器打开入口。

范围限制：终端正常折行的长 URL 可完整识别；程序如果在 URL 中间插入真正换行和缩进，则不能安全地猜测拼接。粘贴示例中 `https://www.` 与域名分行，但仅凭复制文本不能确定原终端是否使用了硬换行。旧 tmux 等中间层若删除 OSC8 信息，隐藏在标签背后的目标无法由 Vibe99 恢复；可见的完整 URL 仍可识别。选择链接文字请按 Shift；点击处理不追踪整条拖动轨迹。

已完成的验收：

- `scripts/test-review-ui.cjs`：用户提供的五个完整网址逐个覆盖跨行点击、普通点击、Ctrl+点击、Shift+点击不打开链接；OSC8 点击、一次打开、零鼠标输入及非活动 pane 首次激活通过。原图片粘贴、pane 排序与关闭回归也通过。
- `scripts/test-terminal-file-links.cjs`：中文、折行及普通/OSC8 Markdown 文件链接回归通过。
- `scripts/test-native-url-clicks.cjs pb@10.8.0.134`：最终 Windows 程序使用真实 SSH + 独立 tmux 会话，点击跨行 Salt Density URL 和可见 VS Code URL；Windows opener 各成功收到一次正确目标，未向终端写入点击数据。没有 mock 原生 IPC。测试会话已清理，用户现有会话未操作。该测试会实际打开浏览器标签，但不验证目标网站内容。
- Windows 构建与 34 项 Rust 测试通过。日志位于 `artifacts/review10-{ui,file-links,native-urls,rust-tests,build}.log`；原生结果在 `artifacts/review10-native-url-results.json`。

代码改动集中于 `src/renderer.js` 的链接回调和 `src/terminal-file-links.mjs` 的共享点击处理。使用独立配置的 Review 窗口已打开：`artifacts/Vibe99-Review-10/Vibe99-Review-10.exe`。SHA256：`4b83d52817fa97263dac813f4df9654bcafa0a00d1b6ff26b0208b9064beda79`。旧窗口不会自动获得此修复；安装版及 Review 9 未关闭或替换。本次尚未提交或发布。

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated read-only subagent
- **Model**: Inherited; exact model ID unavailable
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9/10 | EASILY READABLE: 9/10
