// Owner reports 2026-08-21 — the auto-inclusion inversion.
//
// Diagnosis: docs/superpowers/findings/2026-08-21-parser-inclusion-defects.md
//
// A quick-added `test today` did not appear on today's list, and turned up TOMORROW instead;
// `test today at 4pm` appeared on no day at all; `test every day` skipped its first day; and a task
// with NO date was included while the same task WITH a date was not. One line caused all of it —
// `isScheduled` demands BOTH edges, the parser's default (anchor) reading of a bare day supplies only
// a start, and today is the single day in the app decided by a predicate chain that consults
// `isScheduled`. Every other day consults a span helper that handles a one-edge task correctly, which
// is exactly why the task was absent today and present tomorrow.
//
// Owner ruling 2026-08-21, verbatim: "test today at 4pm should be given the default duration and auto
// included today." So a typed start clock with no stated end is a BLOCK of DEFAULT_TASK_MINUTES, not a
// point and not a span to end-of-day.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW, DAY } = require('./_load.js');

// Build the task the quick-add path would build, through the same pure binding quick-add uses.
function quickAdd(c, text, choice){
  const p = c.parseDateText(text, Date.now());
  const shaped = c.shapeParsedTask(p, choice || 'anchor');
  const t = c.normalizeTask(Object.assign({ id:'t1' }, shaped));
  c.state.tasks = [t];
  return t;
}

const days = (c) => ({ today: c.startOfToday(), tomorrow: c.startOfToday() + DAY });

test('owner 2026-08-21: a quick-added day phrase is on TODAY, not tomorrow', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = quickAdd(c, 'test today');
    const { today, tomorrow } = days(c);
    assert.equal(c.isActiveOn(t, today), true, '`test today` must be on today\'s list');
    // It is ALSO on tomorrow, and that is deliberate, not the other half of the bug. A start with no
    // stated end is genuinely open-ended, so `ghostSpan`'s half-ghost branch carries it forward rather
    // than dropping it — the shortest-effort path must never silently lose a task. The defect was the
    // ABSENCE from today, which inverted the two.
    assert.equal(c.isActiveOn(t, tomorrow), true, 'open-ended work carries forward rather than vanishing');
  });
});

test('owner 2026-08-21: a typed start clock with no end gets the default duration and is on today', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = quickAdd(c, 'test today at 4pm');
    const { today, tomorrow } = days(c);
    assert.equal(new Date(t.start).getHours(), 16, 'start is 16:00');
    assert.notEqual(t.end, null, 'a start clock with no stated end must be given an end');
    assert.equal((t.end - t.start) / 60000, c.DEFAULT_TASK_MINUTES,
      'the invented end is exactly DEFAULT_TASK_MINUTES after the start');
    assert.equal(t.startClock, true);
    assert.equal(t.endClock, true, 'the invented end is a real clock, so the block reads as an appointment');
    assert.equal(c.isScheduled(t), true);
    assert.equal(c.isActiveOn(t, today), true, '`test today at 4pm` must be on today\'s list');
    assert.equal(c.isActiveOn(t, tomorrow), false);
    assert.equal(c.requestedMinutes(t, today), c.DEFAULT_TASK_MINUTES,
      'and it asks the day for exactly the default duration');
  });
});

test('owner 2026-08-21: a daily repeat does not skip its first day', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = quickAdd(c, 'test every day');
    assert.ok(t.recur, 'the phrase produced a repeat rule');
    assert.equal(c.isActiveOn(t, c.startOfToday()), true, 'a daily repeat is active on day one');
  });
});

test('owner 2026-08-21: adding a date never demotes a task off today', () => {
  withNow(FIXED_NOW, () => {
    const cases = ['test', 'test today', 'test today at 4pm', 'test today for 30m', 'test today 3pm-4pm'];
    cases.forEach(text => {
      const c = make();
      const t = quickAdd(c, text);
      assert.equal(c.isActiveOn(t, c.startOfToday()), true, `"${text}" must be on today's list`);
    });
  });
});

test('owner 2026-08-21: Included and New agree — a one-edge task auto-included today is also filed New', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = quickAdd(c, 'test today');
    assert.equal(c.autoIncludedToday(t), true, 'today brought it in');
    assert.equal(c.startsToday(t), true, 'so its triage origin is New, not missing');
    assert.equal(c.inclState(t), 'pressed');
  });
});

// The dateless exclusion is a SEPARATE and still-correct rule; it was riding on the same `isScheduled`
// conflation, so widening the guard must not take it with it.
test('owner 2026-08-21: a genuinely dateless task is still not AUTO-included, and a deadline is still not New', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const dateless = quickAdd(c, 'test');
    assert.equal(c.autoIncludedToday(dateless), false,
      'a someday pick is on today only because someone put it there, never because the calendar opened');

    const c2 = make();
    const due = quickAdd(c2, 'test by friday', 'due');
    assert.equal(due.start, null, 'a deadline has no real start edge');
    assert.equal(c2.startsToday(due), false,
      'a ghost start edge is not a window OPENING — otherwise a deadline files as New every day until it');
  });
});

// The THIRD site of the same conflation, and the one the owner actually sees: `onListNow` short-circuited
// on `isScheduled` too, so `onListSince` was never stamped for a one-edge task and `originOf` filed work
// today had just brought in under Upcoming rather than New.
test('owner 2026-08-21: a one-edge task lands in the New bucket, not Upcoming', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = quickAdd(c, 'test today');
    const B = c.startOfToday();
    assert.equal(c.onListNow(t, B, Date.now()), true, 'it is on the list today');
    c.sweepOnListSince(c.state.tasks, B, Date.now());
    assert.equal(c.originOf(t), 'new', 'and today is where it arrived');
  });
});

test('owner 2026-08-21: a dateless task still needs an explicit press to be on the list', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = quickAdd(c, 'test');
    // Quick-add itself presses the button (owner default), so the untouched case has to be built by
    // hand: it is a someday pick nobody has put on today.
    t.included = null;
    assert.equal(c.onListNow(t, c.startOfToday(), Date.now()), false,
      'no date and no press: `ghostSpan` must not manufacture a window here');
    t.included = true;
    assert.equal(c.onListNow(t, c.startOfToday(), Date.now()), true, 'a press is the evidence');
  });
});
