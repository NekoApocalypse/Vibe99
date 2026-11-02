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
  const token = 'test-session-token';
  const marker = '\x1b]633;Vibe99Prompt;' + token + '\x07';
  const wrapped = run(customPrompt + `\n$env:VIBE99_PROMPT_TOKEN = '${token}'\n` + init + '\n' + suffix);
  assert.equal(wrapped.status, 0, wrapped.stderr);
  assert.equal(wrapped.stdout.split(reset).length - 1, 2, 'Every local prompt must reset reporting');
  assert.equal(wrapped.stdout.split(marker).length - 1, 2, 'Every original-shell prompt must carry the session marker');
  const cwdReports = wrapped.stdout.match(/\x1b\]7;file:[^\x07]*\x07/g) || [];
  assert.equal(cwdReports.length, 2, 'Each local prompt reports its current filesystem directory');
  assert.equal(wrapped.stdout.split(reset).join('').split(marker).join('').replace(/\x1b\]7;[^\x07]*\x07/g, ''), plain.stdout, 'Custom prompt and exit status must be preserved');
  const inherited = run(`$env:VIBE99_PROMPT_TOKEN = '${token}'\n` + init +
    `\nif (Test-Path Env:\\VIBE99_PROMPT_TOKEN) { throw 'Prompt token leaked to children' };\n` +
    `& '${shell}' -NoLogo -NoProfile -Command 'if ($env:VIBE99_PROMPT_TOKEN) { exit 3 }; exit 0'`);
  assert.equal(inherited.status, 0, inherited.stderr);
  console.log(`PASS: ${shell} ${probe.stdout.trim()} prompt recovery preserves custom prompt and command status`);
  tested++;
}
assert(tested > 0, 'No PowerShell installation available');
