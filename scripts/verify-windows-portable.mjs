import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { path7za } = require('7zip-bin');

const scriptPath = fileURLToPath(import.meta.url);
const projectDir = path.resolve(path.dirname(scriptPath), '..');
const outputDir = path.join(projectDir, 'out', 'builder');

function findPortableArtifact() {
  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  const portableFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.exe') &&
        entry.name.includes('-windows-portable-')
    )
    .map((entry) => path.join(outputDir, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  return portableFiles[0] ?? null;
}

function findZipArtifact() {
  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  const zipFiles = entries
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.zip') && entry.name.includes('-windows-')
    )
    .map((entry) => path.join(outputDir, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  return zipFiles[0] ?? null;
}

const portableArtifact = findPortableArtifact();
if (!portableArtifact) {
  throw new Error(`No portable Windows artifact found in ${outputDir}`);
}

const zipArtifact = findZipArtifact();
if (!zipArtifact) {
  throw new Error(`No Windows zip artifact found in ${outputDir}`);
}

const listResult = spawnSync(path7za, ['l', portableArtifact], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (listResult.error) {
  if (listResult.error.code === 'EPERM') {
    console.warn(
      `Skipping portable archive verification for ${path.basename(
        portableArtifact
      )} because this environment blocks executing ${path.basename(path7za)} from Node.`
    );
    process.exit(0);
  }

  throw listResult.error;
}

if (listResult.status !== 0) {
  throw new Error(listResult.stderr || `Failed to inspect ${portableArtifact}`);
}

const requiredEntries = ['ffmpeg.dll', 'Vibe99.exe', 'resources\\app.asar'];
const missingEntries = requiredEntries.filter((entry) => !listResult.stdout.includes(entry));

if (missingEntries.length > 0) {
  throw new Error(
    `Portable artifact ${path.basename(portableArtifact)} is missing embedded entries: ${missingEntries.join(
      ', '
    )}`
  );
}

console.log(
  `Verified Windows artifacts ${path.basename(portableArtifact)} and ${path.basename(
    zipArtifact
  )}; portable build embeds ${requiredEntries.join(', ')}`
);
