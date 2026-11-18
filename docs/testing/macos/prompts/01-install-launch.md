# Installation and launch

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Confirm uname -m is arm64; inventory Node (22.13+), stable Rust and Xcode Command Line Tools. Build with locked npm/Rust dependencies and no Apple credentials. Record exact commands and any prerequisite steps.

2. Build the isolated app using scripts/tauri-macos-test.conf.json. Inspect executable architecture, Info.plist identifier/version, and codesign verification. Launch the bundle from Finder, not a dev server. Four live local shell panes must appear without a blank window, startup error or Developer ID requirement.

3. In a new test shell run uname -m, printf MAC-LAUNCH-OK, pwd, and command -v git. Verify output, native architecture and usable shell environment. Toolbar remains reachable at the minimum window size.

4. Check native app menu, About/version, window close and relaunch, and Cmd+Q. Final production build must also pass launch, terminal output and one local file preview. Preserve the existing 0.4.0 installation.
