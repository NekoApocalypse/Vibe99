<p align="center">
  <img src="./assets/icons/icon.png" alt="Vibe99 icon" width="128" height="128">
</p>

<h1 align="center">Vibe99</h1>

<p align="center">
  Desktop terminal workspace for agentic coding.
</p>

Vibe99 is a Tauri desktop terminal workspace for agentic coding. It is built for the common case where one terminal needs full attention while several others only need peripheral visibility, so the UI keeps one pane readable and stacks the rest so you can still see what agents are doing.

![Vibe99 demo](./artifacts/readme-demo.gif)

## Quick Start

Install dependencies and start the Tauri dev app from this repository:

```bash
npm install
npm run tauri:dev
```

`npm run tauri:dev` starts Vite on `http://localhost:1420` and then launches the native Tauri shell. If Cargo is too old, update Rust with:

```bash
rustup update stable
```

Build release artifacts with:

```bash
npm run tauri:build
```

## Features

- **Custom pane colors** — each pane can have its own accent color for quick visual identification.
- **Activity alerts** — backgrounded panes with settled output show a pulsing breathing mask, with global and per-pane toggles.
- **Command palette** — quick tab switching via a searchable palette.
- **Configurable shortcuts** — keyboard shortcuts can be edited in the settings modal.
- **Session restore** — pane layout, directories, shell profiles, and tab titles are preserved across restarts.
- **WSL integration** — discover installed distributions on request in Settings → Shell Profiles → Discover WSL. Startup and local shells never wait for discovery.
- **Font selection** — pick any installed monospace font from settings.

## Controls

| Shortcut | Action |
|---|---|
| `Cmd+N` / `Ctrl+N` | Add a new pane |
| `Ctrl+Tab` | Cycle to the most recently visited pane (add `Shift` to reverse) |
| `Cmd+Shift+O` / `Ctrl+Shift+O` | Open the command palette (jump to any pane) |
| `Ctrl+Left` / `Ctrl+Right` | Spatial navigation between panes |
| `Ctrl+B` | Enter navigation mode (`H`/`L` or arrows to move, `Enter` to focus) |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / paste in the focused terminal |
| `Ctrl+Shift+M` | Recover mouse input after an interrupted terminal application |
| double-click tab | Rename it |
| drag tab | Reorder panes |
| top-right `+` | Add a pane |
| top-right gear | Open display settings |

Shortcuts are configurable from the gear menu → Keyboard Shortcuts.

If clicks or scrolling print escape sequences after an SSH disconnect, choose
**Recover Mouse Input** from the pane or tab context menu, or press
`Ctrl+Shift+M`. This keeps the screen and scrollback intact. Ordinary interactive
PowerShell profiles recover automatically when the local prompt returns; custom
profiles that launch a script or command can use the manual action. Existing
PowerShell profile files are not modified. Mouse modes are preserved when merely
switching windows or resuming a surviving remote session.

Run `npm test` for stream regression tests and `npm run test:ui` for browser
interaction tests. The latter uses Edge on Windows; on other platforms install
Chromium with `npx playwright install chromium` first. Rust tests run with
`cargo test --manifest-path src-tauri/Cargo.toml --lib`.

`npm run tauri:build:review` builds **Vibe99 Review** with its own application
identity and settings. On Windows, run
`node scripts/test-native-terminal.cjs src-tauri/target/release/vibe99.exe`
against that build to exercise ordinary startup without a shell override, visible
header controls, bounded WSL discovery, real PTY recovery, flow control, process
exit, and session replacement. The PowerShell
prompt hook can also be checked with `node scripts/test-powershell-integration.cjs`.

WSL discovery runs on a background worker with a three-second process deadline.
It only lists distributions; it never starts Linux to query the guest shell or
depends on Windows PATH entries inside Linux. Selecting a discovered profile
saves its distribution and lets WSL launch that distribution's default shell.
Discovery errors preserve saved profiles and existing panes. An explicitly
selected shell that fails stays in its pane with **Retry** and **Use local shell**
actions. A shell that has not produced output after three seconds offers the
same actions; the application remains usable while it starts.

Run `node scripts/benchmark-ui.cjs` for a repeatable renderer performance sample:
eight panes with 5,000 lines each, repeated focus operations, animated pane
switches, and background activity alerts. It reports click latency, layout work,
and paint events. An optional output filename saves the measurements as JSON.
Compare runs on the same machine; these timings are diagnostics, not CI limits.

## Platform Defaults And Known Issues

- Shared project defaults live in `src/default-settings.json`: 16 px text, 1210 px panes, 70% pane opacity, a 3% background mask, activity alerts off, and four starting panes. Review builds use the same defaults with a separate settings identity. Existing user preferences take precedence.
- Terminal font defaults are platform-aware: `Consolas` on Windows, `Menlo` on macOS, and `DejaVu Sans Mono` on Linux.
- WSL integration is available on Windows and is a no-op on macOS/Linux.
- Known issue: the native macOS title bar can remain light while the system is in dark mode. See [issue #28](https://github.com/NekoApocalypse/Vibe99/issues/28).

## Stack

- Tauri 2
- Vite
- Rust
- `portable-pty`
- `xterm.js`
- `@xterm/addon-fit`
- `@xterm/addon-web-links`
- `@xterm/addon-webgl`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Code signing policy

Windows code signing is being prepared through SignPath Foundation; approval is
pending and v0.7.3 and earlier Windows releases are unsigned. See the
[Code signing policy](./CODE_SIGNING.md) for scope, maintainer roles, and privacy.
