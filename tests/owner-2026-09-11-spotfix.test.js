// Owner spotfix session, 2026-09-11. Verbatim:
//
//   "arrows should be rerendered when dates change. Rescheduling a recurring block: if all occurances are
//    merged together, then dragging the start or end should not have a popup for if its an individual or
//    bulk change. 'Included' and 'Focus mode' task lists should only include tasks with non zero time. In
//    particular, if a task is marked as complete for today, even if it is recurring, it should be taken
//    off the list."
//
// Four asks, three predicates. The arrows one is not about re-rendering at all — `renderArrows` runs on
// every paint already — it is about WHICH occurrence the arrow is anchored to, which had drifted away from
// the one the bar draws. The last two are one question ("does this task still ask something of today?")
// asked in the one place both lists share, `inclBand`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

const DAY = 86400000;

function comp(){ const c = make(); c.state.tasks = []; return c; }

/** A repeat anchored `daysAgo` before today, expanded into the render memo the way a paint would. */
function repeat(c, id, kind, daysAgo, over){
  const start = c.startOfToday() - daysAgo * DAY;
  const t = c.normalizeTask(Object.assign({ id, name: id, start, end: start + DAY - 1,
    recur: { kind, n: 1, label: kind } }, over || {}));
  c.state.tasks = c.state.tasks.concat([t]);
  return t;
}
function paint(c, horizonDays){
  c._horizon = c.startOfToday() + (horizonDays || 14) * DAY;
  c._occById = {};
  c.state.tasks.forEach(t => { c._occById[t.id] = c.expandTask(t, c._horizon); });
}
const get = (c, id) => c.state.tasks.find(t => t.id === id);

// ---------------------------------------------------------------------------
// "arrows should be rerendered when dates change"
// ---------------------------------------------------------------------------

test('an arrow anchors on the occurrence the CHART paints, not on occurrence 0', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    repeat(c, 'r', 'day', 5);
    paint(c);
    const t = get(c, 'r');
    const occs = c._occById['r'];
    assert.ok(occs[0].start < c.startOfToday(), 'the fixture really does lead with a PAST occurrence');

    const o = c.arrowOccOf(t, null);
    assert.ok(o, 'a painted repeat always has an anchor');
    assert.ok(o.start >= c.startOfToday(),
      'the anchor is a painted occurrence — past ones are hidden by the bars loop, so an arrow that ' +
      'pointed at one pointed at nothing');
    assert.notEqual(o.start, occs[0].start, 'and specifically not the raw first occurrence');
  });
});

test('a completed occurrence is not an anchor either — the bars loop drops it too', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    repeat(c, 'r', 'day', 0);
    paint(c);
    const t = get(c, 'r');
    const first = c._occById['r'][0];
    assert.equal(c.arrowOccOf(t, null).start, first.start, 'today leads while it is unfinished');

    t.recur.overrides = { [first.idx]: { pct: 100 } };
    assert.ok(c.arrowOccOf(t, null).start > first.start,
      'ticked off, the arrow moves to the next occurrence the chart draws');
  });
});

test('a dependency naming one occurrence anchors on the RUN that holds it', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    repeat(c, 'r', 'day', 0);
    paint(c);
    const t = get(c, 'r');
    // Consecutive days merge into one run, so occurrence 3 is drawn as part of the run starting today.
    const o = c.arrowOccOf(t, 3);
    assert.ok(o.runOccIdxs && o.runOccIdxs.indexOf(3) >= 0, 'the run it is a member of');
    assert.equal(o.start, c._occById['r'][0].start, 'which is the block actually on screen');
  });
});

test('a recurring bar drag moves its arrows with it, not only its block', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    repeat(c, 'r', 'week', 0);   // weekly: every occurrence is its own run, so a drag targets one
    paint(c, 28);
    const t = get(c, 'r');
    const before = c.arrowOccOf(t, null);

    // The shape `onMouseMove` leaves behind mid-gesture: a repeat previews through forceUpdate alone,
    // so `state.tasks` and `_occById` are both deliberately untouched for the whole drag.
    c.dragState = { id: 'r', occIdx: before.idx, mode: 'move', recurring: true, deltaMs: 2 * DAY };
    const during = c.arrowOccOf(t, null);
    assert.equal(during.start, c.addLocalDays(before.start, 2), 'the anchor follows the preview');
    assert.equal(during.end, c.addLocalDays(before.end, 2));

    c.dragState = { id: 'r', occIdx: before.idx, mode: 'end', recurring: true, deltaMs: 3 * DAY };
    const grown = c.arrowOccOf(t, null);
    assert.equal(grown.start, before.start, 'an END drag moves only the trailing edge');
    assert.equal(grown.end, c.addLocalDays(before.end, 3));

    c.dragState = { id: 'other', occIdx: 0, mode: 'move', recurring: true, deltaMs: 9 * DAY };
    assert.equal(c.arrowOccOf(t, null).start, before.start, 'another bar’s drag moves nothing here');
    c.dragState = null;
  });
});

// ---------------------------------------------------------------------------
// "if all occurances are merged together ... should not have a popup"
// ---------------------------------------------------------------------------

test('a fully merged repeat is dragged without being asked which occurrences it meant', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    repeat(c, 'daily', 'day', 0);
    paint(c);
    const idxs = c._occById['daily'].filter(o => o.start >= c.startOfToday()).map(o => o.idx);
    assert.ok(idxs.length > 1, 'the fixture paints several occurrences');
    assert.equal(c.isWholeSeriesRun('daily', idxs), true,
      'consecutive days merge into one block, and one block admits one answer');
  });
});

test('a repeat that paints SEPARATE blocks still asks', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    repeat(c, 'weekly', 'week', 0);
    paint(c, 28);
    const idxs = c._occById['weekly'].filter(o => o.start >= c.startOfToday()).map(o => o.idx);
    assert.ok(idxs.length > 1);
    assert.equal(c.isWholeSeriesRun('weekly', idxs), false,
      'gaps mean the blocks are distinguishable, so the choice is real');
    assert.equal(c.isWholeSeriesRun('weekly', [idxs[0]]), false, 'and one block of many is not the series');
  });
});

test('a run holding only PART of what is painted is not the whole series', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    repeat(c, 'daily', 'day', 0);
    paint(c);
    const idxs = c._occById['daily'].filter(o => o.start >= c.startOfToday()).map(o => o.idx);
    assert.equal(c.isWholeSeriesRun('daily', idxs.slice(0, 2)), false);
  });
});

test('a lone remaining occurrence is not "merged together" — nothing was merged', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = repeat(c, 'twice', 'day', 0);
    c.setSeriesEnd(t, c.startOfToday() + DAY - 1);   // exactly one occurrence left
    paint(c);
    const idxs = c._occById['twice'].filter(o => o.start >= c.startOfToday()).map(o => o.idx);
    assert.equal(idxs.length, 1);
    assert.equal(c.isWholeSeriesRun('twice', idxs), false);
  });
});

test('applyScope can be handed a prompt directly, so the unambiguous drag skips the overlay', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = repeat(c, 'daily', 'day', 0, { included: true });
    paint(c);
    const start0 = t.start;
    c.state.scopePrompt = null;
    c.applyScope('all', { kind: 'date', taskId: 'daily', occIdx: 0,
      payload: { mode: 'move', deltaMs: 2 * DAY, runOccIdxs: [0, 1, 2] } });
    assert.equal(get(c, 'daily').start, c.addLocalDays(start0, 2),
      '"all" moves the series WINDOW — no per-occurrence override residue');
    assert.equal(Object.keys(get(c, 'daily').recur.overrides || {}).length, 0);
  });
});

// ---------------------------------------------------------------------------
// "only tasks with non zero time" / "complete for today ... taken off the list"
// ---------------------------------------------------------------------------

test('a task that asks today for nothing is off the Included and Focus lists', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id: 'z', name: 'z', start: B, end: B, planned: 30, included: true, pct: 0 });
    c.state.tasks = [t];
    assert.equal(c.inclBand(t), 'included', 'a pressed task with minutes on it is on the list');

    t.planned = 0;
    assert.equal(c.requestedMinutes(t, B), 0, 'a deliberate zero asks for zero — the three-valued rule');
    assert.equal(c.inclBand(t), 'excluded', 'so it is not today’s work');
  });
});

test('an unestimated task keeps its default minutes and stays on the list', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id: 'u', name: 'u', start: B, end: B, planned: null, included: true, pct: 0 });
    c.state.tasks = [t];
    assert.ok(c.requestedMinutes(t, B) > 0, 'no estimate is not the same as an estimate of nothing');
    assert.equal(c.inclBand(t), 'included');
  });
});

test('a completed task leaves the list', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id: 'd', name: 'd', start: B, end: B, planned: 30, included: true, pct: 0 });
    c.state.tasks = [t];
    assert.equal(c.inclBand(t), 'included');
    t.pct = 100;
    assert.equal(c.doneForToday(t), true);
    assert.equal(c.inclBand(t), 'excluded');
  });
});

test('ticking off TODAY’s occurrence takes a repeat off the list — the "even if it is recurring" half', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = repeat(c, 'r', 'day', 0, { included: true, planned: 30 });
    paint(c);
    assert.equal(c.inclBand(t), 'included', 'a repeat due today is today’s work');

    const today = c.occInDay(t, c.startOfToday());
    t.recur.overrides = { [today.idx]: { pct: 100 } };
    assert.equal(c.doneForToday(t), true,
      'asked of TODAY’s occurrence — `currentOcc` would have walked on to tomorrow’s and said no');
    assert.equal(c.inclBand(t), 'excluded');
  });
});

test('tomorrow’s occurrence being unfinished does not put a finished today back on the list', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = repeat(c, 'r', 'day', 0, { included: true, planned: 30 });
    paint(c);
    const today = c.occInDay(t, c.startOfToday());
    t.recur.overrides = { [today.idx]: { pct: 100 } };
    // This is the exact expression Focus used to ask, and it is why the row would not leave.
    assert.ok(c.occPct(t, c.currentOccIdx(t)) < 100, 'currentOcc has already moved on');
    assert.equal(c.doneForToday(t), true, 'but today is done, and that is the question the list asks');
  });
});

test('a repeat with no occurrence today is not "done today"', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t = repeat(c, 'w', 'week', 3, { included: true, planned: 30 });
    paint(c, 28);
    assert.equal(c.occInDay(t, c.startOfToday()), null, 'today sits in a gap');
    assert.equal(c.doneForToday(t), false, 'a gap is not a completion');
  });
});

test('the Included filter keeps an excluded PARENT of a zero-time child only when a real child survives', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const mk = (id, over) => c.normalizeTask(Object.assign(
      { id, name: id, start: B, end: B, planned: 30, included: true, pct: 0 }, over || {}));
    // `p` reserves nothing itself, so the only thing that can keep it on the list is a child that survives.
    c.state.tasks = [mk('p', { planned: 0 }), mk('c1', { parentId: 'p', planned: 0 }),
      mk('c2', { parentId: 'p' })];
    let keep = c.inclOnlyKeepSet(c.state.tasks);
    assert.equal(keep.has('c1'), false, 'the zero-time child is gone');
    assert.equal(keep.has('c2'), true);
    assert.equal(keep.has('p'), true, 'and its parent is held up by the child that remains');

    c.state.tasks[2].planned = 0;
    keep = c.inclOnlyKeepSet(c.state.tasks);
    assert.equal(keep.has('p'), false, 'with nothing left under it the parent goes too');
  });
});
