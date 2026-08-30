const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

test('check is the priority column: labelled, sortable, still locked', () => {
  const chk = make().colDefs().find(d => d.k === 'check');
  assert.ok(chk.l, 'check has a header label');
  assert.equal(chk.sortKey, 'priority');
  assert.equal(chk.lock, true);
});

test('no column was added', () => {
  assert.equal(make().colDefs().length, 9);   // pinned before the edit
});

test('priority sort still cycles asc → desc → off', () => {
  const c = make();
  c.cycleSort('priority'); assert.deepEqual(Object.assign({}, c.state.sort), { key:'priority', dir:'asc' });
  c.cycleSort('priority'); assert.deepEqual(Object.assign({}, c.state.sort), { key:'priority', dir:'desc' });
  c.cycleSort('priority'); assert.equal(c.state.sort, null);
});
