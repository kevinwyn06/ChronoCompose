const test = require('node:test');
const assert = require('node:assert/strict');
const { make, DAY } = require('./_load.js');

/* Chain A, Task 19 — the per-day snooze.
 *
 * `snoozeUntil` answers "not until this date". `snoozeDays` answers a different question — "not on THAT
 * day" — and the two are deliberately independent: skipping Thursday's run is not the same statement as
 * putting the whole task away until Friday, and collapsing them would make one of the two unsayable.
 *
 * The field is a set of `ymd` day KEYS, the same convention as `onListSince` and the per-day spent
 * ledger, for the same reason: the value is compared for identity, never for arithmetic, and a string
 * key cannot be shifted a day by a DST boundary the way an epoch day-start can.
 *
 * It is a TASK-level field rather than a `recur.overrides` entry because it has to work for a plain
 * multi-day window too, and a window has no occurrence index to hang an override on.
 */

const seed = (c, over) => c.normalizeTask(Object.assign({
  id: 'a', name: 'a', type: 'Proportional', priority: 4, deps: [], pct: 0, planned: 60, spent: 0,
}, over || {}));

test('snoozeDays: normalizeTask defaults it to an empty list', () => {
  const c = make();
  assert.deepEqual(JSON.parse(JSON.stringify(seed(c).snoozeDays)), []);
  // A task persisted before the field existed loads without a data migration.
  assert.deepEqual(JSON.parse(JSON.stringify(c.normalizeTask({ id: 'o', name: 'o' }).snoozeDays)), []);
  // A stored list survives, and a junk value normalizes rather than poisoning the read path.
  assert.deepEqual(JSON.parse(JSON.stringify(seed(c, { snoozeDays: ['2026-08-20'] }).snoozeDays)),
    ['2026-08-20']);
  assert.deepEqual(JSON.parse(JSON.stringify(seed(c, { snoozeDays: 'nope' }).snoozeDays)), []);
});

test('snoozeDays: a multi-day window is absent on the snoozed day and present the next', () => {
  const c = make();
  const B = c.startOfToday();
  const t = seed(c, { start: B, end: B + 4 * DAY, included: true });
  c.state.tasks = [t];

  assert.equal(c.isActiveOn(t, B + DAY), true, 'precondition: it runs through tomorrow');
  c.snoozeDay('a', B + DAY);
  const got = c.state.tasks.find(x => x.id === 'a');
  assert.equal(c.isActiveOn(got, B + DAY), false, 'not on the day you put it away');
  assert.equal(c.isActiveOn(got, B + 2 * DAY), true, 'and back the next day, untouched');
  assert.equal(got.snoozeUntil, null, 'a day snooze is not a date snooze');
});

test('snoozeDays: it works on TODAY, not only on future days', () => {
  const c = make();
  const B = c.startOfToday();
  const t = seed(c, { start: B, end: B + 2 * DAY, included: true });
  c.state.tasks = [t];
  assert.equal(c.isActiveOn(t, B), true);
  c.snoozeDay('a', B);
  const got = c.state.tasks.find(x => x.id === 'a');
  assert.equal(c.isActiveOn(got, B), false);
  assert.equal(c.isOptedOut(got), true, 'and today reads as opted out, like any other snooze');
});

test('snoozeDays: a recurring occurrence can be skipped without touching the series', () => {
  const c = make();
  const B = c.startOfToday();
  const t = seed(c, { start: B, end: B + 3600000, included: true, recur: { kind: 'day', n: 1 } });
  c.state.tasks = [t];
  /* `occForDay` expands only to `this._horizon || t.end`, a cache the render path fills — with it cold a
     repeat reads as absent on every day past its anchor. Setting it is what the render does, and without
     it this test would assert the cache, not the snooze. */
  c._horizon = B + 10 * DAY;
  assert.equal(c.isActiveOn(t, B + DAY), true, 'precondition: it repeats daily');
  c.snoozeDay('a', B + DAY);
  const got = c.state.tasks.find(x => x.id === 'a');
  assert.equal(c.isActiveOn(got, B + DAY), false, 'tomorrow is skipped');
  assert.equal(c.isActiveOn(got, B + 2 * DAY), true, 'the series is otherwise untouched');
  assert.ok(!got.recur.overrides || !Object.keys(got.recur.overrides).length,
    'and nothing was written into the recurrence — a window has no occurrence index either, which is '
    + 'exactly why this is a task-level field');
});

test('snoozeDays: adding is idempotent, and clearing puts the day back', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.tasks = [seed(c, { start: B, end: B + 4 * DAY, included: true })];
  c.snoozeDay('a', B + DAY);
  c.snoozeDay('a', B + DAY);
  assert.equal(c.state.tasks[0].snoozeDays.length, 1, 'a day is in the set or it is not');
  c.clearSnoozeDay('a', B + DAY);
  assert.deepEqual(JSON.parse(JSON.stringify(c.state.tasks[0].snoozeDays)), []);
  assert.equal(c.isActiveOn(c.state.tasks[0], B + DAY), true);
});

test('snoozeDays: a day-snoozed task files under Snoozed today', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.tasks = [seed(c, { start: B, end: B + 2 * DAY, included: true, onListSince: c.ymdOf(B) })];
  c.snoozeDay('a', B);
  const got = c.state.tasks[0];
  assert.equal(got.onListSince, null, 'putting it away today takes it off today\'s list');
  assert.equal(c.originOf(got), 'snoozed', 'and Task 5 files it where the user put it');
});

test('snoozeDays: it is mirrored, in the same deferred batch snoozeUntil rides', () => {
  const c = make();
  assert.ok(c.SYNC_FIELDS().indexOf('snoozeDays') >= 0, 'a per-day skip is a decision, not a device detail');
  const row = c.syncRowOf(seed(c, { snoozeDays: ['2026-08-20'] }));
  assert.deepEqual(JSON.parse(JSON.stringify(row.snoozeDays)), ['2026-08-20']);
});

test('snoozeDays: the row shows the set and can clear it', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.tasks = [seed(c, { start: B, end: B + 4 * DAY, included: true })];
  assert.equal(c.taskSnoozeDayChips(c.state.tasks[0]), null, 'no chips when nothing is put away');

  c.snoozeDay('a', B + DAY);
  const chips = c.taskSnoozeDayChips(c.state.tasks[0]);
  assert.equal(chips.props['data-snoozedays'], '1');

  // The × writes through the same verb the block control does — one way to put a day back.
  const chip = chips.children[0];
  const x = chip.children.find(k => k && k.props && k.props.onClick);
  x.props.onClick({ stopPropagation() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(c.state.tasks[0].snoozeDays)), []);
});

test('snoozeDays: a day key round-trips through dayMsOfKey without a timezone slide', () => {
  const c = make();
  const B = c.startOfToday();
  // "2026-08-20" read by Date.parse is UTC midnight, which is the 19th for anyone west of Greenwich.
  // Building from parts is what keeps a cleared chip clearing the day it names.
  assert.equal(c.dayMsOfKey(c.ymdOf(B)), B);
  assert.equal(c.ymdOf(c.dayMsOfKey('2026-08-20')), '2026-08-20');
  assert.equal(c.dayMsOfKey('nonsense'), null);
});

test('snoozeDays: past days are not offered for clearing', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.tasks = [seed(c, { start: B - 4 * DAY, end: B + 4 * DAY, included: true,
    snoozeDays: [c.ymdOf(B - 2 * DAY), c.ymdOf(B + 2 * DAY)] })];
  const chips = c.taskSnoozeDayChips(c.state.tasks[0]);
  assert.equal(chips.props['data-snoozedays'], '1', 'a skipped day in the past is history, not a decision');
  assert.equal(chips.children[0].props['data-snoozeday'], c.ymdOf(B + 2 * DAY));
});

/* ---------------------------------------------------------------------------
 * Task 20 — the autoscroll RAMP. The gesture itself is e2e territory (a real scroller and a real
 * pointer), but the arithmetic that makes a slow approach nudge rather than lurch is pure, and pure is
 * where it belongs: a speed curve asserted through a browser tells you a number moved, not which one.
 */
test('autoscroll: the step ramps with depth into the zone, and is zero in the middle', () => {
  const c = make();
  const top = 100, bottom = 500;                     // a 400px scroller, 48px zones
  assert.equal(c.autoScrollStep(300, top, bottom), 0, 'the middle scrolls nothing');
  assert.equal(c.autoScrollStep(top + 48, top, bottom), 0, 'the zone edge is not yet in the zone');

  const nudge = c.autoScrollStep(top + 40, top, bottom);
  const shove = c.autoScrollStep(top + 4, top, bottom);
  assert.ok(nudge < 0 && shove < 0, 'both scroll UP near the top edge');
  assert.ok(Math.abs(shove) > Math.abs(nudge), 'deeper in the zone is faster');
  assert.equal(c.autoScrollStep(top - 20, top, bottom), -c.AUTOSCROLL_MAX_PX(),
    'past the edge is capped, not unbounded');

  assert.ok(c.autoScrollStep(bottom - 4, top, bottom) > 0, 'and down near the bottom');
  assert.equal(c.autoScrollStep(bottom + 20, top, bottom), c.AUTOSCROLL_MAX_PX());
});

test('autoscroll: a scroller shorter than two zones does not fight itself', () => {
  const c = make();
  // With 48px zones and a 40px scroller, the two bands would overlap and a pointer in the middle would
  // be told to go both ways. Halving keeps one answer per position.
  const up = c.autoScrollStep(105, 100, 140);
  const down = c.autoScrollStep(135, 100, 140);
  assert.ok(up < 0 && down > 0);
  assert.equal(c.autoScrollStep(120, 100, 140), 0, 'the midpoint is still neutral');
  assert.equal(c.autoScrollStep(0, 100, 100), 0, 'a zero-height scroller is not a scroller');
});
