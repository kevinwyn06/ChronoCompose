// Owner session 2026-09-09 — four defects reported from live use, each reproduced here before it was
// fixed. They are unrelated in the code and share only the session that found them.
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY, withNow, FIXED_NOW } = require('./_load.js');

const HOUR = 3600000;

// ---------------------------------------------------------------------------
// 1. "Deleting section not control z able."
//
// `deleteSection` writes TWO stores: the section list (saveSections, which had no undo record at all)
// and the tasks it dissolves (commit, which does). So Ctrl+Z restored the tasks' `sectionId` — onto a
// section that no longer existed — and the section itself was gone for good.
// ---------------------------------------------------------------------------
test('deleteSection: one Ctrl+Z restores the section AND the tasks it dissolved', () => {
  const c = make();
  const sec = c.addSection('Deep work');
  c.state.tasks = [c.normalizeTask({ id:'a', name:'a', sectionId: sec.id })];
  c.deleteSection(sec.id);
  assert.strictEqual((c.state.sections||[]).length, 0, 'section is gone');
  assert.strictEqual(c.state.tasks[0].sectionId, null, 'its task dissolved to No section');

  c.undo();
  assert.deepStrictEqual((c.state.sections||[]).map(s=>s.id), [sec.id], 'ONE undo brings the section back');
  assert.strictEqual(c.state.tasks[0].sectionId, sec.id, 'and the same undo re-files its task');
});

test('deleteSection: redo takes it away again, still in one step', () => {
  const c = make();
  const sec = c.addSection('Deep work');
  c.state.tasks = [c.normalizeTask({ id:'a', name:'a', sectionId: sec.id })];
  c.deleteSection(sec.id);
  c.undo();
  c.redo();
  assert.strictEqual((c.state.sections||[]).length, 0, 'section deleted again');
  assert.strictEqual(c.state.tasks[0].sectionId, null, 'task dissolved again');
});

test('addSection and renameSection are undoable too', () => {
  const c = make();
  const sec = c.addSection('Reading');
  c.renameSection(sec.id, 'Reading list');
  assert.strictEqual(c.state.sections[0].name, 'Reading list');
  c.undo();
  assert.strictEqual(c.state.sections[0].name, 'Reading', 'rename undone');
  c.undo();
  assert.strictEqual((c.state.sections||[]).length, 0, 'creation undone');
});

// A section undo entry must interleave with the task history, not jump the queue: the stacks are
// separate arrays and only `_undoKind` records which action came last.
test('section and task undo entries interleave in the order they happened', () => {
  const c = make();
  c.state.tasks = [c.normalizeTask({ id:'a', name:'first' })];
  const sec = c.addSection('S');                      // 1st action: sections
  c.commit(tasks => { tasks[0].name = 'second'; });    // 2nd action: tasks
  c.undo();
  assert.strictEqual(c.state.tasks[0].name, 'first', 'the task edit is undone first');
  assert.deepStrictEqual(c.state.sections.map(s=>s.id), [sec.id], 'the section is still there');
  c.undo();
  assert.strictEqual((c.state.sections||[]).length, 0, 'then the section');
});

// ---------------------------------------------------------------------------
// 2. "Sometimes the timer starts on its own after I edit a date for no reason."
//
// autoTimerPlan fired for any fixed appointment whose window merely CONTAINS now. Editing a date so
// that an appointment lands around the current time therefore started its timer within one tick — the
// clock had not arrived at anything, the data had moved under it. An auto-start is meant to mean "it
// is now time for this", which is a CROSSING: the start instant must be ahead of the previous tick.
// ---------------------------------------------------------------------------
function apptNow(c, over){
  // an appointment that started an hour ago and runs for another hour — `now` sits inside it
  const now = Date.now();
  return c.normalizeTask(Object.assign({
    id:'ap', name:'meeting', start: now - HOUR, end: now + HOUR,
    startClock:true, endClock:true, planned:120, deps:[], pct:0,
  }, over||{}));
}

test('autoTimerPlan does not start an appointment that was already under way at the last tick', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.tasks = [apptNow(c)];
    assert.ok(c.isFixedToday(c.state.tasks[0]), 'fixture really is a fixed appointment today');
    c._autoTickAt = Date.now() - 1000;   // the previous tick already saw this window open
    const plan = c.autoTimerPlan(Date.now());
    assert.deepStrictEqual(Array.from(plan.start), [], 'no auto-start: the clock crossed nothing');
  });
});

test('autoTimerPlan DOES start an appointment whose start the clock has just crossed', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const now = Date.now();
    c.state.tasks = [apptNow(c, { start: now - 1000, end: now + HOUR })];
    c._autoTickAt = now - 30000;         // previous tick was before the start instant
    const plan = c.autoTimerPlan(now);
    assert.deepStrictEqual(Array.from(plan.start), ['ap'], 'the start instant fell between the two ticks');
  });
});

test('a date edit that drops an appointment around now does not start its timer', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const now = Date.now();
    // a meeting sitting harmlessly next week
    c.state.tasks = [c.normalizeTask({ id:'ap', name:'meeting', start: now + 7*DAY,
      end: now + 7*DAY + 2*HOUR, startClock:true, endClock:true, deps:[], pct:0 })];
    c.autoTimerTick();                   // establishes the tick baseline
    c.setDate('ap', 'start', now - HOUR, true);   // owner drags it onto today, around now
    c.autoTimerTick();
    assert.strictEqual(c.isRunning('ap'), false, 'editing a date never starts a timer');
  });
});

test('the first tick after load never retro-starts an appointment already in progress', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.tasks = [apptNow(c)];
    c.autoTimerTick();                   // no previous tick exists
    assert.strictEqual(c.isRunning('ap'), false, 'a reload is not a clock crossing either');
  });
});

// ---------------------------------------------------------------------------
// 3. "I edit a daily recurrance by deleting it and it just comes back."
//
// Two defects on one path. `applyScope` read `this._occById` unguarded — every other reader in the
// file guards it, because the memo is built by RENDER and does not exist before the first paint (and
// holds nothing for a task the current view filtered out). And `deleteMulti` targeted
// `mostRecentOccIdx` — the most recent occurrence in the PAST — while the row displays `occOf`, i.e.
// `currentOcc`. Deleting "this one" therefore struck an occurrence the owner was not looking at and
// left the visible one exactly where it was.
// ---------------------------------------------------------------------------
function dailyAt(c, hour) {
  const today = c.startOfToday();
  return c.normalizeTask({ id:'r1', name:'standup', start: today + hour*HOUR, end: today + (hour+1)*HOUR,
    startClock:true, endClock:true, deps:[], pct:0,
    recur:{ kind:'day', n:1, label:'Daily', shifts:[], overrides:{} } });
}

test('applyScope survives having no render memo (it runs before the first paint)', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.tasks = [dailyAt(c, 9)];
    c._occById = undefined;
    c.openScope('delete', 'r1', c.currentOccIdx(c.state.tasks[0]));
    assert.doesNotThrow(() => c.applyScope('this'), 'no unguarded _occById read');
  });
});

test('deleting "this occurrence" removes the occurrence the row is showing', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    // 9am–10am daily, and it is now noon: the DISPLAYED occurrence is tomorrow's, while the most
    // recent one is this morning's. The old code deleted this morning's.
    c.state.tasks = [dailyAt(c, 9)];
    const shown = c.occOf(c.state.tasks[0]).start;
    c.deleteMulti(['r1']);                       // opens the scope prompt for a repeat
    assert.ok(c.state.scopePrompt, 'a repeat asks for a scope instead of deleting the series');
    c.applyScope('this');
    const after = c.state.tasks[0];
    const stillThere = c.expandTask(after, c.startOfToday() + 30*DAY).some(o => o.start === shown);
    assert.strictEqual(stillThere, false, 'the occurrence the owner was looking at is gone');
  });
});

test('deleting one occurrence leaves the rest of the series intact', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.tasks = [dailyAt(c, 9)];
    const before = c.expandTask(c.state.tasks[0], c.startOfToday() + 10*DAY).length;
    c.deleteMulti(['r1']);
    c.applyScope('this');
    const after = c.expandTask(c.state.tasks[0], c.startOfToday() + 10*DAY).length;
    assert.strictEqual(after, before - 1, 'exactly one occurrence removed');
  });
});

// ---------------------------------------------------------------------------
// 4. "I wrote 'from sept 9 to sept 12' and it interpreted it as a start date and a 72 hour duration
//     instead of a start date and an end date."
//
// chrono resolved the range correctly, but the shaping block only honours an end when a CLOCK was
// typed (`hasSpan = hasClock && spanEnd != null`). A bare day range fell through to the single-day
// branch, which discards the end — while `result.dur` kept the 4320 minutes chrono had measured, and
// that is what reached `planned`.
// ---------------------------------------------------------------------------
test('"from sept 9 to sept 12" is a start date and an end date, not a 72-hour duration', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = c.parseDateText('write the report from sept 9 to sept 12');
    assert.ok(p.start != null, 'has a start');
    assert.ok(p.end != null, 'has an end — the range is not thrown away');
    assert.strictEqual(new Date(p.start).getDate(), 9);
    assert.strictEqual(new Date(p.start).getMonth(), 8);
    // an all-day end is the exclusive next-day midnight, so the last DAY covered is the 12th
    assert.strictEqual(new Date(p.end - 1).getDate(), 12);
    assert.strictEqual(new Date(p.end - 1).getMonth(), 8);
    assert.strictEqual(p.dur, null, 'a day range is not a duration');
  });
});

test('a bare day range does not claim to carry clocks', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = c.parseDateText('conference from sept 9 to sept 12');
    assert.ok(!p.startClock, 'no start clock was typed');
    assert.ok(!p.endClock, 'no end clock was typed');
  });
});

test('a clock range on one day still behaves exactly as before', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = c.parseDateText('standup tomorrow from 9:00 to 10:00');
    assert.ok(p.startClock && p.endClock, 'both edges are real clocks');
    assert.strictEqual(p.end - p.start, HOUR, 'one hour');
  });
});
