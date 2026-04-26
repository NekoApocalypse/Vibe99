Resizing the window no longer makes background panes pulse. The PTY redraw burst that follows a SIGWINCH was being treated as fresh output; it's now ignored for a short window after each resize.
