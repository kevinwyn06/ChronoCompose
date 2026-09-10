// Dependency scheduling: the two gaps closed on 2026-08-14.
//
//   Gap 1 — a successor could be dragged into/past its predecessor and was only rubber-banded back by
//           autoSchedule on release. There is now a drag-time clamp (depFloorFor + clampBarToDeps),
//           reading the SAME floor autoSchedule enforces, so affordance and authority cannot disagree.
//   Gap 2 — an OVERDUE, unfinished predecessor did not absorb slack or push its successors, because
//           autoSchedule read its planned dates and never its completion state. Propagation now runs
//           from effectiveEndOf(), the projected end.
//
// Every rung of the owner's stated model is pinned here, including the three parts that ALREADY worked
// and must not regress.
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY } = require('./_load.js');

function mk(c, over) {
  return c.normalizeTask(Object.assign(
    { id: 'z' + Math.random().toString(36).slice(2, 8), name: 't', type: 'Proportional',
      priority: 4, pct: 0, planned: 60, deps: [], recur: null }, over));
}

// A fixed "today" so nothing here depends on the wall clock. autoSchedule/effectiveEndOf take `now`.
const T = new Date(2026, 7, 14).getTime(); // 2026-08-14, local midnight

/* ===================== effective end — the definition itself ===================== */

// 2026-09-09: both ends below are EXCLUSIVE. A date-only `end` is midnight of the task's inclusive last
// day, so the first instant a successor is free is the midnight after it — see `endExclusiveOf`, the one
// place the ordinary / allDay / timed conventions are reconciled.

test('endExclusiveOf: the three conventions `end` carries', () => {
  const c = make();
  const dateOnly = mk(c, { start: T, end: T + 2 * DAY });
  assert.strictEqual(c.endExclusiveOf(dateOnly, dateOnly.end), T + 3 * DAY,
    'a date-only end means "through that day" ⇒ exclusive edge is the next midnight');
  const allDay = mk(c, { start: T, end: T + 2 * DAY, allDay: true });
  assert.strictEqual(c.endExclusiveOf(allDay, allDay.end), T + 2 * DAY,
    'a gcal all-day end is ALREADY the exclusive next midnight — converting it twice would be the bug');
  const timed = mk(c, { start: T, end: T + 2 * DAY + 17 * 3600e3, endClock: true });
  assert.strictEqual(c.endExclusiveOf(timed, timed.end), T + 2 * DAY + 17 * 3600e3,
    'a user-typed clock is already the exact instant work stops');
  assert.strictEqual(c.endExclusiveOf(dateOnly, null), null, 'no end, no edge');
});

test('effectiveEndOf: an unfinished task past its due date projects past the end of today', () => {
  const c = make();
  const A = mk(c, { start: T - 5 * DAY, end: T - 3 * DAY });
  assert.strictEqual(c.plannedEndOf(A), T - 2 * DAY, 'planned end is untouched (as its exclusive edge)');
  // The work has not happened; the soonest it can is today, so today is occupied and a successor is
  // free tomorrow.
  assert.strictEqual(c.effectiveEndOf(A, T), T + DAY, 'projected end is at least the end of today');
});

test('effectiveEndOf: a FINISHED task keeps its planned end even when that is in the past', () => {
  const c = make();
  const A = mk(c, { start: T - 5 * DAY, end: T - 3 * DAY, pct: 100, completion: T - 3 * DAY });
  assert.strictEqual(c.effectiveEndOf(A, T), T - 2 * DAY, 'it really did end there');
});

test('effectiveEndOf: a future end is never pulled forward, and an unscheduled task has none', () => {
  const c = make();
  const A = mk(c, { start: T, end: T + 4 * DAY });
  assert.strictEqual(c.effectiveEndOf(A, T), T + 5 * DAY);
  assert.strictEqual(c.effectiveEndOf(mk(c, { start: null, end: null }), T), null);
});

test('effectiveEndOf: a TIMED end still ahead is not rounded up a day', () => {
  const c = make();
  // Due at 17:00 today, unfinished. It is not overdue, and its successor is free at 17:00 — a task with
  // a real clock is held to the instant, never to the day.
  const A = mk(c, { start: T, end: T + 17 * 3600e3, endClock: true });
  assert.strictEqual(c.effectiveEndOf(A, T), T + 17 * 3600e3);
});

/* ===================== the rungs that already worked (regression guards) ===================== */

test('rung: A dragged EARLIER does not move B', () => {
  const c = make();
  const A = mk(c, { start: T + 3 * DAY, end: T + 4 * DAY });
  const B = mk(c, { start: T + 6 * DAY, end: T + 7 * DAY, deps: [A.id] });
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T + 6 * DAY, 'B has slack and keeps it');
  A.start = T; A.end = T + DAY;                 // drag A earlier
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T + 6 * DAY, 'B is never pulled earlier');
  assert.strictEqual(B.end, T + 7 * DAY);
  assert.ok(!c._schedDisplaced[B.id], 'and it is not marked displaced');
});

test('rung: A dragged LATER but still within the slack does not move B', () => {
  const c = make();
  const A = mk(c, { start: T, end: T + DAY });
  const B = mk(c, { start: T + 6 * DAY, end: T + 7 * DAY, deps: [A.id] });
  A.start = T + 3 * DAY; A.end = T + 4 * DAY;   // 3 days later; B still has 2 days of slack
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T + 6 * DAY, 'the slack absorbed the move');
  assert.strictEqual(B.end, T + 7 * DAY);
});

test('rung: A dragged LATER beyond the slack pushes B, and the slack floors at 0', () => {
  const c = make();
  const A = mk(c, { start: T, end: T + DAY });
  const B = mk(c, { start: T + 6 * DAY, end: T + 7 * DAY, deps: [A.id] });
  A.start = T + 8 * DAY; A.end = T + 9 * DAY;   // 2 days past B's start
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T + 10 * DAY, 'B starts the day after A\'s last day');
  assert.strictEqual(B.end, T + 11 * DAY, 'B keeps its 1-day duration');
  const slack = c.computeSlack([A, B]);
  assert.strictEqual(Math.max(0, slack[B.id]), 0, 'no slack left, and it floors at 0 rather than going negative');
  assert.ok(slack[A.id] < 0.01, 'A is now on the chain too');
});

test('rung: dragging B never moves A', () => {
  const c = make();
  const A = mk(c, { start: T, end: T + 2 * DAY });
  const B = mk(c, { start: T + 2 * DAY, end: T + 3 * DAY, deps: [A.id] });
  B.start = T + 9 * DAY; B.end = T + 10 * DAY;  // drag B far later
  c.autoSchedule([A, B], T);
  assert.strictEqual(A.start, T, 'A untouched');
  assert.strictEqual(A.end, T + 2 * DAY);
  B.start = T; B.end = T + DAY;                 // now drag B back on top of A
  c.autoSchedule([A, B], T);
  assert.strictEqual(A.start, T, 'still untouched — propagation only ever walks successors');
  assert.strictEqual(A.end, T + 2 * DAY);
  assert.strictEqual(B.start, T + 3 * DAY, 'B is the one that gives way');
});

/* ===================== Gap 1 — the drag-time clamp ===================== */

test('gap 1: depFloorFor is the latest predecessor effective end, and null without predecessors', () => {
  const c = make();
  const A = mk(c, { start: T, end: T + 2 * DAY });
  const A2 = mk(c, { start: T, end: T + 5 * DAY });
  const B = mk(c, { start: T + 6 * DAY, end: T + 7 * DAY, deps: [A.id, A2.id] });
  assert.strictEqual(c.depFloorFor(B.id, [A, A2, B], T), T + 6 * DAY, 'the LATEST predecessor end wins');
  assert.strictEqual(c.depFloorFor(A.id, [A, A2, B], T), null, 'no predecessors ⇒ no floor');
  assert.strictEqual(c.depFloorFor(B.id, [A, A2, B], T, [A2.id]), T + 3 * DAY,
    'a skipped predecessor (a dragged subtree member) is not its own floor');
});

test('gap 1: B is clamped at A\'s end during the drag instead of crossing it', () => {
  const c = make();
  const A = mk(c, { start: T, end: T + 2 * DAY });
  const B = mk(c, { start: T + 6 * DAY, end: T + 7 * DAY, deps: [A.id] });
  const floor = c.depFloorFor(B.id, [A, B], T);
  // Drag B five days earlier — it would land at T+1d, one day INSIDE A.
  const raw = c.barDragEdit('move', -5 * DAY, B.start, B.end, B.start, B.end);
  assert.strictEqual(raw.start, T + DAY, 'unclamped, the gesture crosses into A');
  const cl = c.clampBarToDeps('move', raw, floor);
  assert.strictEqual(cl.clamped, true, 'the clamp reports that it bit (this is what draws the barrier)');
  assert.strictEqual(cl.start, T + 3 * DAY, 'B stops at the first day A has left free');
  assert.strictEqual(cl.end, T + 4 * DAY, 'and carries its full 1-day span with it');
});

test('gap 1: the clamp agrees with autoSchedule — the affordance can never disagree with the authority', () => {
  const c = make();
  for (const deltaDays of [-9, -5, -3, -1, 0, 2, 7]) {
    const A = mk(c, { start: T, end: T + 2 * DAY });
    const B = mk(c, { start: T + 6 * DAY, end: T + 7 * DAY, deps: [A.id] });
    const floor = c.depFloorFor(B.id, [A, B], T);
    const raw = c.barDragEdit('move', deltaDays * DAY, B.start, B.end, B.start, B.end);
    const cl = c.clampBarToDeps('move', raw, floor);
    // Now let the authority run on the CLAMPED drop: it must have nothing left to correct.
    B.start = cl.start; B.end = cl.end;
    const before = { s: B.start, e: B.end };
    c.autoSchedule([A, B], T);
    assert.strictEqual(B.start, before.s, 'autoSchedule does not move a clamped drop (delta ' + deltaDays + 'd)');
    assert.strictEqual(B.end, before.e);
  }
});

test('gap 1: the clamp does not fire where it has no authority to', () => {
  const c = make();
  const A = mk(c, { start: T, end: T + 2 * DAY });
  const raw = { start: T, end: T + DAY };
  assert.strictEqual(c.clampBarToDeps('move', raw, null).clamped, false, 'no floor ⇒ no clamp');
  assert.strictEqual(c.clampBarToDeps('end', raw, T + 2 * DAY).clamped, false,
    'an END drag never moves the start, so it is never clamped');
  assert.strictEqual(c.clampBarToDeps('move', { start: T + 5 * DAY, end: T + 6 * DAY }, T + 2 * DAY).clamped, false,
    'a drop already past the floor is left alone');
  // A start-edge drag that would invert the bar is left to autoSchedule rather than producing a bad span.
  const inv = c.clampBarToDeps('start', { start: T, end: T + DAY }, T + 5 * DAY);
  assert.strictEqual(inv.clamped, false);
  assert.strictEqual(inv.start, T, 'untouched — never emit start > end - DAY');
  // A start-edge drag with room clamps the start only.
  const ok = c.clampBarToDeps('start', { start: T, end: T + 6 * DAY }, T + 2 * DAY);
  assert.strictEqual(ok.clamped, true);
  assert.strictEqual(ok.start, T + 2 * DAY);
  assert.strictEqual(ok.end, T + 6 * DAY, 'the far edge is not dragged along by a start-edge clamp');
  assert.ok(A.end === T + 2 * DAY, 'predecessor untouched throughout');
});

/* ===================== Gap 2 — an overdue predecessor absorbs slack and pushes ===================== */

test('gap 2: A overdue by N days pushes B by exactly the overrun', () => {
  for (const N of [1, 3, 11]) {
    const c = make();
    const A = mk(c, { start: T - (N + 2) * DAY, end: T - N * DAY });      // unfinished, N days late
    const B = mk(c, { start: T - N * DAY, end: T - N * DAY + 2 * DAY, deps: [A.id] });
    c.autoSchedule([A, B], T);
    assert.strictEqual(A.start, T - (N + 2) * DAY, 'A itself is NOT moved — only its projection propagates');
    assert.strictEqual(A.end, T - N * DAY, 'A keeps its planned (now overdue) end');
    assert.strictEqual(B.start, T + DAY, 'B starts at A\'s projected end — A still owes today, so B is free tomorrow');
    assert.strictEqual(B.end, T + 3 * DAY, 'duration preserved');
    assert.strictEqual(c._schedDisplaced[B.id], N * DAY, 'displaced by exactly the overrun (' + N + 'd)');
  }
});

test('gap 2: an overdue predecessor eats the slack first, and only overflow moves B', () => {
  const c = make();
  const A = mk(c, { start: T - 4 * DAY, end: T - 2 * DAY });  // 2 days overdue
  const B = mk(c, { start: T + 5 * DAY, end: T + 6 * DAY, deps: [A.id] });
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T + 5 * DAY, 'B had 7 days of slack; a 2-day overrun is absorbed');
  assert.ok(!c._schedDisplaced[B.id], 'and it is not marked displaced, because it did not move');
});

test('gap 2: a FINISHED overdue predecessor pushes nothing', () => {
  const c = make();
  const A = mk(c, { start: T - 5 * DAY, end: T - 3 * DAY, pct: 100, completion: T - 3 * DAY });
  const B = mk(c, { start: T - 2 * DAY, end: T - DAY, deps: [A.id] });
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T - 2 * DAY, 'the work really is done; the plan is not fiction');
  assert.deepStrictEqual(Object.keys(c._schedDisplaced), []);
});

test('gap 2: displacement is attributed all the way down a chain, not lost at the first hop', () => {
  const c = make();
  const A = mk(c, { start: T - 6 * DAY, end: T - 4 * DAY });   // 4 days overdue, unfinished
  const B = mk(c, { start: T - 4 * DAY, end: T - 3 * DAY, deps: [A.id] });
  const C = mk(c, { start: T - 3 * DAY, end: T - 2 * DAY, deps: [B.id] });
  c.autoSchedule([A, B, C], T);
  assert.strictEqual(B.start, T + DAY, 'B pushed past today, which A still owes');
  assert.strictEqual(C.start, T + 3 * DAY, 'C follows B');
  assert.strictEqual(c._schedDisplaced[B.id], 4 * DAY, 'B: 4 days of overrun');
  assert.strictEqual(c._schedDisplaced[C.id], 4 * DAY,
    'C: the SAME 4 days — the credit survives the hop, so C can say why it moved');
});

test('gap 2: propagation is monotone — an overrun never moves anything earlier', () => {
  const c = make();
  const A = mk(c, { start: T - 6 * DAY, end: T - 4 * DAY });
  const B = mk(c, { start: T + 20 * DAY, end: T + 21 * DAY, deps: [A.id] });
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T + 20 * DAY, 'a far-future successor is untouched');
  assert.strictEqual(B.end, T + 21 * DAY);
});

/* ===================== the carve-outs that must survive both gaps ===================== */

test('carve-out: a RECURRING predecessor anchors via currentOcc but is never itself moved', () => {
  const c = make();
  const A = mk(c, { start: T - 10 * DAY, end: T - 10 * DAY + DAY,
    recur: { kind: 'day', n: 1, overrides: {}, shifts: [] } });
  const B = mk(c, { start: T - 10 * DAY, end: T - 9 * DAY, deps: [A.id] });
  const anchor = c.currentOcc(A).end;
  c.autoSchedule([A, B], T);
  assert.strictEqual(A.start, T - 10 * DAY, 'the series is rule-driven and is not rescheduled');
  // 2026-09-09: `end` is the SERIES WINDOW's end and this series is unbounded. What must not move is the
  // anchor (above) and the rule's own occurrence length (here).
  assert.strictEqual(A.end, null);
  assert.strictEqual(c.recurDurMs(A), DAY);
  assert.strictEqual(c.effectiveEndOf(A, T), anchor,
    'and its projection is currentOcc().end verbatim — no overdue projection on a series');
  assert.strictEqual(B.start, Math.max(T - 10 * DAY, anchor), 'B anchors on that occurrence end');
  assert.ok(!c._schedDisplaced[A.id], 'a recurring task is never marked displaced');
});

test('carve-out: a RECURRING successor is left where it is', () => {
  const c = make();
  const A = mk(c, { start: T - 5 * DAY, end: T - 3 * DAY });  // overdue
  const B = mk(c, { start: T - 3 * DAY, end: T - 2 * DAY, deps: [A.id],
    recur: { kind: 'day', n: 1, overrides: {}, shifts: [] } });
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T - 3 * DAY, 'rule-driven dates are not pushed');
  assert.ok(!c._schedDisplaced[B.id]);
});

test('carve-out: a dependency cycle is flagged into _schedWarn and left unscheduled', () => {
  const c = make();
  const A = mk(c, { start: T - 5 * DAY, end: T - 3 * DAY });
  const B = mk(c, { start: T - 3 * DAY, end: T - 2 * DAY });
  A.deps = [B.id]; B.deps = [A.id];
  assert.doesNotThrow(() => c.autoSchedule([A, B], T), 'the overdue projection must not turn a cycle into a hang');
  assert.strictEqual(c._schedWarn, true, 'cycle flagged');
  assert.strictEqual(A.start, T - 5 * DAY, 'neither node is scheduled');
  assert.strictEqual(B.start, T - 3 * DAY);
  assert.deepStrictEqual(Object.keys(c._schedDisplaced), [], 'and nothing is claimed to be displaced');
});

test('carve-out: an unscheduled (dateless) predecessor supplies no floor and no push', () => {
  const c = make();
  const A = mk(c, { start: null, end: null });
  const B = mk(c, { start: T + DAY, end: T + 2 * DAY, deps: [A.id] });
  c.autoSchedule([A, B], T);
  assert.strictEqual(B.start, T + DAY, 'unchanged');
  assert.strictEqual(c.depFloorFor(B.id, [A, B], T), null, 'and the drag has no floor to clamp against');
});
