// Decision 43 follow-up — the Pomodoro keeps counting after its task's timer is stopped.
// A focus phase bound to a task PAUSES (remaining time kept, no completed pomodoro recorded) whenever that
// task's timer stops, by any path: row ▶/■ (toggleTimer), the top-bar pill Stop, `T`, the Focus hero
// Stop and Done, completing, deleting or archiving the task. Starting the task again resumes it. A break
// keeps running, and a standalone session is not touched by an unrelated timer stopping.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, withNow, FIXED_NOW } = require('./_load.js');

const M = 60000;
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};
const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const key = (k) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  target: { tagName: 'BODY' }, preventDefault() {} });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 2000, msg + ' (' + a + ' vs ' + b + ')');

// A session bound to task 'a', ten minutes into its 25-minute focus phase, with 'a' running.
function boundSession(over) {
  const c = make();
  c.state.tasks = [activeTask(c, Object.assign({ id: 'a', name: 'Write report' }, over || {})),
    activeTask(c, { id: 'b', name: 'Other' })];
  c.startPomodoro('a');
  assert.ok(c.isRunning('a'));
  c.state.pomo = Object.assign({}, c.state.pomo, { phaseStart: Date.now() - 10 * M });
  c.state.running.a.startedAt -= 10 * M;
  c.state.nowTick = Date.now();
  return c;
}
// Stopped by some path: the focus phase is paused with ~15 minutes kept, and stays paused as time passes.
function assertPaused(c, label) {
  const p = c.state.pomo;
  assert.ok(p, label + ': the session survives the stop');
  assert.equal(p.phase, 'work', label + ': still the focus phase');
  assert.equal(p.cycle, 0, label + ': no completed pomodoro recorded');
  near(p.pausedRemaining, 15 * M, label + ': remaining time kept');
  const later = Date.now() + 60 * M;
  const st = c.pomoState(p, later);
  assert.equal(st.done, false, label + ': a paused phase never finishes');
  near(st.remainingMs, 15 * M, label + ': the countdown does not move while paused');
  c.pomoTick(later);
  assert.equal(c.state.pomo.phase, 'work', label + ': the tick does not roll a paused phase');
  assert.equal(c.loadPomo().pausedRemaining, p.pausedRemaining, label + ': the pause is persisted');
}

test('pomoPause / pomoResume are pure and round-trip the remaining time', () => {
  const c = make();
  const S = { work: 25, break: 5, long: 15, cycles: 4 };
  const p = { taskId: 'a', phase: 'work', phaseStart: 1000, cycle: 2 };
  const z = c.pomoPause(p, 1000 + 10 * M, S);
  assert.equal(z.pausedRemaining, 15 * M);
  assert.equal(p.pausedRemaining, undefined, 'input untouched');
  assert.equal(c.pomoPause(z, 1000 + 20 * M, S), z, 'pausing a paused session is a no-op');
  const r = c.pomoResume(z, 1000 + 50 * M, S);
  assert.equal(r.pausedRemaining, undefined);
  assert.equal(r.cycle, 2); assert.equal(r.phase, 'work'); assert.equal(r.taskId, 'a');
  assert.equal(c.pomoState(r, 1000 + 50 * M, S).remainingMs, 15 * M, 'resumes with what was left');
  assert.equal(c.pomoResume(p, 5, S), p, 'resuming an unpaused session is a no-op');
});

test('row ▶/■ (toggleTimer) pauses the bound focus phase', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.toggleTimer('a'); assertPaused(c, 'toggleTimer');
}));

test('the top-bar pill Stop pauses the bound focus phase', () => withNow(FIXED_NOW, () => {
  const c = boundSession();
  const stop = find(c.renderTimerPill(), (p) => p['data-timer-pill-stop'])[0];
  stop.props.onClick({ stopPropagation() {} });
  assert.equal(c.isRunning('a'), false);
  assertPaused(c, 'pill Stop');
}));

test('the T shortcut pauses the bound focus phase', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.onKey(key('t')); assert.equal(c.isRunning('a'), false); assertPaused(c, 'T');
}));

test('the Focus hero Stop pauses the bound focus phase', () => withNow(FIXED_NOW, () => {
  const c = boundSession();
  const tog = find(c.renderFocusNow(), (p) => p['data-focus-hero-toggle'] === 'stop')[0];
  tog.props.onClick();
  assert.equal(c.isRunning('a'), false);
  assertPaused(c, 'hero Stop');
}));

test('the Focus hero Done stops the timer and pauses the bound focus phase', () => withNow(FIXED_NOW, () => {
  const c = boundSession();
  const done = find(c.renderFocusNow(), (p) => p['data-focus-hero-done'])[0];
  done.props.onClick();
  assert.equal(c.isRunning('a'), false, 'completing stops the task timer');
  assert.ok(c.state.tasks.find((t) => t.id === 'a').spent > 9, 'the stop credited the running time');
  assertPaused(c, 'hero Done');
}));

test('completing the task (toggleDone) stops its timer and pauses the focus phase', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.toggleDone('a');
  assert.equal(c.isRunning('a'), false); assertPaused(c, 'toggleDone');
}));

test('completing a repeat\'s occurrence for today stops its timer too', () => withNow(FIXED_NOW, () => {
  const B = new Date(FIXED_NOW); B.setHours(0, 0, 0, 0);
  const c = boundSession({ recur: { kind: 'day', n: 1, shifts: [], overrides: {} }, start: B.getTime() + 9 * 3600000, end: B.getTime() + 10 * 3600000 });
  c.toggleDone('a');
  assert.equal(c.isRunning('a'), false); assertPaused(c, 'repeat toggleDone');
}));

test('deleting the task stops its timer and pauses the focus phase', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.deleteTask('a');
  assert.equal(c.state.tasks.some((t) => t.id === 'a'), false);
  assert.equal(c.isRunning('a'), false, 'no orphan timer left in pp-run');
  assertPaused(c, 'delete');
}));

test('archiving the task stops its timer and pauses the focus phase', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.archiveMulti(['a']);
  assert.equal(c.isRunning('a'), false); assertPaused(c, 'archive');
}));

test('starting the task again resumes the paused focus phase where it left off', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.toggleTimer('a'); assertPaused(c, 'stop');
  c.startTimer('a');
  assert.ok(c.isRunning('a'));
  const p = c.state.pomo;
  assert.equal(p.pausedRemaining, undefined, 'no longer paused');
  near(c.pomoState(p, Date.now()).remainingMs, 15 * M, 'resumes with ~15 minutes left');
  assert.equal(c.loadPomo().pausedRemaining, undefined);
}));

test('the paused panel says so and its Resume restarts the task timer', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.toggleTimer('a');
  const panel = c.renderPomodoroPanel();
  assert.equal(panel.props['data-pomo-paused'], '1');
  assert.equal(textOf(find(panel, (p) => p['data-pomo-ring-label'])[0]), 'Paused');
  assert.equal(textOf(find(panel, (p) => p['data-pomo-ring-text'])[0]), '15:00');
  find(panel, (p) => p['data-pomo-resume'])[0].props.onClick();
  assert.ok(c.isRunning('a'), 'Resume restarts the bound task timer');
  assert.equal(c.state.pomo.pausedRemaining, undefined);
}));

test('switching to another task keeps the focus phase running (it follows the new timer)', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.startTimer('b');
  assert.equal(c.state.pomo.taskId, 'b');
  assert.equal(c.state.pomo.pausedRemaining, undefined, 'a switch is not a pause');
  near(c.pomoState(c.state.pomo, Date.now()).remainingMs, 15 * M, 'clock untouched');
}));

test('a running break is not bound to the task timer and keeps counting', () => withNow(FIXED_NOW, () => {
  const c = boundSession();
  c.skipPomoPhase(); // → break; this stops 'a' itself
  assert.equal(c.state.pomo.phase, 'break');
  assert.equal(c.state.pomo.pausedRemaining, undefined, 'the roll to break is not a pause');
  c.startTimer('a'); c.state.pomo = Object.assign({}, c.state.pomo, { phase: 'break' }); // a timer run during the break
  c.toggleTimer('a');
  assert.equal(c.state.pomo.pausedRemaining, undefined, 'stopping during a break leaves the break running');
}));

test('a focus phase rolling to its break on time is not recorded as a pause', () => withNow(FIXED_NOW, () => {
  const c = boundSession();
  c.state.pomo = Object.assign({}, c.state.pomo, { phaseStart: Date.now() - 26 * M });
  c.pomoTick(Date.now());
  assert.equal(c.state.pomo.phase, 'break');
  assert.equal(c.state.pomo.cycle, 1);
  assert.equal(c.state.pomo.pausedRemaining, undefined);
}));

test('a standalone session is not touched when an unrelated timer stops', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'x', name: 'X' })];
  c.state.running = { x: { startedAt: Date.now() - 5 * M, beat: Date.now() } };
  c.startPomodoro(null);
  assert.equal(c.state.pomo.taskId, null);
  c.stopTimer('x');
  assert.equal(c.state.pomo.pausedRemaining, undefined, 'standalone focus keeps counting');
  c.state.running = { x: { startedAt: Date.now(), beat: Date.now() } };
  c.deleteTask('x');
  assert.equal(c.state.pomo.pausedRemaining, undefined);
}));

test('stopPomodoro still ends the session outright (no paused leftover)', () => withNow(FIXED_NOW, () => {
  const c = boundSession(); c.stopPomodoro();
  assert.equal(c.state.pomo, null); assert.equal(c.isRunning('a'), false);
}));

// ---------------------------------------------------------------------------
// One action, one Undo: the timer stop that complete / delete / archive performs rides in the SAME undo
// step as the mutation. One Undo restores the task, its running timer and the Pomodoro session as they were.
// ---------------------------------------------------------------------------

function oneStepUndo(label, act, check) {
  test('one Undo reverts ' + label + ' AND restarts its timer and session', () => withNow(FIXED_NOW, () => {
    const c = boundSession();
    const kinds0 = c._undoKind.length, hist0 = c.history.length;
    const tasks0 = JSON.stringify(c.state.tasks);
    const run0 = JSON.stringify(c.state.running), pomo0 = JSON.stringify(c.state.pomo);
    act(c);
    assert.equal(c.isRunning('a'), false, label + ': the action stopped the timer');
    assert.ok(c.state.pomo.pausedRemaining != null, label + ': the session paused');
    assert.equal(c._undoKind.length, kinds0 + 2, label + ': one task record + its paired timer record');
    check(c);
    c.undo();
    assert.equal(JSON.stringify(c.state.tasks), tasks0, label + ': tasks exactly as before');
    assert.equal(JSON.stringify(c.state.running), run0, label + ': the timer runs again from its original start');
    assert.equal(JSON.stringify(c.state.pomo), pomo0, label + ': the session as it was');
    assert.equal(c.loadPomo().pausedRemaining, undefined);
    assert.equal(c._undoKind.length, kinds0, label + ': no undo entry left behind');
    assert.equal(c.history.length, hist0);
    c.redo();
    assert.equal(c.isRunning('a'), false, label + ': redo stops it again');
    assert.ok(c.state.pomo.pausedRemaining != null, label + ': redo re-pauses the session');
    check(c);
    c.undo();
    assert.equal(JSON.stringify(c.state.running), run0, label + ': and undo again restores it');
  }));
}
const taskA = (c) => c.state.tasks.find((t) => t.id === 'a');
oneStepUndo('completing (toggleDone)', (c) => c.toggleDone('a'), (c) => assert.equal(taskA(c).pct, 100));
oneStepUndo('setPct to 100', (c) => c.setPct('a', 100), (c) => assert.equal(taskA(c).pct, 100));
oneStepUndo('deleting (deleteMulti)', (c) => c.deleteMulti(['a']), (c) => assert.equal(taskA(c), undefined));
oneStepUndo('archiving (archiveMulti)', (c) => c.archiveMulti(['a']), (c) => assert.ok(taskA(c).archivedAt));

test('one Undo reverts completing a repeat occurrence and deleting a whole series, timer included', () => withNow(FIXED_NOW, () => {
  const B = new Date(FIXED_NOW); B.setHours(0, 0, 0, 0);
  const rec = { recur: { kind: 'day', n: 1, shifts: [], overrides: {} }, start: B.getTime() + 9 * 3600000, end: B.getTime() + 10 * 3600000 };
  for (const act of [(c) => c.toggleDone('a'), (c) => c.applyScope('all', { kind: 'delete', taskId: 'a', occIdx: 0, payload: {} })]) {
    const c = boundSession(rec);
    const tasks0 = JSON.stringify(c.state.tasks), run0 = JSON.stringify(c.state.running), k0 = c._undoKind.length;
    act(c);
    assert.equal(c.isRunning('a'), false);
    c.undo();
    assert.equal(JSON.stringify(c.state.tasks), tasks0);
    assert.equal(JSON.stringify(c.state.running), run0);
    assert.equal(c._undoKind.length, k0);
  }
}));

test('completing a task with no running timer records a single undo entry, as before', () => withNow(FIXED_NOW, () => {
  const c = boundSession();
  const k0 = c._undoKind.length;
  c.toggleDone('b');
  assert.equal(c._undoKind.length, k0 + 1);
  assert.ok(c.isRunning('a'), 'an unrelated timer is untouched');
}));

test('the "Completed" toast Undo is live and restores the task and its timer in one press', () => withNow(FIXED_NOW, () => {
  const c = boundSession();
  const run0 = JSON.stringify(c.state.running);
  c.toggleDone('a');
  assert.ok(c.toastUndoLive(c.state.toast), 'the toast names the newest step');
  c.undoFromToast();
  assert.equal(taskA(c).pct, 0);
  assert.equal(JSON.stringify(c.state.running), run0);
}));
