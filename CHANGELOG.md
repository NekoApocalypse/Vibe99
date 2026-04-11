# Changelog

<!-- towncrier release notes start -->

## 0.3.0 - 2026-04-11

### Fixed

- Display settings now persist across app restarts instead of resetting to the defaults every time Vibe99 launches.
- Right-click menus now work for terminals and tabs, and terminal copy and paste shortcuts follow the usual platform conventions.

### Misc

- Repository structure cleanup.


## 0.2.0 - 2026-04-11

### Added

- The first packaged macOS release is now available, with DMG and ZIP artifacts produced by Electron Forge.

### Fixed

- Closing the last application window now quits the app instead of leaving Vibe99 running in the background.
- Packaged builds now spawn terminal sessions correctly by using a prebuilt multi-architecture PTY dependency and unpacking its macOS helper binary.
