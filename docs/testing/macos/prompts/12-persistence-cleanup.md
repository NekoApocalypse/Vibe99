# Restart, persistence and final acceptance

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Set distinct titles/colors/order, local shell profiles, font/mask/alert preferences and working directories (including a space/Unicode path). Quit test app normally and relaunch from Finder. Terminal layout, profile, titles, colors, focus and directories return; no repeated opacity migration.

2. Confirm local preview panes are not restored. New pane inherits current directory as intended. Close test shells/last window and confirm owned PTYs terminate; reopen without orphaned sessions or dead UI.

3. Run unit/Rust/build checks after fixes. Build the production arm64 bundle with ad-hoc signing and repeat native launch, terminal, relative Markdown, PDF, clipboard and Save As smoke checks. Record executable hash, revision/configuration and all remaining limitations.

4. Update results.md per assertion. All local assertions must PASS before declaring success. Preserve original app/data; SSH cases stay DEFERRED, never PASS. If any required UI/tool capability is unavailable, record BLOCKED and keep the goal incomplete.
