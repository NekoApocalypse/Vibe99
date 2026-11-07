import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileReference, registerTerminalFileLinks } from '../src/terminal-file-links.mjs';

test('recognizes PDF and raster image paths without capturing web URLs or executable formats', () => {
  for (const path of ['C:/docs/report.PDF', '/tmp/图.png', 'photos/test.jpeg', 'plot.webp', 'animation.gif', 'photo.avif', 'old.bmp']) {
    assert.equal(parseFileReference(path)?.path, path);
    const fixture = terminalFor('Open ' + path);
    const registration = registerTerminalFileLinks(fixture.terminal, () => {});
    assert.equal(fixture.links()[0]?.text, path); registration.dispose();
  }
  for (const path of ['https://example.com/a.pdf', 'a.svg', 'a.html', 'a.exe']) assert.equal(parseFileReference(path), null);
});

test('parses Windows/Unix/relative Markdown paths, quotes, spaces and locations', () => {
  for (const [value, path, location] of [
    ['README.md', 'README.md', {}],
    ['C:\\项目\\plan.md:12:3', 'C:/项目/plan.md', { line: 12, column: 3 }],
    ['/home/user/plan.md#L12-L15', '/home/user/plan.md', { line: 12 }],
    ['../docs/plan.markdown:2', '../docs/plan.markdown', { line: 2 }],
    ['./docs/plan.mdown', './docs/plan.mdown', {}],
    ['`docs/design notes.md`#L4C2', 'docs/design notes.md', { line: 4, column: 2 }],
    ['"C:\\my project\\notes.md":8', 'C:/my project/notes.md', { line: 8 }],
  ]) assert.deepEqual(parseFileReference(value), { path, authority: null, scheme: 'path', ...location }, value);
});

test('retains explicit remote authority and decodes only supported file URIs', () => {
  assert.deepEqual(parseFileReference('file:///C:/my%20project/notes.md#L2'),
    { path: 'C:/my project/notes.md', authority: null, scheme: 'file', line: 2 });
  assert.deepEqual(parseFileReference('file://localhost/home/me/README.md'),
    { path: '/home/me/README.md', authority: null, scheme: 'file' });
  assert.deepEqual(parseFileReference('file://server/home/me/README.md'),
    { path: '/home/me/README.md', authority: 'server', scheme: 'file' });
  assert.deepEqual(parseFileReference('vscode-remote://ssh-remote+my-alias/home/me/README.md:4:2'),
    { path: '/home/me/README.md', authority: 'my-alias', scheme: 'vscode-remote', line: 4, column: 2 });
});

test('rejects web URLs, other schemes, malformed/ambiguous authorities and non-Markdown files', () => {
  for (const value of [
    'https://example.com/README.md', 'http://example.com/a.md:2', 'javascript:README.md',
    'mailto:README.md', 'ssh://host/a.md', 'file://user@host/a.md', 'file://host/C:/a.md',
    'file:///tmp/a%00.md', 'file:///tmp/a.md?query=1', 'file:///tmp/%ZZ.md',
    'vscode-remote://dev-container+id/a.md', 'vscode-remote://ssh-remote+/a.md',
    'vscode-remote://ssh-remote+alias:22/a.md', 'vscode-remote://ssh-remote+7b2261227d/a.md',
    'README.md:0', 'README.md:2:0', 'README.md#Lbad', 'README.txt', 'foo\nREADME.md',
    'C:relative.md', '//ambiguous/share.md', null,
  ]) assert.equal(parseFileReference(value), null, String(value));
});

function terminalFor(text, cols = 100) {
  let provider;
  const rows = text.split('\n').map(row => ({
    isWrapped: false, length: cols,
    getCell(x) { return { getWidth: () => 1, getChars: () => row[x] || '' }; },
  }));
  const terminal = { cols, buffer: { active: { getLine: y => rows[y] } },
    registerLinkProvider(value) { provider = value; return { dispose() { provider = null; } }; },
  };
  return { terminal, rows, links(y = 1) { let links; provider.provideLinks(y, value => { links = value; }); return links || []; } };
}

test('provider finds plain/quoted paths but never captures substrings of web URLs', () => {
  const f = terminalFor('See README.md, `docs/design notes.md`:4 and https://example.com/remote.md https://x/(inside.md)', 120);
  const opened = [];
  const registration = registerTerminalFileLinks(f.terminal, ref => opened.push(ref));
  const links = f.links();
  assert.deepEqual(links.map(link => link.text), ['README.md', '`docs/design notes.md`:4']);
  assert.deepEqual(links[0].range, { start: { x: 5, y: 1 }, end: { x: 13, y: 1 } });
  const event = { button: 0, shiftKey: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  links[0].activate(event);
  assert(event.prevented && event.stopped);
  assert.equal(opened[0].path, 'README.md');
  registration.dispose();
});

test('extremely long wrapped logical lines yield no links instead of truncated paths', () => {
  const f = terminalFor(Array.from({ length: 33 }, () => 'README.md').join('\n'));
  for (let i = 1; i < f.rows.length; i++) f.rows[i].isWrapped = true;
  registerTerminalFileLinks(f.terminal, () => {});
  assert.deepEqual(f.links(17), []);
});

test('Markdown labels open their destination, with no duplicate or web-label file links', () => {
  const f = terminalFor('[plan.md](/absolute/project/actual.md:4) [remote.md](https://example.com/remote.md) [space](<docs/my plan.md>) https://host/[label](wrong.md)', 180);
  const opened = [];
  registerTerminalFileLinks(f.terminal, ref => opened.push(ref));
  const links = f.links();
  assert.deepEqual(links.map(link => link.text), ['plan.md', 'space']);
  links[0].activate({ button: 0, shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(opened[0], { path: '/absolute/project/actual.md', authority: null, scheme: 'path', line: 4 });
  links[1].activate({ button: 0, shiftKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(opened[1].path, 'docs/my plan.md');
});
