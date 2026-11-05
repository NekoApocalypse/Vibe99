# Clipboard images in terminal tools

Vibe99 can paste a copied screenshot or bitmap image into a terminal tool such as Codex or Antigravity CLI. It saves the image as PNG and pastes its path as one paste event; for a simple existing SSH connection it uploads the PNG to that host first. This also works when the receiving tool is inside tmux on that host. The prompt is never submitted automatically.

Use **Ctrl+V**, **Ctrl+Shift+V**, **Paste**, or **Paste Image** in the terminal context menu. Text-only clipboard contents still paste normally. Screenshots and “Copy image” are supported; copying a file in Explorer is not the same as copying its bitmap. Tools that recognize pasted image paths display an attachment; other programs receive the path as text.

Remote paste needs existing noninteractive SSH authentication, known_hosts, and Python 3 on a Linux host. Vibe99 detects a direct `ssh user@host` or `ssh alias` process from the Windows pane. For ambiguous connections it asks for the destination once. WSL, nested SSH and containers are not automatically resolved: the uploaded file must be on the same filesystem as the receiving tool. Complex SSH options should be represented by an SSH configuration alias.

Images are stored in the app's private cache locally, or `/tmp/vibe99-images-<uid>/` remotely (directory mode 0700, file mode 0600). Closing Vibe99 or detaching tmux does not delete attachments. Images older than seven days are reclaimed on the next image paste on that host; temporary-directory cleanup by the operating system can remove them earlier. Save a permanent copy if a conversation needs them longer. Limits are 32 megapixels and 16 MiB for the PNG.

Uploads run outside the terminal stream and finish before the path is inserted. Failure leaves the input untouched and shows an error. Closing/restarting a terminal, returning to its local prompt, or having another pane focused when preparation finishes cancels insertion. Opening the terminal context menu checks whether the clipboard contains an image; an explicit paste saves and optionally uploads it. Terminal OSC clipboard queries do not gain access to images.

The expanded Mermaid viewer and other dialogs retain their own input behavior. Clicking an inactive terminal or document pane only focuses it; click again to follow a link or use its controls.
