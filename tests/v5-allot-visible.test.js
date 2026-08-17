/* V5 block 15 — F1 (allotment must come from ALL tasks, never the sheet's visible projection)
   and F4 (`packFromNow` defaults true).

   F1 was the worst finding in the V5 review. `renderVals` fed `computeAllotted` its `_visTasks`
   list — the sheet projection AFTER column filters, smart chips, archived-hiding, subtask collapse
   and SECTION collapse. Two consequences, both silent:
     · the pool was divided among fewer tasks, so every printed "Allotted today" inflated;
     · a hidden task got `allotted:0`, so `flexAllot` returned 0, so `buildDayTimeline` dropped it
       out of `flex` entirely — it never packed AND never showed up in Unscheduled.
   Collapsed sections persist in `pp-prefs`, so a wrong day survived a reload.

   The pool-agreement e2e check cannot see this: both sides read the same poisoned `_allot` and so
   they agree with each other. These tests therefore compare against the FULL task list — the
   ground truth `computeAllotted(state.tasks)` — not against the other consumer. */
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, cleanDay, withNow } = require('./_load.js');

const H = 3600000;

/* renderVals is the site of the bug, so the tests drive renderVals itself rather than a helper.
   The loader's React shim builds plain objects, which is enough: we only read `_allot` afterwards. */
function allotVia(c){ c.renderVals(); return c._allot; }
const totals = m => Object.keys(m).sort().map(id => [id, m[id].allotted]);

test('V5/F1: a column filter does not change anyone\'s allotment', () => withNow(() => {
  const c = make(); cleanDay(c, '10:00');            // 600-minute pool
  const a = activeTask(c, { id:'a', name:'Alpha', planned:120 });
  const b = activeTask(c, { id:'b', name:'Beta',  planned:120 });
  const d = activeTask(c, { id:'d', name:'Delta', planned:240 });
  c.state.tasks = [a, b, d];

  const truth = c.computeAllotted(c.state.tasks);    // ground truth: the FULL list
  assert.deepEqual(totals(allotVia(c)), totals(truth), 'unfiltered render matches the full-list map');
  // 2026-08-16 (cap): 600-minute pool, Sigma demand 480, so every share is capped at the row's own
  // figure — 120, 120, 240 — and 120 minutes stay free. The point of the test is unchanged: the
  // numbers must not move when the sheet is filtered.
  assert.strictEqual(truth.a.allotted, 120);

  /* Filter the sheet down to one row. The sheet may show one task; the DAY still has three. */
  c.state.colFilters = { name:{ contains:'Alpha' } };
  assert.ok(c.hasFilters(), 'the filter is actually active');
  assert.strictEqual(c.visibleTasks().length, 1, 'the sheet really is filtered to one row');

  const filtered = allotVia(c);
  assert.deepEqual(totals(filtered), totals(truth), 'allotment is identical with the filter active');
  assert.strictEqual(filtered.a.allotted, 120, 'Alpha is NOT inflated to the whole pool');
  assert.strictEqual(filtered.b.allotted, 120, 'a filtered-out task keeps its allotment');
  assert.strictEqual(filtered.d.allotted, 240, 'a filtered-out task keeps its allotment');
}));

test('V5/F1: a task in a COLLAPSED section still allots and still reaches the day', () => withNow(() => {
  const c = make(); cleanDay(c, '10:00');            // 600-minute pool
  c.state.sections = [c.normalizeSection({ id:'s1', name:'Research', order:0 }),
                      c.normalizeSection({ id:'s2', name:'Admin',    order:1 })];
  const r = activeTask(c, { id:'r', name:'Read',  planned:120, sectionId:'s1' });
  const m = activeTask(c, { id:'m', name:'Mail',  planned:120, sectionId:'s2' });
  c.state.tasks = [r, m];

  const truth = c.computeAllotted(c.state.tasks);
  // 2026-08-16 (cap): two 120-minute asks in a 600-minute pool — each gets exactly its 120.
  assert.strictEqual(truth.m.allotted, 120);

  /* Collapse Admin — a persisted `pp-prefs` view state, so this is the every-load case. */
  c.state.collapsedSections = { s2: 1 };
  assert.ok(c.isSectionCollapsed('s2'));
  assert.deepEqual(c.visibleTasks().map(t => t.id), ['r', 'm'],
    'section collapse hides at PROJECTION time, not in visibleTasks — which is why it was so easy to miss');

  const after = allotVia(c);
  assert.ok(!c._visTasks.some(t => t.id === 'm'), 'Mail really is out of the sheet projection');
  assert.deepEqual(totals(after), totals(truth), 'collapse changes nothing about the day');
  assert.strictEqual(after.m.allotted, 120, 'the hidden task keeps its allotment');
  assert.strictEqual(c.flexAllot('m'), 120, 'so flexAllot is non-zero…');

  /* …and therefore it still reaches the timeline. Before the fix this was 0 minutes: neither
     packed nor listed as unscheduled — the task simply vanished from the day. */
  const day = c.buildDayTimeline();
  const mine = day.chunks.filter(x => x.id === 'm');
  assert.ok(mine.length > 0, 'the collapsed-section task still reaches the day timeline');
  assert.ok(mine.some(x => x.type === 'scheduled' || x.type === 'unscheduled'),
    'it is packed or explicitly unscheduled — never silently dropped');
}));

test('V5/F4: packFromNow defaults ON, so the pool starts at now, not at dayStart', () => {
  const midnight = new Date(2026, 5, 15, 0, 0, 0, 0).getTime();
  withNow(midnight + 18 * H, () => {                 // 18:00 local, default window 07:00–23:00
    const c = make();
    c.state.nowTick = Date.now();
    assert.strictEqual(c.DEFAULT_SETTINGS().packFromNow, true, 'the shipped default is ON');
    assert.strictEqual(c.state.settings.packFromNow, true, 'a fresh workspace inherits it');

    const B = c.startOfToday();
    assert.strictEqual(c.packStart(B), c.state.nowTick, 'today packs from now');
    const free = c.dayIntervals(B, c.packStart(B), [], []).free;
    assert.ok(free.length > 0, 'there is still evening left at 18:00');
    /* `withNow` moves the ORIGIN of the clock; real milliseconds still elapse inside the block, so
       compare with a one-second tolerance rather than for exact equality. */
    assert.ok(Math.abs(free[0].start - (B + 18 * H)) < 1000,
      'the first free minute is 18:00, not 07:00 (got ' + new Date(free[0].start).toTimeString().slice(0,8) + ')');
    assert.ok(free.every(iv => iv.start >= B + 18 * H), 'no interval reaches back before now');

    /* Future days are unaffected — packFromNow is a today-only rule. */
    assert.strictEqual(c.packStart(B + 86400000), null, 'tomorrow still starts at dayStart');
  });
});
