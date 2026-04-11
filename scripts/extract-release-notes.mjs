import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/extract-release-notes.mjs <version>');
  process.exit(1);
}

const changelogPath = path.resolve('CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');
const normalizedVersion = version.replace(/^v/, '');
const headingPattern = new RegExp(`^##\\s+${normalizedVersion.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b.*$`, 'm');
const headingMatch = changelog.match(headingPattern);

if (!headingMatch || headingMatch.index === undefined) {
  console.error(`Could not find release notes for version ${normalizedVersion} in ${changelogPath}`);
  process.exit(1);
}

const sectionStart = headingMatch.index + headingMatch[0].length;
const remainder = changelog.slice(sectionStart).replace(/^\r?\n/, '');
const nextHeadingIndex = remainder.search(/^##\s+/m);
const releaseNotes = (nextHeadingIndex === -1 ? remainder : remainder.slice(0, nextHeadingIndex)).trim();

if (!releaseNotes) {
  console.error(`Release notes section for version ${normalizedVersion} is empty`);
  process.exit(1);
}

process.stdout.write(`${releaseNotes}\n`);
