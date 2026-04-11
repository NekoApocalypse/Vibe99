# Vibe99

Vibe99 is a desktop terminal workspace for agentic coding. It is built for the common case where one terminal needs full attention while several others only need peripheral visibility, so the UI keeps one pane readable and compresses the rest into narrow visible previews.

![Vibe99 demo](./artifacts/readme-demo.gif)

## What It Is

Vibe99 is a focus-first alternative to equal-sized tiled terminal layouts.

The product thesis is:

`focus + peripheral awareness`

Instead of giving every terminal the same weight, Vibe99 treats terminal attention as asymmetric:

- one pane is the active working surface
- the other panes stay visible as lightweight context
- tab color and ordering help build fast spatial memory across multiple agent or task contexts

The name is a reference to `Tetris 99`: you focus on your own board while still tracking many others around it.

## Current Prototype

This repository is an active Electron prototype, not a polished packaged app.

What already works:

- real PTY-backed terminal sessions via `@homebridge/node-pty-prebuilt-multiarch`
- `xterm.js` rendering inside the app window
- a horizontal deck layout with one focused pane and narrow preview panes
- add pane, close pane, focus pane, and drag-reorder tabs
- double-click rename for tabs
- navigation mode for fast focus switching
- live settings for font size, pane width, and pane opacity
- capture mode for generating a static prototype render

What is not finished yet:

- packaged desktop distribution
- persistent settings across restarts
- multi-window drag-out or drag-in workflows
- richer agent-aware state detection

## Why It Exists

Traditional tiled terminal layouts assume all panes deserve equal attention.

Agentic coding workflows usually do not work like that. One terminal is typically active, while the rest are being monitored. Vibe99 is designed around that asymmetry and tries to make multi-terminal work feel closer to browsing a deck than managing a grid.

## Quick Start

Contributor workflow notes live in [CONTRIBUTING.md](/Users/liyunyang/work_2025/vibe99/CONTRIBUTING.md).

Install dependencies and launch the prototype:

```bash
npm install
npm start
```

For a non-interactive captured render:

```bash
npm run capture
```

The capture script writes a PNG to your system temp directory:

```text
<temp>/vibe99-prototype.png
```

## Packaging

Cross-platform packaging is set up with Electron Forge:

```bash
npm run package
npm run make
```

`npm run package` creates an unpackaged app bundle for your current platform.

`npm run make` creates installable artifacts for your current platform:

- macOS: `.dmg` and `.zip`
- Windows: Squirrel installer output
- Linux: `.deb`, `.rpm`, and `.zip`

Signing and notarization are intentionally not configured yet.

## Changelog And Releases

Release notes are managed with Towncrier and explicit fragment files in [changes/README.md](/Users/liyunyang/work_2025/vibe99/changes/README.md).

This repo does not use issue-numbered changelog fragments. Every user-visible change should add a `+slug.type.md` file under `changes/`.

For a release:

1. Add and review the fragment files.
2. Build the changelog:

```bash
python3 -m pip install towncrier
python3 -m towncrier build --yes --version <version>
```

3. Commit the updated `CHANGELOG.md`.
4. Tag the release, for example `v0.2.0`.
5. Push the commit and tag to GitHub.

Pushing a `v*` tag triggers the GitHub release workflow in [.github/workflows/release.yml](/Users/liyunyang/work_2025/vibe99/.github/workflows/release.yml), which builds the macOS artifacts and publishes them with the matching `CHANGELOG.md` section as the release notes.

## Basic Controls

- `Cmd+T` on macOS or `Ctrl+T` elsewhere: add a pane
- `Ctrl+B`: enter navigation mode
- `Left` / `Right` or `H` / `L` in navigation mode: move focus
- `Enter` in navigation mode: focus the selected terminal
- double-click a tab: rename it
- drag a tab: reorder panes
- top-right `+`: add pane
- top-right gear: open display settings

## Stack

- Electron
- `xterm.js`
- `@xterm/addon-fit`
- `@homebridge/node-pty-prebuilt-multiarch`

## Status

The current preferred way to run Vibe99 is `npm start`.

The prototype already demonstrates the main interaction model, but packaging, persistence, and broader workflow support are still evolving. The repository should be read as an active product and UX exploration rather than a finalized desktop application.
