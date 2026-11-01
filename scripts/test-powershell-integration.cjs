const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const source = readFileSync('src-tauri/src/shell_integration.rs', 'utf8');
const init = source.match(/const POWERSHELL_INIT: &str = r#"([\s\S]*?)"#;/)[1];
const reset = '\x1b[?9;1000;1002;1003;1004;1006;1016l';
let tested = 0;
for (const shell of ['powershell.exe', 'pwsh.exe']) {
  const run = script => spawnSync(shell, ['-NoLogo', '-NoProfile', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 });
  const probe = run('$PSVersionTable.PSVersion.ToString()');
  if (probe.error?.code === 'ENOENT') continue;
  assert.equal(probe.status, 0, probe.stderr);
  const customPrompt = `function global:prompt { "CUSTOM:$?:$global:LASTEXITCODE> " }`;
  // A native failure must still be visible to an existing custom prompt.
  const suffix = `cmd.exe /c exit 7; prompt; cmd.exe /c exit 0; prompt`;
  const plain = run(customPrompt + '\n' + suffix);
  const wrapped = run(customPrompt + '\n' + init + '\n' + suffix);
  assert.equal(wrapped.status, 0, wrapped.stderr);
  assert.equal(wrapped.stdout.split(reset).length - 1, 2, 'Every local prompt must reset reporting');
  assert.equal(wrapped.stdout.split(reset).join(''), plain.stdout, 'Custom prompt and exit status must be preserved');
  console.log(`PASS: ${shell} ${probe.stdout.trim()} prompt recovery preserves custom prompt and command status`);
  tested++;
}
assert(tested > 0, 'No PowerShell installation available');
