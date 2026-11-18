# macOS arm64 acceptance tests

This suite validates Vibe99’s local desktop features on Apple Silicon using the actual packaged app and computer-use tools. It covers the migration from the installed Electron 0.4.0 build to Tauri 0.10.5, so a friend can build and install without an Apple Developer account. SSH is explicitly deferred and is not a passing local test.

## Run protocol

Read `upgrade-audit.md`, then execute every prompt in numerical order. Use `scripts/tauri-macos-test.conf.json` to isolate settings and avoid stopping the user's old app. Generate fixtures with `node scripts/macos-test-fixtures.cjs`. Resolve the printed fixture directory to an absolute path, called FIXTURES below. Use only disposable shells/files created for this suite. Never paste a command into an existing user session.

Use native computer-use interaction for the app: click, type, keys, scroll, drag, native dialogs, and observe screenshots/accessibility state after actions. Shell tools may build, prepare fixtures, and corroborate files/process cleanup. Mocked renderer tests, source inspection and direct backend calls do not replace native UI evidence. Do not use privileged UI scripting as a substitute for an unavailable computer-use tool.

For every numbered assertion record PASS, FAIL, BLOCKED, or NOT RUN, the action and observed result, build revision and configuration, macOS version/architecture, and evidence. A whole prompt passes only when every assertion passes. A failed test must be rerun after a fix, along with affected regression tests. Never turn a missing test server, inaccessible UI, or unexercised case into PASS. Store local captures/logs under `artifacts/macos-test/`; keep a concise, non-sensitive result ledger in `results.md`.

## Completion gate

All local prompt assertions pass on a packaged arm64 build; the production bundle also launches with a real PTY and previews. Installation documentation uses ad-hoc signing/local builds, no paid account, global Gatekeeper changes, or blind remote shell pipelines. Closing/reopening retains intended settings and directories. The old installation and its data remain intact. Record deferred SSH tests separately.

## Copyable coordinator prompt

> Make Vibe99 work on this Apple Silicon Mac without an Apple Developer account. Read `docs/macos-install.md` and `docs/testing/macos/README.md`. Build the isolated test bundle, generate fixtures, and run every prompt under `docs/testing/macos/prompts/` through native computer use. Fix failures and rerun affected cases until all local assertions pass. Keep `results.md` honest and attach evidence. Preserve existing sessions and data. Do not test or configure SSH; track it as deferred. Then build and smoke-test the production app and give me its path and installation instructions.
