import { execFileSync } from 'node:child_process';

const baseRef = process.argv[2] || 'origin/main';
const validFragmentPattern =
  /^changes\/\+[a-z0-9][a-z0-9._-]*\.(feature|bugfix|doc|removal|misc)\.md$/;

const output = execFileSync(
  'git',
  ['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`],
  { encoding: 'utf8' }
);

const changedFiles = output
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const fragmentFiles = changedFiles.filter((filePath) => validFragmentPattern.test(filePath));

if (fragmentFiles.length === 0) {
  console.error(`No changelog fragment found in diff against ${baseRef}.`);
  console.error('Each pull request must add at least one changes/+slug.type.md file.');
  process.exit(1);
}

console.log(`Found changelog fragment(s): ${fragmentFiles.join(', ')}`);
