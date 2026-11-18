# macOS arm64 acceptance results

Vibe99 0.10.5 builds locally on Apple Silicon without an Apple Developer account. All 44 assertions across the 12 local computer-use prompts passed, including the installed production smoke test. SSH is deferred.

## Builds and scope

- Public base `7fd19c3` is 171 commits ahead of the installed Electron 0.4.0 tag. The original Electron app and its data were preserved.
- Native checks used macOS 26.2 arm64, Node 22.22.2, Rust 1.95.0 and packaged WKWebView apps. The isolated bundle uses `com.vibe99.mac-test`. Fixes were rechecked in the packaged app, followed by a smoke test of the installed executable identified below.
- The earlier production bundle installed with `bash scripts/build-macos.sh --install`. Finder launch, real PTY, relative Markdown/PDF, clipboard and Save As worked. Its executable SHA-256 is `bd65b812c5bbdeb4d45266ab3840b47ada2b74db0ce8cc605440ce65ad6a8e53`.
- The final production candidate passed `bash scripts/build-macos.sh`, including a clean locked npm install, locked Rust build and strict signature verification. Its identifier is `com.vibe99.app`, version 0.10.5, signature ad-hoc, with no team identifier. Executable SHA-256 is `e8843ffd9488dc512346a92edfaa8c752b60d75a82b0629865f3e2c591a4b5b7`. After the user quit the previous app, installed this executable, preserved the previous bundle for rollback and launched the installed copy from Finder.
- Local test artifacts are private and excluded from the friend update kit. The README demo uses the real renderer with a fixed synthetic workspace, fictional PTY output and the project icon. It is separate from the native test evidence.

## Results by assertion

| Prompt | Result | Observations |
| --- | --- | --- |
| 01.1 | PASS | Checked arm64, native Node/Rust and Command Line Tools. The documented build script completed without signing credentials. |
| 01.2 | PASS | Isolated arm64 Mach-O and bundle identifier/version verified. The app launched from Finder; the fresh workspace had four live local shells. |
| 01.3 | PASS | The packaged shell printed arm64, MAC-LAUNCH-OK, the fixture cwd and a git executable. Add, File and Settings were reachable at minimum width. |
| 01.4 | PASS | Native menu, About 0.10.5 (0.10.5), normal Cmd+Q, last-window close and Finder relaunch passed. Finder launched the final installed production bundle. Its local PTY and relative document previews passed as recorded under 12.3. |
| 02.1 | PASS | Bash and zsh accepted printable input, Enter, history/arrows, Backspace, Tab completion, Ctrl+A/E/U, Ctrl+C and Ctrl+D. Both resolved a unique filename and produced ABC after inserting B with Ctrl+B. EOF closed each disposable shell; other panes stayed usable. |
| 02.2 | PASS | Box drawing, CJK, emoji and mixed-text editing rendered correctly. In a raw PTY, native Option+E pre-edit sent zero bytes; E committed exactly one UTF-8 é. Language-specific CJK candidate conversion was not exercised. |
| 02.3 | PASS | The 10,000-line stream reached its final marker. Another pane printed ECHO-RESPONSIVE during output. Repeated title changes did not interrupt switching, renaming or Settings. |
| 02.4 | PASS | In two mouse-reporting TUIs, checked arrows, wheel/click reports and resize. Shift selected SELECT with zero mouse bytes, and the clipboard contained that word. Both the menu and shortcut recovered input. The neighbor still received mouse reports. Restarted the streaming profile; its old output disappeared and the replacement zsh accepted input. |
| 03.1 | PASS | Added panes by button and Cmd+N; renamed three. Verified tab/background activation, MRU/reverse, adjacent movement, fuzzy palette and first/last boundaries. |
| 03.2 | PASS | Cmd+Shift+B entered navigation. H/L, arrows, Home/End, digits, N/R/X, Enter and Escape worked. Escape restored the source and cancelled the X confirmation. Two fresh presses were required to close after re-entry. Plain Ctrl+B reached Bash/zsh in Vibe99, and standalone tmux 3.6a received byte 0x02 then C in a real PTY and created window two. In the packaged GUI, a private tmux session reported window 0 of one. Physical Ctrl+B then C switched to window 1 of two and left Vibe99 in terminal mode. Exiting both tmux windows returned to the shell. |
| 03.3 | PASS | Dragged a terminal to first and back and a PDF from last to second. Repeatedly switched focus. On an inactive PDF, the first Next click focused page 1, the second advanced to page 2. An inactive terminal URL likewise needed a second click. |
| 03.4 | PASS | Middle-clicked foreground and background tabs; closed from the tab context menu and document Close. Background context close preserved focus and immediate typing. Last-pane close was disabled and two X presses kept it alive. Dragged to minimum size, opened File/Settings, enlarged, entered fullscreen and returned to the previous size. |
| 04.1 | PASS | Changed and restored family, font size, pane width, opacity and background mask, including bounds. The repaired number field visibly displayed 24. Selected a preset, cleared to the original color, applied a system custom color and restored the accent. |
| 04.2 | PASS | Saved Cmd+Shift+J for New Tab and used it. Reset restored Cmd+N. The recorder displayed Mac modifiers, reported the Cmd+Shift+B conflict, disabled Save and retained focus. Cmd+N in the focused profile name editor left the editor open and created no extra tab. |
| 04.3 | PASS | Detected Zsh/Bash/Sh. Created, cloned, edited, renamed, reordered and set a disposable default. The reordered list persisted after reopening Settings. A quoted argument reached Bash intact; zsh -il was both interactive and login. Changing one pane left its neighbor’s PID unchanged. Removed all four disposable profiles via their Settings controls. Verified their absence on disk and that the other saved profile remained. |
| 04.4 | PASS | A missing executable produced a useful error. Retry repeated it; Use local shell recovered in the same pane and printed MISSING-PROFILE-RECOVERED. Local discovery did not depend on WSL. |
| 05.1 | PASS | Copied a two-line Unicode selection with Cmd+C and context Copy. Cmd+V, Ctrl+Shift+V and context Paste produced three byte-identical bracketed pastes in a raw PTY, each with one opening/closing bracket and no trailing Enter. |
| 05.2 | PASS | Native paste inserted the OSC52 marker once. Ctrl+C interrupted an unselected foreground process. |
| 05.3 | PASS | Copied the fixture bitmap in Preview. Cmd+V and Paste Image inserted readable local PNG paths without executing them or requesting a remote host. |
| 05.4 | PASS | Cancel in the bundled local screen multiplexer wrote zero bytes. During a large bitmap paste, switched focus or closed the receiver; neither receiver nor neighboring probe recorded stray bytes. Subsequent plain text pasted once. |
| 06.1 | PASS | Delayed output settled and the background accent cycled over successive captures. Focusing the pane cleared it. Fresh delayed output restarted the cycle. |
| 06.2 | PASS | Repeated with per-pane and global alerts disabled. The accent stayed steady; fullscreen and return did not trigger an alert. |
| 06.3 | PASS | During long changing titles and streaming output, other tabs accepted clicks and rename, Settings opened and a disposable pane opened/closed. Restored preferences. |
| 07.1 | PASS | Clicked relative, absolute, file URI, line-and-column and quoted Unicode paths, PDF and PNG. The preview opened beside its source. After entering the space folder, the same relative filename showed the other heading. |
| 07.2 | PASS | A real browser and loopback request log showed one open each for plain, Ctrl-click and OSC8. Shift-click made zero requests. Inactive click only focused. Ctrl-click left no extra context menu. Clicking a URL in a mouse-reporting TUI added no mouse bytes. |
| 07.3 | PASS | Both fragments of soft/hard margin wraps, hyphen breaks, deeply indented/padded continuations and a whitespace-only soft row opened the full path. A blank paragraph separated targets; quoted spaces were preserved. |
| 07.4 | PASS | Replaced the full hovered row and, separately, only its continuation. After moving away and back, clicks opened the new headings. File and palette entry opened local documents. Unsupported extensions and missing files produced specific errors. |
| 08.1 | PASS | Observed headings, lists, table, syntax highlighting, inline/display math, numeric dagger/double-dagger, Mermaid SVG and a local image. Raw script text stayed visible and inert. The remote image showed an explicit external-image error. |
| 08.2 | PASS | Section scrolled to Long section, Other document opened its heading and Back returned. A file change while scrolled appeared automatically. The same tab retained focus and paragraph 5 stayed first in view. |
| 08.3 | PASS | Invalid UTF-8 and oversized Markdown produced distinct errors. Created a missing file and retried successfully. Renamed a displayed fixture, observed refresh error, restored and retried successfully. |
| 08.4 | PASS | Closed the source shell while its preview stayed focused; its link still opened the other local document. Closing the preview returned to a live terminal. Relaunch omitted previews. |
| 09.1 | PASS | Expanded Mermaid into the top layer. Exercised wheel zoom, drag pan, Fit, actual size, double-click, +/−, arrows, 0, 1 and Escape. |
| 09.2 | PASS | Tab focus stayed inside the modal, Cmd+N did not add a pane, and Escape returned focus to its document trigger. |
| 09.3 | PASS | Click, Space and Return opened the local image. Zoom/pan worked. Updating its image bytes and document kept the expanded pixels unchanged; reopening showed the new pixels. Underlying links were inaccessible while expanded. After Escape, a local link navigated correctly. Closing the owning window dismissed the viewer and Finder relaunch restored only terminals. The separate renderer test also passed programmatic navigation, clear and disposal while expanded. |
| 10.1 | PASS | Opened the two-page PDF from a terminal link and File. Checked both colored pages, Next/Previous, zoom, Fit and numeric input: 0 clamped to 1 and 99 to 2. Save As and Close remained in its header. |
| 10.2 | PASS | Resized the PDF window, invoked Fit, reordered and switched between PDF and terminals without losing page 2. Invalid PDF and oversized PDF gave distinct inline errors and Retry. Subsequent documents opened. |
| 10.3 | PASS | Opened standalone PNG and a non-square JPEG. The 2:1 test rectangle retained its aspect in Fit and actual-size captures. Tested expansion, keyboard activation, zoom/pan, close, invalid PNG and missing image. Simultaneously open PNG, Markdown and PDF remained independent. |
| 11.1 | PASS | Native Save As defaulted to Downloads with source name. Cancel created no export. Exported a Unicode/space filename and compared the complete UTF-8 document bytes. |
| 11.2 | PASS | Exported PDF and PNG bytes matched their sources. Reopened the exported PDF, PNG and Markdown in Vibe99. |
| 11.3 | PASS | Changing Markdown while the dialog was open exported the original snapshot. On a disposable byte-identical collision, Cancel returned to the panel and Replace saved the expected bytes. A read-only folder produced a visible permission error, preserved its original file and left no partial export. |
| 12.1 | PASS | Quit and reopened from Finder. Terminal order, titles, accents, profiles, focus, specified cwd, font/mask and alerts survived. Compared isolated settings before and after; no repeated opacity migration. |
| 12.2 | PASS | New shell inherited the spaced Unicode directory. Closing the last window terminated all four recorded owned shell PIDs. Relaunch restored terminal-only tabs and accepted commands in the restored cwd. |
| 12.3 | PASS | Verified the installed hash and signature, then launched that copy from Finder. A disposable third PTY printed arm64 and FINAL-PROD-PTY-OK. Relative notes.md rendered its heading, local image and Mermaid. Relative sample.pdf displayed both pages. Save As opened in Downloads and exported identical PDF bytes. Cmd+V inserted the OSC52 marker once with bracketed paste and no Enter. Ctrl+B edited shell input and Cmd+Shift+B opened navigation. Closing the test terminal restored the original two tabs and two owned shells. |
| 12.4 | PASS | Recorded every native assertion, verified the install kit against the pinned public base, preserved the original app/data and left SSH deferred. |

## Reproduction notes

- Native cases ran in the packaged Tauri app through Computer Use. Compared fixture files, PTY input, the loopback request log, saved settings and test process lifetimes where those gave a more precise result than a screenshot.
- Automated checks include 31 JavaScript unit tests, 36 Rust unit tests and two Rust documentation tests. All 14 terminal and nine review renderer groups passed. Diagram, media and document renderer suites also passed and are supplementary. Mock connections exercised by existing renderer tests do not validate SSH.
- An ad-hoc rebuild can cause macOS to ask again for a protected Documents directory. The local suite used a disposable temporary fixture directory. No global security setting was changed.
- Current coverage is macOS 26.2 arm64. Older macOS versions and SSH have separate validation requirements.
