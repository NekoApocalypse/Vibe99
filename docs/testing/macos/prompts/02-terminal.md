# Local terminal correctness and recovery

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. In disposable panes test zsh and bash: printable text, Enter, Backspace, arrows/history, Tab completion, Ctrl+A/E/U, Ctrl+C interruption of sleep 30, and Ctrl+D exit. Commands execute once in the focused pane only; app remains usable after shell exit.

2. Print ASCII box drawing, 中文 日本語 한국어 and emoji, and edit mixed text with arrows/backspace. Verify glyph widths, no corruption or cursor drift. Test real IME composition if available and record separately if unavailable.

3. Run FIXTURES/terminal_probe.py stream in a test pane, switch to another pane and type ECHO-RESPONSIVE while output continues. Output finishes intact; focus, settings and typing remain responsive. Change tab title repeatedly with the title mode while clicking/renaming tabs.

4. Run the alt-screen fixture. Exercise arrows, wheel/mouse, selection with Shift, resize and Ctrl+C. Invoke Recover Mouse Input from the menu and shortcut; verify ordinary typing/scrollback recovers only in that pane. Restart a shell while output is active and verify no old output leaks into the new session.
