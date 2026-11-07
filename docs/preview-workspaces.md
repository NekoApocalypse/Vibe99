# File previews

Click a Markdown, PDF, or raster image file reference in an agent's terminal output to open an ordinary document pane immediately to its right. The reader contains the document name, Save As and Close; it creates any required read-only connection internally and does not start another shell.

Local and remote `.md`, `.markdown`, `.mdown`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, and `.bmp` references are supported, including terminal hyperlinks, absolute paths, relative paths, quoted paths with spaces, and line suffixes. Web links open with a left-click in an active terminal pane; Ctrl-click also works. The File button and command palette also accept a file path when there is no clickable reference.

Each resolved terminal file request creates a new document pane. While file context is being resolved, rapid clicks retain only the latest pending request; links within a document navigate that reader. After insertion, a document uses the same width, tab ordering, dragging, stacking, and focus rules as terminal panes. It is not paired with its source: either can be moved or closed independently. The last remaining pane cannot be closed with its tab or document Close button; the window can still be closed normally. Preview connections and documents are not restored automatically at startup.

The existing visual model is unchanged: the focused pane has its own opaque reading area; background panes overlap in tab order at the configured opacity. Background content showing through those stacked panes is intentional.

The first click anywhere in an inactive pane only focuses it. Links, Markdown paths, and document controls respond on the next click while that pane is active. The activation gesture is also withheld from terminal mouse reporting.

Middle-click any terminal or document tab to close it using the same cleanup and last-pane protection as its Close button. Closing a background tab preserves the focused pane.

**Save As…** opens a native local save dialog in Downloads with a Windows-safe version of the original filename suggested. Local and SSH documents use the same behavior: it saves the displayed Markdown source snapshot as UTF-8, including its line endings. It also works for an already-loaded document after SSH disconnects. Refreshes while the dialog is open do not change the selected snapshot. Cancel writes nothing; write failures are shown inline. This saves the Markdown file alone; relative image/file references remain unchanged, and any original UTF-8 byte-order mark removed by preview loading is not restored.

For PDFs and images, Save As preserves the original loaded bytes and file type. No conversion or recompression is performed.

## Finding the file

Windows PowerShell reports its working folder at each local prompt. For a simple `ssh user@host` or `ssh alias` running inside the source pane, Vibe99 can inspect that pane's owned process tree and open an independent file-reading SSH connection automatically. It uses existing noninteractive authentication and known_hosts, and needs Python 3 on the Linux host.

Relative remote paths also need a working-folder report from the remote terminal. If the folder is missing, or the SSH invocation has custom options, Vibe99 asks once for the pane's file location. Use an SSH configuration alias to preserve ports, identities, and jump-host settings. The association lasts until the pane returns to its local prompt or restarts. Vibe99 cannot automatically discover SSH sessions launched inside a remote shell; their file location must be supplied explicitly. An explicit remote file hyperlink can trigger the location prompt when its authority is ambiguous.

This is a file reader, not a filesystem sandbox: Folder resolves relative paths, and absolute references may open other readable files. Connections are owned by the document pane and close with it, independently of the source terminal. A remote helper exits after 60 seconds without a heartbeat; no permanent daemon is installed. No extra terminal is created for previewing.

## Rendering and recovery

PDFs use bundled PDF.js with local fonts and decoders, without a browser plugin or CDN. Previous/Next, page-number entry, zoom, and Fit width control one rendered page at a time. Canvas allocation is bounded, and closing or navigating away from the document releases its worker. This first viewer displays pages only: password-protected documents, text selection/search, interactive forms, and PDF link actions are not supported. PDFs and standalone images are limited to 16 MiB; standalone images above 100 megapixels are rejected after decoding. SVG files are not supported.

Standalone images fit inside the pane. Click or press Enter on the image to use the same expanded zoom/pan viewer as Markdown images. PDF and image panes retain the ordinary tab focus, stacking, reordering, and close behavior.

The reader supports code highlighting, KaTeX equations, Mermaid diagrams, and local/remote raster images. Text must be UTF-8 up to 4 MiB; images are limited to 16 MiB. Raw HTML and network images are disabled. It checks modification stamps every two seconds while visible, preserving unchanged document DOM and scroll position. Errors appear inline with Retry.

Each rendered Mermaid diagram has an Expand button. The expanded view sits above all panes: drag to pan, scroll to zoom at the pointer, use Fit or double-click to fit, and use the percentage button for actual size. Keyboard controls are `+`/`-`, arrow keys, `0` (fit), `1` (actual size), and Escape (close). Tab stays inside the viewer; app shortcuts do not reach the panes. The expanded view is a snapshot so file updates do not interrupt inspection; close and reopen it for the latest diagram. Changing documents or closing the owner dismisses it. It uses the already sanitized SVG and opens no additional connection.

Click a loaded Markdown image to expand it in the same viewer with the same zoom, pan, Fit and keyboard controls. Images can also be focused with Tab and expanded with Enter or Space. Clicking an image that is itself a hyperlink expands the image. The viewer uses the already loaded local or remote image bytes, at their natural dimensions, and preserves its snapshot during document or image refreshes. It does not enable network images or SVG image files. Navigation, clearing the document, or closing the pane dismisses the viewer.

Mouse recovery and bounded wheel diagnostics remain on the original terminal: Ctrl+Shift+M or its tab context menu. Recovery temporarily suppresses wheel-to-arrow fallback only in the affected alternate screen; it does not force a live tmux session out of that screen. The complete reported sleep/tmux/agy dual-scroll incident remains unreproduced.
