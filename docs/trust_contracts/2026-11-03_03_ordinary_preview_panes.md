# Review 7：文档预览就是普通 pane

Vibe99 Windows Review 7 让 Markdown 预览遵循普通终端 pane 的布局和 tab 操作：点击文件时，新预览插在来源 pane 右边；此后可独立拖动、聚焦和关闭。本说明替代 Review 6 的固定伴窗关系，文件读取与连接机制不变。

- 共用宽度、排序和堆叠规则，不再强制半屏配对，也不因切换焦点把预览拉回来源旁边。前台保持不透明的独立区域；后台仍按顺序半透明叠加，透出后台内容是预期效果，没有新增裁剪。
- 终端中完成定位的文件点击创建新预览；定位期间连续点击只保留最后一次待处理请求。文档内链接在当前预览导航。关闭来源终端保留文档，关闭文档释放自己的文件连接。最后一个终端退出时，若仍有文档，窗口继续保留；最后一个 pane 的关闭按钮禁用，仍可正常关闭窗口。
- 预览仍不随应用重启自动恢复。简单 SSH 可自动识别；复杂或嵌套 SSH、缺少远端目录时仍需显式位置。每个文档使用独立文件连接，无额外终端、无远端常驻服务；完整睡眠/tmux/agy 滚轮异常仍未复现。本次未重新进行真实 SSH 验收。

实现集中在 `src/renderer.js` 的统一 pane 数组与布局，文档内容由 `src/preview-document.js` 管理；没有第二套拖拽或排序逻辑。

**验证：**19 项 Node、33 项 Rust 测试通过，文档与终端交互回归通过。浏览器验证普通布局、透明度、拖拽、文件定位和独立生命周期；最终 Windows exe 实测连续文件点击、拖到左／中／右、焦点不改序、关闭来源保留文档及文档独立关闭。证据在 `artifacts/review7-browser-ui.log`、`review7-native-layout.log`、`review7-presented.json` 和 `review7-ready.png`。

已打开独立配置 `com.vibe99.review7` 的 Review 7 窗口，沿用已安装版 UI 偏好，未推送或发布。程序：`artifacts/Vibe99-Review-7/Vibe99-Review-7.exe`；SHA256：`a29d23e945c5b36bab573ab64fbb98cca5dba4219bbba24038f2f9d6e9dc95f2`。

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated read-only subagent
- **Model**: GPT-6 (inherited; exact runtime variant unavailable)
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9/10 | EASILY READABLE: 9/10
