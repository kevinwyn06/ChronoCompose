// Track B — explicit include/exclude/snooze mutators + the reuse-only snooze free-text parser.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY } = require('./_load.js');

// V2.11 - "Off" is retired (owner: *Off is a dangerous button*). setIncludedOff now UNPRESSES, so the
// task's own triggers can press it back later instead of it being stuck out of today forever. The one
// subtlety: activeTask's window covers yesterday, so V2.2 inheritance would undo a bare unpress on the
// spot - hence the snooze, which is what makes the gesture actually take effect.
test('setIncludedOff: unpresses (never writes false) and snoozes inherited work; one commit', () => {
  const c = make();
  const today = c.startOfToday();
  const t = activeTask(c, { snoozeUntil: Date.now() + DAY });
  c.state.tasks = [t];
  const histLen = c.history.length;
  c.setIncludedOff(t.id);
  assert.strictEqual(c.state.tasks[0].included, null, 'unpressed, not off');
  assert.strictEqual(c.state.tasks[0].snoozeUntil, today + DAY, 'inherited work is snoozed through today');
  assert.strictEqual(c.history.length, histLen + 1, 'exactly one undo entry');
});

test('setIncludedOff on work nothing would inherit leaves the snooze alone', () => {
  const c = make();
  const today = c.startOfToday();
  // window opens today, so V2.2 has no yesterday slice to carry forward
  const t = activeTask(c, { start: today, end: today + DAY, included: true });
  c.state.tasks = [t];
  c.setIncludedOff(t.id);
  assert.strictEqual(c.state.tasks[0].included, null);
  assert.strictEqual(c.state.tasks[0].snoozeUntil, null, 'no phantom snooze when unpressing is enough');
});

test('migrateRetireOff folds any surviving included:false into unpressed', () => {
  const c = make();
  const tasks = [activeTask(c, { id:'a', included:false }), activeTask(c, { id:'b', included:true }),
                 activeTask(c, { id:'c', included:null })];
  assert.strictEqual(c.migrateRetireOff(tasks), 1, 'only the off task is rewritten');
  assert.strictEqual(tasks[0].included, null);
  assert.strictEqual(tasks[1].included, true, 'pressed is untouched');
  assert.strictEqual(tasks[2].included, null);
});

test('setIncludedOn: presses task and clears snoozeUntil', () => {
  const c = make();
  const t = activeTask(c, { included:null, snoozeUntil: Date.now() + DAY });
  c.state.tasks = [t];
  c.setIncludedOn(t.id);
  assert.strictEqual(c.state.tasks[0].included, true);
  assert.strictEqual(c.state.tasks[0].snoozeUntil, null);
});

test('setIncludedTrue: force-in, does not touch snoozeUntil', () => {
  const c = make();
  const t = activeTask(c, {});
  c.state.tasks = [t];
  c.setIncludedTrue(t.id);
  assert.strictEqual(c.state.tasks[0].included, true);
  assert.strictEqual(c.state.tasks[0].snoozeUntil, null);
});

test('snoozeToday: sets snoozeUntil to start-of-tomorrow, leaves included untouched', () => {
  const c = make();
  c.state.nowTick = Date.now();
  const t = activeTask(c, { included:true });
  c.state.tasks = [t];
  c.snoozeToday(t.id);
  assert.strictEqual(c.state.tasks[0].snoozeUntil, c.startOfToday() + DAY);
  assert.strictEqual(c.state.tasks[0].included, true, 'snooze never touches included');
});

test('parseSnoozeText: reuses parseDurPhrase for explicit "for Nh/m" phrases', () => {
  const c = make();
  const now = new Date(2026, 6, 21, 10, 0, 0).getTime(); // Tue 2026-07-21 10:00
  const ms = c.parseSnoozeText('for 3 hours', now);
  assert.strictEqual(ms, c.startOfDay(now), 'floored to the day-only boundary parseDurPhrase\'s minutes land in');
});

test('parseSnoozeText: falls back to chrono.parse for bare durations and absolute anchors', () => {
  const c = make();
  const now = new Date(2026, 6, 21, 10, 0, 0).getTime(); // Tue 2026-07-21
  const threeDays = c.parseSnoozeText('3 days', now);
  assert.strictEqual(threeDays, c.startOfDay(new Date(2026, 6, 24).getTime()), '"3 days" -> Fri Jul 24');
  const untilMon = c.parseSnoozeText('until Monday', now);
  assert.strictEqual(untilMon, c.startOfDay(new Date(2026, 6, 27).getTime()), '"until Monday" -> Mon Jul 27');
});

test('parseSnoozeText: unparseable text returns null', () => {
  const c = make();
  assert.strictEqual(c.parseSnoozeText('asdf qwerty', Date.now()), null);
});

test('snoozeUntilText: false + no commit on unparseable text; commits on success without touching included', () => {
  const c = make();
  c.state.nowTick = new Date(2026, 6, 21, 10, 0, 0).getTime();
  const t = activeTask(c, { included:true });
  c.state.tasks = [t];
  const histLen = c.history.length;
  assert.strictEqual(c.snoozeUntilText(t.id, 'gibberish'), false);
  assert.strictEqual(c.history.length, histLen, 'no commit on a failed parse');
  assert.strictEqual(c.snoozeUntilText(t.id, '3 days'), true);
  assert.strictEqual(c.history.length, histLen + 1, 'exactly one commit on success');
  assert.strictEqual(c.state.tasks[0].snoozeUntil, c.startOfDay(new Date(2026, 6, 24).getTime()));
  assert.strictEqual(c.state.tasks[0].included, true, 'snooze never touches included');
});
