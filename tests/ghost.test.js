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

test('ghostSpan: a double-ghost (both null) derives today→today+1d and never goes overdue', () => {
  const c = make();
  const t = mk(c);
  const g = c.ghostSpan(t, TODAY);
  assert.strictEqual(g.start, TODAY);
  assert.strictEqual(g.end, TODAY + DAY);
  assert.strictEqual(g.ghostStart, true);
  assert.strictEqual(g.ghostEnd, true);
  // Re-derived "tomorrow": the span tracks the new today, so it is still not overdue.
  const g2 = c.ghostSpan(t, TODAY + DAY);
  assert.strictEqual(g2.start, TODAY + DAY);
  assert.ok(g2.end > TODAY + DAY);
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
