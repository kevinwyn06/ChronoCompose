const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const DAY = 86400000;
function comp(){
  const c = make();
  c.state.gcal = Object.assign({}, c.state.gcal, {
    calendars: [{ id:'cal-b', summary:'Birthdays' }, { id:'cal-w', summary:'Work' }],
    selected: { 'cal-b':1, 'cal-w':1 },
    lookahead: { 'cal-b': { shortTerm:true, len:'1m' } },
  });
  return c;
}

test('an unconfigured calendar is unlimited', () => {
  assert.equal(comp().calLookaheadDays('cal-w'), null);
});

test('a short-term calendar resolves its own length', () => {
  assert.equal(comp().calLookaheadDays('cal-b'), 30);
});

test('the "all" length means unlimited even when short-term is on', () => {
  const c = comp();
  c.state.gcal.lookahead['cal-b'] = { shortTerm:true, len:'all' };
  assert.equal(c.calLookaheadDays('cal-b'), null);
});

test('short-term off ignores a configured length', () => {
  const c = comp();
  c.state.gcal.lookahead['cal-b'] = { shortTerm:false, len:'1m' };
  assert.equal(c.calLookaheadDays('cal-b'), null);
});

test('pruning removes only that calendar’s out-of-window imports', () => {
  const c = comp();
  const B = c.startOfToday(), far = B + 30*DAY;
  const tasks = [
    c.normalizeTask({ id:'in',    name:'in',    calendarId:'cal-b', eventId:'e1', start:B+5*DAY,   end:B+5*DAY }),
    c.normalizeTask({ id:'out',   name:'out',   calendarId:'cal-b', eventId:'e2', start:B+200*DAY, end:B+200*DAY }),
    c.normalizeTask({ id:'other', name:'other', calendarId:'cal-w', eventId:'e3', start:B+200*DAY, end:B+200*DAY }),
    c.normalizeTask({ id:'local', name:'local', start:B+200*DAY, end:B+200*DAY }),
  ];
  assert.equal(c.pruneOutOfWindow(tasks, 'cal-b', far), 1);
  assert.deepEqual(tasks.map(t => t.id), ['in','other','local']);
});

test('pruning writes no tombstone, so the event returns when it comes into range', () => {
  const c = comp();
  const B = c.startOfToday();
  const tasks = [ c.normalizeTask({ id:'out', name:'out', calendarId:'cal-b', eventId:'e2', start:B+200*DAY, end:B+200*DAY }) ];
  const before = JSON.stringify(c.loadTombstones());
  c.pruneOutOfWindow(tasks, 'cal-b', B + 30*DAY);
  assert.equal(JSON.stringify(c.loadTombstones()), before);
});

/* PP-EXT (owner 2026-08-25): `saveGcal` persists a WHITELIST of fields rather than the whole object, so
   the new key had to be added there and in `loadGcal`'s default shape. Without this the toggle would work
   for one session and silently forget itself on reload. */
test('the per-calendar lookahead round-trips through the gcal store', () => {
  const c = comp();
  c.setCalLookahead('cal-w', { shortTerm:true, len:'3m' });
  assert.equal(c.calLookaheadDays('cal-w'), 91);
  const stored = JSON.parse(c.lsGet('pp-gcal') || '{}');
  assert.equal(stored.lookahead['cal-w'].shortTerm, true);
  assert.equal(stored.lookahead['cal-w'].len, '3m');
});

/* PP-EXT (owner 2026-08-31): a recurring import stores the MASTER's start — the birth year for a yearly
   birthday — so the old `t.start > farMs` test could never be true and every recurring event on a
   short-term calendar was permanently immune to the window. The window asks whether the series reaches
   into it, which is a question about occurrences, not about the anchor. */

/* Anchor a yearly series exactly `years` before the day `offsetDays` from today, so its next occurrence
   lands on a known day rather than wherever 18 arithmetic years of drift happens to put it. */
function yearlyAnchoredAt(c, offsetDays, years){
  const d = new Date(c.startOfToday());
  d.setDate(d.getDate() + offsetDays);
  d.setFullYear(d.getFullYear() - years);
  return d.getTime();
}

test('a recurring series with an occurrence inside the window is kept', () => {
  const c = comp();
  const far = c.startOfToday() + 30*DAY;
  const anchor = yearlyAnchoredAt(c, 10, 18); /* next occurrence: 10 days out */
  const tasks = [ c.normalizeTask({ id:'bd', name:"Riley's birthday", calendarId:'cal-b', eventId:'e1',
    start:anchor, end:anchor + DAY, recur:{ kind:'year', n:1 } }) ];
  assert.equal(c.pruneOutOfWindow(tasks, 'cal-b', far), 0);
  assert.equal(tasks.length, 1, 'an occurrence falls inside the window, so the series stays');
});

test('a recurring series whose next occurrence is beyond the window is pruned', () => {
  const c = comp();
  const far = c.startOfToday() + 7*DAY; /* a one-week window */
  const anchor = yearlyAnchoredAt(c, 180, 18); /* next occurrence: ~6 months out */
  const tasks = [ c.normalizeTask({ id:'bd', name:"Riley's birthday", calendarId:'cal-b', eventId:'e1',
    start:anchor, end:anchor + DAY, recur:{ kind:'year', n:1 } }) ];
  assert.equal(c.pruneOutOfWindow(tasks, 'cal-b', far), 1);
  assert.equal(tasks.length, 0, 'no occurrence reaches the week, so it leaves');
});

test('the anchor itself is never what decides a recurring series', () => {
  /* The regression guard: the old code compared `t.start` (the master anchor) against farMs directly,
     so a decade-old anchor with a weekly repeat was pruned by nothing and kept by accident. */
  const c = comp();
  const B = c.startOfToday(), far = B + 30*DAY;
  const tasks = [ c.normalizeTask({ id:'wk', name:'Weekly', calendarId:'cal-b', eventId:'e1',
    start:B - 3640*DAY, end:B - 3640*DAY + 3600000, recur:{ kind:'week', n:1 } }) ];
  assert.equal(c.pruneOutOfWindow(tasks, 'cal-b', far), 0);
});
