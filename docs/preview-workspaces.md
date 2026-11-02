# File previews

Click a Markdown file reference in an agent's terminal output to open an ordinary document pane immediately to its right. The reader contains the document name and Close; it creates any required read-only connection internally and does not start another shell.

Local and remote `.md`, `.markdown`, and `.mdown` references are supported, including terminal hyperlinks, absolute paths, relative paths, quoted paths with spaces, and line suffixes. Web links keep their existing Ctrl-click behavior. The MD button and command palette also accept a file path when there is no clickable reference.

Each resolved terminal file request creates a new document pane. While file context is being resolved, rapid clicks retain only the latest pending request; links within a document navigate that reader. After insertion, a document uses the same width, tab ordering, dragging, stacking, and focus rules as terminal panes. It is not paired with its source: either can be moved or closed independently. The last remaining pane cannot be closed with its tab or document Close button; the window can still be closed normally. Preview connections and documents are not restored automatically at startup.

The existing visual model is unchanged: the focused pane has its own opaque reading area; background panes overlap in tab order at the configured opacity. Background content showing through those stacked panes is intentional.

## Finding the file

Windows PowerShell reports its working folder at each local prompt. For a simple `ssh user@host` or `ssh alias` running inside the source pane, Vibe99 can inspect that pane's owned process tree and open an independent file-reading SSH connection automatically. It uses existing noninteractive authentication and known_hosts, and needs Python 3 on the Linux host.

Relative remote paths also need a working-folder report from the remote terminal. If the folder is missing, or the SSH invocation has custom options, Vibe99 asks once for the pane's file location. Use an SSH configuration alias to preserve ports, identities, and jump-host settings. The association lasts until the pane returns to its local prompt or restarts. Vibe99 cannot automatically discover SSH sessions launched inside a remote shell; their file location must be supplied explicitly. An explicit remote file hyperlink can trigger the location prompt when its authority is ambiguous.

This is a file reader, not a filesystem sandbox: Folder resolves relative paths, and absolute references may open other readable files. Connections are owned by the document pane and close with it, independently of the source terminal. A remote helper exits after 60 seconds without a heartbeat; no permanent daemon is installed. No extra terminal is created for previewing.

## Rendering and recovery

The reader supports code highlighting, KaTeX equations, Mermaid diagrams, and local/remote raster images. Text must be UTF-8 up to 4 MiB; images are limited to 16 MiB. Raw HTML and network images are disabled. It checks modification stamps every two seconds while visible, preserving unchanged document DOM and scroll position. Errors appear inline with Retry.

Mouse recovery and bounded wheel diagnostics remain on the original terminal: Ctrl+Shift+M or its tab context menu. Recovery temporarily suppresses wheel-to-arrow fallback only in the affected alternate screen; it does not force a live tmux session out of that screen. The complete reported sleep/tmux/agy dual-scroll incident remains unreproduced.
