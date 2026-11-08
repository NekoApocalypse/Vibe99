# Changelog

<!-- towncrier release notes start -->

## 0.10.2 - 2026-11-08

### Fixed

- Move PDF page and zoom controls into the existing document header beside Save As and Close, removing the second toolbar row.


## 0.10.1 - 2026-11-08

### Fixed

- Keep pane positioning stable when focus moves between a preview and a terminal. The pane stage cannot scroll independently of its layout, and document focus no longer requests browser scrolling.


## 0.10.0 - 2026-11-08

### Added

- Add Save As beside Close in Markdown previews. Local and SSH documents use the same native local save dialog, starting in Downloads with the source filename, and save the displayed Markdown snapshot as UTF-8.
- Open local and SSH PDF and raster image paths directly in ordinary preview panes. PDFs support page selection, zoom, and fit-to-width; images use the shared expand, zoom, and pan viewer. Save As exports the displayed file to a local destination, defaulting to Downloads.

### Misc

- Use xterm's public focus method in the renderer regression test to avoid browser scrolling of its hidden input, and run the UI suite on Windows main-branch validation.


## 0.9.0 - 2026-11-05

### Added

- Add a stable Windows release shortcut and local staging command, so a taskbar pin keeps launching the latest locally staged production build without replacing the pin.
- Expand Markdown images above all panes with the same zoom, pan, Fit, actual-size and keyboard controls as Mermaid diagrams. Expanded images remain stable while the document refreshes.
- Paste clipboard images into terminal tools as PNG attachments: local files are staged automatically, and simple SSH sessions upload images to the remote host before pasting its path, including inside tmux. Ctrl+V, Ctrl+Shift+V and the context menu share this behavior without submitting the prompt. Inactive panes consume the first click to focus, so links and Markdown paths open only from an active pane.

### Fixed

- Open terminal HTTP(S) URLs with a normal left-click, consistently with Markdown links. Consume link gestures before a remote TUI or tmux receives mouse reports; keep Ctrl-click working and Shift-click available for selection. Inactive panes still consume the first click to focus.


## 0.8.1 - 2026-11-03

### Added

- Middle-click terminal and Markdown tabs to close them using the normal cleanup rules. Mermaid diagrams can expand above all panes with wheel zoom, drag panning, Fit, actual size, and keyboard controls.


## 0.8.0 - 2026-11-03

### Added

- Open local and remote Markdown paths from terminal output as ordinary document panes, with code highlighting, math, Mermaid diagrams, local images, automatic refresh, and inline retry. New panes insert immediately after the source tab, then move and close independently using the existing pane layout and transparency settings. The MD button and command palette also accept a file path.
- Read remote Markdown through independent SSH file connections using existing noninteractive authentication and known hosts. Connections close with their document panes; heartbeat timeouts clean up disconnected remote helpers without installing a permanent server.
- Terminal file previews can infer an existing simple SSH connection from the owned Windows process tree. Complex or ambiguous connections request an explicit mapping instead of silently discarding SSH options.

### Fixed

- Fix stale link targets when terminal output replaces a hovered Markdown path or hyperlink while the pointer is outside the pane. Returning to the same row now resolves the current destination, including OSC8 links in SSH output.
- Recovering mouse input now suppresses leftover alternate-screen wheel arrows only in the affected pane. A confirmed local PowerShell prompt restores a leftover alternate screen without moving the cursor on ordinary prompts. External HTTP(S) links open without the unsupported dialog-confirm command. The complete intermittent sleep/tmux/agy scroll incident remains under investigation.

### Documentation

- Rewrite the README in a bilingual (EN/CN) format modeled after Owlet, and add a GitHub Pages site (`docs/`) with release and repository links for Google Search Console indexing.

### Misc

- Prepare SignPath Foundation onboarding with a public code signing policy and a manually dispatched Windows MSI signing and verification workflow. Production signing remains unavailable until Foundation approval and credential setup.


## 0.7.3 - 2026-11-01

### Fixed

- Frequent terminal title updates no longer interrupt tab clicks or renaming. Busy terminals now limit queued output so other panes stay responsive, and replaced shells cannot send stale output into their replacements.
- Keep WSL discovery off the application launch and native-shell paths. Discover distributions on request with a bounded background probe, retain usable controls and saved profiles during failure, and offer pane-local shell recovery. Constrain the header layout so its controls remain visible with long tab content.
- PowerShell prompts now recover mouse input after interrupted remote sessions. Other shells can use Recover Mouse Input from the pane menu or Ctrl+Shift+M; legacy mouse reporting and rendering after graphics context loss are also restored.
- Preserve the renderer's settings version when saving, preventing the background mask opacity migration from running again on every restart.
- Switch tabs immediately while preserving double-click rename, avoid redundant focus renders and shortcut-bar rebuilds, batch drag updates and resize measurements, and animate pane movement and activity alerts without repeated layout or shadow repaint work.
- Use the author's saved appearance preferences as shared frontend/backend defaults: 16 px font, 1210 px panes, 70% pane opacity, a 3% background mask, disabled activity alerts, and four starting panes. Preserve the activity-alert preference and migrate legacy opacity values once. Keep platform font fallbacks without bundling font files.


## 0.7.2 - 2026-05-02

### Added

- Added Ctrl+Left Arrow and Ctrl+Right Arrow shortcuts to switch between adjacent panes by spatial position. These shortcuts stop at boundaries (no cycling), complementing the existing cycling navigation.
- Added `Ctrl+Tab` to cycle to the most recently visited pane (browser-style). Hold `Ctrl` and press `Tab` again to step further back through pane history; add `Shift` to cycle in reverse.
- Added a color overlay on background panes to make foreground/background distinction obvious without dimming the terminal text; mask color and alpha are configurable in settings.
- Added font family selection in settings, allowing users to pick any installed monospace font.
- GitHub releases now publish Windows MSI and setup EXE artifacts alongside Linux RPM, AppImage, and DEB artifacts.
- Keyboard Shortcuts UI improvements (VIB-43):

  - Nav-mode shortcuts now display a "Nav" badge in the settings modal,
    making it clear they only work in navigation mode.
  - Fixed case display: single-letter keys (h, l, n, x, r) now show
    lowercase as intended, instead of uppercase (H, L, N, X, R).
  - Added missing action names and descriptions for all nav-mode
    customizable shortcuts (focus-first, focus-last, new-pane,
    close-pane, rename-pane).
  - Hidden non-customizable "jump-to" (1-9) shortcut from the settings
    modal, as digit-range bindings cannot be remapped.
  - Fixed close-pane shortcut: changed from `c` to `x` to match the
    intended navigation-mode key binding documented in the changelog.
- Navigation mode now displays mode-specific keyboard hints in the status bar. Press `Esc` to exit navigation mode and return focus to the source pane.
- Navigation mode now supports direct pane jumps with number keys, Home/End navigation, pane creation/close/rename actions, an in-app shortcuts help modal, close confirmation, numbered tab badges, and cleaner focus restoration when leaving navigation mode (VIB-33).
- Press Ctrl+Shift+O (Cmd+Shift+O on macOS) to open a command palette and jump to any pane by fuzzy-matching its tab title — arrow keys to move, Enter to focus, Esc to dismiss.
- Redesigned the shell profiles editor with a two-column profile list and editor, profile cloning, drag-and-drop ordering, clearer selected/drag/hover states, and compact sidebar controls while removing the redundant outer modal footer actions (VIB-36).
- Replaced the pane default color palette with Okabe-Ito-based divergent colors so adjacent panes are visually distinct across the full hue circle, with alternating luminance for stronger separation (VIB-41).
- Rewrote the app with Tauri 2 (Rust backend + vanilla JS frontend), replacing the previous Electron stack. The app now launches faster, uses significantly less memory, and produces native installers (.msi/.exe on Windows, .deb/.AppImage on Linux).
- Session state (pane layout, directories, shell profiles, tab titles) is now restored on app restart.
- Shell profiles are fully editable: users can create, modify, and switch profiles per pane via the right-click context menu. All profiles (auto-detected and user-created) support editing.
- Terminal rendering now uses the WebGL renderer for crisp, properly aligned box-drawing characters and better performance.
- WSL integration now auto-detects all installed distributions and creates a shell profile for each one. Distribution names are correctly decoded from UTF-16LE output.
- When a backgrounded pane has settled output you haven't seen yet, the mask now pulses with a brighter accent-tinted breathing glow that stays readable at any "BG mask opacity" value, and switching back to the pane stops it immediately. You can disable the alert globally from Settings → "Background activity alert", or per-pane via the tab context menu.

### Fixed

- Breathing light now cancels and restarts when new content arrives after the alert has fired. Resize-induced redraws still don't cancel the alert (consistent with VIB-29's resize quiet logic), so only genuine new content can dismiss the breathing animation.
- CJK characters now consume two cells in the terminal grid, matching what modern CLI apps (Claude Code, Ink-based UIs) assume. Lines with Chinese, Japanese, or Korean input no longer drift left when the app redraws after IME composition.
- Fixed toolbar settings button (gear icon) being visually lower than the other toolbar buttons (+tab, fullscreen). Changed `.tabs-actions` from `align-items: stretch` to `align-items: center`, and added `vertical-align: middle` + `line-height: 1` to all three icon buttons for consistent vertical alignment.
- Removed dead shell profile rendering code that was left after VIB-14 moved shell profiles to modal dialogs. The code referenced a non-existent `shell-profile-list` DOM element and was never called.
- Resizing the window no longer makes background panes pulse. The PTY redraw burst that follows a SIGWINCH was being treated as fresh output; it's now ignored until the pane has been silent for a beat, so even heavy multiplexer redraws (zellij, tmux) don't trip the alert.

### Documentation

- README Controls table now matches the actual key bindings: new pane is `Ctrl+N` (not `Ctrl+T`), and the command palette and copy/paste shortcuts are listed.

### Misc

- Added `scripts/bump-version.mjs` to synchronize version numbers across package.json, tauri.conf.json, and Cargo.toml from a single command.


## 0.7.1 - 2026-04-26

### Misc

- Updated changelog to cover the 0.6.0 and 0.7.0 releases.
- Improved README with new shortcuts and features.


## 0.7.0 - 2026-04-26

### Added

- Command palette for tab switching (VIB-16).
- Keyboard shortcut editing interface with configurable defaults.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` pane cycling.
- `Ctrl+Left` / `Ctrl+Right` spatial navigation between panes.
- Breathing mask pulse on backgrounded panes with settled output (VIB-8).
- Activity alert with global and per-pane toggles accessible from the pane context menu.
- Complex settings (shell profiles, keyboard shortcuts) moved to independent modal dialogs.

### Fixed

- Quotes are now preserved in shell profile arguments round-trip.
- BG mask opacity range extended to the full 0–1 range in both UI controls and settings sanitization.
- Removed dead shell profile rendering code from an incomplete refactoring.

### Misc

- Extracted command palette into its own module.
- Modularized keyboard shortcuts into separate files.


## 0.6.0 - 2026-04-25

### Added

- Custom pane colors — each pane can have its own accent color visible on the tab and mask overlay (VIB-10).
- Fullscreen toggle button in the toolbar.
- Color mask overlay on background panes using the pane accent color.
- Focused tab is filled with its theme color for better visibility.

### Fixed

- Terminal rendering glitches resolved with improved UTF-8 handling and batched writes per animation frame.
- Clipboard: normal copy/paste, Shift+selection for edit mode, and OSC52 support.
- Terminal links now open on click without a modifier key.
- Tab rename error handling and re-entrant render race condition.
- Race condition that could make keyboard input impossible in SSH sessions.
- Linux GitHub Actions build and local dev setup.
- Switched from deprecated `shell.open` to the opener plugin.


## 0.5.0 - 2026-04-25

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
