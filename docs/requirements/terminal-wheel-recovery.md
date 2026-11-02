# Terminal wheel recovery

Vibe99 must preserve predictable terminal wheel input across sleep, SSH interruption, and tmux reattachment: scrolling must not unexpectedly alter an agent's input history or produce duplicate mouse and arrow input. Markdown document panes must scroll independently of terminal input.

## Report and status

Reported 2026-11-02: in tmux-connected agy sessions, wheel scrolling sometimes appears to trigger both scrolling and Up-arrow behavior, possibly after device sleep. The user confirmed that the unexpected effect recalls previous prompt/input history. The exact trigger remains unknown. No live user session was modified during investigation.

The full reported incident has **not** been reproduced. A related recovery limitation has been reproduced in an isolated Edge/Playwright instance using this checkout's installed xterm.js 6.0.0 and the actual `RESET_MOUSE_MODES` export from `src/terminal-input.mjs`.

## Evidence

For one wheel-up event in each state, the terminal emitted:

| State | Input emitted |
| --- | --- |
| Normal buffer, mouse reporting off | None |
| Alternate buffer, modes 1000 and 1006 enabled | SGR wheel mouse report |
| Same alternate buffer after Vibe99's mouse reset | Up-arrow sequence (`ESC [ A`) |
| Same state after additionally disabling mode 1007 | Up-arrow sequence (`ESC [ A`) |
| Mouse reporting re-enabled | SGR wheel mouse report |

No case in this experiment emitted both a mouse report and an arrow sequence. This was a terminal-component experiment, not a Windows sleep, SSH, tmux, or agy end-to-end test.

`node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts` makes mouse reporting and fallback arrow generation mutually exclusive in its ordinary wheel path. When mouse reporting is off and the buffer has no scrollback, it translates wheel movement to cursor keys. `src/renderer.js` recovery disables mouse reporting without leaving the alternate buffer or re-establishing the remote application's requested modes. The PowerShell prompt integration uses the same mode-reset sequence. This supports a recovery-state hypothesis; it does not establish which transition occurred in the user's incident.

tmux can independently translate wheel reports into arrow keys through its bindings. Inspect the affected session's bindings and mouse flags before assigning the entire problem to Vibe99. Reference: https://github.com/tmux/tmux/wiki/Recipes#send-up-and-down-keys-for-the-mouse-wheel

## Acceptance requirements

- A wheel event must not produce duplicate mouse and cursor-key input from Vibe99.
- In the affected agy workflow, scrolling transcript/history must not also recall previous prompt entries. Check the prompt contents as well as viewport movement; absence of duplicate outbound sequences alone does not establish that the user-visible regression is fixed.
- Preserve intentional wheel-to-arrow behavior in applications that rely on it; do not globally disable that compatibility behavior as a speculative fix.
- Recovery must account for mouse reporting and alternate-screen wheel fallback together. Do not automatically reset active terminal modes merely on window focus or resume.
- Test healthy operation, sleep with SSH surviving, SSH loss to the local prompt, tmux reattachment, and manual recovery, with mouse reporting on and off.
- Verify terminal panes and independent Markdown document scrolling. The document reader does not start an integrated terminal.
- Add opt-in, bounded diagnostic capture if the full incident remains intermittent: correlate wheel events, buffer/mouse state, and only mouse/arrow output classifications. Do not collect ordinary typed input or terminal contents.

## Next investigation

The implementation now suppresses alternate-screen wheel-to-arrow fallback only after manual recovery, and clears that suppression when actual mouse tracking resumes or the alternate screen ends. An authenticated local PowerShell prompt marker can exit a leftover alternate screen; ordinary normal-screen prompts do not restore the cursor. Automated xterm and native PowerShell tests cover these transitions. Physical sleep and the reported tmux/agy dual behavior remain unverified.

Capture the actual event at Vibe99's outbound-input boundary and compare the same tmux session in another terminal. If Vibe99 emits only a mouse report, inspect tmux/agy handling; if it emits an unexpected arrow or both categories, inspect local mode transitions and event routing. Keep the issue open until the observed dual behavior is explained or explicitly reported as unreproduced in review notes.
