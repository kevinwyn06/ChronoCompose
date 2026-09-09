// Owner ruling 2026-09-09 — inclusion follows the dates.
//
// Owner, verbatim: *"I want the vast majority of tasks to be included as their start and end dates
// state, unless explicitly overridden by the user, in which case the backend should take a note of that
// and not automatically update inclusion based on date edits. Auto inclusion should update every time
// dates are edited directly."* And, on snoozing: *"When time passes and today's date triggers an event,
// snoozed events should become autoincluded again."*
//
// The derivation itself already ran on every read. What did not follow the dates were the two things
// layered over it — a snooze, and an inherited `included===true` with no provenance. Both are cleared by
// a direct date edit; an EXPLICIT press is the note the owner asked the backend to take, and survives.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY, withNow, FIXED_NOW } = require('./_load.js');

const HOUR = 3600000;

function dated(c, over) {
  const B = c.startOfToday();
  return c.normalizeTask(Object.assign({
    id: 'a', name: 'task', type: 'Proportional', start: B + 2 * DAY, end: B + 4 * DAY,
    priority: 4, deps: [], pct: 0, planned: 60,
  }, over || {}));
}

// ---------------------------------------------------------------------------
// A date edit re-derives.
// ---------------------------------------------------------------------------
test('setDate clears a snooze — re-dating work restates when it happens', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = dated(c, { snoozeUntil: c.startOfToday() + 10 * DAY, snoozedAt: Date.now() });
    c.state.tasks = [t];
    assert.strictEqual(c.inclState(t), 'snoozed');
    c.setDate('a', 'start', c.startOfToday(), false);
    const after = c.state.tasks[0];
    assert.strictEqual(after.snoozeUntil, null, 'the snooze answered a question about the old dates');
    assert.strictEqual(c.inclState(after), 'pressed', 'and the new dates decide instead');
  });
});

test('an EXPLICIT press survives any number of date edits', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = dated(c, { included: true, includedExplicit: true });
    c.state.tasks = [t];
    c.setDate('a', 'start', c.startOfToday() + 20 * DAY, false);
    c.setDate('a', 'end', c.startOfToday() + 25 * DAY, false);
    const after = c.state.tasks[0];
    assert.strictEqual(after.included, true, 'the note the backend took is honoured');
    assert.strictEqual(after.includedExplicit, true);
  });
});

test('an inherited press with no provenance is released by a date edit', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = dated(c, { included: true, includedExplicit: false });
    c.state.tasks = [t];
    c.setDate('a', 'start', c.startOfToday() + 20 * DAY, false);
    assert.strictEqual(c.state.tasks[0].included, null,
      'nothing the user decided is being discarded — this press had no decision behind it');
  });
});

test('clearDate re-derives too — removing a date is a date edit', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = dated(c, { snoozeIndef: true, snoozedAt: Date.now() });
    c.state.tasks = [t];
    c.clearDate('a', 'end');
    assert.strictEqual(c.state.tasks[0].snoozeIndef, false);
  });
});

test('the When line re-derives on the same rule', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = dated(c, { snoozeUntil: c.startOfToday() + 10 * DAY, snoozedAt: Date.now() });
    c.state.tasks = [t];
    const r = c.applyWhenText('a', 'tomorrow');
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(c.state.tasks[0].snoozeUntil, null);
  });
});

// A date edit is a gesture, not a background sweep. Nothing automatic may clear a snooze, or a snooze
// would be undone by the app's own housekeeping.
test('completing a task does not clear its snooze — only a DATE edit re-derives', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const t = dated(c, { snoozeUntil: c.startOfToday() + 10 * DAY, snoozedAt: Date.now() });
    c.state.tasks = [t];
    c.setPct('a', 50);
    assert.notStrictEqual(c.state.tasks[0].snoozeUntil, null);
  });
});

// ---------------------------------------------------------------------------
// The date arriving beats the snooze.
// ---------------------------------------------------------------------------
test('a snoozed task wakes when its own window OPENS on a later day', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // Put away last week; its window opens today.
    const t = dated(c, {
      start: B, end: B + 2 * DAY,
      snoozeUntil: B + 10 * DAY, snoozedAt: B - 7 * DAY,
    });
    c.state.tasks = [t];
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), 'date');
    assert.strictEqual(c.snoozeActive(t, B, Date.now()), false, 'the snooze is over');
    assert.strictEqual(c.inclState(t), 'pressed', 'and the task is back on today');
    assert.strictEqual(c.snoozeEndedToday(t), true, 'so it files as work today brought back');
  });
});

test('an indefinite snooze wakes on the same trigger, dateless start or not', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = dated(c, { start: B, end: B + 2 * DAY, snoozeIndef: true, snoozedAt: B - 3 * DAY });
    c.state.tasks = [t];
    // No start CLOCK, which is what the pre-existing 'start' trigger required and why an all-day date
    // could never wake one of these.
    assert.strictEqual(c.hasStartTime(t), false);
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), 'date');
    assert.strictEqual(c.isOptedOut(t), false);
  });
});

// Without this guard the snooze verbs would be inert on exactly the work people use them on: you put a
// task away, and its window opening today wakes it in the same breath.
test('a snooze set TODAY survives today, even when the window opens today', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = dated(c, { start: B, end: B + 2 * DAY });
    c.state.tasks = [t];
    c.snoozeUntilText('a', '3 days');
    const after = c.state.tasks[0];
    assert.notStrictEqual(after.snoozedAt, null, 'the verb stamps when it was asked');
    assert.strictEqual(c.snoozeWakeReason(after, B, Date.now()), null);
    assert.strictEqual(c.inclState(after), 'snoozed');
  });
});

test('a window that opened BEFORE the snooze does not wake it', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    // Started three days ago; snoozed yesterday. Nothing new happened today.
    const t = dated(c, {
      start: B - 3 * DAY, end: B + 3 * DAY,
      snoozeUntil: B + 5 * DAY, snoozedAt: B - DAY,
    });
    c.state.tasks = [t];
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), null);
    assert.strictEqual(c.snoozeActive(t, B, Date.now()), true);
  });
});

// A dateless task has no date to arrive, so the trigger cannot fire for it — the same reasoning that
// keeps `startsToday` and `autoIncludedToday` away from dateless work.
test('a dateless snooze has no date to be woken by', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = c.normalizeTask({ id: 'a', name: 'someday', start: null, end: null,
      snoozeIndef: true, snoozedAt: B - 5 * DAY, deps: [], pct: 0 });
    c.state.tasks = [t];
    assert.strictEqual(c.snoozeWakeReason(t, B, Date.now()), null);
    assert.strictEqual(c.snoozeActive(t, B, Date.now()), true);
  });
});

// ---------------------------------------------------------------------------
// One predicate, four surfaces. These used to be four hand-rolled copies of the same condition, which
// is exactly how a dated snooze and an open-ended one came to be answered differently.
// ---------------------------------------------------------------------------
test('every surface reads the same snooze answer', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id: 'a', snoozeUntil: B + 3 * DAY, snoozedAt: Date.now() });
    c.state.tasks = [t];
    assert.strictEqual(c.snoozeActive(t, B, Date.now()), true);
    assert.strictEqual(c.isOptedOut(t), true);
    assert.strictEqual(c.inclState(t), 'snoozed');
    assert.strictEqual(c.autoIncludedToday(t), false);
    assert.strictEqual(c.onListNow(t, B, Date.now()), false);
  });
});

test('an expired dated snooze is not active on any surface', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const B = c.startOfToday();
    const t = activeTask(c, { id: 'a', snoozeUntil: B - DAY, snoozedAt: B - 4 * DAY });
    c.state.tasks = [t];
    assert.strictEqual(c.snoozeActive(t, B, Date.now()), false);
    assert.strictEqual(c.inclState(t), 'pressed');
  });
});

void HOUR;
