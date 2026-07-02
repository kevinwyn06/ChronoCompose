// Tests for the full-day planned invariant and rich-text description helpers (node-safe subset).
// sanitizeHtml itself is browser-only (needs DOMParser) and is exercised in-app, not here.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

test('normalizeTask: full-day tasks have no planned time (migrates existing data)', () => {
  const c = make();
  // A previously-imported all-day task stuck at planned 60 gets zeroed on load/normalize.
  const migrated = c.normalizeTask({ id:'a', allDay:true, planned:60, predicted:60, type:'Proportional' });
  assert.strictEqual(migrated.planned, 0);
  assert.strictEqual(migrated.predicted, 0);
  // A manual predicted override on an all-day task is left alone (planned still 0).
  const manual = c.normalizeTask({ id:'b', allDay:true, planned:60, predicted:30, predictManual:true });
  assert.strictEqual(manual.planned, 0);
  assert.strictEqual(manual.predicted, 30);
});

test('normalizeTask: timed tasks keep their planned time', () => {
  const c = make();
  const t = c.normalizeTask({ id:'c', allDay:false, planned:120, type:'Exact' });
  assert.strictEqual(t.planned, 120);
});

test('hasDesc: true only for real content, ignoring empty tags/whitespace', () => {
  const c = make();
  assert.strictEqual(c.hasDesc(''), false);
  assert.strictEqual(c.hasDesc('<p></p>'), false);
  assert.strictEqual(c.hasDesc('<br>'), false);
  assert.strictEqual(c.hasDesc('&nbsp; '), false);
  assert.strictEqual(c.hasDesc('<ul><li>step</li></ul>'), true);
  assert.strictEqual(c.hasDesc('plain text'), true);
});
