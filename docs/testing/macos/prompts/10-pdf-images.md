# PDF and raster image panes

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Open sample.pdf through a terminal link and File button. Both pages render text and colored rectangles. Use Next/Previous, page number, zoom and Fit width; invalid/out-of-range page input is bounded. Controls share the document header with Save As and Close.

2. Resize/reorder/focus PDF panes and switch to terminals repeatedly; layout remains stable. Open malformed PDF and oversized media fixture; useful inline errors and retry, no crash or runaway canvas.

3. Open sample.png and sample.jpg if provided. Verify fit, natural aspect ratio, expand/zoom/pan, keyboard expansion and close. Missing/invalid images show an error. Multiple PDF/image/Markdown panes remain independent.
