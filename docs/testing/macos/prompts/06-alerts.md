# Background alerts and busy-pane behavior

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. Enable global activity alerts. Start delayed output in a pane and focus another. Once output settles, observe breathing accent; focusing that pane clears it. Start fresh output and verify the alert restarts only after output settles.

2. Disable activity alerts per-pane and globally and repeat; verify suppression. Resize/fullscreen without new output must not create spurious alerts.

3. Produce a long title and high output in one pane; click other tabs, rename, open settings and create/close a test pane. No lost clicks, clipped toolbar, stale output or hanging UI. Restore chosen test preferences.
