import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const command = process.argv[2];

if (!['package', 'make'].includes(command)) {
  console.error(`Unsupported package command: ${command ?? '(missing)'}`);
  process.exit(1);
}

function resolveBin(packageName, binName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = require(packageJsonPath);
  const binEntry = packageJson.bin?.[binName] ?? packageJson.bin;

  if (typeof binEntry !== 'string') {
    throw new Error(`Unable to resolve ${binName} for ${packageName}`);
  }

  return require.resolve(`${packageName}/${binEntry}`);
}

const isWindows = process.platform === 'win32';
const binPath = isWindows
  ? resolveBin('electron-builder', 'electron-builder')
  : resolveBin('@electron-forge/cli', 'electron-forge');
const args = isWindows
  ? command === 'package'
    ? ['--win', 'dir']
    : ['--win', 'portable', 'zip']
  : [command];

const result = spawnSync(process.execPath, [binPath, ...args], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  throw result.error;
}

if (result.status === 0 && isWindows && command === 'make') {
  const verifyResult = spawnSync(process.execPath, ['./scripts/verify-windows-portable.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });

  if (verifyResult.error) {
    throw verifyResult.error;
  }

  if (verifyResult.status !== 0) {
    process.exit(verifyResult.status ?? 1);
  }
}

process.exit(result.status ?? 1);
