import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAttachableImage, partitionFiles, evidenceExtension, evidenceName, ATTACH_ACCEPT } from '../../lib/evidence.js';

const file = (name, type) => ({ name, type });

test('accepts png, jpeg, gif and webp; rejects svg, pdf and untyped files', () => {
  for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'IMAGE/PNG']) assert.ok(isAttachableImage(file('a', t)), t);
  for (const t of ['image/svg+xml', 'application/pdf', 'text/plain', '']) assert.ok(!isAttachableImage(file('a', t)), t);
  assert.ok(!isAttachableImage(null));
  assert.equal(ATTACH_ACCEPT, 'image/png,image/jpeg,image/gif,image/webp');
});

test('partitionFiles splits accepted files from rejected names', () => {
  const { accepted, rejected } = partitionFiles([file('a.png', 'image/png'), file('notes.pdf', 'application/pdf'), file('b.jpg', 'image/jpeg'), { type: 'text/plain' }]);
  assert.deepEqual(accepted.map((f) => f.name), ['a.png', 'b.jpg']);
  assert.deepEqual(rejected, ['notes.pdf', 'unnamed file']);
  assert.deepEqual(partitionFiles(undefined), { accepted: [], rejected: [] });
});

test('evidence names keep the real extension', () => {
  const shot = (type, kind) => ({ kind, blob: { type } });
  assert.equal(evidenceExtension(shot('image/png')), 'png');
  assert.equal(evidenceExtension(shot('image/jpeg')), 'jpg');
  assert.equal(evidenceExtension(shot('image/webp')), 'webp');
  assert.equal(evidenceExtension(shot('image/gif')), 'gif');
  assert.equal(evidenceExtension(shot('')), 'png');
  assert.equal(evidenceExtension(shot('video/webm', 'video')), 'webm');
  assert.equal(evidenceName(42, '20261020-101500', 0, shot('image/jpeg')), 'C42-20261020-101500-1.jpg');
  assert.equal(evidenceName(42, '20261020-101500', 1, shot('image/png')), 'C42-20261020-101500-2.png');
  assert.equal(evidenceName(42, '20261020-101500', 2, shot('video/webm', 'video')), 'C42-20261020-101500-recording-3.webm');
});
