# Terminal links after output changes

Vibe99 patches xterm.js 6.0.0 so a link replaced while the pointer is outside the terminal cannot activate the previous destination when the pointer returns. Both the UMD test bundle and the ESM application bundle receive the same small fix.

## Reproduction and fix

Hover a Markdown path or OSC8 hyperlink, leave the terminal or move to a blank cell on the same row, overwrite that row with another hyperlink, wait for rendering, and return to the link. Upstream 6.0.0 can reuse cached provider replies and activate the old destination. No terminal reset or SSH failure is needed. An initially empty row can also retain an empty cached result after a link appears.

The equivalent change in `src/browser/Linkifier.ts` is:

```diff
+this._register(this._renderService.onRenderedViewportChange(() => {
+  if (!this._currentLink) {
+    this._activeLine = -1;
+    this._lastBufferCell = undefined;
+  }
+}));
 this._register(this._bufferService.onResize(/* existing handler */));
 this._register(addDisposableListener(this._element, 'mouseleave', () => {
   this._isMouseOut = true;
   this._clearCurrentLink();
+  this._activeLine = -1;
+  this._lastBufferCell = undefined;
 }));
```

The next pointer movement queries the buffer again, even when it returns to the same cell. Stable rows keep their cache, avoiding a full provider scan on every movement over blank cells. Vibe99 does not read private xterm fields from application code, synthesize pointer movements, delay clicks, or change terminal dimensions to work around the cache.

For active links spanning multiple rows, both the render listener and `_clearCurrentLink` now test range **intersection** (`link.start.y <= end && link.end.y >= start`), rather than requiring the entire link to fit inside the repainted rows. Redrawing only a continuation row must invalidate the complete target. The patch remains hash-verified and applies to both bundles.

## Application-inserted line breaks

`terminal-wrapped-links.mjs` adds a provider ahead of plain URL/file detection, while keeping explicit OSC8 hyperlinks authoritative. It reconstructs supported file paths and HTTP(S) URLs broken by CRLF/cursor-position redraws at the right margin (up to two padding cells and eight continuation-indent spaces), or at a trailing `-`, `/` or backslash used as a word-wrap boundary inside a target. The separator is preserved. It maps the complete target back to buffer cells and uses the existing mouse gesture interception, so clicking either fragment opens once without sending a mouse report to the TUI.

This is a bounded inference: maximum 32 rows / 16,384 cells, a path prefix before the inferred break, and no joining short rows without a separator, complete file paths, new absolute paths/URIs, headings or list items. Arbitrary newlines without either signal are not reconstructed. Terminal buffers cannot distinguish every deliberately adjacent token from a hard wrap; the provider deliberately limits that ambiguity to the margin and separators. Normal soft wraps keep their existing providers.

`npm run test:wrapped-links` exercises both bundles with real pointer clicks, both fragments, partial-row redraws and Shift selection. Unit tests cover continuation mapping and independent-row exclusions; the full app interaction suite covers soft and hard-wrapped documentation URLs.

## Maintaining the patch

`scripts/patch-xterm-link-cache.cjs` runs on installation and before Vite builds. It pins xterm to 6.0.0 and verifies each original bundle's SHA256 before applying the change. It accepts its own already-patched output and rejects unexpected files or versions. The installed upstream source maps remain unchanged; the snippet above documents the additions to the compiled bundles.

Run `npm run test:link-cache` to verify the actual bundled behavior. When upgrading xterm, first verify that upstream handles the reproduction, then remove the patch and hooks together. Do not remove the regression test.
