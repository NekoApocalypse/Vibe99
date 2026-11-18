# Local file context and terminal links

Use the protocol in `../README.md`. Run this prompt in the actual macOS arm64 packaged test app. FIXTURES is the absolute directory printed by the fixture generator. Record evidence for each assertion; repair failures and rerun.

1. cd into FIXTURES, print paths to notes.md, "space folder/中文 notes.md", sample.png and sample.pdf. Click relative, absolute, file://, quoted and :line:column forms. Correct file opens immediately right of source with no extra shell. Change directory into the space folder and open relative notes again; verify current directory is used.

2. Run `python3 terminal_probe.py serve-links` in one fixture shell. From another, run `python3 terminal_probe.py links` to print a plain URL and OSC8 hyperlink. Compare `link-requests.txt` before and after each gesture, then stop the local server with Ctrl+C. A public https://example.com link can also exercise the browser handoff. First click in an inactive pane focuses only; active plain click and Ctrl-click open the intended URL once in the default browser. Shift-click remains selection. No mouse escape sequences leak into a local mouse-enabled fixture.

3. Use the links fixture to print long soft wraps, hard margin wraps, hyphen separator wraps, deep indentation and padded whitespace rows. Click both fragments; correct full target opens. Blank paragraphs stay separate and quoted filename spaces remain meaningful.

4. Use the redraw fixture to replace the hovered link and only its continuation row, move pointer away/back, then click. New target opens, never the stale target. File button and palette path entry open supported files; unsupported or malformed paths report actionable errors.
