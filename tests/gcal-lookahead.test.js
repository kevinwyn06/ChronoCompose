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
