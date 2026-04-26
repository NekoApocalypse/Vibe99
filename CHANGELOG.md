# Changelog

<!-- towncrier release notes start -->

## 0.5.0 - 2026-04-25

### Bug Fix

- Extended BG mask opacity range from 0–0.8 to the full 0–1 range in both UI controls and settings sanitization.

### Added

- Rewrote the app with Tauri 2 (Rust backend + vanilla JS frontend), replacing the previous Electron stack. The app now launches faster, uses significantly less memory, and produces native installers (.msi/.exe on Windows, .deb/.AppImage on Linux).
- WSL integration now auto-detects all installed distributions and creates a shell profile for each one. Distribution names are correctly decoded from UTF-16LE output.
- Shell profiles are fully editable: users can create, modify, and switch profiles per pane via the right-click context menu. All profiles (auto-detected and user-created) support editing.
- Session state (pane layout, directories, shell profiles, tab titles) is now restored on app restart.
- Added font family selection in settings, allowing users to pick any installed monospace font.
- Terminal rendering now uses the WebGL renderer for crisp, properly aligned box-drawing characters and better performance.

### Misc

- Added `scripts/bump-version.mjs` to synchronize version numbers across package.json, tauri.conf.json, and Cargo.toml from a single command.


## 0.4.5 - 2026-04-20

### Fixed

- On Windows, Codex and Typeless paste now route text and image paste correctly, the launched app uses the correct icon, and tabs close automatically when their terminal process exits.
- Windows local packaging now produces a self-contained portable Electron Builder build while keeping macOS and Linux npm workflows unchanged.


## 0.4.4 - 2026-04-13

### Fixed

- Restored Linux `.deb` release packaging in the GitHub release workflow while keeping the fixed AppImage packaging path.


## 0.4.3 - 2026-04-13

### Fixed

- Fixed Linux release packaging so the published AppImage launches correctly and the GitHub release workflow ships the portable Linux artifacts by default.


## 0.4.2 - 2026-04-13

### Fixed

- Linux release builds now use a Forge-compatible AppImage maker implementation instead of the outdated adapter that failed during `npm run make`.


## 0.4.1 - 2026-04-13

### Added

- Linux releases now publish an AppImage alongside the `.deb` and `.zip`, while macOS release artifacts are paused until signing and notarization are worth the cost.


## 0.4.0 - 2026-04-13

### Added

- Linux releases now include a `.deb` package built in GitHub Actions, making Ubuntu and Debian installs part of the standard release flow instead of a local-only packaging path.

### Fixed

- Linux development runs and packaged builds now restore the PTY native module correctly under Electron 36, fixing the startup crash that was falling back to a missing `build/Release/pty.node` binary.
- Native runtime preparation no longer uses a shared temporary Electron ABI probe file, preventing concurrent `npm run` flows from failing with a missing-module error during startup or packaging.
- Terminal panes now detect web links and open them on modifier-click, preserving normal click and selection behavior for non-activated links.
- Vibe99 now ships with the new branded application icon across packaged app assets and installer output.

### Misc

- Local packaging commands now fail fast on unsupported Node versions, and the repo pins Node 22 so macOS release builds use a known-good toolchain.


## 0.3.0 - 2026-04-11

### Fixed

- Display settings now persist across app restarts instead of resetting to the defaults every time Vibe99 launches.
- Right-click menus now work for terminals and tabs, and terminal copy and paste shortcuts follow the usual platform conventions.

### Misc

- Repository structure cleanup.


## 0.2.0 - 2026-04-11

### Added

- The first packaged macOS release is now available, with DMG and ZIP artifacts produced by Electron Forge.

### Fixed

- Closing the last application window now quits the app instead of leaving Vibe99 running in the background.
- Packaged builds now spawn terminal sessions correctly by using a prebuilt multi-architecture PTY dependency and unpacking its macOS helper binary.
