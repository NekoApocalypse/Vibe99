# Native Save As and snapshot fidelity

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Open Markdown and click Save As. Native dialog starts in Downloads with source name. Cancel; no file created. Save to FIXTURES/exports with a Unicode/space filename; compare bytes to the displayed UTF-8 snapshot.

2. Open PDF and image, save copies through the native dialog, and compare SHA-256 with sources. No recompression or format conversion. Reopen exported files to verify usability.

3. Overwrite only a disposable export, honoring native confirmation. Change the source while Save As is open; saved bytes must match the snapshot at click time. Try a non-writable destination if available; failure must be visible and original destination contents preserved.
