// Owner reports, 2026-09-11 — three complaints, and all three are the same class of defect: a control
// whose one click did not do the thing its shape promised.
//
//   1. *"I'll click on a task, and instead of completing it for today, it just clears the allocated time,
//      and then clicking again completes it for today. But shouldn't it just complete it on the first
//      click?"*
//      The circle's catch-up branch RETURNED before the target was looked at, so a repeat carrying missed
//      occurrences took two clicks to finish today. The first one was not merely wasted: clearing the
//      backlog is what `recurBeyondLeadToday`'s carve-out was keeping the task on today FOR, so the row's
//      allotment disappeared while the circle stayed empty — "it just clears the allocated time", exactly.
//
//   2. *"When ticking the checkbox of an included task, immediately make it excluded and unticked until
//      it's triggered. Have a seperate button for a scheduled snooze."*
//      The box asked instead of acting. The durations moved to `taskSnoozeBtn`.
//
//   3. *"pressing snooze today clears the allocated time as expected, but pressing snooze indefinitely
//      doesn't do anything even though there's absolutely no trigger and the indicator shows snoozed."*
//      `isActiveOn`'s today branch tested `snoozeUntil` directly, so it saw only the DATED variant. The
//      indicator went through `snoozeActive` and the scheduler did not — two definitions of "snoozed",
//      which is what `snoozeActive` was created to prevent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, withNow, FIXED_NOW } = require('./_load.js');

const DAY = 86400000;

function comp(){ const c = make(); c.state.tasks = []; return c; }
const get = (c, id) => c.state.tasks.find(t => t.id === id);
// The mocked `createElement` keeps children off `props`, so the glyph is read from the node's own list.
const glyphOf = (c, id) => (c.taskInclControl(get(c, id)).children || []).join('');

/* A daily repeat anchored `daysAgo` before today: a backlog of missed occurrences PLUS one today, which
   is the shape the owner was clicking on. `planned` so the task actually asks the day for minutes. */
function dailyWithBacklog(c, id, daysAgo){
  const start = c.startOfToday() - daysAgo * DAY;
  const t = c.normalizeTask({ id, name: id, start, end: start + DAY - 1, planned: 30,
    included: true, includedExplicit: true, recur: { kind: 'day', n: 1, label: 'day' } });
  c.state.tasks = c.state.tasks.concat([t]);
  c._horizon = c.startOfToday() + 30 * DAY;
  c._occById = {};
  return t;
}

// ---------------------------------------------------------------------------
// 1. One click completes it for today
// ---------------------------------------------------------------------------

test('one click on a repeat with a backlog completes TODAY, not just the past', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    dailyWithBacklog(c, 'standup', 4);
    assert.equal(c.doneForToday(get(c, 'standup')), false, 'premise: today is owed');

    c.toggleDone('standup');

    assert.equal(c.doneForToday(get(c, 'standup')), true,
      'the first click is the one that finishes today — that is the whole report');
    const occ = c.occInDay(get(c, 'standup'), today);
    assert.equal(c.occPct(get(c, 'standup'), occ.idx), 100);
  });
});

test('and it leaves the Included list on that same click, rather than on the second', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    dailyWithBacklog(c, 'standup', 4);
    assert.equal(c.inclBand(get(c, 'standup')), 'included', 'premise: it is asking for time today');

    c.toggleDone('standup');

    /* The visible symptom the owner described: after click one the allotment was gone (the backlog had
       been what held the task on today) while the row still read as unfinished. Now the two agree. */
    assert.equal(c.inclBand(get(c, 'standup')), 'excluded', 'done for today, so it stops asking');
    assert.equal(c.hasWorkToday(get(c, 'standup')), false);
  });
});

test('the backlog is cleared by the same click, in ONE commit', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const today = c.startOfToday();
    dailyWithBacklog(c, 'standup', 4);
    const hist = c.history.length;

    c.toggleDone('standup');

    const after = get(c, 'standup');
    const missed = c.expandTask(after, today + 30 * DAY).filter(o => o.start < today);
    assert.equal(missed.length > 0, true, 'the fixture really does carry a backlog');
    assert.equal(missed.every(o => c.occPct(after, o.idx) >= 100), true, 'and it is cleared');
    assert.equal(c.history.length, hist + 1, 'one gesture is one undo, however many occurrences it wrote');
  });
});

// ---------------------------------------------------------------------------
// 2. The checkbox acts in both directions; the durations get their own button
// ---------------------------------------------------------------------------

test('unticking an included task removes it from today on the click', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const t = activeTask(c, { id: 'p1', start: B - 2 * DAY, end: B + 4 * DAY, included: true,
      includedExplicit: true, planned: 60, pct: 10 });
    c.state.tasks = [t];
    assert.equal(c.isActiveToday(get(c, 'p1')), true, 'premise: on today, with minutes');

    const node = c.taskInclControl(get(c, 'p1'));
    node.props.onClick({ stopPropagation(){}, currentTarget:{ getBoundingClientRect:()=>({left:1,bottom:2}) } });

    assert.equal(!!c.state.inclPick, false, 'no menu was opened');
    assert.equal(c.inclState(get(c, 'p1')), 'snoozed', 'it is off today');
    assert.equal(c.isActiveToday(get(c, 'p1')), false, 'and it has stopped claiming the day');
    assert.equal(c.snoozeIsOpenEnded(get(c, 'p1')), true, 'by the open-ended variant, which needs no date');
  });
});

test("the box renders the state it just wrote: unticked, with 💤 reserved for a scheduled snooze", () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const t = activeTask(c, { id: 'p1', start: B - 2 * DAY, end: B + 4 * DAY, included: true,
      includedExplicit: true, planned: 60, pct: 10 });
    c.state.tasks = [t];

    c.snoozeIndefinitely('p1');
    assert.equal(glyphOf(c, 'p1'), '☐', 'unticked, as the owner asked');

    c.tickOnToday('p1');
    c.snoozeToday('p1');
    assert.equal(glyphOf(c, 'p1'), '💤',
      'a snooze with a DAY keeps the sleep badge — that is how the two off-states stay apart');
  });
});

test('a snoozed box has one move left, so the click performs it instead of asking', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const t = activeTask(c, { id: 'p1', start: B - 2 * DAY, end: B + 4 * DAY, included: true,
      includedExplicit: true, planned: 60, pct: 10 });
    c.state.tasks = [t];
    c.snoozeIndefinitely('p1');

    const node = c.taskInclControl(get(c, 'p1'));
    node.props.onClick({ stopPropagation(){}, currentTarget:{ getBoundingClientRect:()=>({left:1,bottom:2}) } });

    assert.equal(!!c.state.inclPick, false, 'still no menu');
    assert.equal(c.inclState(get(c, 'p1')), 'pressed', 'back on today');
    assert.equal(get(c, 'p1').snoozeIndef, false, 'and the snooze is cleared, not merely overridden');
  });
});

test('the scheduled snooze is a control of its own, on both surfaces, and it is the one that asks', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const t = activeTask(c, { id: 'p1', start: B, end: B + DAY, included: true, planned: 60 });
    c.state.tasks = [t];

    const btn = c.taskSnoozeBtn(get(c, 'p1'));
    assert.equal(btn.props['data-snooze-btn'], 'p1');
    btn.props.onClick({ stopPropagation(){}, currentTarget:{ getBoundingClientRect:()=>({left:1,bottom:2}) } });
    assert.equal(c.state.inclPick && c.state.inclPick.id, 'p1', 'this is what opens the durations');

    /* The card carried a 💤 shortcut that snoozed until tomorrow with no choice offered; it is the shared
       button now, so the two surfaces cannot offer different snooze gestures (the V2.11 parity rule). */
    assert.equal(JSON.stringify(c.planCard(get(c, 'p1'))).includes('"data-snooze-btn":"p1"'), true,
      'the card renders the same builder');
    assert.equal(c.taskSnoozeBtn(c.normalizeTask({ id:'m', name:'m', type:'Milestone' })), null,
      'a milestone has no inclusion and no snooze, exactly as its checkbox slot has none');
  });
});

// ---------------------------------------------------------------------------
// 3. An open-ended snooze removes the time, not just the badge
// ---------------------------------------------------------------------------

test('"snooze indefinitely" with no trigger in sight takes the minutes away', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    /* No start clock, and a window that opened before today: `snoozeWakeReason` has nothing to fire on,
       which is the owner's "absolutely no trigger". */
    const t = activeTask(c, { id: 'p1', start: B - 2 * DAY, end: B + 4 * DAY, included: true,
      includedExplicit: true, planned: 60, pct: 10 });
    c.state.tasks = [t];
    assert.equal(c.isActiveToday(get(c, 'p1')), true, 'premise: it holds a slice of today');

    c.snoozeIndefinitely('p1');

    assert.equal(c.snoozeWakeReason(get(c, 'p1'), B, Date.now()), null, 'the fixture has no wake trigger');
    assert.equal(c.inclState(get(c, 'p1')), 'snoozed', 'the indicator says snoozed');
    assert.equal(c.isActiveToday(get(c, 'p1')), false, 'and the scheduler now says the same');
    assert.equal(c.inclBand(get(c, 'p1')), 'excluded');
  });
});

test('the dated variant is unchanged, and a wake trigger still outranks either', () => {
  withNow(FIXED_NOW, () => {
    const c = comp();
    const B = c.startOfToday();
    const dated = activeTask(c, { id: 'd', start: B - 2 * DAY, end: B + 4 * DAY, included: true,
      includedExplicit: true, planned: 60, pct: 10 });
    c.state.tasks = [dated];
    c.snoozeToday('d');
    assert.equal(c.isActiveToday(get(c, 'd')), false, 'snooze today still clears the day');

    /* The carve-out the 2026-09-09 ruling put inside `snoozeActive`: the day the work itself names beats
       the snooze. Routing `isActiveOn` through that predicate must not lose it — a task whose window opens
       TODAY, snoozed on an earlier day, is back. */
    const woken = activeTask(c, { id: 'w', start: B, end: B + 2 * DAY, included: true,
      includedExplicit: true, planned: 60, pct: 0, snoozeIndef: true, snoozedAt: B - 3 * DAY });
    c.state.tasks = [woken];
    assert.equal(c.snoozeWakeReason(get(c, 'w'), B, Date.now()), 'date', 'the date arriving is the reason');
    assert.equal(c.isActiveToday(get(c, 'w')), true, 'so the task is on today despite the snooze');
  });
});
