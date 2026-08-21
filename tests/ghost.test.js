// V1.2 ghost blocks — ghostSpan derives a render-time span from null dates WITHOUT mutating the task,
// and dateless tasks stay out of the gcal-outbound diff (their nulls never become a 1970-epoch event).
const { test } = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load');

// A fixed "today" (local midnight) so derivation math is deterministic regardless of wall clock.
const TODAY = new Date(2026, 6, 15).getTime(); // Wed 2026-07-15 00:00 local
const mk = (c, over) => c.normalizeTask(Object.assign(
  { id: 't' + Math.random().toString(36).slice(2, 7), name: 'g', type: 'Proportional',
    start: null, end: null, priority: 4, deps: [], pct: 0, planned: 0 }, over || {}));

test('ghostSpan: a solid task (both dates set) returns the real span, no ghost edges', () => {
  const c = make();
  const t = mk(c, { start: TODAY, end: TODAY + 3 * DAY });
  const g = c.ghostSpan(t, TODAY);
  assert.strictEqual(g.start, TODAY);
  assert.strictEqual(g.end, TODAY + 3 * DAY);
  assert.strictEqual(g.ghostStart, false);
  assert.strictEqual(g.ghostEnd, false);
});

test('ghostSpan: a double-ghost (both null) derives TODAY ONLY and never goes overdue', () => {
  const c = make();
  const t = mk(c);
  const g = c.ghostSpan(t, TODAY);
  assert.strictEqual(g.start, TODAY);
  // owner 2026-08-20 (task 11): the span CLOSES at the last instant of today, not at tomorrow's
  // midnight. Every window test in the app is inclusive of the end DAY, so the old exclusive boundary
  // made an undated task occupy today AND tomorrow.
  assert.strictEqual(g.end, TODAY + DAY - 1);
  assert.strictEqual(c.startOfDay(g.end), TODAY, 'one day, by the test every caller actually applies');
  assert.strictEqual(g.ghostStart, true);
  assert.strictEqual(g.ghostEnd, true);
  // Re-derived "tomorrow": the span tracks the new today, so it is still not overdue.
  const g2 = c.ghostSpan(t, TODAY + DAY);
  assert.strictEqual(g2.start, TODAY + DAY);
  assert.ok(g2.end > TODAY + DAY);
  assert.strictEqual(c.startOfDay(g2.end), TODAY + DAY, 'and it is still exactly one day');
});

test('ghostSpan: a half-ghost (future start, no end) derives a non-overdue end after the start', () => {
  const c = make();
  const t = mk(c, { start: TODAY + 5 * DAY }); // starts next week
  const g = c.ghostSpan(t, TODAY);
  assert.strictEqual(g.start, TODAY + 5 * DAY, 'real start edge is preserved');
  assert.strictEqual(g.ghostStart, false);
  assert.strictEqual(g.ghostEnd, true);
  assert.strictEqual(g.end, TODAY + 5 * DAY + DAY, 'derived end = max(start,today)+1d');
});

test('ghostSpan: a half-ghost with a PAST start spans through today (still actionable)', () => {
  const c = make();
  const t = mk(c, { start: TODAY - 3 * DAY });
  const g = c.ghostSpan(t, TODAY);
  assert.strictEqual(g.start, TODAY - 3 * DAY);
  assert.strictEqual(g.end, TODAY + DAY, 'derived end reaches past today so the bar is not stuck in the past');
  assert.strictEqual(g.ghostEnd, true);
});

test('ghostSpan: a deadline (end set, no start) derives a ghost start at today, up to the due date', () => {
  const c = make();
  const due = TODAY + 4 * DAY;
  const t = mk(c, { end: due });
  const g = c.ghostSpan(t, TODAY);
  assert.strictEqual(g.end, due, 'real due edge is preserved');
  assert.strictEqual(g.start, TODAY, 'ghost start = today (work now until the deadline)');
  assert.strictEqual(g.ghostStart, true);
  assert.strictEqual(g.ghostEnd, false);
});

test('ghostSpan never mutates the task — the nulls stay null in data', () => {
  const c = make();
  const t = mk(c);
  c.ghostSpan(t, TODAY);
  assert.strictEqual(t.start, null);
  assert.strictEqual(t.end, null);
  const t2 = mk(c, { end: TODAY + DAY });
  c.ghostSpan(t2, TODAY);
  assert.strictEqual(t2.start, null, 'a deadline task keeps a null start after derivation');
});

test('a dateless (ghost) task is skipped by the gcal-outbound diff', () => {
  const c = make();
  const ghost = mk(c, { name: 'no dates yet' });
  // A fresh ghost task added to the board must not produce an outbound insert (would be a 1970-epoch event).
  const ops = c.computeOutboundOps([], [ghost]);
  assert.strictEqual(ops.length, 0, 'no gcal op for a dateless task');
  // Once it gets real dates it becomes pushable again (proves the skip is about the nulls, not the task).
  const dated = c.normalizeTask(Object.assign({}, ghost, { start: TODAY, end: TODAY + DAY }));
  const ops2 = c.computeOutboundOps([], [dated]);
  assert.strictEqual(ops2.length, 1);
  assert.strictEqual(ops2[0].op, 'insert');
});

// Chain 6 block 47 retires ghost paint and widened render spans. `ghostSpan` above remains the
// scheduling predicate; recurring anchor derivation below remains scheduling/occurrence data.
// ---- A DATELESS REPEAT STILL EXPANDS FOR SCHEDULING (owner 2026-08-12 / Chain 6 block 47) ----
// renderVals used to hand a recurring task with a missing date an explicitly EMPTY occurrence list, on
// the reasoning that a repeat needs real dates to expand and a dateless one "shouldn't happen". It
// happens on the laziest path there is — type a title, set Daily, never open the date picker — and the
// task then had no occurrence data for the scheduler. The Gantt now deliberately leaves its aligned
// row empty when both raw date edges are null; the derived series remains scheduling data only.

// NOTE on the clock: `recurGhostAnchor` takes `today` as an argument and is tested against the file's
// fixed TODAY. The renderVals tests below CANNOT be — renderVals derives its anchor from the component's
// own `startOfToday()`, and expandTask's `recurStartIndex` trims occurrences relative to that same real
// clock. Mixing the two reads as a failure ~26 days wide (it did on first run). So these tests anchor on
// `c.startOfToday()` and assert relative offsets from it, which is clock-independent.
const recurOccs = (c, list) => { c.state.tasks = list; c.renderVals(); return c._occById; };

test('recurGhostAnchor: only the ANCHOR is derived, and an occurrence is always one day', () => {
  const c = make();
  // No dates at all → anchor today, both edges ghost.
  let a = c.recurGhostAnchor(mk(c), TODAY);
  assert.strictEqual(a.start, TODAY);
  assert.strictEqual(a.end - a.start, DAY);
  assert.strictEqual(a.ghostStart, true);
  assert.strictEqual(a.ghostEnd, true);

  // Start set, no due → anchor the REAL start; the due edge is the ghost one.
  a = c.recurGhostAnchor(mk(c, { start: TODAY - 30 * DAY }), TODAY);
  assert.strictEqual(a.start, TODAY - 30 * DAY, 'a real start anchors the series');
  assert.strictEqual(a.ghostStart, false);
  assert.strictEqual(a.ghostEnd, true);
  // The reason this does not just reuse ghostSpan: ghostSpan returns end = max(start,today)+DAY, which
  // would give this series a 31-day occurrence duration and smear the whole row into one overlap.
  assert.strictEqual(a.end - a.start, DAY, 'an occurrence is one day, never the gap back to today');

  // Due set, no start → anchor the real due.
  a = c.recurGhostAnchor(mk(c, { end: TODAY + 5 * DAY }), TODAY);
  assert.strictEqual(a.start, TODAY + 5 * DAY);
  assert.strictEqual(a.ghostStart, true);
  assert.strictEqual(a.ghostEnd, false);
});

test('a dateless recurring task keeps derived scheduling occurrences instead of an empty list', () => {
  const c = make();
  const daily = mk(c, { id: 'gre', name: 'GRE prep', recur: { kind: 'day', n: 1, label: 'Daily' } });
  const weekly = mk(c, { id: 'wk', name: 'Weekly thing', recur: { kind: 'week', n: 1, label: 'Weekly' } });
  const plain = mk(c, { id: 'plain', name: 'Someday' });
  const occ = recurOccs(c, [daily, weekly, plain]);

  assert.ok(occ.gre.length > 10, 'the daily repeat derives many occurrences, not zero (was [])');
  assert.ok(occ.wk.length > 2, 'so does the weekly one');
  // The RULE drives the expansion — this is not just "some bars appeared".
  assert.ok(occ.gre.length > occ.wk.length * 4,
    'daily produces far more occurrences than weekly over the same horizon');

  for (const o of occ.gre.slice(0, 5)) {
    assert.strictEqual(o.ghost, true, 'every derived occurrence paints as a ghost');
    assert.strictEqual(o.ghostStart, true);
    assert.strictEqual(o.ghostEnd, true);
    assert.strictEqual(o.end - o.start, DAY, 'each occurrence is one day');
  }
  // Indices still come from expandTask, so per-occurrence overrides keep lining up.
  // The spread re-homes the container: `_load.js` runs index.html in a `vm`, so an array built in
  // there carries that realm's Array.prototype and deepStrictEqual rejects it on prototype identity
  // even when every element matches (the same dodge `calendar.gen.test.js` uses). Values untouched.
  assert.deepStrictEqual([...occ.gre.slice(0, 3).map(o => o.idx)], [0, 1, 2]);

  // The task's own dates are NOT written. This must stay a render-time derivation.
  assert.strictEqual(daily.start, null, 'start stays null in data');
  assert.strictEqual(daily.end, null, 'end stays null in data');

  // The non-recurring dateless path is untouched: still exactly one ghost.
  assert.strictEqual(occ.plain.length, 1);
});

test('a half-dated repeat anchors on the date it does have', () => {
  const c = make();
  const today = c.startOfToday();
  const startOnly = mk(c, { id: 'so', start: today - 3 * DAY, recur: { kind: 'day', n: 1, label: 'Daily' } });
  const dueOnly = mk(c, { id: 'do', end: today + 5 * DAY, recur: { kind: 'day', n: 1, label: 'Daily' } });
  const occ = recurOccs(c, [startOnly, dueOnly]);

  assert.strictEqual(occ.so[0].start, today - 3 * DAY, 'the real start anchors the series');
  assert.strictEqual(occ.so[0].ghostStart, false, 'the committed edge is not a ghost edge');
  assert.strictEqual(occ.so[0].ghostEnd, true);

  assert.strictEqual(occ.do[0].start, today + 5 * DAY, 'the real due anchors the series');
  assert.strictEqual(occ.do[0].ghostStart, true);
  assert.strictEqual(occ.do[0].ghostEnd, false);

  for (const o of occ.so.concat(occ.do)) {
    assert.strictEqual(o.end - o.start, DAY, 'no occurrence smears across the gap to today');
  }
});
