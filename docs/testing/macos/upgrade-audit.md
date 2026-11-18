# Installed-to-current compatibility audit

The installed Vibe99 bundle is Electron **0.4.0**, while the source checked out for this audit is Tauri **0.10.5** at `7fd19c3`. There are **171 commits** after tag `v0.4.0`. This suite tests the entire local product surface because the runtime, renderer host and packaging changed.

## Baseline evidence

The running binary was `…/out/Vibe99-darwin-arm64/Vibe99.app/Contents/MacOS/Vibe99`. Its Info.plist has CFBundleShortVersionString and CFBundleVersion 0.4.0. The adjacent source checkout says 0.4.2 at `950f0e4`; that is not evidence that the installed binary was updated. Preserve both. The new checkout was fetched from https://github.com/NekoApocalypse/Vibe99 and branched as `codex/macos-arm64`.

## Change-to-test mapping

| Updates since installed build | Local acceptance prompt |
| --- | --- |
| 0.4.1–0.4.4 Linux packaging; mac release suspension | 01 source installation; Linux-only changes outside scope |
| 0.4.5 clipboard routing, shell-exit cleanup | 02, 05, 12 |
| 0.5 Tauri rewrite, PTYs, editable profiles, session persistence, fonts, WebGL | 01–04, 06, 12 |
| 0.6 terminal UTF-8, clipboard/OSC52, links, colors, fullscreen | 02, 04–07 |
| 0.7/0.7.2 palette, MRU/spatial/nav keys, editable shortcuts, alerts, profile quoting, CJK | 02–06 |
| 0.7.3 bounded output, stale-session isolation, title races, startup recovery, mask migration, mouse recovery | 02–06, 12 |
| 0.8 Markdown/math/code/Mermaid/images, file context, refresh/retry, link cache | 07–09 |
| 0.8.1 middle-close and expanded diagrams | 03, 09 |
| 0.9 bitmap clipboard, inactive-pane click protection, URL clicks, expanded images | 05, 07, 09–10 |
| 0.10 Save As, PDF and image panes | 10–11 |
| 0.10.1 stable preview/terminal focus layout | 03, 08, 10 |
| 0.10.2 compact PDF toolbar | 10 |
| 0.10.3 wrapped link targets/continuation redraw | 07 |
| 0.10.4 padded and whitespace wraps | 07 |
| 0.10.5 numeric math with dagger/double-dagger | 08 |

Windows WSL discovery, SignPath/MSI, and Windows release shortcuts do not apply to macOS. Check that macOS controls do not advertise unusable WSL workflows. Browser-based upstream tests mostly inject a Windows mock bridge and cannot establish WKWebView or native macOS behavior.

## Explicitly deferred

SSH authentication/host keys, automatic connection discovery, remote file roots, SSH Markdown/PDF/images, remote image uploads, tmux over SSH, reconnect/heartbeat/helper cleanup, nested connections and ambiguous options. No server is available. Local tmux/TUI and local manual mouse recovery remain in scope when exercised by deterministic fixtures.

## Risks to validate

Ad-hoc codesigning and LaunchServices launch; actual arm64 Mach-O; macOS PATH and default directory; Cmd clipboard versus Ctrl signals; native menus; WKWebView WebGL/PDF workers; zsh/bash current directory changes; local context without Windows process APIs; native Save As and permissions; settings persistence across the Electron→Tauri data-directory boundary. Do not imply automatic migration of Electron settings until implemented and verified.
