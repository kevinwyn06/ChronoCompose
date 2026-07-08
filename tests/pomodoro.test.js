// Phase 10 (ROADMAP.md) — Pomodoro: pure phase math (pomoPhaseDur / pomoState / pomoAdvance) + the
// control methods that bind the existing task timer (start/skip/stop/tick). Notifications no-op under
// test (Notification is unsupported in the sandbox), so these exercise the timer binding + persistence.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask } = require('./_load.js');

const S = { work: 25, break: 5, long: 15, cycles: 4 };

test('pomoPhaseDur maps phases to ms and clamps a 0 to 1 minute', () => {
  const c = make();
  assert.equal(c.pomoPhaseDur('work', S), 25 * 60000);
  assert.equal(c.pomoPhaseDur('break', S), 5 * 60000);
  assert.equal(c.pomoPhaseDur('long', S), 15 * 60000);
  assert.equal(c.pomoPhaseDur('work', { work: 0, break: 5, long: 15, cycles: 4 }), 60000, '0 clamps to 1 min');
});

test('pomoState reports elapsed / remaining / done (remaining floors at 0)', () => {
  const c = make();
  const t0 = 1000000;
  const p = { taskId: null, phase: 'work', phaseStart: t0, cycle: 0 };
  let st = c.pomoState(p, t0 + 10 * 60000, S);
  assert.equal(st.remainingMs, 15 * 60000);
  assert.equal(st.done, false);
  st = c.pomoState(p, t0 + 25 * 60000, S);
  assert.equal(st.done, true, 'done exactly at the duration');
  st = c.pomoState(p, t0 + 30 * 60000, S);
  assert.equal(st.remainingMs, 0, 'remaining never goes negative');
  assert.equal(st.done, true);
});

test('pomoAdvance cycles work→break→work, and a long break every N sessions, preserving the task', () => {
  const c = make();
  const now = 5000;
  let p = { taskId: 'x', phase: 'work', phaseStart: 0, cycle: 0 };
  p = c.pomoAdvance(p, S, now);
  assert.equal(p.phase, 'break');
  assert.equal(p.cycle, 1);
  assert.equal(p.phaseStart, now, 'phaseStart restarts at now');
  p = c.pomoAdvance(p, S, now);
  assert.equal(p.phase, 'work');
  assert.equal(p.cycle, 1, 'a break keeps the session count');
  // the 4th work completion → long break, then long → work resets the set
  p = { taskId: 'x', phase: 'work', phaseStart: 0, cycle: 3 };
  p = c.pomoAdvance(p, S, now);
  assert.equal(p.phase, 'long');
  assert.equal(p.cycle, 4);
  p = c.pomoAdvance(p, S, now);
  assert.equal(p.phase, 'work');
  assert.equal(p.cycle, 0, 'a long break resets the session set');
  assert.equal(p.taskId, 'x', 'task binding survives every phase change');
});

test('startPomodoro binds the task timer; a break pauses it; focus resumes; stop ends it', () => {
  const c = make();
  const t = activeTask(c, { id: 'foc' });
  c.state.tasks = [t];
  c.startPomodoro('foc');
  assert.equal(c.state.pomo.phase, 'work');
  assert.ok(c.isRunning('foc'), 'focus runs the bound task timer');
  c.skipPomoPhase();
  assert.equal(c.state.pomo.phase, 'break');
  assert.ok(!c.isRunning('foc'), 'a break pauses the task timer');
  c.skipPomoPhase();
  assert.equal(c.state.pomo.phase, 'work');
  assert.ok(c.isRunning('foc'), 'focus resumes the timer');
  c.stopPomodoro();
  assert.equal(c.state.pomo, null, 'stop clears the session');
  assert.ok(!c.isRunning('foc'), 'stop ends the timer too');
});

test('pomoTick rolls a finished phase forward and persists to pp-pomo', () => {
  const c = make();
  const t = activeTask(c, { id: 'foc' });
  c.state.tasks = [t];
  c.startPomodoro('foc');
  c.state.pomo.phaseStart = Date.now() - 26 * 60000; // make the focus interval look finished
  c.pomoTick(Date.now());
  assert.equal(c.state.pomo.phase, 'break', 'a finished focus interval rolls to a break');
  assert.ok(!c.isRunning('foc'), 'the task timer paused on the roll to break');
  assert.equal(c.loadPomo().phase, 'break', 'the session was persisted to pp-pomo');
});

test('a standalone pomodoro (no bound task) advances without touching any timer', () => {
  const c = make();
  c.state.tasks = [];
  c.startPomodoro(null);
  assert.equal(c.state.pomo.taskId, null);
  assert.equal(c.anyRunning(), false, 'no task timer for a standalone session');
  c.skipPomoPhase(); // must not throw with no bound task
  assert.equal(c.state.pomo.phase, 'break');
});
