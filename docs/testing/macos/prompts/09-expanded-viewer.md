# Expanded Mermaid and images

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Expand Mermaid from notes.md. It appears above all panes. Test wheel zoom at pointer, drag pan, Fit, percentage actual size, double-click fit, +/-, arrows, 0, 1 and Escape.

2. Tab through viewer controls; focus stays inside. App pane shortcuts must not create or switch panes while the viewer is open. Closing restores document focus.

3. Expand the local Markdown image with click and keyboard Enter/Space. Repeat zoom/pan controls. Modify the source image/document while expanded; snapshot stays stable until reopened. While expanded, verify that underlying document controls cannot take focus. Close the viewer, navigate to another local file, and verify its content and controls. With a viewer open, close its owning window through the native close button and reopen the app; no orphaned viewer should remain. Also run npm run test:diagrams for the renderer-only case of an owning document changing location programmatically while its modal is open. Record those results separately.
