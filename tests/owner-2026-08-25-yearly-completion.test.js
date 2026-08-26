// Owner report 2026-08-25 — "why does this task get marked as completed anyways it's a recurring task?!"
//
// The subject was a Google-imported birthday: a YEARLY repeat anchored three days ago, showing its
// PASSED date in the due chip and 100% in the % Done column, with no way back except undo.
//
// It is not a completion bug. It is a DISPLAY bug with a completion-shaped symptom, and the mechanism
// is `currentOcc`'s last fallback:
//
//     occs.find(o => o.start >= todayStart && occPct(o.idx) < 100)   // nothing — next one is 12mo out
//  || occs.find(o => o.start >= todayStart)                          // nothing, same reason
//  || occs[occs.length - 1]                                          // ← the PAST occurrence
//
// `occs` comes from `expandTask(t, this._horizon || t.end)`, and `_horizon` is
// `max(furthest non-recurring task end + 75d, recur.until)`. A yearly occurrence is ~362 days out, so
// unless the workspace holds a task ending 287+ days from now the expansion contains ONLY the passed
// occurrence. Clicking the circle then runs the catch-up branch (which is correct and stays — the owner's
// ruling: "if something is overdue it never goes out of view, and clicking complete should bring it up to
// date"), writes pct 100 onto that passed occurrence, and the row goes on displaying it. Complete, passed,
// and stuck.
//
// Owner ruling, verbatim: *"If it's not in the expansion horizon then it should not be both completed and
// shown at the same time altogether."*
//
// So the fix is display-side only. `toggleDone` is untouched. What changes is that a repeat can always
// reach its next occurrence, the same way `nextPendingOcc` already does on its own 366-day horizon —
// which is also why nothing is hidden by the fix: `isOverdueBucket` reports repeats through
// `hasMissedOcc`, independent of `currentOcc`, so the missed occurrence is still surfaced as overdue.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

const DAY = 86400000;

function comp(){ const c = make(); c.state.tasks = []; return c; }

/** A repeat anchored `daysAgo` before today, with NO `_horizon` set — the state a unit component is in,
 *  and the same state the app is in whenever its furthest dated task is nearer than the next occurrence. */
function anchored(c, id, kind, daysAgo){
  const start = c.startOfToday() - daysAgo * DAY;
  const t = c.normalizeTask({ id, name: id, start, end: start + DAY - 1,
    recur: { kind, n: 1, label: kind } });
  /* `kind` is a RECUR_PRESETS key ('day' | 'week' | 'month' | 'year'), NOT the human label:
     `occStart`'s switch falls through to a WEEKLY default on anything it does not recognise, which
     silently turns a mistyped yearly fixture into a weekly one that passes for the wrong reason. */
  c.state.tasks = c.state.tasks.concat([t]);
  return t;
}
const get = (c, id) => c.state.tasks.find(t => t.id === id);

test('a yearly repeat whose next occurrence is beyond the expansion horizon never displays a PASSED occurrence', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    anchored(c, 'bday', 'year', 3);

    const d = c.taskDisp(get(c, 'bday'));
    assert.ok(d.curOcc, 'a repeat always resolves to some occurrence');
    assert.ok(d.curOcc.start >= c.startOfToday(),
      'the displayed occurrence is the NEXT one, not the one that already passed');
    assert.equal(d.done, false, 'and an untouched birthday is not done');
  });
});

test('clicking the circle on a passed yearly occurrence brings it up to date instead of sticking at 100%', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    anchored(c, 'bday', 'year', 3);

    /* This is the owner's gesture, and the reported symptom. Catch-up is deliberately unchanged: the
       click SHOULD clear the missed occurrence. What must not happen is the row then reporting itself
       as a completed task. */
    c.toggleDone('bday');

    const d = c.taskDisp(get(c, 'bday'));
    assert.equal(d.done, false, 'the task is up to date, not completed');
    assert.equal(d.dispPct, 0, 'and the percentage shown belongs to the next occurrence');
    assert.ok(d.curOcc.start >= c.startOfToday(), 'which is in the future');
  });
});

test('the missed occurrence is still cleared by that click — catch-up is untouched', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const t0 = anchored(c, 'bday', 'year', 3);
    const missedIdx = c.expandTask(t0, c.startOfToday()).find(o => o.start < c.startOfToday()).idx;

    c.toggleDone('bday');

    assert.equal(c.occPct(get(c, 'bday'), missedIdx), 100,
      'the occurrence the user actually missed was marked done');
  });
});

test('an overdue yearly repeat is still reported as overdue before the click — the fix hides nothing', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    anchored(c, 'bday', 'year', 3);
    /* The load-bearing negative. Moving the DISPLAY forward must not move the task out of the overdue
       bucket: `isOverdueBucket` reads `hasMissedOcc`, not `currentOcc`, for exactly this reason. If this
       ever goes red, the fix has traded one silent drop for another. */
    assert.equal(c.isOverdueBucket(get(c, 'bday')), true,
      'a birthday missed three days ago is still owed');
  });
});

/* Not a control — this was RED before the fix too. Any repeat whose next occurrence sits outside the
   chart horizon fell back to the past; yearly is simply the rule that hits it in practice, because a
   daily repeat's next occurrence is inside almost any horizon the app ever computes. Kept so the fix is
   pinned as a general rule about repeats rather than a yearly special case. */
test('the same rule holds for a daily repeat — a passed occurrence is never the one displayed', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    anchored(c, 'daily', 'day', 3);
    const d = c.taskDisp(get(c, 'daily'));
    assert.ok(d.curOcc.start >= c.startOfToday(), 'shows today or later, never the missed one');
    assert.equal(d.done, false);
  });
});

test('a BOUNDED series that is entirely finished still resolves, and does not invent an occurrence', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const start = c.startOfToday() - 30 * DAY;
    const t = c.normalizeTask({ id: 'done-series', name: 'done-series', start, end: start + DAY - 1,
      recur: { kind: 'year', n: 1, label: 'Yearly', until: start + DAY } });
    c.state.tasks = [t];
    /* `until` is before today, so there is genuinely nothing ahead. The fallback to the last occurrence
       is CORRECT here — the fix must only bypass it when a real future occurrence exists. */
    const d = c.taskDisp(get(c, 'done-series'));
    assert.ok(d.curOcc, 'a finished bounded series still has something to display');
    assert.ok(d.curOcc.start < c.startOfToday(), 'and it is the last occurrence, which is in the past');
  });
});
