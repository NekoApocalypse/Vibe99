# Vibe99 0.10.3 — Click wrapped paths and URLs

agy's displayed paths can contain real newlines after hyphens. Vibe99 now reconstructs supported preview paths (Markdown, PDF and supported raster images) and HTTP(S) URLs, so either fragment opens the complete destination. The supplied-text fixture matched all six expected paths exactly, including the two-path continuation. A separate fix prevents stale destinations when an agent redraws just one row of a wrapped link.

The additional terminal link provider recognizes right-margin breaks and breaks after a hyphen, slash or backslash, preserves the separator, and uses the existing click interception and local/SSH file-opening route. Explicit terminal hyperlinks keep priority; Shift selection and first-click activation of inactive panes remain unchanged. The version-pinned xterm patch now invalidates links whenever a repainted row intersects them.

**Boundary:** reconstruction is an inference, limited to 32 rows / 16,384 cells and eight spaces of continuation indentation. A path prefix must precede the break. New URIs, absolute paths, list items, headings and complete file paths prevent joining. Deliberate adjacent tokens can still resemble a wrap; arbitrary breaks without a margin or separator cue are outside this fix.

**Evidence:**

- 25 unit tests and 38 Rust tests pass. The full app interaction suite and existing stale-link tests pass; Windows CI also runs the new regression tests.
- `scripts/test-terminal-wrapped-links.cjs` checks real clicks on both fragments, agy/margin/soft wrapping, partial-row redraws, Shift selection and no mouse-report leakage in both xterm bundles.
- The packaged Windows executable opened the correct local Markdown preview from real terminal process output. URL routing was verified in the browser harness; an external browser launch was not asserted. The supplied agy text was replayed as a fixture; a live remote agy session was not tested.

Logs: `artifacts/agy-sample-result.log`, `artifacts/wrapped-links-{unit,browser,cache}.log`, `artifacts/hard-wrap-review.log`, and `artifacts/release-0.10.3-{rust-tests.log,native-wrapped.json}`.

The stable launcher now targets the tested 0.10.3 build. SHA-256: `5a01ef3464370f7be32fee34c28c8e509aadc7dcf83b6ab6bab9253aaa533717`. Existing sessions were left running; relaunch to use the update.

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated subagent
- **Model**: inherited parent model
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9/10 | EASILY READABLE: 9/10
