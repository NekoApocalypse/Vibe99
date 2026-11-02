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

The next pointer movement queries the buffer again, even when it returns to the same cell. Existing active-link render handling is retained; the new listener covers rendering with no active link. Stable rows keep their cache, avoiding a full provider scan on every movement over blank cells. Vibe99 does not read private xterm fields from application code, synthesize pointer movements, delay clicks, or change terminal dimensions to work around the cache.

## Maintaining the patch

`scripts/patch-xterm-link-cache.cjs` runs on installation and before Vite builds. It pins xterm to 6.0.0 and verifies each original bundle's SHA256 before applying the change. It accepts its own already-patched output and rejects unexpected files or versions. The installed upstream source maps remain unchanged; the snippet above documents the additions to the compiled bundles.

Run `npm run test:link-cache` to verify the actual bundled behavior. When upgrading xterm, first verify that upstream handles the reproduction, then remove the patch and hooks together. Do not remove the regression test.
