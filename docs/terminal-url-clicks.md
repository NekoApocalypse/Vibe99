# Clicking terminal URLs

In an active Vibe99 terminal pane, left-click an HTTP(S) link to open it in the default Windows browser. Ctrl-click also works. Hold Shift to select link text instead. Clicking an inactive pane first only activates that pane.

Plain URLs and explicit terminal hyperlinks (OSC8) share the same click handling as Markdown paths. Vibe99 consumes the link gesture before xterm can forward it as mouse input to an SSH program or tmux. Browser launching continues to use the existing HTTP(S)-only opener.

URLs wrapped by the terminal remain one link, including clicks on continuation rows. A program that inserts a real newline and indentation *inside* a plain URL has broken the text into separate tokens. Vibe99 does not guess a destination by joining arbitrary neighboring lines; such output should use an explicit OSC8 hyperlink or print the URL without hard line breaks. For example, `https://www.` followed by a new indented `saltdesignsystem.com/...` line is not equivalent to normal terminal wrapping.
