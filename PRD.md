# PRD: Vibe99 Tauri Migration

## Goal
Migrate Vibe99 from Electron to Tauri v2, keeping all existing functionality while dramatically reducing app size and memory usage.

## Background
Vibe99 is a desktop terminal workspace for agentic coding. Current stack: Electron + xterm.js + node-pty. The codebase is ~2100 lines — small enough for a clean migration.

## Non-Goals
- No new features. Feature parity only.
- No UI redesign. Keep the same layout and interaction model.

## Architecture

### Frontend (keep as-is, minimal changes)
- `src/index.html` — unchanged
- `src/styles.css` — unchanged
- `src/renderer.js` — replace `window.vibe99.xxx` calls with `window.__TAURI__.invoke('xxx', ...)`

### Backend (Electron → Rust)
- `electron/main.js` → `src-tauri/src/main.rs` + `src-tauri/src/pty.rs`
- `electron/preload.js` → eliminated (Tauri handles this)
- `electron/pty.js` (node-pty) → `portable-pty` crate

### IPC Mapping

| Electron IPC | Tauri Command |
|---|---|
| `vibe99:terminal-create` | `terminal_create(pane_id, cols, rows, cwd)` |
| `vibe99:terminal-write` | `terminal_write(pane_id, data)` |
| `vibe99:terminal-resize` | `terminal_resize(pane_id, cols, rows)` |
| `vibe99:terminal-destroy` | `terminal_destroy(pane_id)` |
| `vibe99:window-close` | `window.close()` (frontend) |
| `vibe99:settings-load` | `settings_load()` |
| `vibe99:settings-save` | `settings_save(settings)` |
| `vibe99:show-context-menu` | Tauri menu API |
| `vibe99:terminal-data` (push) | Tauri event `terminal-data` |
| `vibe99:terminal-exit` (push) | Tauri event `terminal-exit` |
| `vibe99:menu-action` (push) | Tauri event `menu-action` |

## Tasks

### Phase 0: Project Setup
- [ ] P0.1: Initialize Tauri v2 project in `src-tauri/`
- [ ] P0.2: Configure Cargo.toml with dependencies (portable-pty, tauri plugins)
- [ ] P0.3: Configure tauri.conf.json (window size, app metadata)

### Phase 1: Core PTY Backend
- [ ] P1.1: Implement PTY manager in Rust (spawn, write, resize, kill)
- [ ] P1.2: Implement Tauri commands for terminal CRUD
- [ ] P1.3: Implement Tauri event emission for PTY data/exit
- [ ] P1.4: Test PTY lifecycle (spawn → write → resize → kill)

### Phase 2: Frontend Migration
- [ ] P2.1: Replace Electron bridge with Tauri invoke calls in renderer.js
- [ ] P2.2: Replace Electron event listeners with Tauri event listeners
- [ ] P2.3: Adapt clipboard API (Tauri clipboard plugin)
- [ ] P2.4: Adapt context menu (Tauri menu API or frontend-only)
- [ ] P2.5: Verify xterm.js works in Tauri WebView

### Phase 3: Settings & Persistence
- [ ] P3.1: Implement settings load/save using Tauri fs/path plugins
- [ ] P3.2: Migrate settings.json format

### Phase 4: Polish & Distribution
- [ ] P4.1: App icon configuration (PNG for Linux, ICO for Windows)
- [ ] P4.2: macOS dock integration
- [ ] P4.3: Remove all Electron dependencies from package.json
- [ ] P4.4: Test on Linux, verify keyboard shortcuts work
- [ ] P4.5: Build and package for distribution

## Key Dependencies (Rust)
- `portable-pty` — cross-platform PTY
- `tauri` v2 — app framework
- `tauri-plugin-clipboard-manager` — clipboard
- `tauri-plugin-fs` — file system
- `tauri-plugin-shell` — shell operations (if needed)
- `serde` / `serde_json` — serialization
- `tokio` — async runtime for PTY event loop

## Key Dependencies (Frontend, unchanged)
- `@xterm/xterm`
- `@xterm/addon-fit`
- `@xterm/addon-web-links`

## Acceptance Criteria
- [ ] All terminal operations work: create, write, resize, destroy
- [ ] Multiple panes with independent PTY sessions
- [ ] Tab management: add, rename, reorder, close
- [ ] Settings persistence
- [ ] Context menu (copy/paste/select all)
- [ ] Keyboard shortcuts (Ctrl+T, Ctrl+B navigation)
- [ ] App builds successfully on Linux
- [ ] Binary size < 20MB

Backpressure: `cd /cluster/yar/projects/vibe99 && cargo tauri build 2>&1 | tail -1 | grep -q "Finished"`
