// Phase 2 (ROADMAP.md) — two-way gcal sync, pure layer: RRULE serialization round-trips,
// event bodies, outbound diff (computeOutboundOps), queue coalescing + tombstones, echo gating.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, DAY } = require('./_load.js');

const H = 3600000;

function linked(c, over){
  return activeTask(c, Object.assign({ eventId: 'ev_' + Math.random().toString(36).slice(2, 7), calendarId: 'cal1' }, over || {}));
}
const clone = t => JSON.parse(JSON.stringify(t));

// ---------------------------------------------------------------------------
// recurToRRule ⇄ rruleToRecur
// ---------------------------------------------------------------------------
test('recurToRRule round-trips through rruleToRecur for the shared kinds', () => {
  const c = make();
  const until = Date.UTC(2026, 11, 31, 23, 59, 59);
  for (const recur of [
    { kind: 'day', n: 1 }, { kind: 'day', n: 3 }, { kind: 'week', n: 2 },
    { kind: 'weekdays', days: ['mon', 'wed', 'fri'] },
    { kind: 'month', n: 1 }, { kind: 'year', n: 1 }, { kind: 'day', n: 1, until },
  ]) {
    const rr = c.recurToRRule(recur);
    assert.ok(/^RRULE:/.test(rr), 'serializes to an RRULE line');
    const back = c.rruleToRecur([rr]);
    assert.equal(back.kind, recur.kind, rr);
    if (recur.days) assert.deepEqual([...back.days], recur.days);
    if (recur.n > 1) assert.equal(back.n, recur.n);
    assert.equal(back.until != null ? back.until : null, recur.until != null ? recur.until : null, 'UNTIL survives as UTC');
  }
});

test('recurToRRule covers quick-add kinds (weekday, monthDay)', () => {
  const c = make();
  assert.equal(c.recurToRRule({ kind: 'weekday' }), 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.equal(c.recurToRRule({ kind: 'monthDay', day: 15 }), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15');
  assert.equal(c.recurToRRule(null), null);
});

// ---------------------------------------------------------------------------
// eventBodyOf / timesBodyOf
// ---------------------------------------------------------------------------
test('eventBodyOf: all-day uses date + exclusive end and never collapses to zero days', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { name: 'AD', allDay: true, start: B, end: B + DAY });
  const body = c.eventBodyOf(t, false);
  assert.equal(body.summary, 'AD');
  assert.ok(body.start.date && body.end.date);
  assert.notEqual(body.start.date, body.end.date, 'end date is exclusive (next day)');
  const zero = c.eventBodyOf(activeTask(c, { allDay: true, start: B, end: B }), false);
  assert.notEqual(zero.start.date, zero.end.date, 'zero-length all-day still spans one day');
});

test('eventBodyOf: timed events use RFC3339 with offset; recurrence only when asked', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const t = activeTask(c, { start: B + 15 * H, end: B + 16 * H, recur: { kind: 'day', n: 1 } });
  const noR = c.eventBodyOf(t, false);
  assert.ok(/T\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(noR.start.dateTime), noR.start.dateTime);
  assert.equal(noR.recurrence, undefined, 'recurrence omitted unless the rule changed');
  const withR = c.eventBodyOf(t, true);
  assert.deepEqual([...withR.recurrence], ['RRULE:FREQ=DAILY']);
});

// ---------------------------------------------------------------------------
// computeOutboundOps
// ---------------------------------------------------------------------------
test('outbound diff: create → insert, rename → patch, remove → delete/cancelInsert', () => {
  const c = make();
  const lk = linked(c, { id: 'L', name: 'old' });
  const un = activeTask(c, { id: 'U', name: 'manual' });
  // create
  let ops = c.computeOutboundOps([], [un]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'insert');
  assert.equal(ops[0].body.summary, 'manual');
  // rename linked
  const lk2 = clone(lk); lk2.name = 'new';
  ops = c.computeOutboundOps([lk], [lk2]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'patch');
  assert.equal(ops[0].eventId, lk.eventId);
  assert.equal(ops[0].calendarId, 'cal1', 'imported tasks write back to their source calendar');
  assert.equal(ops[0].body.summary, 'new');
  assert.equal(ops[0].body.recurrence, undefined);
  // deletes
  ops = c.computeOutboundOps([lk, un], []);
  assert.equal([...ops.map(o => o.op)].sort().join(','), 'cancelInsert,delete');
});

test('outbound diff: recurrence is only rewritten when the rule changed', () => {
  const c = make();
  const a = linked(c, { id: 'R', recur: { kind: 'day', n: 1, overrides: {}, shifts: [] } });
  const b = clone(a); b.name = 'renamed only';
  let ops = c.computeOutboundOps([a], [b]);
  assert.equal(ops[0].body.recurrence, undefined);
  const d = clone(a); d.recur.n = 2;
  ops = c.computeOutboundOps([a], [d]);
  assert.deepEqual([...ops[0].body.recurrence], ['RRULE:FREQ=DAILY;INTERVAL=2']);
});

test('outbound diff skips subtasks, archived, milestones, and import-created tasks', () => {
  const c = make();
  const sub = activeTask(c, { id: 's', parentId: 'p' });
  const arch = activeTask(c, { id: 'a', archivedAt: Date.now() });
  const ms = activeTask(c, { id: 'm', type: 'Milestone' });
  assert.equal(c.computeOutboundOps([], [sub, arch, ms]).length, 0);
  // a task that APPEARS already linked was written by the import — never echo it back
  const imported = linked(c, { id: 'imp' });
  assert.equal(c.computeOutboundOps([], [imported]).length, 0);
  // archiving an existing linked task is not a remote change
  const live = linked(c, { id: 'x' });
  const archd = clone(live); archd.archivedAt = Date.now();
  assert.equal(c.computeOutboundOps([live], [archd]).length, 0);
});

test('outbound diff: per-occurrence overrides become instance ops; shifts disable them', () => {
  const c = make();
  const B = c.startOfDay(Date.now());
  const base = linked(c, { id: 'ro', start: B - 10 * DAY + 9 * H, end: B - 10 * DAY + 10 * H,
    recur: { kind: 'day', n: 1, overrides: {}, shifts: [] } });
  // move occurrence 4 by an hour
  const moved = clone(base);
  moved.recur.overrides[4] = { start: base.start + 4 * DAY + H, end: base.end + 4 * DAY + H };
  let ops = c.computeOutboundOps([base], [moved]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'patchInstance');
  assert.ok(ops[0].eventId.startsWith(base.eventId + '_'), 'instance id = master_originalStart');
  assert.ok(/Z$/.test(ops[0].eventId), 'timed instance stamp is UTC basic format');
  // delete occurrence 5
  const del = clone(base); del.recur.overrides[5] = { deleted: true };
  ops = c.computeOutboundOps([base], [del]);
  assert.equal(ops[0].op, 'deleteInstance');
  // shifts present → no instance ops (series splits aren't representable remotely)
  const shifted = clone(moved); shifted.recur.shifts = [{ from: 3, offset: DAY }];
  assert.equal(c.computeOutboundOps([base], [shifted]).filter(o => o.op.endsWith('Instance')).length, 0);
});

// ---------------------------------------------------------------------------
// Queue coalescing + tombstones
// ---------------------------------------------------------------------------
test('gcalEnqueue coalesces patches, cancels unsent inserts, and tombstones deletes', () => {
  const c = make();
  c.gcalEnqueue([{ op: 'patch', taskId: 't1', eventId: 'e1', calendarId: 'c1', body: { summary: 'a' } }]);
  c.gcalEnqueue([{ op: 'patch', taskId: 't1', eventId: 'e1', calendarId: 'c1', body: { summary: 'b' } }]);
  assert.equal(c.loadQueue().length, 1, 'successive patches coalesce');
  assert.equal(c.loadQueue()[0].body.summary, 'b', 'latest body wins');

  c.gcalEnqueue([{ op: 'insert', taskId: 't2', body: { summary: 'x' } }]);
  c.gcalEnqueue([{ op: 'cancelInsert', taskId: 't2' }]);
  assert.equal(c.loadQueue().filter(o => o.taskId === 't2').length, 0, 'cancelled insert never flushes');

  c.gcalEnqueue([{ op: 'delete', taskId: 't1', eventId: 'e1', calendarId: 'c1' }]);
  const q = c.loadQueue().filter(o => o.taskId === 't1');
  assert.equal(q.length, 1, 'delete supersedes the pending patch');
  assert.equal(q[0].op, 'delete');
  assert.ok(c.loadTombstones()['e1'], 'tombstone recorded for the deleted event');
});

test('mergeCalendarEvents does not resurrect tombstoned events', () => {
  const c = make();
  const results = [{ cid: 'c1', items: [{ id: 'ghost', status: 'confirmed', summary: 'Ghost',
    start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date(Date.now() + H).toISOString() } }] }];
  const tasks = [];
  c.mergeCalendarEvents(tasks, results, {}, {}, { ghost: Date.now() });
  assert.equal(tasks.length, 0, 'tombstoned event skipped');
  c.mergeCalendarEvents(tasks, results, {}, {}, {});
  assert.equal(tasks.length, 1, 'without a tombstone it imports normally');
});

// ---------------------------------------------------------------------------
// Funnel gating
// ---------------------------------------------------------------------------
test('commit enqueues outbound ops only when two-way is on and not applying an import', () => {
  const c = make();
  const t = linked(c, { id: 'g1', name: 'before' });
  c.state.tasks = [t];
  c.rename('g1', 'off - no push');
  assert.equal(c.loadQueue().length, 0, 'two-way off → no writes');

  c.state.settings.gcalTwoWay = true;
  c.rename('g1', 'on - push');
  assert.equal(c.loadQueue().length, 1, 'two-way on → rename queues a patch');
  assert.equal(c.loadQueue()[0].op, 'patch');

  c.saveQueue([]);
  c._gcalApplying = true;
  c.rename('g1', 'import echo');
  assert.equal(c.loadQueue().length, 0, 'import-applied commits never echo back out');
  c._gcalApplying = false;
});

test('undo pushes the restored state back out', () => {
  const c = make();
  c.state.settings.gcalTwoWay = true;
  const t = linked(c, { id: 'u1', name: 'original' });
  c.state.tasks = [t];
  c.rename('u1', 'changed');
  c.saveQueue([]); // pretend the rename already flushed
  c.undo();
  const q = c.loadQueue();
  assert.equal(q.length, 1, 'undo produces a compensating write');
  assert.equal(q[0].body.summary, 'original');
});
