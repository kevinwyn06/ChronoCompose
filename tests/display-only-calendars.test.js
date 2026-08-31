/* PP-EXT (owner 2026-08-31): the display-only calendar tier.

   Owner ask: birthdays should live only on the Birthdays calendar, honour the per-calendar short-term
   window, and NOT require a per-task toggle. Measured on the owner's account the same day: 17 of 19
   birthday events on the primary calendar are duplicated on the contacts Birthdays calendar, and Google
   already tags the primary copies `eventType:"birthday"` while the Birthdays calendar's own copies come
   back as plain `default`/`opaque`. Both halves of that asymmetry are pinned below — the event-level
   classifier catches the first, the calendar-level default catches the second. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const BIRTHDAYS = 'addressbook#contacts@group.v.calendar.google.com';

function comp(){
  const c = make();
  c.state.gcal = Object.assign({}, c.state.gcal, {
    calendars: [{ id:'cal-p', summary:'Personal' }, { id:BIRTHDAYS, summary:'Birthdays' }],
    selected: { 'cal-p':1, [BIRTHDAYS]:1 },
    tier: {},
  });
  c.saveCalEvents([]);
  return c;
}

/* ---- the calendar tier ---------------------------------------------------- */

test('an unconfigured calendar is auto', () => {
  assert.equal(comp().calTier('cal-p'), 'auto');
});

test('the contacts Birthdays calendar defaults to display-only without configuration', () => {
  /* Its events report eventType `default` and transparency `opaque` (measured), so the event-level
     classifier alone would import all twelve of them as tasks. */
  assert.equal(comp().calTier(BIRTHDAYS), 'display');
});

test('an explicit tier overrides the built-in default in both directions', () => {
  const c = comp();
  c.setCalTier(BIRTHDAYS, 'tasks');
  assert.equal(c.calTier(BIRTHDAYS), 'tasks');
  c.setCalTier('cal-p', 'display');
  assert.equal(c.calTier('cal-p'), 'display');
});

test('a junk stored tier degrades to auto rather than throwing', () => {
  const c = comp();
  c.state.gcal.tier = { 'cal-p': 'nonsense' };
  assert.equal(c.calTier('cal-p'), 'auto');
});

/* `saveGcal` persists a WHITELIST, so `tier` had to be added in BOTH directions — the same trap
   `lookahead` fell into on 2026-08-25. Without this the dropdown works for one session and forgets. */
test('the tier survives a save/load round trip', () => {
  const c = comp();
  c.setCalTier('cal-p', 'display');
  assert.deepEqual(c.loadGcal().tier, { 'cal-p':'display' });
});

/* ---- the event classifier ------------------------------------------------- */

test('eventType birthday is display-only on an auto calendar', () => {
  const c = comp();
  assert.equal(c.gcalEventIsDisplay({ id:'e', eventType:'birthday' }, 'auto'), true);
});

test('workingLocation and outOfOffice are display-only', () => {
  const c = comp();
  assert.equal(c.gcalEventIsDisplay({ id:'e', eventType:'workingLocation' }, 'auto'), true);
  assert.equal(c.gcalEventIsDisplay({ id:'e', eventType:'outOfOffice' }, 'auto'), true);
});

test('a Free event is display-only — busy/free is the user’s own answer to "does this cost me time"', () => {
  assert.equal(comp().gcalEventIsDisplay({ id:'e', transparency:'transparent' }, 'auto'), true);
});

test('a Busy default event stays a task', () => {
  assert.equal(comp().gcalEventIsDisplay({ id:'e' }, 'auto'), false);
});

/* Owner call 2026-08-31: a Gmail-derived appointment (the measured case was a dentist booking) is real
   work you have to be somewhere for, even though Google marks such events Free. */
test('fromGmail is exempt from the transparency rule', () => {
  assert.equal(comp().gcalEventIsDisplay({ id:'e', eventType:'fromGmail', transparency:'transparent' }, 'auto'), false);
});

test('an explicit tier short-circuits the event signals entirely', () => {
  const c = comp();
  assert.equal(c.gcalEventIsDisplay({ id:'e', eventType:'birthday' }, 'tasks'), false);
  assert.equal(c.gcalEventIsDisplay({ id:'e' }, 'display'), true);
});

/* eventType is checked before transparency, so a birthday someone marked Busy is still a birthday. */
test('an explicitly Busy birthday is still display-only', () => {
  assert.equal(comp().gcalEventIsDisplay({ id:'e', eventType:'birthday', transparency:'opaque' }, 'auto'), true);
});

/* ---- the display-event store ---------------------------------------------- */

test('an all-day event becomes a whole-day record with Google’s exclusive end honoured', () => {
  const c = comp();
  const rec = c.calEventFrom('cal-p', { id:'e1', summary:"Jordan Lee's birthday",
    start:{ date:'2026-09-18' }, end:{ date:'2026-09-19' } });
  assert.equal(rec.name, "Jordan Lee's birthday");
  assert.equal(rec.allDay, true);
  assert.equal(rec.end - rec.start, c.DAY);
});

test('a cancelled or undated event produces no record', () => {
  const c = comp();
  assert.equal(c.calEventFrom('cal-p', { id:'e', status:'cancelled' }), null);
  assert.equal(c.calEventFrom('cal-p', { id:'e', start:{} }), null);
});

/* An import of one calendar must never clear another's stored events — the same reasoning that keeps
   pruneDeletedEvents off calendars it did not reach. */
test('merging replaces only the calendars this import touched', () => {
  const c = comp();
  const existing = [ { cid:'cal-p', eid:'old' }, { cid:'cal-x', eid:'keep' } ];
  const out = c.mergeCalEvents(existing, [ { cid:'cal-p', eid:'new' } ], ['cal-p']);
  assert.deepEqual(out.map(e => e.eid), ['keep','new']);
});

test('the store round-trips through localStorage', () => {
  const c = comp();
  c.saveCalEvents([{ cid:'cal-p', eid:'e1', name:'B', start:1, end:2, allDay:true }]);
  assert.equal(c.loadCalEvents().length, 1);
  assert.equal(c.loadCalEvents()[0].name, 'B');
});

test('a corrupt store reads as empty rather than throwing', () => {
  const c = comp();
  c.lsSet('pp-calevents', '{not json');
  /* .length, not deepEqual: the component runs in a VM sandbox, so its [] is a different realm's Array. */
  assert.equal(c.loadCalEvents().length, 0);
});

/* ---- pseudo-tasks --------------------------------------------------------- */

test('display events project to read-only pseudo-tasks that are flagged and namespaced', () => {
  const c = comp();
  c.saveCalEvents([{ cid:'cal-p', eid:'e1', name:'Birthday', start:1000, end:1000+c.DAY, allDay:true }]);
  const [t] = c.calEventTasks();
  assert.equal(t.displayOnly, true);
  assert.equal(c.isDisplayEvent(t), true);
  assert.ok(t.id.startsWith(c.CAL_EVENT_ID_PREFIX));
  /* Never blocking: a birthday must not carve a busy interval out of the day. */
  assert.equal(t.blocking, false);
});

test('a display event never enters the task store', () => {
  const c = comp();
  c.saveCalEvents([{ cid:'cal-p', eid:'e1', name:'Birthday', start:1000, end:1000+c.DAY, allDay:true }]);
  c.calEventTasks();
  assert.equal(c.state.tasks.some(t => t.displayOnly), false);
});

test('calEventsOnDay returns the events overlapping that day only', () => {
  const c = comp();
  const B = c.startOfToday();
  c.saveCalEvents([
    { cid:'cal-p', eid:'today',    name:'today',    start:B,           end:B+c.DAY,   allDay:true },
    { cid:'cal-p', eid:'tomorrow', name:'tomorrow', start:B+c.DAY,     end:B+2*c.DAY, allDay:true },
  ]);
  assert.deepEqual(c.calEventsOnDay(B).map(t => t.name), ['today']);
});

/* ---- converting an existing workspace ------------------------------------- */

/* This is what makes the feature retroactive with no one-time migration: the next import reclassifies
   and the stale task rows leave by themselves. It runs in both directions — flip a calendar back to
   Tasks and the rows come back as ordinary imports. */
test('a task row whose event is now display-only is removed', () => {
  const c = comp();
  const tasks = [
    c.normalizeTask({ id:'bd',    name:"Riley's birthday", calendarId:'cal-p', eventId:'e1', start:1, end:2 }),
    c.normalizeTask({ id:'work',  name:'Standup',         calendarId:'cal-p', eventId:'e2', start:1, end:2 }),
    c.normalizeTask({ id:'local', name:'Local only',                                        start:1, end:2 }),
  ];
  const keys = new Set([ c.gcalKey('cal-p','e1') ]);
  assert.equal(c.pruneDisplayTasks(tasks, keys), 1);
  assert.deepEqual(tasks.map(t => t.id), ['work','local']);
});

test('a task with no calendar link is never removed by the display prune', () => {
  const c = comp();
  const tasks = [ c.normalizeTask({ id:'local', name:'Local', start:1, end:2 }) ];
  assert.equal(c.pruneDisplayTasks(tasks, new Set(['cal-p|e1'])), 0);
  assert.equal(tasks.length, 1);
});

test('an archived row is left alone, exactly as pruneDeletedEvents leaves it', () => {
  const c = comp();
  const tasks = [ c.normalizeTask({ id:'bd', name:'B', calendarId:'cal-p', eventId:'e1', start:1, end:2, archivedAt:5 }) ];
  assert.equal(c.pruneDisplayTasks(tasks, new Set([c.gcalKey('cal-p','e1')])), 0);
});

/* A merge preserves the graph. Dropping a dependency edge would silently unblock a successor — the same
   rule collapseEventDuplicates holds, except that there is no survivor to re-point at here. */
test('dependencies on a removed row are dropped, not left dangling', () => {
  const c = comp();
  const tasks = [
    c.normalizeTask({ id:'bd',   name:'B', calendarId:'cal-p', eventId:'e1', start:1, end:2 }),
    c.normalizeTask({ id:'next', name:'N', deps:['bd'], start:1, end:2 }),
  ];
  c.pruneDisplayTasks(tasks, new Set([c.gcalKey('cal-p','e1')]));
  assert.deepEqual(tasks.find(t => t.id === 'next').deps, []);
});

/* The event is fine and is not being deleted. A tombstone here would additionally queue a real remote
   DELETE through gcalEnqueue — which is exactly what must never happen to the owner's Google data. */
test('the display prune writes no tombstone', () => {
  const c = comp();
  const tasks = [ c.normalizeTask({ id:'bd', name:'B', calendarId:'cal-p', eventId:'e1', start:1, end:2 }) ];
  const before = JSON.stringify(c.loadTombstones());
  c.pruneDisplayTasks(tasks, new Set([c.gcalKey('cal-p','e1')]));
  assert.equal(JSON.stringify(c.loadTombstones()), before);
});

/* ---- the duplication this exists to end ----------------------------------- */

test("the owner's duplicate-birthday case collapses to one entry", () => {
  /* Two genuinely distinct Google events for one person: the contacts Birthdays copy and a hand-made
     yearly event on the primary calendar. They share no event id, so no merge could ever match them. */
  const c = comp();
  const primary = { id:'bi9mqngl0rv5gan9qud9j23ld0', summary:"Morgan Diaz's birthday",
    eventType:'birthday', transparency:'transparent', start:{ date:'2026-10-22' }, end:{ date:'2026-10-23' } };
  const contacts = { id:'2026_BIRTHDAY_347f650f88416e0c', summary:"Morgan Diaz's birthday",
    start:{ date:'2026-10-22' }, end:{ date:'2026-10-23' } };
  assert.equal(c.gcalEventIsDisplay(primary, c.calTier('cal-p')), true, 'primary copy demoted by eventType');
  assert.equal(c.gcalEventIsDisplay(contacts, c.calTier(BIRTHDAYS)), true, 'contacts copy demoted by calendar tier');
  /* Neither becomes a task, so the pair can no longer produce two rows in the planner. */
});
