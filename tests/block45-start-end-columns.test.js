const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

test('Block 45: Start and End are ordinary visible sheet columns', () => {
  const c = make();
  const defs = c.colDefs();
  const start = defs.find(x => x.k === 'start');
  const end = defs.find(x => x.k === 'end');

  assert.ok(start, 'Start belongs to colDefs');
  assert.ok(end, 'End belongs to colDefs');
  assert.equal(start.l, 'Start');
  assert.equal(end.l, 'End');
  assert.equal(start.lock, undefined, 'Start can hide/reorder/resize like an ordinary column');
  assert.equal(end.lock, undefined, 'End can hide/reorder/resize like an ordinary column');
  assert.equal(c.visibleCols().some(x => x.k === 'start'), true, 'Start is visible by default');
  assert.equal(c.visibleCols().some(x => x.k === 'end'), true, 'End is visible by default');
});

test('Block 45: date cells show clocks only when that edge explicitly has one', () => {
  const c = make();
  const midnight = new Date(2026, 7, 18).setHours(0, 0, 0, 0);
  const bare = { start: midnight, end: midnight, startClock: null, endClock: null };
  const explicitMidnight = { start: midnight, end: midnight, startClock: true, endClock: true };

  assert.equal(c.sheetDateParts(bare, 'start').time, null, 'bare start date never invents 00:00');
  assert.equal(c.sheetDateParts(bare, 'end').time, null, 'bare end date never invents 00:00');
  assert.ok(c.sheetDateParts(explicitMidnight, 'start').time, 'explicit midnight remains visible');
  assert.ok(c.sheetDateParts(explicitMidnight, 'end').time, 'explicit midnight remains visible');
  assert.deepEqual(c.sheetDateParts({ start:null, end:null }, 'start'), { date:'—', time:null });
});
