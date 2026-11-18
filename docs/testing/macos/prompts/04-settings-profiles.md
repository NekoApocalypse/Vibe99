# Appearance, shortcuts and shell profiles

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Change font size, font family, pane width, opacity and background mask, including supported bounds. Check readable rendering and immediate updates; close/reopen settings without losing changes. Inspect color picker/custom pane colors and reset.

2. Edit a shortcut to a unique chord; use it, check conflicting bindings are handled, restore defaults, and verify defaults work. Test Cmd modifiers on macOS and input fields without shortcuts stealing typed text.

3. Open shell profiles. Detect local shells; create, edit, clone, rename, reorder, set default and remove disposable profiles. Round-trip quoted arguments with spaces using /bin/zsh -il and a harmless command profile. Switch one pane to bash and verify only that pane restarts.

4. Create a profile with a missing executable. Select it in a disposable pane; observe useful error, Retry and Use local shell recovery without freezing other panes. Confirm no Windows-only WSL discovery is required for macOS startup.
