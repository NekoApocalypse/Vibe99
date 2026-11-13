# Vibe99 0.10.5 — Math footnotes after numbers

Markdown table entries such as `5.66e-1$^\dagger$` now render the superscript † instead of raw math text. The parser had rejected an opening dollar immediately after a digit. Removing that restriction also fixes adjacent double-dagger, letter and star markers, for both local and SSH previews.

The change is confined to `src/markdown-preview.js`. Math still requires delimiters; code blocks and escaped dollars remain literal. Existing whitespace and closing-dollar guards remain in place. Ambiguous dollar-delimited prose still follows the existing parser heuristics; this is not a general currency parser. Remote document contents and SSH transport were not changed by this work.

Evidence:

- `npm run test:preview` now checks rendered glyphs in numeric table cells through local and mocked SSH document loads, plus ordinary math, separate prefix/suffix currency examples, escaped dollars, unclosed math and literal code. The new numeric-cell assertion failed before the fix and passes after it (`artifacts/math-markers-before.log`, `artifacts/math-markers-after.log`).
- The production Windows app opened the user's actual remote document over SSH. All seven dagger glyphs in its current main table matched the source count; no raw math markers remained outside KaTeX's accessibility annotations, and its LaTeX code block stayed literal. The document had been edited concurrently to replace its double daggers with letters, so double-dagger coverage comes from the regression fixture. Evidence: `artifacts/test-native-math-0.10.5.cjs`, `artifacts/release-0.10.5-native-math.json`, and `artifacts/release-0.10.5-native-math.png`.
- The Windows production build succeeded (`artifacts/release-0.10.5-build.log`) and was staged at the stable shortcut target. Relaunch Vibe99 to use it; existing sessions were not stopped. Executable SHA-256: `b23bedd08133fc6f7c1a4db3bff2693b92b44226e8401ea252f13e0d85ba9d36`.

The regression test is committed; machine-specific native evidence is retained under ignored `artifacts/`.

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated Token-Zero subagent
- **Model**: inherited unspecified
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9/10 | EASILY READABLE: 9/10
