// Independent, spec-derived unit tests for the Google Calendar logic.
// Derived from CLAUDE.md + architecture.md + the Component methods in index.html:
//   rruleToRecur, parseEventMeta, calTag, mergeCalendarEvents, pruneDeletedEvents.
// These are the pure helpers documented under "Google Calendar I/O". We call them
// directly on plain task arrays (no React / no commit needed).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const DAY = 86400000;

// --- helpers ------------------------------------------------------------
function timedEvent(over){
  return Object.assign({
    id:'ev1', status:'confirmed', summary:'Meeting',
    start:{ dateTime:'2026-07-02T09:00:00Z' },
    end:{ dateTime:'2026-07-02T10:00:00Z' },
    description:'',
  }, over||{});
}
function results(cid, items){ return [{ cid, items }]; }
function calById(cid, summary){ const o={}; o[cid]={ id:cid, summary }; return o; }

// =======================================================================
// rruleToRecur
// =======================================================================
test('rruleToRecur: null/empty recurrence -> null', () => {
  const c = make();
  assert.equal(c.rruleToRecur(null), null);
  assert.equal(c.rruleToRecur([]), null);
  assert.equal(c.rruleToRecur(['EXDATE:20260101']), null); // no RRULE line
});

test('rruleToRecur: DAILY -> kind day, n 1', () => {
  const c = make();
  const r = c.rruleToRecur(['RRULE:FREQ=DAILY']);
  assert.equal(r.kind, 'day');
  assert.equal(r.n, 1);
  assert.equal(r.label, 'Daily');
  // spec: every parsed recur carries these bookkeeping fields
  assert.deepEqual([...r.shifts], []);
  assert.deepEqual({...r.overrides}, {});
  assert.equal(r.until, null);
});

test('rruleToRecur: DAILY INTERVAL=3 -> Every 3 days', () => {
  const c = make();
  const r = c.rruleToRecur(['RRULE:FREQ=DAILY;INTERVAL=3']);
  assert.equal(r.kind, 'day');
  assert.equal(r.n, 3);
  assert.equal(r.label, 'Every 3 days');
});

test('rruleToRecur: WEEKLY with no BYDAY -> kind week', () => {
  const c = make();
  const r = c.rruleToRecur(['RRULE:FREQ=WEEKLY;INTERVAL=2']);
  assert.equal(r.kind, 'week');
  assert.equal(r.n, 2);
  assert.equal(r.label, 'Every 2 weeks');
});

test('rruleToRecur: WEEKLY single BYDAY -> kind week (not weekdays)', () => {
  const c = make();
  const r = c.rruleToRecur(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
  assert.equal(r.kind, 'week');
});

test('rruleToRecur: WEEKLY multi BYDAY -> kind weekdays with mapped days', () => {
  const c = make();
  const r = c.rruleToRecur(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR']);
  assert.equal(r.kind, 'weekdays');
  assert.deepEqual([...r.days], ['mon','wed','fri']);
});

test('rruleToRecur: MONTHLY and YEARLY', () => {
  const c = make();
  assert.equal(c.rruleToRecur(['RRULE:FREQ=MONTHLY']).kind, 'month');
  assert.equal(c.rruleToRecur(['RRULE:FREQ=YEARLY']).kind, 'year');
});

test('rruleToRecur: UNTIL is parsed as UTC', () => {
  const c = make();
  const r = c.rruleToRecur(['RRULE:FREQ=DAILY;UNTIL=20261231T235959Z']);
  assert.equal(r.until, Date.UTC(2026,11,31,23,59,59));
});

test('rruleToRecur: date-only UNTIL -> end of that UTC day', () => {
  const c = make();
  const r = c.rruleToRecur(['RRULE:FREQ=DAILY;UNTIL=20261231']);
  assert.equal(r.until, Date.UTC(2026,11,31,23,59,59));
});

// =======================================================================
// mergeCalendarEvents — import + upsert
// =======================================================================
test('mergeCalendarEvents: imports a single event as a new task', () => {
  const c = make();
  const tasks = [];
  const r = c.mergeCalendarEvents(tasks, results('cal1', [timedEvent()]), {}, calById('cal1','Work'));
  assert.equal(r.added, 1);
  assert.equal(r.updated, 0);
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.name, 'Meeting');
  assert.equal(t.eventId, 'ev1');
  assert.equal(t.calendarId, 'cal1');
  assert.equal(t.start, new Date('2026-07-02T09:00:00Z').getTime());
  assert.equal(t.end, new Date('2026-07-02T10:00:00Z').getTime());
  // Proportional mode; planned = the event's own duration (here 09:00->10:00 = 60m)
  assert.equal(t.type, 'Proportional');
  assert.equal(t.planned, 60);
  // description is imported verbatim (no marker stripping); goal is not derived from it
  assert.equal(t.goal, '');
  // CONTRACT CHANGED (owner 2026-08-14): the calendar summary no longer becomes a slugged tag.
  assert.deepEqual([...t.labels], []);
});

test('mergeCalendarEvents: timed event -> planned = actual gcal duration in minutes', () => {
  const c = make();
  const tasks = [];
  // 09:00 -> 11:30 = 150 minutes
  c.mergeCalendarEvents(tasks, results('cal1', [timedEvent({ end:{ dateTime:'2026-07-02T11:30:00Z' } })]), {}, calById('cal1','Work'));
  const t = tasks[0];
  assert.equal(t.planned, 150);
  assert.equal(t.type, 'Proportional'); // no explicit marker -> still Proportional
});

test('mergeCalendarEvents: all-day event -> planned left blank (0)', () => {
  const c = make();
  const tasks = [];
  const ev = { id:'allday2', status:'confirmed', summary:'Holiday',
    start:{ date:'2026-07-04' }, end:{ date:'2026-07-05' }, description:'' };
  c.mergeCalendarEvents(tasks, results('cal1', [ev]), {}, calById('cal1','Work'));
  assert.equal(tasks[0].planned, 0);
});

test('mergeCalendarEvents: legacy //planned-duration and //goal markers are ignored', () => {
  const c = make();
  const tasks = [];
  // 60-minute event whose description still carries old markers from a prior export.
  const desc = '//planned-duration: 02:00 1\n//goal: ship it\nreal notes';
  c.mergeCalendarEvents(tasks, results('cal1', [timedEvent({ description:desc })]), {}, calById('cal1','Work'));
  const t = tasks[0];
  assert.equal(t.type, 'Proportional', 'no Exact-mode inference from markers');
  assert.equal(t.planned, 60, 'planned from duration, not the 02:00 marker');
  assert.equal(t.goal, '', 'goal not parsed from marker');
  assert.equal(t.description, desc, 'description imported verbatim, markers not stripped');
});

test('mergeCalendarEvents: skips cancelled events', () => {
  const c = make();
  const tasks = [];
  const r = c.mergeCalendarEvents(tasks, results('cal1', [timedEvent({ status:'cancelled' })]), {}, calById('cal1','Work'));
  assert.equal(r.added, 0);
  assert.equal(tasks.length, 0);
});

test('mergeCalendarEvents: re-import is idempotent (no duplicate)', () => {
  const c = make();
  const tasks = [];
  c.mergeCalendarEvents(tasks, results('cal1', [timedEvent()]), {}, calById('cal1','Work'));
  const r2 = c.mergeCalendarEvents(tasks, results('cal1', [timedEvent()]), {}, calById('cal1','Work'));
  assert.equal(r2.added, 0);
  assert.equal(r2.updated, 1);
  assert.equal(tasks.length, 1); // still exactly one task
});

test('mergeCalendarEvents: updating an existing event refreshes name/times, still untagged', () => {
  const c = make();
  const tasks = [];
  c.mergeCalendarEvents(tasks, results('cal1', [timedEvent()]), {}, calById('cal1','Work'));
  const upd = timedEvent({ summary:'Renamed', end:{ dateTime:'2026-07-02T11:00:00Z' } });
  c.mergeCalendarEvents(tasks, results('cal1', [upd]), {}, calById('cal1','Work'));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].name, 'Renamed');
  assert.equal(tasks[0].end, new Date('2026-07-02T11:00:00Z').getTime());
  assert.deepEqual([...tasks[0].labels], []); // no tag added on import or re-import (owner 2026-08-14)
});

test('mergeCalendarEvents: all-day event spans whole days from local midnight', () => {
  const c = make();
  const tasks = [];
  const ev = { id:'allday1', status:'confirmed', summary:'Holiday',
    start:{ date:'2026-07-04' }, end:{ date:'2026-07-05' }, description:'' };
  c.mergeCalendarEvents(tasks, results('cal1', [ev]), {}, calById('cal1','Work'));
  const t = tasks[0];
  assert.equal(t.allDay, true);
  assert.equal(t.start, c.parseYMD('2026-07-04'));
  assert.equal(t.end, c.parseYMD('2026-07-05'));
});

// =======================================================================
// mergeCalendarEvents — recurring-series collapse
// =======================================================================
test('mergeCalendarEvents: recurring instances collapse to ONE task keyed by master id', () => {
  const c = make();
  const tasks = [];
  const inst = (id, day) => ({ id, status:'confirmed', summary:'Standup',
    recurringEventId:'master1',
    start:{ dateTime:`2026-07-0${day}T09:00:00Z` },
    end:{ dateTime:`2026-07-0${day}T09:15:00Z` }, description:'' });
  const items = [inst('i1',2), inst('i2',3), inst('i3',4)];
  const masters = { 'cal1|master1': { id:'master1', summary:'Standup',
    recurrence:['RRULE:FREQ=DAILY'],
    start:{ dateTime:'2026-07-02T09:00:00Z' }, end:{ dateTime:'2026-07-02T09:15:00Z' }, description:'' } };
  const r = c.mergeCalendarEvents(tasks, results('cal1', items), masters, calById('cal1','Work'));
  assert.equal(r.added, 1);         // three instances -> one task
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].eventId, 'master1'); // keyed by master id
  assert.ok(tasks[0].recur, 'carries a recur rule');
  assert.equal(tasks[0].recur.kind, 'day');
});

test('mergeCalendarEvents: recurring re-import stays a single task', () => {
  const c = make();
  const tasks = [];
  const inst = (id) => ({ id, status:'confirmed', summary:'Standup', recurringEventId:'master1',
    start:{ dateTime:'2026-07-02T09:00:00Z' }, end:{ dateTime:'2026-07-02T09:15:00Z' }, description:'' });
  const masters = { 'cal1|master1': { id:'master1', summary:'Standup', recurrence:['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'],
    start:{ dateTime:'2026-07-02T09:00:00Z' }, end:{ dateTime:'2026-07-02T09:15:00Z' }, description:'' } };
  c.mergeCalendarEvents(tasks, results('cal1', [inst('i1'), inst('i2')]), masters, calById('cal1','Work'));
  const r2 = c.mergeCalendarEvents(tasks, results('cal1', [inst('i1'), inst('i2')]), masters, calById('cal1','Work'));
  assert.equal(tasks.length, 1);
  assert.equal(r2.added, 0);
});

// =======================================================================
// pruneDeletedEvents
// =======================================================================
test('pruneDeletedEvents: removes calendar tasks whose event is gone', () => {
  const c = make();
  const tasks = [ c.normalizeTask({ id:'t1', name:'gone', eventId:'ev1', calendarId:'cal1' }) ];
  const removed = c.pruneDeletedEvents(tasks, results('cal1', []), ['cal1']);
  assert.equal(removed, 1);
  assert.equal(tasks.length, 0);
});

test('pruneDeletedEvents: keeps tasks whose event is still present', () => {
  const c = make();
  const tasks = [ c.normalizeTask({ id:'t1', name:'live', eventId:'ev1', calendarId:'cal1' }) ];
  const removed = c.pruneDeletedEvents(tasks, results('cal1', [timedEvent()]), ['cal1']);
  assert.equal(removed, 0);
  assert.equal(tasks.length, 1);
});

test('pruneDeletedEvents: never removes manual tasks (no eventId)', () => {
  const c = make();
  const tasks = [ c.normalizeTask({ id:'m1', name:'manual' }) ];
  const removed = c.pruneDeletedEvents(tasks, results('cal1', []), ['cal1']);
  assert.equal(removed, 0);
  assert.equal(tasks.length, 1);
});

test('pruneDeletedEvents: leaves tasks from unselected calendars alone', () => {
  const c = make();
  const tasks = [ c.normalizeTask({ id:'t1', name:'other', eventId:'ev1', calendarId:'cal2' }) ];
  // only cal1 selected/fetched; cal2 not in results -> its tasks must survive
  const removed = c.pruneDeletedEvents(tasks, results('cal1', []), ['cal1']);
  assert.equal(removed, 0);
  assert.equal(tasks.length, 1);
});

test('pruneDeletedEvents: cancelled instances count as gone', () => {
  const c = make();
  const tasks = [ c.normalizeTask({ id:'t1', name:'cx', eventId:'ev1', calendarId:'cal1' }) ];
  const removed = c.pruneDeletedEvents(tasks, results('cal1', [timedEvent({ status:'cancelled' })]), ['cal1']);
  assert.equal(removed, 1);
  assert.equal(tasks.length, 0);
});

test('pruneDeletedEvents: recurring task survives when only instances (not master) are listed', () => {
  const c = make();
  const tasks = [ c.normalizeTask({ id:'t1', name:'series', eventId:'master1', calendarId:'cal1' }) ];
  const inst = { id:'i1', status:'confirmed', recurringEventId:'master1',
    start:{ dateTime:'2026-07-02T09:00:00Z' }, end:{ dateTime:'2026-07-02T09:15:00Z' } };
  const removed = c.pruneDeletedEvents(tasks, results('cal1', [inst]), ['cal1']);
  assert.equal(removed, 0);
  assert.equal(tasks.length, 1);
});

test('pruneDeletedEvents: cleans dangling deps pointing at removed tasks', () => {
  const c = make();
  const gone = c.normalizeTask({ id:'g1', name:'gone', eventId:'ev1', calendarId:'cal1' });
  const keep = c.normalizeTask({ id:'k1', name:'keep', deps:['g1'] });
  const tasks = [gone, keep];
  const removed = c.pruneDeletedEvents(tasks, results('cal1', []), ['cal1']);
  assert.equal(removed, 1);
  assert.deepEqual([...keep.deps], []); // dependency on removed task cleaned
});
