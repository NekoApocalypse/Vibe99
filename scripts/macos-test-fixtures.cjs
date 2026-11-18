// Disposable, deterministic fixtures for the native computer-use prompts.
const fs = require('node:fs');
const path = require('node:path');
const { pdfFixture } = require('./media-fixtures.cjs');
// Give every run its own unprotected working directory. This also keeps a
// later run from overwriting a document or export under test.
const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vibe99-mac-'));
fs.mkdirSync(path.join(root, 'space folder'), { recursive: true });
fs.mkdirSync(path.join(root, 'exports'), { recursive: true });
fs.copyFileSync('src-tauri/icons/128x128.png', path.join(root, 'sample.png'));
fs.writeFileSync(path.join(root, 'sample.pdf'), pdfFixture());
fs.writeFileSync(path.join(root, 'invalid.pdf'), 'not a pdf');
fs.writeFileSync(path.join(root, 'invalid.png'), 'not an image');
fs.writeFileSync(path.join(root, 'invalid-utf8.md'), Buffer.from([0xff, 0xfe, 0x80]));
fs.writeFileSync(path.join(root, 'oversize.md'), Buffer.alloc(4 * 1024 * 1024 + 1, 65));
fs.writeFileSync(path.join(root, 'oversize.pdf'), Buffer.alloc(16 * 1024 * 1024 + 1));
fs.writeFileSync(path.join(root, 'other.md'), '# OTHER TARGET\n\n[Back](notes.md)\n');
fs.writeFileSync(path.join(root, 'space folder', '中文 notes.md'), '# SPACE UNICODE TARGET\n');
fs.writeFileSync(path.join(root, 'space folder', 'notes.md'), '# CHANGED DIRECTORY TARGET\n');
fs.writeFileSync(path.join(root, 'notes.md'), `# MAC LOCAL PREVIEW

This is a **bold** and *italic* local document. 中文 日本語 한국어.

- One
- Two

| Result | Marker |
| --- | --- |
| 42$^{\\dagger}$ | numeric dagger |
| 99$^{\\ddagger}$ | numeric double dagger |

Inline $E=mc^2$.

$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$

\`\`\`javascript
const message = "syntax highlighting";
console.log(message);
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Local terminal] --> B[Markdown preview]
  B --> C[Mac arm64]
\`\`\`

![Local icon](sample.png)

[Other document](other.md) · [Section](#long-section) · [Web](https://example.com)

<script>document.title = "UNSAFE"</script>

![Network image must remain disabled](https://example.com/vibe99-test-must-not-load.png)

## Long section

${Array.from({ length: 70 }, (_, i) => `Paragraph ${i+1}: stable scrolling and automatic refresh.`).join('\n\n')}
`);
fs.writeFileSync(path.join(root, 'terminal_probe.py'), String.raw`#!/usr/bin/env python3
import sys, time, os, base64, pathlib, shutil, termios, tty
root=pathlib.Path(__file__).resolve().parent
mode=sys.argv[1] if len(sys.argv)>1 else 'text'
if mode=='stream':
    for i in range(10000):
        print(f'{i:05d} Unicode 中文 日本語 한국어 ┌──┬──┐ █', flush=True)
        if i%100==0: time.sleep(.02)
    print('STREAM-END-10000', flush=True)
elif mode=='title':
    for i in range(120):
        print(f'\033]2;Title {i} '+('busy '*30)+'\007', end='', flush=True);time.sleep(.05)
    print('TITLE-END')
elif mode=='osc52':
    text=base64.b64encode(b'CLIPBOARD-OSC52').decode()
    print(f'\033]52;c;{text}\007',end='',flush=True)
elif mode=='alt':
    old=termios.tcgetattr(sys.stdin)
    try:
        tty.setraw(sys.stdin)
        print('\033[?1049h\033[?1000h\033[?1006h\033[2J\033[HLOCAL TUI: q/Ctrl+C exits; input bytes shown below\r',flush=True)
        while True:
            b=os.read(sys.stdin.fileno(),128)
            if b in [b'q',b'\x03']:break
            print('\r\nINPUT '+repr(b)+'\r',flush=True)
    finally:
        termios.tcsetattr(sys.stdin,termios.TCSADRAIN,old)
        print('\033[?1000l\033[?1006l\033[?1049lALT-END',flush=True)
elif mode=='serve-links':
    from http.server import BaseHTTPRequestHandler, HTTPServer
    class Receiver(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path not in ['/plain','/osc8','/control','/mouse','/inactive']:
                self.send_error(404)
                return
            with (root/'link-requests.txt').open('a') as output:
                print(self.path,file=output)
            self.send_response(200)
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(b'Vibe99 local link received')
        def log_message(self,*args): pass
    with HTTPServer(('127.0.0.1',0),Receiver) as server:
        url='http://127.0.0.1:'+str(server.server_port)
        (root/'link-base.txt').write_text(url)
        (root/'link-requests.txt').write_text('')
        print(url,flush=True)
        server.serve_forever()
elif mode in ['links','redraw']:
    if pathlib.Path.cwd() != root:
        sys.exit('Run this probe after cd into its printed fixture directory.')
    cols=shutil.get_terminal_size().columns
    deep=root/('long-directory-'*8)
    deep.mkdir(exist_ok=True)
    target=deep/'wrapped-target.md';target.write_text('# WRAPPED CORRECT TARGET\n')
    other=deep/'updated-target.md';other.write_text('# UPDATED CORRECT TARGET\n')
    print('notes.md\n"space folder/中文 notes.md"\nnotes.md:3:1\nsample.pdf\nsample.png')
    print(root/'notes.md')
    print((root/'notes.md').as_uri())
    url=(root/'link-base.txt').read_text().strip() if (root/'link-base.txt').exists() else 'https://example.com'
    print(url+'/plain')
    print('\033]8;;'+url+'/osc8\007SAFE OSC8 LINK\033]8;;\007')
    print(str(target))
    text=str(target)
    print('Hard margin wrap:')
    for i in range(0,len(text),cols):print(text[i:i+cols])
    # Keep the separator and suffix visible at ordinary pane widths even if
    # the absolute fixture path itself wraps across several rows.
    (root/'design-notes.md').write_text('# DESIGN NOTES TARGET\n')
    (root/'design-noted.md').write_text('# REDRAW TARGET\n')
    for label, boundary in [('hyphen', '\n'), ('padded', '        \n'),
                            ('soft padding', ' '*max(0,cols-11))]:
        print(label+':\n  ./design-'+boundary+'            notes.md')
    print('Blank paragraph control:\n  ./design-\n\n            notes.md')
    if mode=='redraw':
        print('Hover ./design- now; the suffix changes in five seconds.')
        print('  ./design-\n            notes.md',end='',flush=True);time.sleep(5)
        print('\r\033[2K            noted.md',flush=True)
else:
    print('ASCII ┌──┬──┐ 中文 日本語 한국어 😀\nTERMINAL-TEXT-OK')
`);
console.log(root);
