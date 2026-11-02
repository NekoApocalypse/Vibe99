# Review 6：点击文件，紧挨原终端阅读

Windows Review 6 将文件预览改成原 agent 终端的阅读伴窗：单击 Markdown 路径或文件超链接，即在旁边显示文档。预览只有文件名、正文和关闭按钮，不再暴露连接表单或启动额外终端。本文件替代 Review 5 的预览交互说明；原有鼠标恢复与后台工作区机制保留。

## 行为与边界

- 一个来源终端复用一个伴窗，两者并排可读。关闭预览保留来源会话；关闭来源会同时清理伴窗。预览不自动恢复或重连。
- 本地绝对路径直接读取；PowerShell 提示符报告当前目录，支持本地相对路径。简单的 `ssh user@host` / `ssh alias` 从该终端自有进程树识别，内部建立独立的只读文件连接，使用已有认证与 known_hosts。
- 复杂 SSH 参数、缺少远端工作目录或不明确的链接来源，会询问一次位置，记到本地提示符返回或终端重启。远端再次 SSH 无法自动探测；该场景需要显式提供正确位置。自动识别不代表接管所有嵌套连接。
- 支持 `.md`、`.markdown`、`.mdown`、带空格的引号路径、Markdown 链接标签、换行/CJK 和行号后缀；后缀用于识别文件，不承诺跳到源码行。网络链接仍按原修饰键打开浏览器。文件点击不会给终端程序发送鼠标点击报告。

```mermaid
flowchart LR
  A[原终端中的文件链接] --> B[来源会话与目录识别]
  B --> C[本地读取或独立 SSH 文件连接]
  C --> D[并排的只读文档]
```

预览和图表仍按需加载，进程检查不在启动路径，Windows 检查限时 3 秒。原有文本/图片大小限制、HTML 清理、后台连接心跳继续适用；没有安装远端常驻服务。文件读取不是目录沙箱。复杂大文档仍可能耗时，完整睡眠/tmux/agy 滚轮异常仍未复现。

## 验证与交付

19 项 Node 测试、33 项 Rust release 测试通过。浏览器测试验证无控件伴窗、并排尺寸、鼠标报告隔离、上下文记忆、关闭清理和最后一个终端退出。最终 Windows exe 实测本地路径、真实既有 SSH 的路径及文件超链接：无需配置表单，关闭预览后原 SSH 可继续输入，关闭测试来源后远端 shell 退出。测试目录已清理。

证据：`artifacts/review6-node-tests.log`、`review6-rust-tests.log`、`review6-browser-ui.log`、`review6-native-companion.log`。构建为 `artifacts/Vibe99-Review-6/Vibe99-Review-6.exe`，SHA256 `daf53e63f5fc0addbbb13c7bd97f34a4740ea202d448d81d119b8f2d1649be12`。

Review 使用独立配置 `com.vibe99.review6`，沿用已安装版 UI 偏好。已打开演示窗口；未推送或发布。详细使用边界见 [文件预览说明](../preview-workspaces.md)。

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated subagent, Token-Zero factual codebase audit
- **Model**: inherited session model
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9/10 | EASILY READABLE: 9/10
