const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load.js');

test('rruleToRecur maps Google RRULE to recur model', () => {
  const c = make();
  const daily = c.rruleToRecur(['RRULE:FREQ=DAILY;INTERVAL=2']);
  assert.strictEqual(daily.kind, 'day'); assert.strictEqual(daily.n, 2);
  assert.deepEqual(daily.shifts, []); assert.deepEqual(daily.overrides, {});

  const wd = c.rruleToRecur(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z']);
  assert.strictEqual(wd.kind, 'weekdays');
  assert.deepEqual(wd.days, ['mon','wed']);
  assert.ok(Number.isFinite(wd.until));

  const wk = c.rruleToRecur(['RRULE:FREQ=WEEKLY;INTERVAL=2']);
  assert.strictEqual(wk.kind, 'week'); assert.strictEqual(wk.n, 2);

  assert.strictEqual(c.rruleToRecur(['RRULE:FREQ=MONTHLY']).kind, 'month');
  assert.strictEqual(c.rruleToRecur(['RRULE:FREQ=YEARLY']).kind, 'year');

  assert.strictEqual(c.rruleToRecur([]), null);
  assert.strictEqual(c.rruleToRecur(null), null);
  assert.strictEqual(c.rruleToRecur(['EXDATE:20260101T000000Z']), null);
});

// RETIRED CONTRACT (owner 2026-08-14, "get rid of the calendar tags"): calTag no longer slugifies
// anything for anyone. The slugifier itself did not go away — it is `calTagFor`, which the
// `no-calendar-tags` migration needs in order to RECOGNISE the old tags — so the original assertions are
// re-pointed at it rather than deleted, and calTag gets the one assertion it now owns.
test('calTag returns no tag for any calendar; calTagFor still slugifies for the migration', () => {
  const c = make();
  assert.strictEqual(c.calTag({ summary:'Work Cal' }), '', 'external calendars are no longer tagged either');
  assert.strictEqual(c.calTag({ summary:'ChronoCompose' }), '');
  assert.strictEqual(c.calTag(undefined), '');
  assert.strictEqual(c.calTag({}), '');
  assert.strictEqual(c.calTagFor('Work Cal'), 'work-cal', 'the slug rule survives where the migration reads it');
});

function calFixtures(){
  const results = [{ cid:'cal1', items:[
    { id:'m1_20260701', recurringEventId:'m1', summary:'Standup', start:{dateTime:'2026-07-01T09:00:00Z'}, end:{dateTime:'2026-07-01T09:15:00Z'} },
    { id:'m1_20260702', recurringEventId:'m1', summary:'Standup', start:{dateTime:'2026-07-02T09:00:00Z'}, end:{dateTime:'2026-07-02T09:15:00Z'} },
    { id:'single1', summary:'One off', start:{dateTime:'2026-07-03T10:00:00Z'}, end:{dateTime:'2026-07-03T11:00:00Z'}, description:'//planned-duration: 01:30\n//goal: x' },
    { id:'plain1', summary:'Plain', start:{dateTime:'2026-07-04T10:00:00Z'}, end:{dateTime:'2026-07-04T10:30:00Z'} },
    { id:'cancelled1', status:'cancelled' },
    { id:'nostart', summary:'no start' },
  ]}];
  const masters = { 'cal1|m1':{ id:'m1', summary:'Standup', start:{dateTime:'2026-07-01T09:00:00Z'}, end:{dateTime:'2026-07-01T09:15:00Z'}, recurrence:['RRULE:FREQ=DAILY'] } };
  const calById = { cal1:{ id:'cal1', summary:'Work Cal' } };
  return { results, masters, calById };
}

test('mergeCalendarEvents: recurring collapses to one task with recur + master id', () => {
  const c = make();
  const { results, masters, calById } = calFixtures();
  const tasks = [];
  const r = c.mergeCalendarEvents(tasks, results, masters, calById);
  // 3 tasks: Standup (series), One off, Plain. cancelled + nostart skipped.
  assert.strictEqual(tasks.length, 3, 'series collapses; cancelled/nostart skipped');
  const standup = tasks.find(t=>t.name==='Standup');
  assert.ok(standup);
  assert.strictEqual(standup.eventId, 'm1', 'keyed by master id');
  assert.strictEqual(standup.recur.kind, 'day');
  assert.ok(!standup.labels.includes('work-cal'), 'import stamps no calendar tag (owner 2026-08-14)');
  assert.strictEqual(r.added, 3);
});

test('mergeCalendarEvents: planned = event duration; description markers are ignored', () => {
  const c = make();
  const { results, masters, calById } = calFixtures();
  const tasks = [];
  c.mergeCalendarEvents(tasks, results, masters, calById);
  // 'One off' description contains legacy //planned-duration:/ //goal: text — we no longer parse it.
  const oneoff = tasks.find(t=>t.name==='One off');
  assert.strictEqual(oneoff.planned, 60, 'planned from event duration (10:00-11:00 = 60m), not the marker');
  assert.strictEqual(oneoff.goal, '', 'goal no longer imported from description marker');
  assert.strictEqual(oneoff.type, 'Proportional', 'all imported tasks default to Proportional');
  assert.strictEqual(oneoff.eventId, 'single1');
  const plain = tasks.find(t=>t.name==='Plain');
  assert.strictEqual(plain.type, 'Proportional');
  assert.strictEqual(plain.planned, 30, 'planned = event duration (10:00-10:30 = 30m)');
});

test('mergeCalendarEvents: idempotent re-import (no duplicates)', () => {
  const c = make();
  const { results, masters, calById } = calFixtures();
  const tasks = [];
  c.mergeCalendarEvents(tasks, results, masters, calById);
  const first = tasks.length;
  const r2 = c.mergeCalendarEvents(tasks, results, masters, calById);
  assert.strictEqual(tasks.length, first, 'no new tasks on re-import');
  assert.strictEqual(r2.added, 0);
  assert.ok(r2.updated > 0);
});

test('pruneDeletedEvents: removes deleted, keeps manual and unselected-calendar tasks', () => {
  const c = make();
  const live = c.normalizeTask({ id:'L', name:'live', calendarId:'cal1', eventId:'e_live' });
  const dead = c.normalizeTask({ id:'D', name:'dead', calendarId:'cal1', eventId:'e_dead' });
  const manual = c.normalizeTask({ id:'M', name:'manual' });
  const other = c.normalizeTask({ id:'O', name:'other-cal', calendarId:'cal2', eventId:'e_other' });
  const tasks = [live, dead, manual, other];
  const results = [{ cid:'cal1', items:[ { id:'e_live', start:{dateTime:'2026-07-01T09:00:00Z'} } ] }];
  const removed = c.pruneDeletedEvents(tasks, results, ['cal1'], new Set(['cal1|e_dead']));
  assert.strictEqual(removed, 1);
  const ids = tasks.map(t=>t.id).sort();
  assert.deepEqual(ids, ['L','M','O'], 'dead removed; manual + other-cal kept');
});

test('pruneDeletedEvents: a calendar excluded from selectedIds (404/removed) keeps its tasks', () => {
  // gcalImport drops a calendar that returned 404/410 from the prune's selectedIds so an unreachable
  // calendar never wipes its imported tasks — a failed fetch isn't proof the events were deleted.
  const c = make();
  const kept = c.normalizeTask({ id:'G', name:'from-gone-cal', calendarId:'calGone', eventId:'e_g' });
  const live = c.normalizeTask({ id:'L', name:'live', calendarId:'cal1', eventId:'e_live' });
  const tasks = [kept, live];
  const results = [{ cid:'cal1', items:[ { id:'e_live', start:{dateTime:'2026-07-01T09:00:00Z'} } ] }];
  // 'calGone' is intentionally NOT in selectedIds (it 404'd, so gcalImport excluded it)
  const removed = c.pruneDeletedEvents(tasks, results, ['cal1']);
  assert.strictEqual(removed, 0, 'nothing pruned');
  assert.deepEqual(tasks.map(t=>t.id).sort(), ['G','L'], 'gone-calendar task preserved');
});

// CONTRACT CHANGED (owner 2026-08-14): the @tag strip is gone. There are no calendar tags to strip, and a
// 404 from Google is not evidence about what the user's own labels mean — so unlinking clears the LINK
// and leaves every label alone.
test('gcalDropGone: deselects a removed calendar and unlinks its tasks, keeping every label', () => {
  const c = make();
  c.state.gcal = { connected:true, selected:{ calGone:true, cal1:true }, calendars:[], window:30 };
  const gone = c.normalizeTask({ id:'G', name:'Todoist task', calendarId:'calGone', eventId:'e_g', labels:['todoist','work'] });
  const keep = c.normalizeTask({ id:'K', name:'live', calendarId:'cal1', eventId:'e_k', labels:['work'] });
  c.state.tasks = [gone, keep];
  // calById still carries the (now-removed) calendar's summary from the last successful list
  c.gcalDropGone(['calGone'], { calGone:{ id:'calGone', summary:'Todoist' } });
  assert.ok(!c.state.gcal.selected.calGone, 'removed calendar deselected');
  assert.strictEqual(c.state.gcal.selected.cal1, true, 'other calendar untouched');
  const g = c.state.tasks.find(t=>t.id==='G');
  assert.ok(g, 'task kept, not deleted');
  assert.strictEqual(g.calendarId, null, 'calendarId cleared');
  assert.strictEqual(g.eventId, null, 'eventId cleared');
  assert.deepEqual(g.labels, ['todoist','work'], 'labels are NOT touched — losing the link is not licence to lose the tags');
  const k = c.state.tasks.find(t=>t.id==='K');
  assert.strictEqual(k.calendarId, 'cal1', 'unrelated linked task untouched');
});

// CONTRACT CHANGED (owner 2026-08-14): the "strip the label common to ALL tasks of the gone calendar"
// intersection heuristic is DELETED. It was a sound inference only while import guaranteed a calendar tag
// existed; with no calendar tags, that intersection is just a label the user applied to all of them, and
// deleting it because calendar ACCESS lapsed destroys real data.
test('gcalReconcileLinks: unlinks tasks whose calendar is absent from a fresh list; labels survive intact', () => {
  const c = make();
  c.state.gcal = { connected:true, selected:{}, calendars:[], window:30, ccCalId:'ccCal' };
  // Two tasks from a now-removed "todoist" calendar (tag on both), plus a per-task user label on one.
  const a = c.normalizeTask({ id:'A', name:'a', calendarId:'calTd', eventId:'ea', labels:['todoist','errand'] });
  const b = c.normalizeTask({ id:'B', name:'b', calendarId:'calTd', eventId:'eb', labels:['todoist'] });
  // A task still linked to a live calendar, and a task on our own ChronoCompose calendar — both must survive.
  const live = c.normalizeTask({ id:'L', name:'live', calendarId:'cal1', eventId:'el', labels:['work'] });
  const ours = c.normalizeTask({ id:'O', name:'ours', calendarId:'ccCal', eventId:'eo', labels:[] });
  c.state.tasks = [a, b, live, ours];
  const n = c.gcalReconcileLinks([{ id:'cal1', summary:'Work' }]); // fresh list: no todoist, cal1 present
  assert.strictEqual(n, 2, 'both todoist tasks unlinked');
  const A = c.state.tasks.find(t=>t.id==='A'), B = c.state.tasks.find(t=>t.id==='B');
  assert.strictEqual(A.calendarId, null); assert.strictEqual(A.eventId, null);
  assert.deepEqual(A.labels, ['todoist','errand'], 'the shared label is a USER label now — it stays');
  assert.deepEqual(B.labels, ['todoist'], 'nothing is inferred away from an intersection');
  assert.strictEqual(c.state.tasks.find(t=>t.id==='L').calendarId, 'cal1', 'live-calendar task untouched');
  assert.strictEqual(c.state.tasks.find(t=>t.id==='O').calendarId, 'ccCal', 'ChronoCompose-calendar task untouched');
  assert.strictEqual(c.gcalReconcileLinks([{ id:'cal1', summary:'Work' }]), 0, 'idempotent: nothing left to unlink');
});

test('pruneDeletedEvents: recurring series kept if any instance present, removed if none', () => {
  const c = make();
  const series = c.normalizeTask({ id:'S', name:'series', calendarId:'cal1', eventId:'m1' });
  let tasks = [series];
  let results = [{ cid:'cal1', items:[ { id:'m1_20260701', recurringEventId:'m1', start:{dateTime:'2026-07-01T09:00:00Z'} } ] }];
  assert.strictEqual(c.pruneDeletedEvents(tasks, results, ['cal1']), 0, 'kept when an instance present');
  assert.strictEqual(tasks.length, 1);
  results = [{ cid:'cal1', items:[] }];
  assert.strictEqual(c.pruneDeletedEvents(tasks, results, ['cal1'], new Set(['cal1|m1'])), 1, 'removed when direct verification says the series is gone');
  assert.strictEqual(tasks.length, 0);
});

test('pruneDeletedEvents: cleans dangling deps on survivors', () => {
  const c = make();
  const dead = c.normalizeTask({ id:'D', name:'dead', calendarId:'cal1', eventId:'e_dead' });
  const keep = c.normalizeTask({ id:'K', name:'keep', calendarId:'cal1', eventId:'e_live', deps:['D', { id:'other', occ:0 }] });
  const tasks = [dead, keep];
  const results = [{ cid:'cal1', items:[ { id:'e_live', start:{dateTime:'2026-07-01T09:00:00Z'} } ] }];
  c.pruneDeletedEvents(tasks, results, ['cal1'], new Set(['cal1|e_dead']));
  const k = tasks.find(t=>t.id==='K');
  assert.ok(!k.deps.some(d=>c.depId(d)==='D'), 'dep on removed task cleaned');
  assert.ok(k.deps.some(d=>c.depId(d)==='other'), 'unrelated dep kept');
});
