# Markdown rendering, refresh and errors

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Open notes.md. Visually verify headings, lists, table, highlighted code, inline/display math, numeric dagger/double-dagger table cells, Mermaid diagram and local image. Raw HTML/script must stay inert and remote images must not load.

2. Click local Markdown links and anchor links; verify correct document/navigation behavior. Scroll the long fixture, update it from another test shell, and verify refresh after polling without unnecessary jumps or focus loss.

3. Open a missing file; observe inline error. Create it and Retry; content appears. Rename/remove a currently viewed disposable file and restore it, then retry. Verify wrong encoding/oversized Markdown errors leave the UI responsive.

4. Close source terminal while keeping preview; document continues working. Close preview and verify no lingering worker/refresh errors. Document previews are intentionally not restored at next startup.
