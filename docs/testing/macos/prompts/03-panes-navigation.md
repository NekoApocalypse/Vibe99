# Pane lifecycle, navigation and layout

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Create panes with + and Cmd+N. Double-click rename to MAC Alpha, MAC Beta and MAC Gamma. Switch via tab, visible background pane, Ctrl+Tab and reverse, adjacent navigation, and Cmd+Shift+O fuzzy palette. Verify focus and MRU order, no accidental terminal keystrokes, and boundary behavior.

2. At a shell prompt, verify Ctrl+B moves the cursor back. In an isolated tmux session using its default prefix, press Ctrl+B then C and verify tmux creates a window. Enter Vibe99 navigation mode with Cmd+Shift+B. Test H/L, arrows, digits, Home/End (Fn equivalents allowed), N, R, X, Enter and Escape. Verify close confirmation cancel/confirm, source focus restoration on cancel, numbered tabs and contextual hints.

3. Drag terminal/document tabs to reorder; focus previews then terminals repeatedly. The stage must not scroll independently or shift unpredictably. First click on an inactive document control or terminal link only focuses it; the second activates.

4. Close foreground and background disposable tabs with middle click, context menu and document Close. Background close preserves focus; last-pane protection works. Resize window at minimum and larger sizes, toggle fullscreen and back; all toolbar controls remain reachable.
