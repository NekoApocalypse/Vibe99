# Native clipboard and image paste

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Copy selected terminal output using Cmd+C and context menu, then paste into a disposable input using Cmd+V, Ctrl+Shift+V and context menu. Include Unicode, spaces and multiline text. Verify each route inserts exactly once and bracketed paste does not auto-submit.

2. Run the OSC52 fixture to write the known CLIPBOARD-OSC52 marker, then paste into the test terminal and verify it. Check normal Ctrl+C still interrupts a process when no selection is present.

3. Open FIXTURES/sample.png in Preview, select/copy the bitmap, then paste into the test terminal using Cmd+V and Paste Image. Verify a quoted local PNG path, no Enter, no SSH requirement, and readable PNG bytes. Copying a file icon is not this test.

4. Cancel any target prompt and verify input remains untouched; repeat image paste after changing focus/closing the receiving test pane and ensure no insertion into another pane. Verify text-only paste works afterward.
