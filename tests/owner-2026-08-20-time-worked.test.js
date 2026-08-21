const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

/* Chain A, Task 26 — SET time worked, replacing the `+15 min` button.
 *
 * `+15` could only ADD, so correcting an overcount meant undoing your way back to it or living with it.
 * The risk in the replacement is entirely in the per-day ledger: `spent` is the LIFETIME total and
 * `spentByDay` is the daily slice, and a "set" that wrote the lifetime figure would silently erase every
 * other day's work. Every test here is really about that distinction.
 */

const seed = (c, over) => c.normalizeTask(Object.assign({
  id: 'a', name: 'a', type: 'Proportional', included: true, priority: 4, deps: [], pct: 0,
  planned: 120, spent: 0,
}, over || {}));

function withTask(over) {
  const c = make();
  c.state.tasks = [seed(c, over)];
  return { c, t: () => c.state.tasks.find(x => x.id === 'a'), day: c.ymdOf(c.startOfToday()) };
}

test('set time worked: it sets today\'s figure, not the lifetime total', () => {
  const { c, t, day } = withTask({ spent: 500, spentByDay: { '2026-01-02': 480, [null]: 0 } });
  t().spentByDay = { '2026-01-02': 480, [c.ymdOf(c.startOfToday())]: 20 };
  t().spent = 500;

  c.setSpentToday('a', 30);

  assert.equal(t().spentByDay[day], 30, 'today holds exactly what was typed');
  assert.equal(t().spentByDay['2026-01-02'], 480, 'and a past day is untouched');
  assert.equal(t().spent, 510, 'the lifetime total moves by the DELTA (+10), never to the typed figure');
});

test('set time worked: setting a day to less takes the difference off the lifetime total', () => {
  const { c, t, day } = withTask({ spent: 90, spentByDay: {} });
  t().spentByDay = { [day]: 90 };
  c.setSpentToday('a', 15);
  assert.equal(t().spentByDay[day], 15);
  assert.equal(t().spent, 15, 'an overcount corrected down, which "+15" could never do');
});

test('set time worked: a day with nothing logged yet just starts at the typed figure', () => {
  const { c, t, day } = withTask({ spent: 0, spentByDay: {} });
  c.setSpentToday('a', 45);
  assert.equal(t().spentByDay[day], 45);
  assert.equal(t().spent, 45);
});

test('set time worked: zero is a real value, and never goes negative', () => {
  const { c, t, day } = withTask({ spent: 60, spentByDay: {} });
  t().spentByDay = { [day]: 60 };
  c.setSpentToday('a', 0);
  assert.equal(t().spentByDay[day], 0, '"I did not actually work on this" has to be sayable');
  assert.equal(t().spent, 0);
  c.setSpentToday('a', -30);
  assert.equal(t().spentByDay[day], 0, 'and a negative duration is clamped, not stored');
});

test('set time worked: it is ONE commit, so one undo restores the figure', () => {
  const { c, t, day } = withTask({ spent: 20, spentByDay: {} });
  t().spentByDay = { [day]: 20 };
  const before = JSON.parse(JSON.stringify(t()));
  c.setSpentToday('a', 75);
  assert.equal(c.history.length, 1, 'one undoable commit');
  c.undo();
  assert.deepEqual(JSON.parse(JSON.stringify(t())), before);
});

test('set time worked: a running timer is STOPPED first, so the figure you typed is the figure you get', () => {
  const { c, t, day } = withTask({ spent: 0, spentByDay: {} });
  const now = Date.now();
  c.state.nowTick = now;
  c.startTimer('a');
  c.state.nowTick = now + 10 * 60000;          // ten minutes on the clock

  c.setSpentToday('a', 30);

  assert.equal(c.isRunning('a'), false,
    'the point of a box that SETS is that the number stays true a minute later');
  assert.equal(t().spentByDay[day], 30, 'the stopped timer credited, then the set overwrote it');
  assert.equal(c.getSpentOn(t(), c.startOfToday()), 30, 'and nothing is double-counted');
});

test('set time worked: the box shows the figure and speaks the duration grammar', () => {
  const { c, t } = withTask({ spent: 90, spentByDay: {} });
  t().spentByDay = { [c.ymdOf(c.startOfToday())]: 90 };
  const box = c.taskSpentBox(t());
  assert.equal(box.props.defaultValue, '1:30', 'durations render H:MM, never through the clock formatter');

  // Task 15's grammar, so every duration field takes the same words.
  box.props.onBlur({ target: { value: '45m' }, currentTarget: { value: '45m' } });
  assert.equal(c.state.tasks[0].spentByDay[c.ymdOf(c.startOfToday())], 45);
});

test('set time worked: an unreadable value leaves the day alone', () => {
  const { c, t, day } = withTask({ spent: 60, spentByDay: {} });
  t().spentByDay = { [day]: 60 };
  const box = c.taskSpentBox(t());
  const el = { value: 'nonsense' };
  box.props.onBlur({ target: el, currentTarget: el });
  assert.equal(c.state.tasks[0].spentByDay[day], 60, 'a typo must not zero a day of tracked work');
  assert.equal(el.value, '1:00', 'and the box snaps back to what is actually stored');
});

/* ---------------------------------------------------------------------------
 * Task 27 — Planned and Allotted as two real columns. The risk is not the split, it is what happens to a
 * layout SAVED BEFORE it: `colW`, `colHidden` and `colOrder` are persisted by key.
 */
test('two columns: an older saved layout survives, and the new column joins it', () => {
  const c = make();
  // A layout saved before the split: it names `planned` and knows nothing about `allot`.
  c.state.colOrder = ['check', 'name', 'planned', 'pct', 'actions'];
  c.state.colW = { planned: 150 };
  c.state.colHidden = { pct: true };

  const cols = c.orderedCols();
  const byK = {}; cols.forEach(x => { byK[x.k] = x; });
  assert.equal(byK.planned.w, 150, 'the saved width still lands on the column it was saved for');
  assert.equal(byK.pct.hidden, true, 'and the saved hide with it');
  assert.ok(byK.allot, 'the new column appears rather than being dropped for not being in the order');
  assert.equal(byK.allot.w, byK.allot.defW, 'at its default width, since nothing was saved for it');
  assert.equal(cols[0].k, 'check', 'check stays pinned first, as ever');
});

test('two columns: each is independently sizable and hideable', () => {
  const c = make();
  c.state.colW = { planned: 90, allot: 120 };
  c.state.colHidden = { planned: true };
  const byK = {}; c.orderedCols().forEach(x => { byK[x.k] = x; });
  assert.equal(byK.planned.w, 90);
  assert.equal(byK.allot.w, 120);
  assert.equal(byK.planned.hidden, true);
  assert.equal(byK.allot.hidden, false, 'hiding what you type does not hide what the app computes');
  assert.ok(c.visibleCols().some(x => x.k === 'allot'));
  assert.ok(!c.visibleCols().some(x => x.k === 'planned'));
});

test('two columns: planned keeps its three-valued rendering', () => {
  const c = make();
  const cell = over => c.taskPlannedCell(c.normalizeTask(Object.assign(
    { id: 'p', name: 'p', type: 'Proportional' }, over)));
  const valueOf = node => {
    let v = null;
    (function w(n) { if (!n || typeof n !== 'object') return;
      if (n.props && n.props.defaultValue !== undefined) v = n.props.defaultValue;
      (n.children || []).forEach(w); })(node);
    return v;
  };
  assert.equal(valueOf(cell({ planned: null })), '—', 'null is "no estimate"');
  assert.equal(valueOf(cell({ planned: 0 })), '0:00', 'zero is a decision, and must not read as null');
  assert.equal(valueOf(cell({ planned: 90 })), '1:30', 'and a duration is H:MM, not a clock time');
});
