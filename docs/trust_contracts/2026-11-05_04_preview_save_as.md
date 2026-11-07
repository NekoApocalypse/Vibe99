# Vibe99 — Save Markdown As

Markdown preview panes now have **Save As…** beside Close. Local and SSH documents use the same native Windows dialog: Downloads is the default folder, and a Windows-safe version of the original filename is suggested. Review 11 is ready; this change is not released.

The saved file contains the Markdown currently displayed, captured when Save As is clicked. An already-loaded remote document remains saveable after disconnection. This exports Markdown alone, with relative references unchanged; it does not bundle images. Text is UTF-8 with its existing line endings, but a byte-order mark stripped by the preview loader is not restored.

The existing reader passes its loaded text to one native save command. The native dialog chooses the destination; writes are staged beside it before replacement, avoiding truncation on failed writes. Cancel writes nothing, failures appear inline, and duplicate clicks are disabled while saving. No new SSH connection, shell, filesystem permission, or pane-layout behavior is introduced.

**Verified:** 36 Rust tests and both document/renderer UI suites passed. The built Windows app saved local and real SSH fixtures to Downloads with exact Chinese UTF-8 and CRLF bytes; native cancellation returned control normally. Automated cases cover disconnected export, write failure, duplicate clicks, and navigation while saving. Evidence: `artifacts/review11-{rust-tests,document,ui,build}.log`, `artifacts/review11-native-results.json`, `artifacts/review11-native-observations.md`; tests: `src-tauri/src/document_export.rs`, `scripts/test-document-ui.cjs`, `scripts/test-review-ui.cjs`.

**Try it:** `artifacts/Vibe99-Review-11/Vibe99-Review-11.exe`. The separate review window uses the installed app’s appearance preferences. Click Save As beside Close on a loaded Markdown document. SHA-256: `a84776184c77731f749cc27721fc3c6332e19002a8c0a0e829066649f4f362f5`.

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated token-zero subagent
- **Model**: GPT-6 (inherited)
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9/10 | EASILY READABLE: 9/10
