// UI revamp block 9 — a running timer is visible everywhere.
// 1. Top-bar pill: the active task's name, its current segment's elapsed (m:ss / h:mm:ss), and Stop.
// 2. Tab title: "▶ 0:12 · Task — ChronoCompose" while running, "ChronoCompose" idle.
// 3. The running block on today's timeline carries an elapsed bar (progress) and the elapsed label.
// 4. The Pomodoro never contradicts the running timer (follows it; mirrors it when no session runs).
// 5. `T` stops the running timer, and the `?` sheet lists it.
const test = require('node:test');
const assert = require('node:assert');
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
const key = (k, over) => Object.assign({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  target: { tagName: 'BODY' }, preventDefault() {} }, over || {});

// ---------------------------------------------------------------------------
// 1. Pill model
// ---------------------------------------------------------------------------

test('fmtElapsed: m:ss under an hour, h:mm:ss from an hour, never negative', () => {
  const c = make();
  assert.equal(c.fmtElapsed(0), '0:00');
  assert.equal(c.fmtElapsed(12000), '0:12');
  assert.equal(c.fmtElapsed(25 * M + 3000), '25:03');
  assert.equal(c.fmtElapsed(60 * M), '1:00:00');
  assert.equal(c.fmtElapsed(62 * M + 5000), '1:02:05');
  assert.equal(c.fmtElapsed(-5000), '0:00');
});

test('timerPillModel: null when idle; the most recent start when running, with the others counted', () => {
  const c = make();
  const tasks = [{ id: 'a', name: 'Write report' }, { id: 'b', name: '  ' }];
  assert.equal(c.timerPillModel({}, tasks, 1000), null);
  assert.equal(c.timerPillModel(null, tasks, 1000), null);
  const m = c.timerPillModel({ a: { startedAt: 1000 } }, tasks, 1000 + 12000);
  assert.equal(m.id, 'a'); assert.equal(m.name, 'Write report');
  assert.equal(m.elapsed, '0:12'); assert.equal(m.others, 0);
  const two = c.timerPillModel({ a: { startedAt: 1000 }, b: { startedAt: 5000 } }, tasks, 65000);
  assert.equal(two.id, 'b', 'the active task is the most recent start');
  assert.equal(two.name, 'Untitled task', 'a blank name still reads as something');
  assert.equal(two.elapsed, '1:00'); assert.equal(two.others, 1);
  assert.equal(c.timerPillModel({ gone: { startedAt: 1 } }, tasks, 5), null, 'a timer on a deleted task shows nothing');
});

test('the pill renders only while a timer runs: name, elapsed, a real Stop button that stops it', () => withNow(FIXED_NOW, () => {
  const c = make();
  const t = activeTask(c, { id: 'a', name: 'Write report' });
  c.state.tasks = [t];
  assert.equal(c.renderTimerPill(), null, 'idle → no pill, no placeholder');
  assert.equal(find(c.renderTopRight(), (p) => p['data-timer-pill']).length, 0);
  c.startTimer('a');
  c.state.running.a.startedAt -= 42000; // 42 s ago, so the stop below has real time to credit
  c.state.nowTick = Date.now();
  // UI revamp block 11b: the pill moved to the right end of the bar (the {{ drawertoggle }} slot, just left
  // of the gear); the nav slot is the nav only.
  const ctx = c.renderTopRight();
  const pill = find(ctx, (p) => p['data-timer-pill'])[0];
  assert.ok(pill, 'the pill sits in the right-hand top-bar slot');
  assert.equal(find(c.renderTopContext(), (p) => p['data-timer-pill']).length, 0, 'not beside the nav any more');
  assert.equal(c.renderVals().drawertoggle.props['data-topbar-right'], '1', 'rendered through the slot left of the gear');
  assert.equal(textOf(find(pill, (p) => p['data-timer-pill-name'])[0]), 'Write report');
  assert.equal(textOf(find(pill, (p) => p['data-timer-pill-elapsed'])[0]), '0:42');
  const stop = find(pill, (p) => p['data-timer-pill-stop'])[0];
  assert.equal(stop.type, 'button');
  assert.ok(parseFloat(stop.props.style.width) * c.SHELL_ZOOM >= c.HIT_MIN_PX, 'Stop renders at least HIT_MIN_PX');
  const name = find(pill, (p) => p['data-timer-pill-name'])[0];
  name.props.onClick();
  assert.equal(c.state.detailId, 'a', 'the name opens the task');
  stop.props.onClick();
  assert.equal(c.isRunning('a'), false);
  assert.ok(c.state.tasks[0].spent > 0, 'the stop credited spent time');
  assert.equal(c.renderTimerPill(), null);
}));

// ---------------------------------------------------------------------------
// 2. Tab title
// ---------------------------------------------------------------------------

test('docTitleFor: the plain app title idle; "▶ elapsed · name — ChronoCompose" running; long names clip', () => {
  const c = make();
  assert.equal(c.docTitleFor(null), 'ChronoCompose');
  assert.equal(c.docTitleFor({ name: 'Write report', elapsed: '0:12' }), '▶ 0:12 · Write report — ChronoCompose');
  const long = 'x'.repeat(c.TIMER_TITLE_NAME_MAX + 10);
  const t = c.docTitleFor({ name: long, elapsed: '1:00' });
  assert.ok(t.includes('x'.repeat(c.TIMER_TITLE_NAME_MAX - 1) + '…'));
  assert.ok(!t.includes('x'.repeat(c.TIMER_TITLE_NAME_MAX)));
});

test('syncDocTitle writes document.title from the running timer', () => withNow(FIXED_NOW, () => {
  const c = make();
  const doc = require('./_load.js').loadComponent.lastSandbox.document;
  c.state.tasks = [activeTask(c, { id: 'a', name: 'Write report' })];
  c.syncDocTitle();
  assert.equal(doc.title, 'ChronoCompose');
  c.startTimer('a'); c.state.nowTick = Date.now() + 12000;
  c.syncDocTitle();
  assert.equal(doc.title, '▶ 0:12 · Write report — ChronoCompose');
  c.stopTimer('a'); c.syncDocTitle();
  assert.equal(doc.title, 'ChronoCompose');
}));

// ---------------------------------------------------------------------------
// 3. Running block
// ---------------------------------------------------------------------------

test('runBlockModel: fill = worked today / (worked + still drawn), label = segment elapsed', () => {
  const c = make();
  assert.deepEqual(c.runBlockModel(20, 40, 20 * M), { fill: 1 / 3, label: '20:00' });
  assert.equal(c.runBlockModel(0, 60, 0).fill, 0);
  assert.equal(c.runBlockModel(30, 0, 5000).fill, 1, 'nothing left to draw → full');
  assert.equal(c.runBlockModel(-3, 10, 0).fill, 0);
});

test('the running task\'s block today carries the elapsed bar and label; other blocks do not', () => withNow(FIXED_NOW, () => {
  const c = make();
  const a = activeTask(c, { id: 'a', name: 'Write report', planned: 60 });
  const b = activeTask(c, { id: 'b', name: 'Other', planned: 60 });
  c.state.tasks = [a, b];
  const B = c.startOfToday();
  let col = c.renderDayColumn(B, {});
  assert.equal(find(col, (p) => p['data-tl-run-fill'] != null).length, 0, 'idle: no bar anywhere');
  c.state.running = { a: { startedAt: Date.now() - 20 * M, beat: Date.now() } };
  c.state.nowTick = Date.now();
  col = c.renderDayColumn(B, {});
  const blk = find(col, (p) => p['data-tl-block'] && p['data-tl-task'] === 'a')[0];
  const bar = find(blk, (p) => p['data-tl-run-fill'] != null)[0];
  assert.ok(bar, 'the running block has the bar');
  assert.ok(Math.abs(+bar.props['data-tl-run-fill'] - 20 / 60) < 0.01, 'worked 20 of 60 → a third');
  assert.equal(textOf(find(blk, (p) => p['data-tl-run-elapsed'])[0]), '20:00');
  const other = find(col, (p) => p['data-tl-block'] && p['data-tl-task'] === 'b')[0];
  assert.equal(find(other, (p) => p['data-tl-run-fill'] != null).length, 0);
}));

// ---------------------------------------------------------------------------
// 4. Pomodoro
// ---------------------------------------------------------------------------

test('pomoBindRun: a session follows the timer just started; same task or no session is untouched', () => {
  const c = make();
  const p = { taskId: 'x', phase: 'work', phaseStart: 5, cycle: 1 };
  assert.equal(c.pomoBindRun(p, 'x'), p);
  assert.equal(c.pomoBindRun(null, 'y'), null);
  assert.equal(c.pomoBindRun(p, null), p);
  assert.deepEqual(c.pomoBindRun(p, 'y'), { taskId: 'y', phase: 'work', phaseStart: 5, cycle: 1 }, 'phase and clock untouched');
  assert.equal(c.pomoBindRun({ taskId: null, phase: 'break', phaseStart: 0, cycle: 0 }, 'y').taskId, 'y', 'a standalone session binds too');
});

test('pomoPanelModel: session counts down; no session + a running timer mirrors it (never an idle 25:00)', () => {
  const c = make();
  const S = { work: 25, break: 5, long: 15, cycles: 4 };
  const ses = c.pomoPanelModel({ taskId: 'a', phase: 'work', phaseStart: 1000, cycle: 0 }, null, 1000 + 10 * M, S);
  assert.equal(ses.mode, 'session'); assert.equal(ses.ringMs, 15 * M);
  const run = { id: 'a', elapsedMs: 25 * M, elapsed: '25:00' };
  const mir = c.pomoPanelModel(null, run, 0, S);
  assert.equal(mir.mode, 'mirror'); assert.equal(mir.taskId, 'a');
  assert.equal(mir.ringMs, 25 * M, 'the ring shows the 25 minutes the task has run, not 25:00 to go');
  assert.equal(mir.fill, 1);
  assert.equal(c.pomoPanelModel(null, { id: 'a', elapsedMs: 5 * M }, 0, S).fill, 0.2);
  const idle = c.pomoPanelModel(null, null, 0, S);
  assert.equal(idle.mode, 'idle'); assert.equal(idle.ringMs, 25 * M);
});

test('the panel mirrors a running timer, and Start binds the session to that task without stopping it', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'a', name: 'Write report' })];
  c.startTimer('a'); c.state.nowTick = Date.now() + 25 * M;
  const panel = c.renderPomodoroPanel();
  assert.equal(panel.props['data-pomo-mode'], 'mirror');
  assert.equal(textOf(find(panel, (p) => p['data-pomo-task'])[0]), 'Write report');
  assert.equal(textOf(find(panel, (p) => p['data-pomo-ring-text'])[0]), '25:00');
  assert.equal(textOf(find(panel, (p) => p['data-pomo-ring-label'])[0]), 'Running');
  find(panel, (p) => p['data-pomo-start'])[0].props.onClick();
  assert.equal(c.state.pomo.taskId, 'a');
  assert.equal(c.isRunning('a'), true, 'the timer keeps running');
  assert.notEqual(c.renderPomodoroPanel().props['data-pomo-mode'], 'mirror', 'now a real session');
}));

test('starting another task\'s timer during a session rebinds the session to it', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'a', name: 'A' }), activeTask(c, { id: 'b', name: 'B' })];
  c.startPomodoro('a');
  assert.equal(c.isRunning('a'), true);
  c.startTimer('b');
  assert.equal(c.isRunning('a'), false, 'single-timer policy stopped A');
  assert.equal(c.state.pomo.taskId, 'b', 'the session follows B');
  assert.equal(c.state.pomo.phase, 'work');
}));

// ---------------------------------------------------------------------------
// 5. Shortcut
// ---------------------------------------------------------------------------

test('T stops the running timer; inert when idle; listed in the ? sheet', () => withNow(FIXED_NOW, () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'a', name: 'A' })];
  c.onKey(key('t')); // idle: nothing to stop, no throw
  c.startTimer('a');
  c.onKey(key('t'));
  assert.equal(c.isRunning('a'), false);
  const listed = c.SHORTCUTS().flatMap((g) => g.items.flatMap((i) => i.keys));
  assert.ok(listed.includes('T'));
}));
