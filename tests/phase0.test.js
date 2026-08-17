// Phase 0 (ROADMAP.md) — bug-fix bundle: normalizeTask numeric defaults, undo/redo cap symmetry,
// EDF-uses-current-occurrence, timer accounting (stopTimerAt/timerHeartbeat — timers persist across
// a closed tab / sleep), JSON backup round-trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

// ---------------------------------------------------------------------------
// normalizeTask numeric defaults (a missing planned leaked NaN into the pool)
// ---------------------------------------------------------------------------
test('normalizeTask defaults planned to null and predicted to 0', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'a', name: 'x' });
  // Changed 2026-08-16 (allotment fix): `planned` became NULLABLE so "never estimated" (null) is
  // distinguishable from "deliberately zero" (0). The NaN concern this test was written for is
  // unchanged — every arithmetic reader coerces with `+t.planned||0`, which maps null to 0.
  assert.equal(t.planned, null, 'no estimate given → null, not 0');
  assert.equal(t.predicted, 0, 'predicted stays a plain number — it is only read behind predictManual');
});

test('computeAllotted stays finite when a task lacks planned', () => {
  const c = make();
  cleanDay(c, '10:00'); // pool = 600 min
  const bare = c.normalizeTask({ id: 'bare', name: 'legacy', start: Date.now() - DAY, end: Date.now() + DAY });
  const full = activeTask(c, { id: 'full', planned: 120 });
  const map = c.computeAllotted([bare, full]);
  assert.ok(Number.isFinite(map['bare'].allotted), 'bare task allotted must be finite');
  assert.ok(Number.isFinite(map['full'].allotted), 'other tasks must not be poisoned by NaN');
  assert.ok(map['full'].allotted > 0);
});

// ---------------------------------------------------------------------------
// Undo/redo history caps apply to BOTH stacks
// ---------------------------------------------------------------------------
test('undo caps the future stack at HISTORY_MAX', () => {
  const c = make();
  const snap = JSON.stringify(c.state.tasks);
  c.history = Array.from({ length: c.HISTORY_MAX + 60 }, () => snap);
  for (let i = 0; i < c.HISTORY_MAX + 60; i++) c.undo();
  assert.ok(c.future.length <= c.HISTORY_MAX, `future grew to ${c.future.length}`);
});

test('redo caps the history stack at HISTORY_MAX', () => {
  const c = make();
  const snap = JSON.stringify(c.state.tasks);
  c.future = Array.from({ length: c.HISTORY_MAX + 60 }, () => snap);
  for (let i = 0; i < c.HISTORY_MAX + 60; i++) c.redo();
  assert.ok(c.history.length <= c.HISTORY_MAX, `history grew to ${c.history.length}`);
});

// ---------------------------------------------------------------------------
// Drawer EDF ordering uses the CURRENT occurrence of a recurring task
// ---------------------------------------------------------------------------
test('timeline EDF ranks a recurring task by its current occurrence, not its long-past base end', () => {
  const c = make();
  cleanDay(c, '23:00');
  const B0 = c.startOfDay(Date.now());
  // A: daily recurrence started 10 days ago; today's occurrence spans 00:00–23:00 (due late today).
  const recA = c.normalizeTask({ id: 'recA', name: 'recurring', type: 'Proportional', priority: 4,
    start: B0 - 10 * DAY, end: B0 - 10 * DAY + 23 * 3600000, planned: 60, spent: 0, pct: 0,
    recur: { kind: 'day', n: 1, shifts: [], overrides: {} } });
  // B: plain task due earlier today (10:00) — must be packed FIRST under correct EDF.
  const plainB = c.normalizeTask({ id: 'plainB', name: 'plain', type: 'Proportional', priority: 4,
    start: B0 - DAY, end: B0 + 10 * 3600000, planned: 60, spent: 0, pct: 0 });
  c.state.tasks = [recA, plainB]; // recA listed first so a stable sort can't mask the bug
  c._horizon = Date.now() + 30 * DAY; // what renderVals normally provides for occurrence expansion
  c._allot = c.computeAllotted(c.state.tasks);
  const chunks = c.buildDayTimeline().chunks.filter(x => x.type === 'scheduled');
  assert.ok(chunks.length >= 2, 'both tasks should be scheduled');
  assert.equal(chunks[0].id, 'plainB', 'earlier-due plain task packs before the recurring task');
});

// ---------------------------------------------------------------------------
// Timer idle guard
// ---------------------------------------------------------------------------
test('stopTimerAt credits only up to the given timestamp', () => {
  const c = make();
  const t = activeTask(c, { id: 'w', spent: 0 });
  c.state.tasks = [t];
  const now = Date.now();
  c.state.running = { w: { startedAt: now - 10 * 60000, beat: now - 8 * 60000 } };
  c.stopTimerAt('w', now - 8 * 60000); // credit up to the last beat, not all 10 minutes
  const after = c.state.tasks.find(x => x.id === 'w');
  assert.ok(Math.abs(after.spent - 2) < 0.05, `expected ~2 min, got ${after.spent}`);
  assert.ok(!c.isRunning('w'));
});

test('stopTimerAt clamps ts into [startedAt, now]', () => {
  const c = make();
  const t = activeTask(c, { id: 'w2', spent: 0 });
  c.state.tasks = [t];
  const now = Date.now();
  c.state.running = { w2: { startedAt: now - 60000 } };
  c.stopTimerAt('w2', now - 5 * 60000); // before startedAt → credits 0
  assert.ok(c.state.tasks.find(x => x.id === 'w2').spent < 0.02);
  c.state.running = { w2: { startedAt: now - 60000 } };
  c.stopTimerAt('w2', now + 60 * 60000); // future ts → clamped to now (~1 min)
  const sp = c.state.tasks.find(x => x.id === 'w2').spent;
  assert.ok(sp <= 1.1, `future ts must not over-credit (got ${sp})`);
});

test('timerHeartbeat keeps a run with a long-stalled beat alive (timers persist across a closed tab / sleep)', () => {
  const c = make();
  const t = activeTask(c, { id: 'w3', spent: 0 });
  c.state.tasks = [t];
  const now = Date.now();
  // beat is 40 min stale (tab was closed / machine asleep) — the timer must NOT auto-stop.
  c.state.running = { w3: { startedAt: now - 45 * 60000, beat: now - 40 * 60000 } };
  c.timerHeartbeat();
  assert.ok(c.isRunning('w3'), 'a stalled beat no longer stops the timer — it keeps counting');
  assert.equal(c.state.tasks.find(x => x.id === 'w3').spent, 0, 'nothing credited while still running');
  assert.ok(!c.state.timerNote, 'no inactivity note');
  // stopping now credits the full wall-clock span from startedAt (≈45 min), not just up to the last beat
  c.stopTimer('w3');
  const sp = c.state.tasks.find(x => x.id === 'w3').spent;
  assert.ok(Math.abs(sp - 45) < 0.1, `expected full ~45 min credited on stop, got ${sp}`);
});

test('timerHeartbeat refreshes the beat of a live run without stopping it', () => {
  const c = make();
  c.state.tasks = [activeTask(c, { id: 'w4' })];
  const now = Date.now();
  c.state.running = { w4: { startedAt: now - 60000, beat: now - c.TIMER_BEAT_MS - 1000 } };
  c.timerHeartbeat();
  assert.ok(c.isRunning('w4'), 'live run keeps running');
  assert.ok(now - c.state.running.w4.beat < c.TIMER_BEAT_MS, 'beat was refreshed');
});

// ---------------------------------------------------------------------------
// JSON backup round-trip
// ---------------------------------------------------------------------------
test('collectBackup/applyBackup round-trips tasks, settings and raw stores', () => {
  const c = make();
  // V0.2: workspaces no longer auto-seed, so give the backup a real task to round-trip.
  c.setState({ quickText: 'Backup me' });
  c.runQuickAdd('bottom');
  c.saveTasks(c.state.tasks);
  c.saveSettings({ minChunk: 45 });
  c.setTheme('light'); // pp-theme is a bare string → exercises the __raw wrapper
  const bak = c.collectBackup();
  assert.equal(bak.app, 'ChronoCompose');
  assert.ok(Array.isArray(bak.data['pp-tasks']) && bak.data['pp-tasks'].length > 0);
  assert.equal(bak.data['pp-settings'].minChunk, 45);
  assert.equal(bak.data['pp-theme'].__raw, 'light');
  // clobber, then restore
  c.saveTasks([]);
  c.setTheme('dark');
  c.saveSettings({ minChunk: 30 });
  const n = c.applyBackup(bak);
  assert.ok(n >= 3, `expected ≥3 stores restored, got ${n}`);
  assert.ok(c.loadTasks().length > 0, 'tasks restored');
  assert.equal(c.loadSettings().minChunk, 45, 'settings restored');
  assert.equal(c.initialTheme(), 'light', 'raw store restored verbatim');
});

test('applyBackup rejects non-backup payloads', () => {
  const c = make();
  assert.throws(() => c.applyBackup({}), /backup/i);
  assert.throws(() => c.applyBackup({ app: 'Other', data: {} }), /backup/i);
});
