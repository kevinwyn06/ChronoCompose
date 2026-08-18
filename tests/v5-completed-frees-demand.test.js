// Chain 4 / block 34 — a COMPLETED task stops consuming the day's pool.
//
// Owner ruling 2026-08-11: *"Yes — free it on completion."*
//
// The bug: a finished task still on the board asked the day for its full `planned` figure forever.
// `autoArchiveDays:0` merely MASKED this — and a recurring series is never auto-archived at all, so
// archiving could never have been the fix. The day stayed permanently over-subscribed and the work
// kept being allotted timeline space it no longer needed.
//
// The rule, and the part that is easy to get wrong: what is freed is the REMAINING demand only. The
// minutes already spent today stay spent, because the day really did contain that work — completing
// something at 60% done must not retroactively empty the morning.
//
// NOT IN SCOPE, and asserted here so a later block cannot drift into it: `planned` is still
// minutes-planned-for-a-DAY, and deliberate over-subscription by UNFINISHED work is still a feature.
// An unfinished task asks for its whole figure exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, cleanDay } = require('./_load.js');

const HOUR = 3600000;

/* Local `YYYY-MM-DD`, matching `ymdOf`. The fixture builder below runs before the component exists, so
   it cannot borrow the component's own copy. */
function ymd(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* A plain 09:00–17:00 day with a single flexible task, so `demand` is attributable to exactly one
   thing and there is nothing else in the pool to confuse a reading. */
function day(tasks) {
  const c = make();
  cleanDay(c, '23:59');
  Object.assign(c.state.settings, { dayStart: '09:00', dayEnd: '17:00', breakMin: 0 });
  const today = c.startOfToday();
  /* Accepts a FUNCTION of `today` as well as a plain list: a fixture that needs to stamp a completion
     date cannot reference `today` before this helper has computed it. */
  const list = typeof tasks === 'function' ? tasks(today) : (tasks || []);
  c.state.tasks = list.map((t) => c.normalizeTask(Object.assign({
    type: 'Proportional', priority: 4, deps: [], pct: 0, spent: 0,
    start: today, end: today + 6 * HOUR, included: true,
  }, t)));
  return { c, today };
}

test('block 34 — an UNFINISHED task asks the day for its whole planned figure (unchanged)', () => {
  const { c, today } = day([{ id: 'a', name: 'a', planned: 120 }]);
  const cap = c.dayCapacity(today);
  assert.equal(cap.remaining, 120, 'still owed in full');
  assert.equal(cap.demand, 120);
});

test('block 34 — completing a task frees its remaining demand', () => {
  const { c, today } = day((today) => [{ id: 'a', name: 'a', planned: 120, pct: 100, completion: today }]);
  const cap = c.dayCapacity(today);
  assert.equal(cap.remaining, 0, 'a finished task asks the day for nothing');
});

test('block 34 — the minutes already SPENT today survive completion', () => {
  /* Finished at 60%: 72 of the 120 minutes were really worked this morning. Freeing the remainder must
     not erase them — `demand` (what the day was asked for in total) still reports them. */
  const { c, today } = day((today) => [{
    id: 'a', name: 'a', planned: 120, pct: 100, completion: today,
    spent: 72, spentByDay: { [ymd(today)]: 72 },
  }]);
  const cap = c.dayCapacity(today);
  assert.equal(cap.remaining, 0, 'nothing further is owed');
  assert.equal(cap.demand, 72, 'the morning that actually happened is still on the bar');
});

test('block 34 — a completed task with no logged time contributes nothing at all', () => {
  const { c, today } = day((today) => [{ id: 'a', name: 'a', planned: 120, pct: 100, completion: today }]);
  assert.equal(c.dayCapacity(today).demand, 0);
});

test('block 34 — UN-completing restores the demand symmetrically', () => {
  const { c, today } = day((today) => [{ id: 'a', name: 'a', planned: 120, pct: 100, completion: today }]);
  assert.equal(c.dayCapacity(today).remaining, 0);
  /* `doneOn` is derived, never stored, so clearing the completion is enough — there is no second
     piece of state that could fall out of step. */
  c.state.tasks[0].pct = 0;
  c.state.tasks[0].completion = null;
  assert.equal(c.dayCapacity(today).remaining, 120, 'the demand comes straight back');
});

test('block 34 — a task completed YESTERDAY does not keep asking today for its minutes', () => {
  const { c, today } = day([]);
  const t = c.normalizeTask({
    id: 'a', name: 'a', type: 'Proportional', priority: 4, deps: [], planned: 120, spent: 0,
    pct: 100, completion: today - 24 * HOUR,
    start: today - 24 * HOUR, end: today + 6 * HOUR,
  });
  c.state.tasks = [t];
  assert.equal(c.dayCapacity(today).remaining, 0, 'done on Monday is done on Tuesday');
});

test('block 34 — a completed task no longer takes an allotment', () => {
  /* The arithmetic above is only half the fix. If a finished task still received allotted minutes it
     would keep occupying the timeline, and a banner reading "all done" over a visible block would be
     worse than the original bug. */
  const { c, today } = day((today) => [
    { id: 'a', name: 'a', planned: 120, pct: 100, completion: today },
    { id: 'b', name: 'b', planned: 120 },
  ]);
  const map = c.computeAllotted(c.state.tasks, today, {});
  assert.equal((map.a && map.a.allotted) || 0, 0, 'the finished task is out of the pool');
  assert.ok(((map.b && map.b.allotted) || 0) > 0, 'the unfinished one still gets time');
});

test('block 34 — a completed SUBTASK returns its share to its siblings, not to nobody', () => {
  /* The family split has its own weighting pass. If it did not free what the pool split freed, the
     two halves of the same fix would disagree and a parent would quietly lose the freed minutes. */
  const { c, today } = day((today) => [
    { id: 'p', name: 'p', planned: 120 },
    { id: 'k1', name: 'k1', planned: 60, parentId: 'p', pct: 100, completion: today },
    { id: 'k2', name: 'k2', planned: 60, parentId: 'p' },
  ]);
  const map = c.computeAllotted(c.state.tasks, today, {});
  assert.equal((map.k1 && map.k1.allotted) || 0, 0, 'the finished child weighs nothing');
  assert.ok(((map.k2 && map.k2.allotted) || 0) > 0, 'the sibling absorbs the family share');
});

test('block 34 — doneOn is per-OCCURRENCE for a recurring series', () => {
  /* A series completed yesterday still owes today its next occurrence. This is exactly why `doneOn`
     is distinct from a bare `pct >= 100` check. */
  const { c, today } = day([]);
  const t = c.normalizeTask({
    id: 'r', name: 'r', type: 'Proportional', priority: 4, deps: [], planned: 60, spent: 0, pct: 0,
    start: today - 24 * HOUR, end: today + 30 * 24 * HOUR,
    recur: { freq: 'daily', every: 1, overrides: {} },
  });
  assert.equal(c.doneOn(t, today), false, 'an untouched occurrence is not done');
});

test('block 34 — a MILESTONE is never "done" for demand purposes (it allots nothing anyway)', () => {
  const { c, today } = day([]);
  const m = c.normalizeTask({
    id: 'm', name: 'm', type: 'Milestone', priority: 4, deps: [], planned: 0, spent: 0, pct: 100,
    completion: today, start: today, end: today,
  });
  assert.equal(c.doneOn(m, today), false);
});

test('block 34 — `planned` semantics are UNCHANGED: unfinished work may still over-subscribe a day', () => {
  /* The standing rule this block must not break. Three unfinished 4-hour tasks against an 8-hour
     window is a deliberate over-subscription and must still read as one. */
  const { c, today } = day([
    { id: 'a', name: 'a', planned: 240 },
    { id: 'b', name: 'b', planned: 240 },
    { id: 'c', name: 'c', planned: 240 },
  ]);
  const cap = c.dayCapacity(today);
  assert.equal(cap.remaining, 720, 'the day is asked for 12 hours');
  assert.ok(cap.over, 'and it says so');
});
