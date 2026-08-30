const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const c = () => make();

test('retired smart chips are dropped, Unplanned survives', () => {
  const m = c().migrateFilterPrefs({ chips: ['activeToday','startable','unplanned','overdue','running'] });
  assert.deepEqual(m.chips, ['unplanned']);
});

test('groupBy none folds to section', () => {
  assert.equal(c().migrateFilterPrefs({ groupBy: 'none' }).groupBy, 'section');
  assert.equal(c().migrateFilterPrefs({ groupBy: 'inclusion' }).groupBy, 'inclusion');
  assert.equal(c().migrateFilterPrefs({}).groupBy, 'section');
});

test('a sort naming a column-less key is cleared', () => {
  assert.equal(c().migrateFilterPrefs({ sort: { key:'tags', dir:'asc' } }).sort, null);
  assert.equal(c().migrateFilterPrefs({ sort: { key:'calendar', dir:'asc' } }).sort, null);
  assert.deepEqual(c().migrateFilterPrefs({ sort: { key:'name', dir:'desc' } }).sort, { key:'name', dir:'desc' });
});

test('horizon is validated against the six lengths', () => {
  assert.equal(c().migrateFilterPrefs({ horizon: '3m' }).horizon, '3m');
  assert.equal(c().migrateFilterPrefs({ horizon: '9y' }).horizon, null);
  assert.equal(c().migrateFilterPrefs({}).horizon, null);
});

test('priority column filters are not touched', () => {
  const comp = c();
  comp.state.colFilters = { priority: { set:[1,2] } };
  comp.migrateFilterPrefs({ colFilters: { priority: { set:[1,2] } } });
  assert.deepEqual(comp.state.colFilters.priority.set, [1,2]);
});

test('setGroupBy no longer accepts none', () => {
  const comp = c(); comp.setGroupBy('none');
  assert.equal(comp.state.groupBy, 'section');
});
