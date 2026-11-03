# Vibe99 Review 8：中键关闭 tab，展开查看 Mermaid

这次 Windows review 给终端和 Markdown tab 增加中键关闭，并让 Mermaid 图表像 Owlet 一样展开、缩放和平移。Review 8 已打开演示文档，复制了安装版的外观设置；使用独立配置目录，没有覆盖安装版或发布到 GitHub。

- **关闭规则一致**：中键走原有关闭流程，释放该 pane 的终端或文件连接；关闭后台 tab 不抢焦点，最后一个 tab 保留。文档与来源仍独立。
- **图表覆盖所有 pane**：Expand 打开应用级模态视图。滚轮按指针位置缩放、拖动或方向键平移；Fit／双击适应窗口，百分比按钮恢复原始尺寸，Esc 返回。焦点留在弹层内，应用快捷键不会操作背后的 pane。
- **展开的是快照**：文件自动更新不会打断缩放和平移，关闭再展开即可查看新版。切换文档或销毁其 pane 会关闭弹层。复用已净化的 SVG，不增加连接、后台服务或渲染依赖；原有 pane 排序、堆叠和透明度不变。

实现集中在 `src/diagram-viewer.js`、对应样式及 Markdown 渲染器，tab 仅添加中键事件并复用 `closePane`。使用浏览器原生模态层隔离焦点与点击；SVG 移动而非复制，避免重复 ID 干扰图表。

**验收通过**：19 项 Node 测试、33 项 Rust 测试；真实鼠标浏览器测试覆盖缩放锚点、拖动、键盘、窗口调整、刷新快照、导航／销毁，以及两类 tab 的中键清理和末页保护。完整文档刷新／重试／清理回归通过。最终 Windows 程序实测本地文件点击、弹层快捷键隔离、真实 SSH Mermaid 文件及中键关闭两类 pane，未记录页面异常。SSH 使用独立临时文件并已清理。

程序：`artifacts/Vibe99-Review-8/Vibe99-Review-8.exe`。SHA256：`5094a252be8d66fe889292226451fb230157820bd8cd6729bdb31089c721f92d`。

证据：`artifacts/review8-{diagrams,tabs,document,node,rust-tests,native,build}.log`、`artifacts/review8-presented.json`；演示截图 `artifacts/review8-ready.png`。可复跑入口为 `npm run test:diagrams`、`npm run test:review`、`npm run test:preview`；原生展示脚本 `scripts/present-review8.cjs` 需要全新 review 配置目录及授权的 SSH 主机。

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated, read-only factual/taste subagent
- **Model**: inherited/unknown; exact model ID unavailable
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9/10 | EASILY READABLE: 9/10
