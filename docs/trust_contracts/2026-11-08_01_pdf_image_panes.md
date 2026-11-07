# Vibe99 0.10.1 — PDF and image panes

Click a local or SSH PDF or raster image path to open it in an ordinary pane, immediately beside the source pane. PDFs have page selection, zoom and Fit width; images expand above all panes with the existing zoom/pan controls. Dragging, stacking, inactive-pane focus and closing follow the same rules as Markdown.

This release also includes **Save As…** beside Close for Markdown, PDFs and images. The native local dialog starts in Downloads. It saves the loaded snapshot, so an already-loaded remote file remains exportable after disconnection. PDF/image bytes are preserved exactly; Markdown stays UTF-8 with its existing line endings, without restoring a stripped byte-order mark or bundling linked assets.

**Limits:** PDF/image files are capped at 16 MiB; Markdown remains capped at 4 MiB. Supported images: PNG, JPEG, GIF, WebP, AVIF and BMP. PDFs display one page at a time, without password support, text selection/search, forms or link actions. SVG files are excluded. Standalone images above 100 megapixels are rejected after decoding.

The existing file reader carries the bytes over its existing local/SSH route. PDF.js loads only when a PDF opens; its worker, fonts and decoders are bundled locally. Canvas allocation is bounded, and navigation/close releases the owned renderer. No extra terminal, persistent server, or special pane layout was added. Preview focus also avoids browser scrolling, and the pane stage cannot scroll independently of its layout; the full interaction suite passes locally and in Windows CI.

**Evidence:** 38 Rust, 20 JavaScript and 10 Python tests passed, plus document, media, pane, terminal-link and expanded-view browser regressions. The packaged review app passed real local/SSH PDF navigation and image zoom/pan; native PDF Save As matched the source bytes. The exact staged production executable then passed PDF/image smoke tests, and MSI extraction verified version and product metadata. Evidence lives in `artifacts/0101-review.log`, `artifacts/release-0.10.1-ci-validation.json`, `artifacts/media-*.log`, `artifacts/review12-native-media.json`, `artifacts/review12-save-results.json`, `artifacts/release-0.10.1-{rust-tests.log,build.log,production.json,msi-verification.json}`. Relevant tests: `scripts/test-media-preview.cjs`, `scripts/test-native-media.cjs`, `remote/test_bridge.py`, and `src-tauri/src/workspace.rs`.

The Windows installers are prepared for publication. `artifacts/release/Vibe99.lnk` now targets the staged production 0.10.1 executable; existing sessions were left running. Production SHA-256: `334ec9bc80aa5569ca17b85a889aa6bb91a5c08812acbe71430d326a16b54ce4`.

---

## Subagent Review Sign-Off

- **Review Harness**: Codex isolated subagent
- **Model**: inherited parent model
- **Verdict**: TRUST & EASILY READABLE
- **Scores**: TRUST: 9/10 | EASILY READABLE: 9/10
