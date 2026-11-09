// xterm 6.0.0 keeps the last row's link-provider replies after mouseleave.
// Redrawing that row while the mouse is outside can then activate an old URL.
// Invalidate on leave and on renders without an active link, so re-entry or
// movement from a blank cell queries the real buffer without per-move rescans.
// See docs/xterm-link-cache.md. Keep this patch version-pinned and fail closed.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.dirname(require.resolve('@xterm/xterm/package.json'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (version !== '6.0.0') throw new Error('Revalidate the xterm link-cache patch before changing xterm versions.');

const before = 'this._isMouseOut=!0,this._clearCurrentLink()';
const after = before + ',this._activeLine=-1,this._lastBufferCell=void 0';
const renderListener = 'this._register(this._renderService.onRenderedViewportChange(()=>{if(!this._currentLink){this._activeLine=-1;this._lastBufferCell=void 0}})),';
const hashes = {
  'lib/xterm.js': '14903579ff54664cd72f8e8699e6961a6272c21863ec1c3b118cdc8af5d4a972',
  'lib/xterm.mjs': 'b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59',
};
// Validate both bundles before changing either. Accept only the exact upstream
// bytes or this exact patch; repeated npm installs/builds are idempotent.
const updates = Object.entries(hashes).map(([relative, expected]) => {
  const file = path.join(root, relative), current = fs.readFileSync(file, 'utf8');
  const intersections = (relative.endsWith('.mjs') ? [['e', 'i'], ['n', 'o']] : [['e', 't'], ['t', 'i']]).map(([start, end]) => [
    `this._currentLink.link.range.start.y>=${start}&&this._currentLink.link.range.end.y<=${end}`,
    `this._currentLink.link.range.start.y<=${end}&&this._currentLink.link.range.end.y>=${start}`,
  ]);
  const renderBefore = relative.endsWith('.mjs')
    ? 'this._register(this._bufferService.onResize(()=>{this._clearCurrentLink(),this._wasResized=!0}))'
    : 'this._register(this._bufferService.onResize((()=>{this._clearCurrentLink(),this._wasResized=!0})))';
  const renderAfter = renderListener + renderBefore;
  let original = current.replace(after, before).replace(renderAfter, renderBefore);
  for (const [before, after] of intersections) original = original.replace(after, before);
  if (createHash('sha256').update(original).digest('hex') !== expected || original.split(before).length !== 2 || original.split(renderBefore).length !== 2) {
    throw new Error('Unexpected xterm bundle; refusing to patch ' + relative);
  }
  let patched = original.replace(before, after).replace(renderBefore, renderAfter);
  for (const [before, after] of intersections) {
    if (patched.split(before).length !== 2) throw new Error('Unexpected wrapped-link render check: ' + relative);
    patched = patched.replace(before, after);
  }
  return { file, current, patched };
});
for (const { file, current, patched } of updates) if (current !== patched) fs.writeFileSync(file, patched);
console.log('Verified xterm 6.0.0 stale-link cache patch (UMD + ESM).');
