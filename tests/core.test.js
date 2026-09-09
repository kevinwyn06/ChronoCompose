const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, cleanDay, DAY, withNow } = require('./_load.js');

test('migratePins: 9am placeholder start collapses to midnight and the flag clears', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = { id: 'm1', start: B + 9 * 3600000, startClock: false };
  assert.equal(c.migratePins([t]), 1);
  assert.equal(t.start, B, 'placeholder 9am becomes a bare midnight date');
  assert.equal(t.startClock, null, 'flag clears - the timestamp now carries the truth');
  assert.equal(c.migratePins([t]), 0, 'idempotent');
});

test('migratePins: drops pinStart/pinEnd, leaves a real clock alone', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = { id: 'm2', start: B + 14 * 3600000, pinStart: true, pinEnd: false };
  assert.equal(c.migratePins([t]), 1);
  assert.equal('pinStart' in t, false);
  assert.equal('pinEnd' in t, false);
  assert.equal(t.start, B + 14 * 3600000, 'a real 14:00 clock is untouched');
});

test('normalizeTask: no pin fields, clock flags default to null (derive)', () => {
  const c = make();
  const t = c.normalizeTask({ id: 'n1' });
  assert.equal('pinStart' in t, false);
  assert.equal('pinEnd' in t, false);
  assert.equal(t.startClock, null);
  assert.equal(t.endClock, null);
});

// CHANGED (owner 2026-08-20, Task 15): a bare number is MINUTES now, not decimal hours. One duration
// grammar across every field was the owner's ask — "just one example there might be more" — and the
// grammar table they gave reads `90` as ninety minutes. H:MM is how you type hours, as it always was.
test('parseDur / fmtDur (minutes; bare number = minutes)', () => {
  const c = make();
  assert.strictEqual(c.parseDur('1:30'), 90);
  assert.strictEqual(c.parseDur('2'), 2);
  assert.strictEqual(c.parseDur('2h'), 120);
  assert.strictEqual(c.parseDur(''), 0);
  assert.strictEqual(c.parseDur('0:45'), 45);
  assert.strictEqual(c.fmtDur(90), '1:30');
  assert.strictEqual(c.fmtDur(0), '0:00');
  assert.strictEqual(c.fmtDur(null), '—');
  assert.strictEqual(c.fmtDur(c.parseDur('3:05')), '3:05');
});

test('normalizeTask fills defaults', () => {
  const c = make();
  const t = c.normalizeTask({ id:'a', name:'n' });
  assert.strictEqual(t.spent, 0);
  assert.strictEqual(t.goal, '');
  assert.strictEqual(t.predictManual, false);
  assert.strictEqual(t.calendarId, null);
  assert.strictEqual(t.eventId, null);
  assert.ok(Array.isArray(t.labels));
  assert.ok(Array.isArray(t.deps));
  assert.strictEqual(t.priority, 4);
});

test('isActiveToday: explicit pressed state plus V2.2 inheritance replace today-window inference', () => {
  const c = make();
  c.state.nowTick = Date.now();
  const B = Date.now(), today=c.startOfToday();
  assert.strictEqual(c.isActiveToday(activeTask(c)), true, 'new/default task is pressed');
  assert.strictEqual(c.isActiveToday(activeTask(c, { included:null })), true, 'unfinished work scheduled yesterday inherits');
  /* V5 block 20 (F19): the today window alone now DOES include. Owner: "What? Of course it should be
     auto included." A window opening today with nothing said about it is undecided work, not refused
     work, and it used to resurface a day late as Overdue. A window that has not opened yet is still
     decided by the press, which line below preserves. */
  assert.strictEqual(c.isActiveToday(activeTask(c, { start:today, end:today+DAY, included:null })), true, 'a window opening today auto-includes');
  assert.strictEqual(c.isActiveToday(activeTask(c, { start:today+2*DAY, end:today+4*DAY, included:null })), false, 'an unopened window alone does not include');
  assert.strictEqual(c.isActiveToday(activeTask(c, { start:B+2*DAY, end:B+4*DAY })), true, 'pressed future task is user discretion');
  assert.strictEqual(c.isActiveToday(activeTask(c, { included:null, snoozeUntil: today+DAY })), false, 'excluded (V2.11: a snooze, not Off)');
  assert.strictEqual(c.isActiveToday(activeTask(c, { type:'Milestone' })), false, 'milestone');
  // included:true forces active even outside the [start,end] window
  assert.strictEqual(c.isActiveToday(activeTask(c, { start:B+2*DAY, end:B+4*DAY, included:true })), true, 'force-included');
});

// V5 (F4): `packFromNow` now defaults TRUE, so a pool taken from the DEFAULT 07:00–23:00 window is
// empty when the suite happens to run after 23:00. The clock is pinned (12:00) so this test keeps
// asserting dateless semantics rather than the hour the suite was run at.
test('dateless task: pressed joins today; unpressed/snoozed do not', () => withNow(() => {
  const c = make();
  const B = Date.now();
  c.state.nowTick = B;
  const today = c.startOfToday();
  const dateless = (over) => c.normalizeTask(Object.assign({ id:'d'+Math.random().toString(36).slice(2,7),
    name:'dl', type:'Proportional', start:null, end:null, priority:4, deps:[], pct:0, planned:120, spent:0 }, over||{}));
  assert.strictEqual(c.isScheduled(dateless()), false, 'no dates => unscheduled');
  assert.strictEqual(c.isActiveToday(dateless({ included:null })), false, 'unpressed stays out despite ghost window');
  assert.strictEqual(c.isActiveToday(dateless({ included:true })), true, 'pressed is active');
  // V2.11: `included:false` is retired. A dateless task has no window to inherit from, so unpressed
  // (asserted above) is the whole of "not in today" here; snooze covers the deliberate opt-out.
  assert.strictEqual(c.isActiveToday(dateless({ snoozeUntil: today + DAY })), false, 'snoozed excludes');
  assert.strictEqual(c.isActiveToday(dateless({ snoozeUntil: today + 2*DAY })), false, 'active snooze still excludes');
  assert.strictEqual(c.isActiveToday(dateless({ included:true, snoozeUntil: today })), true, 'expired snooze falls back to pressed');
  // never surfaces on another day — now for a structural reason (ghostSpan anchored at real-today), not a manual gate
  assert.strictEqual(c.isActiveOn(dateless({ included:true }), today + 3*DAY), false, 'other day => not active');
  // due/notBefore are null-safe (fall back to the scheduled day's bounds) so the timeline can order it
  const dl = dateless({ included:true });
  assert.strictEqual(c.dueMsOf(dl, today), today + DAY, 'dateless due = end of today');
  assert.strictEqual(c.notBeforeMsOf(dl, today), today, 'dateless notBefore = start of today');
  // it actually receives allotted time in the pool
  c.state.tasks = [dl];
  const map = c.computeAllotted(c.state.tasks, today);
  assert.ok(map[dl.id].active && map[dl.id].allotted > 0, 'dateless task allots time today');
  // 2026-08-16: REVERSED. V2.1 gave a `planned:0` task the named default so it was draggable, but
  // that is exactly the owner's report — "0 minute tasks are getting 30 minutes". `planned` is now
  // nullable, so 0 is a DECISION ("ask for nothing") and only `null` draws DEFAULT_TASK_MINUTES.
  const zeroPlanned = dateless({ included:true, planned:0 });
  c.state.tasks = [zeroPlanned];
  const map2 = c.computeAllotted(c.state.tasks, today);
  assert.strictEqual(map2[zeroPlanned.id].active, true, 'still active (in the pool)');
  assert.strictEqual(map2[zeroPlanned.id].allotted, 0, 'a deliberate 0 competes normally and is allotted 0');
  const unsetPlanned = dateless({ included:true, planned:null });
  c.state.tasks = [unsetPlanned];
  assert.strictEqual(c.computeAllotted(c.state.tasks, today)[unsetPlanned.id].allotted,
    c.DEFAULT_TASK_MINUTES, '...and an UNSET planned is what draws the default slice');
}));

test('isActiveOn: {dated,dateless} x {auto,forced-in,snoozed-active,snoozed-expired} x {today,other day}', () => {
  const c = make();
  const B = Date.now();
  c.state.nowTick = B;
  const today = c.startOfToday();
  const otherDay = today + 3*DAY;
  const dated = (over) => c.normalizeTask(Object.assign({ id:'x'+Math.random().toString(36).slice(2,7),
    name:'t', type:'Proportional', start:today-DAY, end:today+DAY, priority:4, deps:[], pct:0, planned:60, spent:0 }, over||{}));
  const dateless = (over) => c.normalizeTask(Object.assign({ id:'d'+Math.random().toString(36).slice(2,7),
    name:'dl', type:'Proportional', start:null, end:null, priority:4, deps:[], pct:0, planned:60, spent:0 }, over||{}));
  const cases = [
    { label:'unpressed',       over:{ included:null },                    today:false, other:false },
    { label:'pressed',         over:{ included:true },                    today:true,  other:false },
    { label:'snoozed-active',  over:{ included:true, snoozeUntil: today + 2*DAY }, today:false, other:false },
    { label:'snoozed-expired', over:{ included:true, snoozeUntil: today }, today:true, other:false },
  ];
  for(const kind of [{ name:'dated', make:dated }, { name:'dateless', make:dateless }]){
    for(const c2 of cases){
      const t = kind.make(c2.over);
      const expectedToday=(kind.name==='dated'&&c2.label==='unpressed')?true:c2.today; /* V2.2: yesterday window carries unfinished work */
      assert.strictEqual(c.isActiveOn(t, today), expectedToday, `${kind.name}/${c2.label} @ today`);
      assert.strictEqual(c.isActiveOn(t, otherDay), c2.other, `${kind.name}/${c2.label} @ other day`);
    }
  }
});

test('isOptedOut: unpressed/snoozed work is out unless V2.2 inherited it', () => {
  const c = make();
  const B = Date.now();
  c.state.nowTick = B;
  const today = c.startOfToday();
  const t = () => activeTask(c, {start:today,end:today+DAY});
  // V2.11: the `included:false` case is gone with Off; unpressed (below) is what it collapsed into.
  assert.strictEqual(c.isOptedOut(Object.assign(t(), { included:null, snoozeUntil: today + DAY })), true, 'active snooze alone');
  /* V5 block 20 (F19), owner verbatim: "What? Of course it should be auto included." `t()`'s window
     OPENS today, and untouched work the calendar just surfaced is no longer filed as a refusal. The
     original assertion is preserved below against a window that has not started yet — which is where
     `included:null` still genuinely means unpressed. */
  assert.strictEqual(c.isOptedOut(Object.assign(t(), { included:null, snoozeUntil:null })), false,
    'a window opening today auto-includes untouched work');
  assert.strictEqual(c.isOptedOut(activeTask(c, { start:today+2*DAY, end:today+4*DAY, included:null, snoozeUntil:null })),
    true, 'null is unpressed');
  assert.strictEqual(c.isOptedOut(activeTask(c,{included:null})), false, 'yesterday-scheduled null state is inherited');
  assert.strictEqual(c.isOptedOut(Object.assign(t(), { included:true, snoozeUntil: today })), false, 'expired snooze returns to pressed');
});

test('inclState: active is stronger than pressed; inherited work receives pressed depth', () => {
  const c = make();
  c.state.nowTick = Date.now();
  const today = c.startOfToday();
  const inWin = () => activeTask(c); // straddles today
  const outWin = () => activeTask(c, { start: today+2*DAY, end: today+4*DAY });
  // V2.11: 'off' no longer exists. There are four states, and nothing outranks snooze except active.
  assert.strictEqual(c.inclState(Object.assign(inWin(), { snoozeUntil: today+DAY })), 'snoozed');
  assert.strictEqual(c.inclState(Object.assign(outWin(), { included:true, snoozeUntil: today+DAY })), 'snoozed',
    'a snooze covering today beats an explicit press');
  assert.strictEqual(c.inclState(Object.assign(inWin(), { included:true })), 'pressed');
  assert.strictEqual(c.inclState(Object.assign(inWin(), { included:null })), 'pressed', 'inherited task is auto-included');
  assert.strictEqual(c.inclState(Object.assign(outWin(), { included:null })), 'unpressed');
  const active=Object.assign(outWin(), { included:null });
  c.state.running={ [active.id]:{startedAt:Date.now(),beat:Date.now()} };
  assert.strictEqual(c.inclState(active), 'active');
});

test('isMilestone reflects the internal Milestone marker', () => {
  const c = make();
  assert.strictEqual(c.isMilestone(activeTask(c, { type:'Milestone' })), true);
  assert.strictEqual(c.isMilestone(activeTask(c)), false);
});

test('computeAllotted: snoozed/off subtask weighs zero; turning on restores its share', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '01:00'); // pool = 60
  const today = c.startOfToday();
  // p's own planned (60) matches the whole pool; a and b are BOTH planned 60 each (oversubscribed vs
  // p, matching the existing "oversubscribed children split everything" pattern in tests/subtasks.test.js)
  // so that excluding b's weight is visible in a's share, not masked by denom=max(P,S) pinning to P.
  const p = activeTask(c, { id:'p', planned:60 });
  const a = activeTask(c, { id:'a', planned:60, parentId:'p' });
  const b = activeTask(c, { id:'b', planned:60, parentId:'p', snoozeUntil: today + DAY }); // snoozed
  c.state.tasks = [p, a, b];
  let map = c.computeAllotted(c.state.tasks);
  assert.strictEqual(map['b'].allotted, 0, 'snoozed child weighs zero');
  assert.strictEqual(map['a'].allotted, 60, 'a gets the whole family pool (b contributes no weight)');
  // turning b back on (same-day recompute — no snapshot/undo needed, this is a pure read)
  b.snoozeUntil = null;
  map = c.computeAllotted(c.state.tasks);
  assert.strictEqual(map['a'].allotted, 30, 'a and b now split evenly (both oversubscribed against the 60min pool)');
  assert.strictEqual(map['b'].allotted, 30);
});

test('computeAllotted: manual-override fixed, excluded/milestone inactive, Proportional split', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '10:00'); // 600 min pool
  const ex = activeTask(c, { predictManual:true, predicted:120, planned:120 });
  const p1 = activeTask(c, { planned:120 });
  const p2 = activeTask(c, { planned:240 });
  const excl = activeTask(c, { included:null, snoozeUntil: c.startOfToday()+DAY, planned:999 });
  c.state.tasks = [ex, p1, p2, excl];
  const a = c.computeAllotted(c.state.tasks);
  assert.strictEqual(a[ex.id].allotted, 120, 'override = predicted');
  // pool after the reserve = 600-120 = 480; the 120:240 shares would be 160:320, but the 2026-08-16
  // cap holds each row at its own figure — nothing is ever allotted more than it asked for.
  assert.strictEqual(a[p1.id].allotted, 120);
  assert.strictEqual(a[p2.id].allotted, 240);
  assert.strictEqual(a[excl.id].active, false);
  assert.strictEqual(a[excl.id].allotted, 0);
});

test('computeAllotted: manual override redistributes pool to remaining Proportional', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '10:00'); // 600
  const p1 = activeTask(c, { type:'Proportional', planned:120 });
  const p2 = activeTask(c, { type:'Proportional', planned:240 });
  c.state.tasks = [p1, p2];
  const before = c.computeAllotted(c.state.tasks);
  // 2026-08-16: Σdemand = 360 into a 600 pool, so both shares (600*120/360 = 200, 600*240/360 = 400)
  // are capped at the rows' own figures. The 240 surplus minutes stay unallocated.
  assert.strictEqual(before[p1.id].allotted, 120);
  assert.strictEqual(before[p2.id].allotted, 240);
  // override p1 to a fixed 60 -> the remaining 540 all goes to p2, but p2 only asked for 240
  p1.predictManual = true; p1.predicted = 60;
  const after = c.computeAllotted(c.state.tasks);
  assert.strictEqual(after[p1.id].allotted, 60);
  assert.strictEqual(after[p2.id].allotted, 240, 'the whole remaining pool, capped at p2\'s own ask');
});

test('getSpent adds live elapsed while running', () => {
  const c = make();
  const t = activeTask(c, { spent:10 });
  c.state.tasks = [t];
  assert.strictEqual(c.getSpent(t), 10);
  c.state.running = { [t.id]: { startedAt: Date.now() - 60*60000 } };
  c.state.nowTick = Date.now();
  const s = c.getSpent(t);
  assert.ok(s >= 69 && s <= 71, 'about 10 + 60 minutes, got '+s);
});

test('timers: multitasking concurrent; stop accumulates spent per task', () => {
  const c = make();
  c.state.settings.multitask = true; // V2.4: concurrency is opt-in now
  const a = activeTask(c, { spent:0 }); const b = activeTask(c, { spent:0 });
  c.state.tasks = [a, b];
  c.startTimer(a.id);
  assert.ok(c.isRunning(a.id));
  c.startTimer(b.id); // both run now (multitasking)
  assert.ok(c.isRunning(a.id) && c.isRunning(b.id), 'a and b both running');
  // simulate 30 min elapsed for b, then stop just b
  c.state.running = Object.assign({}, c.state.running, { [b.id]: { startedAt: Date.now() - 30*60000 } });
  c.stopTimer(b.id);
  assert.ok(!c.isRunning(b.id) && c.isRunning(a.id), 'b stopped, a still running');
  const bb = c.state.tasks.find(t=>t.id===b.id);
  assert.ok(bb.spent >= 29 && bb.spent <= 31, 'b spent ~30, got '+bb.spent);
  // toggle the still-running a stops it -> nothing running
  c.toggleTimer(a.id);
  assert.ok(!c.anyRunning());
});

/* PP-EXT V2.4 */
test('V2.4: multitask defaults off', () => {
  const c = make();
  assert.equal(c.DEFAULT_SETTINGS().multitask, false, 'strict single timer is the default');
  assert.equal(c.multitaskOn(), false);
});

test('V2.4: strict single timer - starting one stops the others and credits their spent', () => {
  const c = make();
  const a = activeTask(c, { spent:0 }); const b = activeTask(c, { spent:0 });
  c.state.tasks = [a, b];
  c.startTimer(a.id);
  assert.ok(c.isRunning(a.id));
  // 30 min on a, then b starts
  c.state.running = { [a.id]: { startedAt: Date.now() - 30*60000, beat: Date.now() } };
  c.startTimer(b.id);
  assert.ok(!c.isRunning(a.id), 'a stopped when b started');
  assert.ok(c.isRunning(b.id), 'b running');
  assert.equal(Object.keys(c.state.running).length, 1, 'exactly one timer runs');
  const aa = c.state.tasks.find(t=>t.id===a.id);
  assert.ok(aa.spent >= 29 && aa.spent <= 31, 'a was credited its ~30 min, got '+aa.spent);
});

test('V2.4: multitask on preserves concurrency', () => {
  const c = make();
  c.state.settings.multitask = true;
  const a = activeTask(c, { spent:0 }); const b = activeTask(c, { spent:0 });
  c.state.tasks = [a, b];
  c.startTimer(a.id); c.startTimer(b.id);
  assert.equal(Object.keys(c.state.running).length, 2, 'both timers run');
});

test('V2.4: activateTask switches active and stops only the prior active', () => {
  const c = make();
  c.state.settings.multitask = true; // isolate the switch rule from the strict-stop rule
  const a = activeTask(c, { spent:0 }); const b = activeTask(c, { spent:0 }); const d = activeTask(c, { spent:0 });
  c.state.tasks = [a, b, d];
  c.startTimer(d.id);                       // an independently-started multitask timer
  c.startTimer(a.id);                       // a is now the most recent start -> active
  assert.equal(c.activeTaskId(), a.id, 'a is active');
  c.activateTask(b.id);
  assert.equal(c.activeTaskId(), b.id, 'b is active after the switch');
  assert.ok(!c.isRunning(a.id), 'the prior active stopped');
  assert.ok(c.isRunning(d.id), 'the independently-started timer keeps running');
});

test('V2.4: activateTask on a running-but-not-active task makes it active', () => {
  const c = make();
  c.state.settings.multitask = true;
  const a = activeTask(c, { spent:0 }); const b = activeTask(c, { spent:0 });
  c.state.tasks = [a, b];
  c.startTimer(b.id); c.startTimer(a.id);
  assert.equal(c.activeTaskId(), a.id);
  c.activateTask(b.id);
  assert.equal(c.activeTaskId(), b.id, 'b takes over as active');
  assert.ok(c.isRunning(b.id), 'and is still running');
});

test('V2.4: rowDblClick activates a task, and never a milestone or an archived one', () => {
  const c = make();
  const ev = () => ({ preventDefault(){}, stopPropagation(){} });
  const a = activeTask(c, { spent:0 });
  const mile = activeTask(c, { type:'Milestone' });
  const arch = activeTask(c, { archivedAt: Date.now() });
  c.state.tasks = [a, mile, arch];
  c.rowDblClick(ev(), a.id);
  assert.equal(c.activeTaskId(), a.id, 'double-click made it active');
  c.rowDblClick(ev(), mile.id);
  assert.equal(c.activeTaskId(), a.id, 'a milestone has no timer, so active is unchanged');
  c.rowDblClick(ev(), arch.id);
  assert.equal(c.activeTaskId(), a.id, 'an archived task does not activate');
  c.rowDblClick(ev(), 'nope');
  assert.equal(c.activeTaskId(), a.id, 'an unknown id is a no-op');
});

test('V2.4: orderingSeam puts the active task first', () => {
  const c = make();
  const rows = [
    { id:'x', active:false, priority:1, due:1, rem:60 },
    { id:'y', active:true,  priority:4, due:9, rem:10 },
  ];
  assert.deepEqual(c.orderingSeam(rows).map(r=>r.id), ['y','x'], 'active outranks priority/EDF');
});

// Clock-injected: the fixtures below sit ±1h around "now" and autoTimerPlan gates on isFixedToday(),
// which asks whether the occurrence *starts* on the current local day. Run for real at 00:05 and the
// "started an hour ago" fixture starts yesterday, so it is legitimately not fixed-today and the
// auto-pause assertion fails. Freezing noon keeps the assertions pinned to the behaviour they mean.
test('autoTimerPlan: fixed appointments auto-start once and auto-pause; open shapes never auto-start', () => withNow(() => {
  const c = make();
  const now = Date.now();
  c.state.nowTick = now;
  // Clocked start with no end must NOT auto-start: it has no defined stop.
  const s = activeTask(c, { start: now - 60000, end: null });
  c.state.tasks = [s];
  c.state.running = {};
  assert.ok(!c.autoTimerPlan(now).start.includes(s.id), 'clocked start without end must not auto-start');
  // Deadline without a clocked start also must NOT auto-start.
  const e = activeTask(c, { start: null, end: now + 3600000 });
  c.state.tasks = [e];
  assert.ok(!c.autoTimerPlan(now).start.includes(e.id), 'deadline-only task must not auto-start');

  // Fixed appointment whose start the clock has just CROSSED -> should be planned to start.
  // (Owner report 2026-09-09: "sometimes the timer starts on its own after I edit a date". A window
  // that merely CONTAINS now is no longer enough — the start instant has to fall between the previous
  // tick and this one, or any edit that moves an appointment onto the current hour starts its timer.
  // See autoTimerPlan and tests/owner-session-2026-09-09.test.js.)
  const b = activeTask(c, { start: now - 60000, end: now + 3600000 });
  c.state.tasks = [b];
  c.state.running = {};
  c._autoTickAt = now - 120000;   // the previous tick was before the appointment began
  let plan = c.autoTimerPlan(now);
  assert.ok(plan.start.includes(b.id), 'fixed in-window task should auto-start');
  // once its occurrence is marked done, it is not re-started
  c._autoDone[b.id + ':' + c.occOf(b).start] = true;
  plan = c.autoTimerPlan(now);
  assert.ok(!plan.start.includes(b.id), 'already-started occurrence is not re-started');

  // Fixed appointment currently running past its end -> should be planned to pause.
  const bp = activeTask(c, { start: now - 3600000, end: now - 1000 });
  c.state.tasks = [bp];
  c.state.running = { [bp.id]: { startedAt: now - 3600000, beat: now } };
  const plan2 = c.autoTimerPlan(now);
  assert.ok(plan2.pause.includes(bp.id), 'fixed running task past its end should auto-pause');
}));

test('daily ledger: stopTimerAt credits both lifetime spent and spentByDay[startDay]', () => {
  const c = make();
  c.state.nowTick = Date.now();
  const t = activeTask(c, { spent:0 });
  c.state.tasks = [t];
  const startedAt = Date.now() - 30*60000;
  c.state.running = { [t.id]: { startedAt, beat: startedAt } };
  c.stopTimer(t.id);
  const tt = c.state.tasks.find(x=>x.id===t.id);
  const key = c.ymdOf(startedAt);
  assert.ok(tt.spent >= 29 && tt.spent <= 31, 'lifetime spent ~30, got '+tt.spent);
  assert.ok(tt.spentByDay[key] >= 29 && tt.spentByDay[key] <= 31, 'today ledger ~30, got '+tt.spentByDay[key]);
  assert.ok(Math.abs(tt.spent - tt.spentByDay[key]) < 0.01, 'single session: lifetime == that day');
});

test('daily ledger: getSpentOn is per-day; lifetime spent from prior days is not counted today', () => {
  const c = make();
  const today = c.startOfToday();
  const yKey = c.ymdOf(today - DAY), tKey = c.ymdOf(today);
  const t = activeTask(c, { spent:90, spentByDay:{ [yKey]:60, [tKey]:30 } });
  c.state.running = {};
  assert.strictEqual(c.getSpentOn(t, today), 30, 'today only');
  assert.strictEqual(c.getSpentOn(t, today - DAY), 60, 'yesterday only');
  assert.strictEqual(c.getSpent(t), 90, 'lifetime total unchanged');
});

// Clock-injected: "started 20 minutes ago" is yesterday's timer if the suite runs before 00:20, so
// getSpentOn credits yesterday and today reads 0. That is the correct per-day behaviour — the fixture,
// not the assertion, is what needs pinning.
test('daily ledger: getSpentOn adds live running only on the timer\'s start day', () => withNow(() => {
  const c = make();
  const today = c.startOfToday();
  const t = activeTask(c, { spent:0, spentByDay:{} });
  const startedAt = Date.now() - 20*60000;
  c.state.running = { [t.id]: { startedAt } };
  c.state.nowTick = Date.now();
  assert.ok(c.getSpentOn(t, today) >= 19 && c.getSpentOn(t, today) <= 21, 'live ~20 today');
  assert.strictEqual(c.getSpentOn(t, today + DAY), 0, 'no live credit on a different day');
}));

test('computeAllotted subtracts today-only spent (prior-day spent no longer shrinks the pool)', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '10:00'); // 600 pool
  const today = c.startOfToday();
  const yKey = c.ymdOf(today - DAY);
  // 60 min of work logged YESTERDAY only — must not reduce today's allotment
  const p1 = activeTask(c, { type:'Proportional', planned:120, spent:60, spentByDay:{ [yKey]:60 } });
  const p2 = activeTask(c, { type:'Proportional', planned:240 });
  c.state.tasks = [p1, p2];
  const a = c.computeAllotted(c.state.tasks);
  // 2026-08-16: the 600*120/360 = 200 share is capped at p1's own 120 (and p2's 400 at 240); what
  // this test is about is unchanged — yesterday's 60 minutes do not touch today's figure.
  assert.strictEqual(a[p1.id].allotted, 120, 'its whole ask — yesterday spent ignored today');
  assert.strictEqual(a[p2.id].allotted, 240);
  // now log 50 min TODAY -> its allotment drops by exactly 50, because the cap is demand MINUS spent
  p1.spentByDay[c.ymdOf(today)] = 50; p1.spent = 110;
  const b = c.computeAllotted(c.state.tasks);
  assert.strictEqual(b[p1.id].allotted, 70, '120 ask - 50 done today');
});

test('togglePredictManual / setPredict', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '10:00');
  const p1 = activeTask(c, { type:'Proportional', planned:120 });
  c.state.tasks = [p1];
  c._allot = c.computeAllotted(c.state.tasks); // togglePredictManual reads allotOf -> _allot
  const computed = c._allot[p1.id].computed;
  c.togglePredictManual(p1.id);
  let t = c.state.tasks.find(x=>x.id===p1.id);
  assert.strictEqual(t.predictManual, true);
  assert.strictEqual(t.predicted, computed, 'seeded with computed');
  c.togglePredictManual(p1.id);
  t = c.state.tasks.find(x=>x.id===p1.id);
  assert.strictEqual(t.predictManual, false);
  c.setPredict(p1.id, '2:00');
  t = c.state.tasks.find(x=>x.id===p1.id);
  assert.strictEqual(t.predicted, 120);
  assert.strictEqual(t.predictManual, true);
});

// V5 (F4): clock pinned at 12:00 — with `packFromNow` defaulting true the default 07:00–23:00 window
// has no room left when the suite runs after 23:00. Both meals still lie ahead of the pinned now.
//
// 2026-08-19: meals are TASKS now (the routines), not two settings-derived `meal` chunks, so they are
// seeded here and arrive as `fixed` chunks. The property under test is unchanged and is the one that
// mattered all along: scheduled chunks stay inside the window and never overlap a blocking meal.
test('buildDayTimeline: meals present, chunks in-window & non-overlapping', () => withNow(() => {
  const c = make();
  c.state.nowTick = Date.now();
  c.state.settings.freeTime = 0; // no evening reserve, so the meals are the only busy blocks
  const B = c.startOfToday();
  const meal = (id, name, sh, eh) => c.normalizeTask({ id, name, type:'Proportional', included:true,
    start:B + sh*3600000, end:B + eh*3600000, startClock:true, endClock:true, uncompressable:true,
    priority:4, deps:[], pct:0, planned:null, spent:0 });
  const lunch = meal('lunch', 'Lunch', 12.5, 13), dinner = meal('dinner', 'Dinner', 17.5, 18);
  const p1 = activeTask(c, { type:'Proportional', planned:120, name:'A' });
  const p2 = activeTask(c, { type:'Proportional', planned:120, name:'B' });
  c.state.tasks = [p1, p2, lunch, dinner];
  c._allot = c.computeAllotted(c.state.tasks);
  const d = c.buildDayTimeline();
  assert.ok(d.dayStart < d.dayEnd);
  const mealsFull = d.chunks.filter(x=>x.type==='fixed' && (x.id==='lunch' || x.id==='dinner'));
  assert.deepEqual(mealsFull.map(x=>x.title).sort(), ['Dinner','Lunch']);
  const sched = d.chunks.filter(x=>x.start && x.type==='scheduled');
  assert.ok(sched.length > 0, 'some scheduled chunks');
  sched.forEach(x=>{
    assert.ok(x.start >= d.dayStart && x.end <= d.dayEnd, 'within window');
    assert.ok(x.start < x.end, 'positive duration');
  });
  // no scheduled chunk overlaps a meal
  sched.forEach(x=> mealsFull.forEach(mm=>{
    assert.ok(x.end <= mm.start || x.start >= mm.end, 'no overlap with meal');
  }));
}));

test('buildDayTimeline: overflow tasks become unscheduled', () => {
  const c = make();
  c.state.nowTick = Date.now();
  cleanDay(c, '01:00'); // 60-min window
  // A manual Predict override is a fixed slice, not pool-capped, so 10h into a 1h window overflows.
  const big = activeTask(c, { predictManual:true, predicted:600, planned:600, name:'Big' });
  c.state.tasks = [big];
  c._allot = c.computeAllotted(c.state.tasks);
  const d = c.buildDayTimeline();
  const uns = d.chunks.filter(x=>x.start===null && x.type==='unscheduled');
  assert.ok(uns.length >= 1, 'expected an unscheduled remainder');
  assert.ok(uns[0].durationMin > 0);
});
