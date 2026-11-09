import test from 'node:test';
import assert from 'node:assert/strict';
import { wrappedReferences } from '../src/terminal-wrapped-links.mjs';

function fixture(lines, cols = 30, wrapped = []) {
  const rows = lines.map((text, index) => ({ length: cols, isWrapped: wrapped.includes(index),
    getCell(x) { return { getWidth: () => 1, getChars: () => text[x] || '' }; } }));
  return { cols, buffer: { active: { getLine: i => rows[i] } } };
}
function split(text, size) { return text.match(new RegExp(`.{1,${size}}`, 'g')); }

test('reconstructs margin-wrapped paths and URLs on every fragment, with mapped cells', () => {
  for (const target of ['/home/pb/project/docs/design-notes.md', 'https://example.com/project/docs/design-notes']) {
    const lines = split(target, 30), terminal = fixture(lines);
    for (let row = 1; row <= lines.length; row++) {
      const links = wrappedReferences(terminal, row);
      assert.equal(links.length, 1);
      assert.equal(links[0].reference?.path || links[0].url, target);
      assert.deepEqual(links[0].range, { start: { x: 1, y: 1 }, end: { x: lines.at(-1).length, y: lines.length } });
    }
  }
});

test('supports padded, indented and mixed soft/hard continuation rows', () => {
  const target = '/home/pb/project/docs/very-long-folder-name/design-notes.md';
  const lines = split(target, 26).map(line => '  ' + line);
  const terminal = fixture(lines);
  for (let y = 1; y <= lines.length; y++) assert.equal(wrappedReferences(terminal, y)[0]?.reference.path, target);
  const mixed = fixture(split(target, 30), 30, [1]);
  // Extend across an additional hard row after the soft-wrapped row.
  const longer = target + ':123456789012';
  const mixedLong = fixture(split(longer, 30), 30, [1]);
  assert.equal(wrappedReferences(mixedLong, 2)[0]?.reference.path, target);
  assert.deepEqual(wrappedReferences(mixed, 1), [], 'ordinary soft wraps stay with the existing providers');
});

test('does not join short lines, new links, absolute paths, list items, or complete files', () => {
  for (const lines of [
    ['https://example.com/short', 'suffix'],
    ['https://example.com/' + 'a'.repeat(10), 'https://other.example/path'],
    ['/home/' + 'x'.repeat(24), '/tmp/another.md'],
    ['/home/' + 'x'.repeat(24), '- list.md'],
    ['/home/' + 'x'.repeat(24), '# Heading'],
    ['/home/' + 'x'.repeat(21) + '.md', 'next.md'],
    ['ordinary prose ends ' + 'x'.repeat(10), 'README.md'],
  ]) {
    const terminal = fixture(lines);
    assert.deepEqual(wrappedReferences(terminal, 1), [], JSON.stringify(lines));
    assert.deepEqual(wrappedReferences(terminal, 2), [], JSON.stringify(lines));
  }
});

test('bounded scans do not emit truncated targets', () => {
  assert.deepEqual(wrappedReferences(fixture(Array(40).fill('a'.repeat(30))), 20), []);
  assert.deepEqual(wrappedReferences(fixture(['a'.repeat(20000)], 20000), 1), []);
});

test('agy word wraps at path hyphens before the margin, including two paths in one paragraph', () => {
  const root = '/mnt/data/team';
  const lines = [
    `  ${root}/workspace/planning/2026-11-`,
    '  09_02_section_3_2_draft_tc.md',
    `  (Also in delivery: ${root}/workspace/delivery/2026-11-`,
    `  09_02_section_3_2_draft_tc.md and repo: ${root}/project-`,
    '  labs/docs/trust_contracts/2026-11-09_02_section_3_2_draft_tc.md)',
    '  • Full draft and rationale:',
    `  ${root}/project-labs/research/journal/2026-11-`,
    '  09_002_section_3_2_draft_and_rationale.md whenever you are ready.',
  ];
  const t = fixture(lines, 140);
  const expected = [
    root + '/workspace/planning/2026-11-09_02_section_3_2_draft_tc.md',
    root + '/workspace/delivery/2026-11-09_02_section_3_2_draft_tc.md',
    root + '/project-labs/docs/trust_contracts/2026-11-09_02_section_3_2_draft_tc.md',
    root + '/project-labs/research/journal/2026-11-09_002_section_3_2_draft_and_rationale.md',
  ];
  for (const [row, paths] of [[1,[expected[0]]],[2,[expected[0]]],[3,[expected[1]]],[4,expected.slice(1,3)],[5,[expected[2]]],[7,[expected[3]]],[8,[expected[3]]]]) {
    assert.deepEqual(wrappedReferences(t,row).map(link=>link.reference?.path),paths,`row ${row}`);
  }
  assert.deepEqual(wrappedReferences(fixture(['ordinary single-', 'thread CPU time'],140),1),[]);
  const url = fixture(['  https://example.com/research/section-', '  3-2-draft'],140);
  assert.equal(wrappedReferences(url,2)[0]?.url,'https://example.com/research/section-3-2-draft');
});
