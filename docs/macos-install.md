# Install Vibe99 on Apple Silicon

Vibe99 is a terminal workspace for running several coding agents. Mac users can build an arm64 app locally with an ad-hoc signature, without an Apple Developer account. A coding model can run the commands or guide you through them in Terminal. Open the result in Finder yourself or use a model with computer use for the visual checks. The installed app runs independently. SSH validation is deferred; see the [local acceptance results](testing/macos/results.md) for what has actually passed.

## Prompt for your coding agent

If your download is `Vibe99-mac-update.zip`, give the ZIP and its `START-HERE.md` to your agent. It identifies the exact public checkout and where to copy the update files before building.

> Install the supplied Vibe99 source on this Apple Silicon Mac. If I supplied a source ZIP, extract it into a new folder and use that checkout. Otherwise clone https://github.com/NekoApocalypse/Vibe99 into a new folder and use its main branch, or check out the revision I specified. Read AGENT.md and docs/macos-install.md. Check native arm64 Node.js 22.13+ (Node 22 recommended), stable arm64 Rust and Xcode Command Line Tools. Install missing prerequisites from their official sources, letting me handle any OS/password/license prompts. From the directory containing package.json, run `bash scripts/build-macos.sh --install`. Preserve any existing app and settings. Do not request an Apple Developer account, notarization credentials, or disable Gatekeeper. Launch the resulting app from Finder, verify a real local shell, Cmd+N, and local Markdown/PDF previews. Report the exact revision, app path and any failures. Do not claim the computer-use suite passed unless you run every assertion in docs/testing/macos/prompts.

## Prerequisites and build

Use a native terminal (`uname -m` must print `arm64`). Install [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/) with `xcode-select --install` if missing. Full Xcode is unnecessary. Install native [Node.js](https://nodejs.org/en/download) 22.13+ and [stable Rust](https://www.rust-lang.org/tools/install). Restart your terminal so `node`, `npm`, `cargo` and `rustc` are on PATH. Homebrew is optional.

```sh
# In the extracted source folder or the checkout containing this guide:
bash scripts/build-macos.sh --install
```

The script installs locked npm dependencies, builds the locked Rust graph for `aarch64-apple-darwin`, ad-hoc signs, verifies, and copies the app to `~/Applications/Vibe99.app`. It refuses to replace an existing app. Omit `--install` to build only; the bundle is at `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Vibe99.app`. Launch from Finder. Keep the checkout for updates; Node/Rust are build tools, not runtime dependencies.

No paid account or signing certificate is used. [Tauri documents ad-hoc signing](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing) using `-` as the signing identity. This does not notarize a downloaded binary. The supported no-account route is to build from source on the recipient's Mac. If sharing a prebuilt app, the recipient may need the per-app **Open Anyway** action in macOS Privacy & Security after verifying its source; never disable Gatekeeper globally. That downloaded-app route is separate from the locally built acceptance result.

## Updates and existing Electron installs

Quit the app normally before replacing its bundle. Build the new revision first, verify it, move the previous bundle aside as a rollback copy, then copy the new one into the same location. Do not delete application data. This source uses Tauri; the old Electron 0.4.x bundle can remain in its original location. Their macOS settings directories differ (`~/Library/Application Support/com.vibe99.app` for Tauri, versus Electron's product-name directory). Automatic import of Electron preferences is not implemented. Recreate desired preferences in the new app; the original remains untouched.

macOS may ask again for Documents/Desktop/Downloads folder access after an ad-hoc rebuild because its code signature changes. Respond to the normal system folder prompt yourself. A restored shell whose working directory is protected can wait for that response before displaying a prompt. Full Disk Access is not an installation requirement; do not grant it as a workaround. Test fixtures can also live in `/tmp` while a folder decision is pending.

## Isolated testing

```sh
npm ci
npm run tauri:build -- --debug --bundles app --config scripts/tauri-macos-test.conf.json
node scripts/macos-test-fixtures.cjs
```

Open `src-tauri/target/debug/bundle/macos/Vibe99 Mac Test.app` and follow [the computer-use suite](testing/macos/README.md). It uses identifier `com.vibe99.mac-test` and separate settings. A successful compile alone does not establish compatibility. Current validation is on macOS 26.2 arm64; older OS versions require their own acceptance run.
