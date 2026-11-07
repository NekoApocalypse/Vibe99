// Ship PDF.js fonts/decoders locally; document viewing never needs a CDN.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  fs.cpSync(path.join(root, 'node_modules/pdfjs-dist', folder), path.join(root, 'src/public/pdfjs', folder), { recursive: true });
}
fs.copyFileSync(path.join(root, 'node_modules/pdfjs-dist/LICENSE'), path.join(root, 'src/public/pdfjs/LICENSE'));
