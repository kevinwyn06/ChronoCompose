const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const c = () => make();

test('retired smart chips are dropped, Unplanned survives', () => {
  const m = c().migrateFilterPrefs({ chips: ['activeToday','startable','unplanned','overdue','running'] });
  assert.deepEqual(m.chips, ['unplanned']);
});

test('groupBy is gone from the migrated prefs entirely', () => {
  assert.equal('groupBy' in c().migrateFilterPrefs({ groupBy: 'inclusion' }), false);
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

/* PP-EXT (owner 2026-09-10): groupBy is deleted; the inclusion mode became the `inclOnly` FILTER. */
test('a stored groupBy:inclusion migrates into the inclOnly filter', () => {
  assert.equal(c().migrateFilterPrefs({ groupBy:'inclusion' }).inclOnly, true);
  assert.equal(c().migrateFilterPrefs({ groupBy:'section' }).inclOnly, false);
  assert.equal(c().migrateFilterPrefs({ groupBy:'none' }).inclOnly, false);
  assert.equal(c().migrateFilterPrefs({}).inclOnly, false);
});

test('an explicitly stored inclOnly wins over the legacy groupBy', () => {
  assert.equal(c().migrateFilterPrefs({ inclOnly:false, groupBy:'inclusion' }).inclOnly, false);
  assert.equal(c().migrateFilterPrefs({ inclOnly:true }).inclOnly, true);
});

test('toggleInclOnly flips the filter and persists it', () => {
  const comp = c();
  comp.toggleInclOnly();
  assert.equal(comp.state.inclOnly, true);
  comp.toggleInclOnly();
  assert.equal(comp.state.inclOnly, false);
});
