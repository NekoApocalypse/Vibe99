# A stable Windows taskbar shortcut

Pin `artifacts/release/Vibe99.lnk` to the Windows taskbar to launch the latest locally staged Vibe99 release. Its target stays at `artifacts/release/Vibe99/Vibe99.exe`; versioned GitHub packages and review builds remain separate.

Run `npm run release:local` on a Windows development machine with the normal Tauri build prerequisites. It builds the production app and refreshes the executable and shortcut. To stage an already built production executable, run `powershell -NoProfile -File scripts/stage-local-release.ps1 -SourceExe <path>`; its product name and version must match this checkout's `package.json`.

The script checks file hashes before switching the stable executable. It renames an existing executable so an already running window can continue on its current version. If Windows prevents that rename, the script fails without stopping the app; close that window and retry. New launches through the pin use the newly staged executable. Keep the checkout at the same location to preserve the pin.

This follows Owlet's local packaging model: it does not check GitHub or download updates at launch. Each local release must run the staging step. It uses the normal Vibe99 settings, does not change existing installed-app shortcuts, and does not pin anything automatically.
