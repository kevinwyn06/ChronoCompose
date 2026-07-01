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

test('calTag slugifies calendar summary', () => {
  const c = make();
  assert.strictEqual(c.calTag({ summary:'Work Cal' }), 'work-cal');
  assert.strictEqual(c.calTag(undefined), 'cal');
  assert.strictEqual(c.calTag({}), 'cal');
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
  assert.ok(standup.labels.includes('work-cal'));
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
  const removed = c.pruneDeletedEvents(tasks, results, ['cal1']);
  assert.strictEqual(removed, 1);
  const ids = tasks.map(t=>t.id).sort();
  assert.deepEqual(ids, ['L','M','O'], 'dead removed; manual + other-cal kept');
});

test('pruneDeletedEvents: recurring series kept if any instance present, removed if none', () => {
  const c = make();
  const series = c.normalizeTask({ id:'S', name:'series', calendarId:'cal1', eventId:'m1' });
  let tasks = [series];
  let results = [{ cid:'cal1', items:[ { id:'m1_20260701', recurringEventId:'m1', start:{dateTime:'2026-07-01T09:00:00Z'} } ] }];
  assert.strictEqual(c.pruneDeletedEvents(tasks, results, ['cal1']), 0, 'kept when an instance present');
  assert.strictEqual(tasks.length, 1);
  results = [{ cid:'cal1', items:[] }];
  assert.strictEqual(c.pruneDeletedEvents(tasks, results, ['cal1']), 1, 'removed when no instances');
  assert.strictEqual(tasks.length, 0);
});

test('pruneDeletedEvents: cleans dangling deps on survivors', () => {
  const c = make();
  const dead = c.normalizeTask({ id:'D', name:'dead', calendarId:'cal1', eventId:'e_dead' });
  const keep = c.normalizeTask({ id:'K', name:'keep', calendarId:'cal1', eventId:'e_live', deps:['D', { id:'other', occ:0 }] });
  const tasks = [dead, keep];
  const results = [{ cid:'cal1', items:[ { id:'e_live', start:{dateTime:'2026-07-01T09:00:00Z'} } ] }];
  c.pruneDeletedEvents(tasks, results, ['cal1']);
  const k = tasks.find(t=>t.id==='K');
  assert.ok(!k.deps.some(d=>c.depId(d)==='D'), 'dep on removed task cleaned');
  assert.ok(k.deps.some(d=>c.depId(d)==='other'), 'unrelated dep kept');
});
