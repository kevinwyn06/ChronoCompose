// Tests for the full-day planned invariant and rich-text description helpers (node-safe subset).
// sanitizeHtml itself is browser-only (needs DOMParser) and is exercised in-app, not here.
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

test('normalizeTask: does not override an all-day planned value (stays user-editable)', () => {
  const c = make();
  // normalizeTask must preserve planned — the all-day cleanup is a one-time migration, not a per-load rule.
  const allDay = c.normalizeTask({ id:'a', allDay:true, planned:60, type:'Proportional' });
  assert.strictEqual(allDay.planned, 60);
  const timed = c.normalizeTask({ id:'c', allDay:false, planned:120, type:'Exact' });
  assert.strictEqual(timed.planned, 120);
});

test('migrateAllDayPlanned: one-time scrub clears old all-day planned, leaves the rest', () => {
  const c = make();
  const tasks = [
    { id:'a', allDay:true, planned:60 },   // old import default -> cleared
    { id:'b', allDay:false, planned:30 },  // timed -> untouched
    { id:'c', allDay:true, planned:0 },    // old ambiguous zero -> cleared too
    { id:'d', allDay:true, planned:90 },   // cleared
  ];
  const n = c.migrateAllDayPlanned(tasks);
  assert.strictEqual(n, 3, 'every non-null all-day planned value was cleared');
  assert.strictEqual(tasks[0].planned, null);
  assert.strictEqual(tasks[1].planned, 30, 'timed task untouched');
  assert.strictEqual(tasks[2].planned, null);
  assert.strictEqual(tasks[3].planned, null);
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
