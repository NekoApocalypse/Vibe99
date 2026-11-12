# Vibe99 0.10.4 — Whitespace-tolerant wrapped links

Wrapped Markdown/PDF/image paths and HTTP(S) URLs now tolerate display padding on either side of a recognized line break. This includes deep continuation indentation, padded soft wraps, and whitespace-only rows created when padding overflows. Hyphens and separators remain part of the target. The two supplied Gemini paths matched their complete expected destinations at five terminal widths.

Recognition still requires a margin or separator cue and a path prefix, and remains bounded to 32 rows / 16,384 cells. Intentional blank paragraphs stay separate. Quoted filenames with soft-wrapped spaces use the existing whitespace-preserving provider. This does not remove spaces globally or infer arbitrary line breaks. Click positions remain mapped to the original buffer cells; existing file-opening and mouse interception routes are unchanged.

Evidence:

- 28 unit tests and 38 Rust tests passed. `tests/terminal-wrapped-links.test.mjs` covers whitespace, quoted filenames and blank-paragraph boundaries.
- `scripts/test-terminal-wrapped-links.cjs` passed real clicks in both xterm bundles, including padded hard/soft wraps, overflow rows, redraws, Shift selection and no mouse-report leakage. [Windows](https://github.com/NekoApocalypse/Vibe99/actions/runs/43145328503) and [Linux](https://github.com/NekoApocalypse/Vibe99/actions/runs/43145328520) validation passed.
- The two reported Gemini paths were replayed with trailing padding and continuation indentation at 60/80/90/100/140 columns (`artifacts/gemini-sample.log`); a live remote Gemini session was not tested. CI metadata is saved in `artifacts/release-0.10.4-ci-validation.json`.
- The packaged Windows app opened the correct local preview by clicking a padded continuation in real terminal process output (`artifacts/release-0.10.4-native-wrapped.json`). Further evidence: `artifacts/padded-links-{unit,browser}.log` and `artifacts/release-0.10.4-{rust-tests.log,build.log,msi-verification.json}`.

On this laptop, the running app and taskbar/Desktop/Start menu shortcuts still used installed v0.8.1. Those three shortcuts now target the stable `artifacts/release/Vibe99/Vibe99.exe`; original shortcuts were backed up under `artifacts/shortcut-backups/`. The existing v0.8.1 process remains running, so relaunch is necessary to use the update. Shortcut evidence: `artifacts/release-0.10.4-shortcuts.json`.

Tested production SHA-256: `ffc81dd50b19940ef25da7eaef223fdaec0a6eef33a55ae933e9156176c9e2af`.

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated subagent
- **Model**: inherited unspecified
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 10/10 | EASILY READABLE: 9/10
