// Owner rulings 2026-08-24 — the completion circle, and how far ahead a repeat reaches.
//
// TWO rulings, and they are the same complaint seen from two sides: a repeat was showing the user
// information about a future they had not asked about, and letting them act on it by accident.
//
//   THE CIRCLE NEVER REACHES FORWARD. The old ladder advanced — click 1 completed the current
//   occurrence, click 2 completed the NEXT one. On a yearly birthday click 2 silently marked an
//   occurrence twelve months out as done, and the un-complete branch could not rescue it: it only fired
//   once EVERY upcoming occurrence was done, which for an unbounded series is never. The circle is now a
//   plain toggle over ONE occurrence, the first on or after today.
//
//   THE LEAD WINDOW. "You never see more than one period ahead, and never more than 30 days ahead."
//   A daily standup's next instance is tomorrow and belongs on the surface as soon as today's is done;
//   a birthday's is eleven months out and does not. Nothing is deleted — the series, its overrides and
//   its Gantt row are untouched. The occurrence is simply not yet today's business.
//
// The load-bearing negative in this file is the OVERDUE case: the lead window must never gate an
// occurrence the user actually missed, or the standing tenet (the laziest path must not silently drop a
// deadline) would be broken by the very rule meant to reduce noise.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, withNow, FIXED_NOW } = require('./_load.js');

const DAY = 86400000;

function comp(){ const c = make(); c.state.tasks = []; return c; }

// A repeat anchored on a given day. `kind` is the recurrence rule's kind.
function repeating(c, id, kind, startMs, extra){
  const t = c.normalizeTask(Object.assign({
    id, name: id, start: startMs, end: startMs + DAY - 1,
    recur: Object.assign({ kind, n: 1, label: kind }, (extra && extra.recur) || {}),
  }, extra && extra.task));
  c.state.tasks = c.state.tasks.concat([t]);
  return t;
}
const get = (c, id) => c.state.tasks.find(t => t.id === id);
// The occurrence the circle acts on: the first on or after today.
function targetIdx(c, t){
  const B = c.startOfToday();
  return (c.expandTask(t, B + 800 * DAY).find(o => o.start >= B) || {}).idx;
}
const pctOfTarget = (c, id) => { const t = get(c, id); return c.occPct(t, targetIdx(c, t)); };

// ---------------------------------------------------------------------------
// The circle
// ---------------------------------------------------------------------------

test('circle: a second click UNDOES the completion instead of advancing to the next occurrence', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    repeating(c, 'bday', 'year', today);

    c.toggleDone('bday');
    assert.equal(pctOfTarget(c, 'bday'), 100, 'click 1 completes today’s occurrence');

    c.toggleDone('bday');
    assert.equal(pctOfTarget(c, 'bday'), 0, 'click 2 undoes it');

    c.toggleDone('bday');
    assert.equal(pctOfTarget(c, 'bday'), 100, 'and it is a toggle, not a one-way door');
  });
});

// THE DEFECT THE RULING WAS WRITTEN FOR. Under the old ladder this assertion failed: the second click
// found the next uncompleted occurrence — a year away — and completed it. Nothing on any surface would
// have shown the user that it had happened.
test('circle: no occurrence beyond today is ever touched, however many times it is clicked', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    repeating(c, 'bday', 'year', today);

    for (let i = 0; i < 5; i++) c.toggleDone('bday');

    const t = get(c, 'bday');
    const mine = targetIdx(c, t);
    const overrides = (t.recur && t.recur.overrides) || {};
    const touched = Object.keys(overrides).filter(k => {
      const o = overrides[k];
      return o && (o.pct != null || o.completion != null);
    });
    assert.deepEqual(touched, [String(mine)],
      'exactly one occurrence carries a completion override, and it is today’s');
  });
});

test('circle: the catch-up branch survives — missed occurrences still clear in one click', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    // A daily repeat anchored four days ago: three missed days plus today.
    const t = repeating(c, 'standup', 'day', today - 4 * DAY);
    c._horizon = today + 30 * DAY;
    c._occById = {};

    c.toggleDone('standup');

    const after = get(c, 'standup');
    const missed = c.expandTask(after, today + 30 * DAY).filter(o => o.start < today);
    assert.equal(missed.length > 0, true, 'the fixture really does have missed occurrences');
    assert.equal(missed.every(o => c.occPct(after, o.idx) >= 100), true,
      'every missed occurrence is cleared, because clearing a backlog is what that click means');
    assert.equal(pctOfTarget(c, 'standup'), 0,
      'and today’s is NOT swept up with them — the catch-up click is about the past only');
  });
});

// ---------------------------------------------------------------------------
// The lead window
// ---------------------------------------------------------------------------

test('lead window: one period, capped at 30 days', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    assert.equal(c.recurLeadDays({ recur: { kind: 'day', n: 1 } }), 1);
    assert.equal(c.recurLeadDays({ recur: { kind: 'week', n: 1 } }), 7);
    assert.equal(c.recurLeadDays({ recur: { kind: 'year', n: 1 } }), c.RECUR_LEAD_MAX_DAYS,
      'a year is capped — the cap is what makes the birthday case work');
    assert.equal(c.recurLeadDays({ recur: { kind: 'month', n: 1 } }), c.RECUR_LEAD_MAX_DAYS,
      'a month is just over the cap, so it clamps rather than reaching 30.44 days');
  });
});

test('lead window: a completed birthday leaves the surface; the daily standup stays', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    repeating(c, 'bday', 'year', today);
    repeating(c, 'standup', 'day', today);
    c._horizon = today + 400 * DAY;
    c._occById = {};

    assert.equal(c.originOf(get(c, 'bday')) != null, true, 'before completing, the birthday is on the surface');

    c.toggleDone('bday');
    c.toggleDone('standup');

    assert.equal(c.originOf(get(c, 'bday')), null,
      'next year is not today’s business, so the birthday leaves rather than showing a date 12 months out');
    assert.equal(c.originOf(get(c, 'standup')), 'upcoming',
      'tomorrow IS today’s business, so the daily repeat moves bucket instead of leaving');
  });
});

// THE OWNER REPORT, 2026-08-25: "I still don't see a resolution for yearly recurring tasks not hiding
// itself." The window was only ever consulted on the ONE day the occurrence falls on: `originOf` reached
// it inside `if (occ && occ.idx != null && occPct >= 100)`, and `occInDay` is null on every other day. So
// a birthday ticked off on the day did leave the surface that day — and reappeared the next morning, and
// every morning after, for eleven months, because the gate was no longer reachable. These two tests are
// the day AFTER, which is the case the original pair never asked about.
test('lead window: a settled yearly repeat stays gone the DAY AFTER, not just on the day', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    // Anchored three days ago: the occurrence is settled and behind us, the next one is ~362 days out.
    const t = repeating(c, 'bday', 'year', today - 3 * DAY);
    c._horizon = today + 400 * DAY;
    c._occById = {};

    const past = c.expandTask(t, today + 400 * DAY).find(o => o.start < today);
    assert.notEqual(past, undefined, 'the fixture has an occurrence before today');
    c.commit(tasks => {
      const x = tasks.find(y => y.id === 'bday');
      x.recur.overrides = { [past.idx]: { pct: 100, completion: Date.now() } };
    });

    assert.equal(c.occInDay(get(c, 'bday'), today), null,
      'the fixture really is a day with NO occurrence — which is the case that used to slip through');
    assert.equal(c.originOf(get(c, 'bday')), null,
      'next year is still not today’s business on the day after; the birthday stays off the surface');
  });
});

test('lead window: a daily repeat on a day it has no occurrence is NOT hidden by the same gate', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    // A weekday rule anchored so that today may or may not carry an occurrence; either way its next one
    // is days, not months, away — so the gate must never remove it. This is the guard that stops the fix
    // above from becoming "any repeat without an occurrence today disappears".
    repeating(c, 'standup', 'weekday', today - 3 * DAY);
    c._horizon = today + 400 * DAY;
    c._occById = {};
    assert.notEqual(c.originOf(get(c, 'standup')), null,
      'a repeat whose next occurrence is inside the window stays, occurrence today or not');
  });
});

test('lead window: the series is not deleted — the birthday comes back inside the window', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    // Anchored a year and a fortnight ago, so the NEXT occurrence is ~14 days out: inside the 30-day cap.
    const t = repeating(c, 'bday', 'year', today - 365 * DAY + 14 * DAY);
    c._horizon = today + 400 * DAY;
    c._occById = {};

    const B = today;
    const past = c.expandTask(t, B + 400 * DAY).find(o => o.start < B);
    assert.notEqual(past, undefined, 'the fixture has a settled past occurrence');
    // Settle it, so the task is not merely overdue.
    c.commit(tasks => {
      const x = tasks.find(y => y.id === 'bday');
      x.recur.overrides = { [past.idx]: { pct: 100, completion: Date.now() } };
    });

    assert.notEqual(c.originOf(get(c, 'bday')), null,
      'within 30 days of the next occurrence the birthday is back on the surface');
  });
});

// THE NEGATIVE THIS FILE EXISTS FOR. The window reduces noise; it must never be the reason a missed
// deadline goes quiet. Overdue outranks it, exactly as it outranks every other bucket.
// THE SECOND SURFACE. `originOf` decides which triage BUCKET a task sits in; `isActiveOn` decides
// whether it takes a slice of TODAY. Gating only the first left the two disagreeing about the same task:
// the list said "not today's business" while the timeline kept drawing a block and claiming minutes,
// every day, for eleven months. `included===true` is what made it stick — a real press, and V2.11 retired
// the "Off" that used to clear it.
test('lead window: a pressed yearly repeat stops claiming time on today, not just its bucket', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    const t = repeating(c, 'bday', 'year', today - 3 * DAY,
      { task: { included: true, includedExplicit: true } });
    c._horizon = today + 400 * DAY;
    c._occById = {};
    const past = c.expandTask(t, today + 400 * DAY).find(o => o.start < today);
    c.commit(tasks => {
      const x = tasks.find(y => y.id === 'bday');
      x.recur.overrides = { [past.idx]: { pct: 100, completion: Date.now() } };
    });

    assert.equal(c.isActiveToday(get(c, 'bday')), false,
      'a press says WHEN to do the work, not that work eleven months out is due now');
    assert.equal(c.originOf(get(c, 'bday')), null, 'and the two surfaces agree');
  });
});

test('lead window: a pressed DAILY repeat is untouched by the same gate', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    repeating(c, 'standup', 'day', today - 3 * DAY,
      { task: { included: true, includedExplicit: true } });
    c._horizon = today + 400 * DAY;
    c._occById = {};
    assert.equal(c.isActiveToday(get(c, 'standup')), true,
      'tomorrow IS today’s business, so nothing about a daily repeat changes');
  });
});

// The carve-out this gate cannot ship without. `nextPendingOcc` looks FORWARD from today, so a renewal
// missed last week is not in it; gating on "the next one is eleven months out" would take a genuinely
// owed deadline off today's list — the silent drop the standing tenet forbids, committed by the rule
// meant to reduce noise.
test('lead window: a MISSED yearly occurrence still claims today, however far the next one is', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    // Anchored three days ago and never completed: the occurrence has ended, unfinished.
    repeating(c, 'renewal', 'year', today - 3 * DAY,
      { task: { included: true, includedExplicit: true } });
    c._horizon = today + 400 * DAY;
    c._occById = {};

    assert.equal(c.hasMissedOcc(get(c, 'renewal')), true, 'the fixture really is a missed occurrence');
    assert.equal(c.recurBeyondLeadToday(get(c, 'renewal')), false, 'owed work is never gated');
    assert.equal(c.isActiveToday(get(c, 'renewal')), true, 'and it keeps its place on today');
    assert.equal(c.originOf(get(c, 'renewal')), 'overdue', 'overdue outranks the window, as it always did');
  });
});

// Fail-safe direction. `recurPeriodDays` and `occStart` both fall back for an unrecognised `kind`, and
// their fallbacks disagree — so an unreadable rule must not be judged at all. Treating "I could not tell"
// as "hide it" would make legacy data silently vanish from today.
test('lead window: an unreadable recurrence rule is never gated', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    // The RRULE-ish `{freq}` shape rather than the local `{kind}` one. `rruleToRecur` converts between
    // them, but older data and fixtures still carry this.
    const t = c.normalizeTask({ id: 'legacy', name: 'legacy', start: today - 3 * DAY,
      end: today - 3 * DAY + DAY - 1, included: true,
      recur: { freq: 'DAILY', interval: 1 } });
    c.state.tasks = [t];
    c._horizon = today + 400 * DAY;
    c._occById = {};
    assert.equal(c.recurKindKnown(t.recur), false, 'the fixture really is an unreadable rule');
    assert.equal(c.recurBeyondLeadToday(t), false, 'so the gate declines to act rather than guessing');
    assert.equal(c.isActiveToday(t), true, 'and the task stays visible');
  });
});

test('lead window: an OVERDUE occurrence is never gated, however far the next one is', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    // A yearly repeat whose occurrence was three days ago and was never completed.
    repeating(c, 'renewal', 'year', today - 3 * DAY);
    c._horizon = today + 400 * DAY;
    c._occById = {};

    assert.equal(c.originOf(get(c, 'renewal')), 'overdue',
      'a missed yearly renewal still reaches the user — the next one being a year out is irrelevant');
  });
});

test('lead window: measured from the start of today, so it cannot flip part-way through a day', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const t = { recur: { kind: 'year', n: 1 } };
    const edge = { idx: 0, start: B + c.RECUR_LEAD_MAX_DAYS * DAY };
    // Same occurrence, two very different moments within the same day: one answer.
    assert.equal(c.occWithinLead(t, edge, B + 60000), true);
    assert.equal(c.occWithinLead(t, edge, B + 23 * 3600000), true,
      'late in the day the answer is the same, because the window is measured from midnight');
    assert.equal(c.occWithinLead(t, { idx: 0, start: B + (c.RECUR_LEAD_MAX_DAYS + 1) * DAY }, B), false,
      'and one day past the cap is out');
  });
});

// `recurStartIndex` now divides by `recurPeriodDays` rather than keeping a second per-kind table. That
// is a refactor, so it needs a test that the two agree — the drift it removes is invisible otherwise.
test('recurPeriodDays is the single definition of a period, shared with recurStartIndex', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const RULES = [
      { kind: 'day', n: 1 }, { kind: 'day', n: 3 }, { kind: 'week', n: 1 }, { kind: 'week', n: 2 },
      { kind: 'weekday' }, { kind: 'weekdays', days: ['Mon', 'Wed', 'Fri'] },
      { kind: 'month', n: 1 }, { kind: 'monthDay', day: 12 }, { kind: 'year', n: 1 },
    ];
    for (const r of RULES) {
      const per = c.recurPeriodDays(r);
      assert.equal(per > 0, true, r.kind + ' has a positive period');
      const start = FIXED_NOW - 200 * DAY;
      const i = c.recurStartIndex(start, r, FIXED_NOW);
      assert.equal(i, Math.max(0, Math.floor((200 * DAY / DAY) / per) - c.RECUR_BACKOFF),
        r.kind + ': the index estimate is exactly days/period, backed off');
    }
  });
});
