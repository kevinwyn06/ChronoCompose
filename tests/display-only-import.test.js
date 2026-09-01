/* PP-EXT (owner 2026-08-31): the display-only tier driven through the REAL `gcalImport`, not through its
   pieces. The first round of tests for this feature covered the classifier, the store and the prune in
   isolation and all passed while the feature did not visibly work — so these drive the whole pull with a
   stubbed `gcalFetch` and assert on what the user actually ends up with.

   Event JSON below mirrors the shapes measured live on the owner's account 2026-08-31:
     · a primary-calendar birthday  — eventType "birthday", transparency "transparent", RECURRING
     · a contacts-calendar birthday — eventType absent, transparency absent (i.e. Busy), non-recurring
     · a real meeting               — eventType absent, Busy, timed
   The asymmetry between the first two is the whole reason the classifier has two levels. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

const PRIMARY = 'owner@example.com';
const BIRTHDAYS = 'addressbook#contacts@group.v.calendar.google.com';
const DAY = 86400000;

function ymd(ms){ const d=new Date(ms); const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }

/* A yearly birthday on the PRIMARY calendar, as Google returns its expanded instance. */
function primaryBirthday(c, name, dayMs, masterId){
  return { id:'inst_'+masterId, recurringEventId:masterId, summary:name,
    eventType:'birthday', transparency:'transparent',
    start:{ date:ymd(dayMs) }, end:{ date:ymd(dayMs+DAY) } };
}
/* Its master, fetched by gcalImport for the RRULE. */
function primaryBirthdayMaster(name, masterId){
  return { id:masterId, summary:name, eventType:'birthday', transparency:'transparent',
    recurrence:['RRULE:FREQ=YEARLY'], start:{ date:'2007-06-30' }, end:{ date:'2007-07-01' } };
}
/* The contacts Birthdays calendar serves each year as its OWN non-recurring event, and — measured —
   reports neither eventType nor transparency. */
function contactsBirthday(name, dayMs, id){
  return { id, summary:name, start:{ date:ymd(dayMs) }, end:{ date:ymd(dayMs+DAY) } };
}
function meeting(id, name, startMs, endMs){
  return { id, summary:name, start:{ dateTime:new Date(startMs).toISOString() },
    end:{ dateTime:new Date(endMs).toISOString() } };
}

/* Wire a component to a fixed set of events per calendar and run one import to completion. */
/* `unbounded` = what the display pass (`singleEvents=false`, no timeMax) returns per calendar, i.e. the
   series MASTERS. Omit it and both passes see the same list, which is what every test written before the
   pass existed assumes. */
function harness(byCal, masters, unbounded){
  const c = make();
  Object.assign(c.state.gcal, {
    selected:{ [PRIMARY]:true, [BIRTHDAYS]:true },
    calendars:[{id:PRIMARY,summary:'Personal'},{id:BIRTHDAYS,summary:'Birthdays'}],
    window:365, lookahead:{}, tier:{},
  });
  c._token = 'token';
  c.saveCalEvents([]);
  const fetched = { window:[], display:[] }; c._fetched = fetched;
  c.gcalFetch = (url) => {
    /* an events.list call */
    const m = /calendars\/([^/]+)\/events\?/.exec(url);
    if(m){ const cid = decodeURIComponent(m[1]);
      const isDisplayPass = /singleEvents=false/.test(url);
      if(isDisplayPass) fetched.display.push(cid); else fetched.window.push(cid);
      const src = (isDisplayPass && unbounded) ? unbounded[cid] : byCal[cid];
      return Promise.resolve({ items: src || [] }); }
    /* a by-id lookup: either a recurring master or gcalVerifyMissing probing a linked event */
    const g = /calendars\/([^/]+)\/events\/([^?]+)/.exec(url);
    if(g){ const id = decodeURIComponent(g[2]);
      if(masters && masters[id]) return Promise.resolve(masters[id]);
      return Promise.reject(Object.assign(new Error('404'), { status:404 })); }
    return Promise.resolve({});
  };
  return c;
}
async function settle(){ for(let i=0;i<8;i++) await new Promise(r=>setImmediate(r)); }

const B = () => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };

/* ---- the whole pull ------------------------------------------------------- */

test('an import files birthdays as display events and the meeting as a task', async () => {
  const day = B() + 10*DAY;
  const c = harness({
    [PRIMARY]: [ primaryBirthday(null, "Morgan Diaz's birthday", day, 'mstr1'),
                 meeting('mtg1', 'Standup', day+3600000, day+5400000) ],
    [BIRTHDAYS]: [ contactsBirthday("Morgan Diaz's birthday", day, '2026_BIRTHDAY_aaa') ],
  }, { mstr1: primaryBirthdayMaster("Morgan Diaz's birthday", 'mstr1') });

  c.gcalImport({});
  await settle();

  /* Array.from: the component runs in a VM sandbox, so its arrays are a different realm's Array and
     deepEqual compares prototypes. Every list assertion in this file copies into a host array first. */
  assert.deepEqual(Array.from(c.state.tasks, t=>t.name), ['Standup'], 'only the meeting became a task');
  assert.deepEqual(Array.from(c.loadCalEvents(), e=>e.name).sort(),
    ["Morgan Diaz's birthday","Morgan Diaz's birthday"],
    'both Google copies are stored as display events');
});

/* THE owner-visible symptom: one person, two calendars, previously two task rows. */
test('the duplicate pair produces zero task rows', async () => {
  const day = B() + 10*DAY;
  const c = harness({
    [PRIMARY]: [ primaryBirthday(null, "Morgan Diaz's birthday", day, 'mstr1') ],
    [BIRTHDAYS]: [ contactsBirthday("Morgan Diaz's birthday", day, '2026_BIRTHDAY_aaa') ],
  }, { mstr1: primaryBirthdayMaster("Morgan Diaz's birthday", 'mstr1') });

  c.gcalImport({});
  await settle();
  assert.equal(c.state.tasks.length, 0);
});

/* The retroactive half: a workspace that already imported the birthday as a task. */
test('an already-imported birthday task is removed by the next import', async () => {
  const day = B() + 10*DAY;
  const c = harness({
    [PRIMARY]: [ primaryBirthday(null, "Riley's birthday", day, 'mstr2') ],
    [BIRTHDAYS]: [],
  }, { mstr2: primaryBirthdayMaster("Riley's birthday", 'mstr2') });
  /* linked on the MASTER id, which is what a recurring import stores */
  c.state.tasks = [ c.normalizeTask({ id:'old', name:"Riley's birthday",
    calendarId:PRIMARY, eventId:'mstr2', start:day, end:day+DAY, allDay:true }) ];

  c.gcalImport({});
  await settle();

  assert.equal(c.state.tasks.length, 0, 'the stale task row is gone');
  assert.equal(c.loadCalEvents().length, 1, 'and it is now a display event');
});

/* ...and it must not have gone out to Google. A tombstone is what gcalEnqueue writes alongside a real
   remote DELETE, so its absence is the evidence that the owner's calendar was not touched. */
test('converting a task to a display event queues nothing and tombstones nothing', async () => {
  const day = B() + 10*DAY;
  const c = harness({
    [PRIMARY]: [ primaryBirthday(null, "Riley's birthday", day, 'mstr2') ],
    [BIRTHDAYS]: [],
  }, { mstr2: primaryBirthdayMaster("Riley's birthday", 'mstr2') });
  c.state.tasks = [ c.normalizeTask({ id:'old', name:"Riley's birthday",
    calendarId:PRIMARY, eventId:'mstr2', start:day, end:day+DAY, allDay:true }) ];

  c.gcalImport({});
  await settle();

  assert.deepEqual(Array.from(Object.keys(c.loadTombstones())), [], 'no tombstone');
  assert.equal(c.loadQueue().filter(op=>op.op==='delete').length, 0, 'no queued DELETE');
});

/* The reverse direction — the escape hatch has to actually work. */
test('setting a calendar to Tasks brings its events back as tasks', async () => {
  const day = B() + 10*DAY;
  const mk = () => harness({
    [PRIMARY]: [],
    [BIRTHDAYS]: [ contactsBirthday("Casey Park's birthday", day, '2026_BIRTHDAY_bbb') ],
  }, {});

  const c = mk();
  c.gcalImport({}); await settle();
  assert.equal(c.state.tasks.length, 0, 'display by default');
  assert.equal(c.loadCalEvents().length, 1);

  c.setCalTier(BIRTHDAYS, 'tasks');
  c.gcalImport({}); await settle();
  assert.deepEqual(Array.from(c.state.tasks, t=>t.name), ["Casey Park's birthday"], 'now a task');
  assert.equal(c.loadCalEvents().length, 0, 'and no longer a display event');
});

/* An explicit `display` tier on a work calendar must demote Busy events too. */
test('an explicit display tier demotes ordinary busy events', async () => {
  const day = B() + 2*DAY;
  const c = harness({ [PRIMARY]: [ meeting('mtg1','Standup', day+3600000, day+5400000) ], [BIRTHDAYS]: [] }, {});
  c.setCalTier(PRIMARY, 'display');
  c.gcalImport({}); await settle();
  assert.equal(c.state.tasks.length, 0);
  assert.deepEqual(Array.from(c.loadCalEvents(), e=>e.name), ['Standup']);
});

/* One calendar's import must never clear another's stored display events. */
test('an import of one calendar leaves the other calendar’s display events intact', async () => {
  const day = B() + 10*DAY;
  const c = harness({
    [PRIMARY]: [ primaryBirthday(null, "Riley's birthday", day, 'mstr2') ],
    [BIRTHDAYS]: [ contactsBirthday("Casey Park's birthday", day, '2026_BIRTHDAY_bbb') ],
  }, { mstr2: primaryBirthdayMaster("Riley's birthday", 'mstr2') });

  c.gcalImport({}); await settle();
  assert.equal(c.loadCalEvents().length, 2);

  /* Now deselect Birthdays and re-import: only PRIMARY is refreshed, and Birthdays' stored events
     are dropped because that calendar is no longer selected — but PRIMARY's must survive. */
  c.state.gcal.selected = { [PRIMARY]: true };
  c.gcalImport({}); await settle();
  assert.deepEqual(Array.from(c.loadCalEvents(), e=>e.cid), [PRIMARY]);
});

/* ---- the render projection, which is where the first round actually broke ---- */

/* `_calTasks` is rebuilt behind a cache whose keys are all task-state identities. A display event lives
   OUTSIDE `state.tasks`, so an import that changes no task changes none of those keys — and the events
   stayed invisible. This is the regression guard for that. */
test('display events reach the calendar projection even when no task changed', async () => {
  const day = B() + 10*DAY;
  const c = harness({ [PRIMARY]: [], [BIRTHDAYS]: [ contactsBirthday('Party', day, 'ev-party') ] }, {});

  /* Prime the view cache the way a first render would, with no display events stored yet. */
  c.renderVals();
  const before = (c._calTasks||[]).length;

  c.gcalImport({}); await settle();
  c.renderVals();

  assert.equal(c.state.tasks.length, 0, 'no task changed — the cache keys are all identical');
  assert.equal(c._calTasks.length, before + 1, 'and the projection still picked the event up');
  assert.ok(c._calTasks.some(t=>t.displayOnly && t.name==='Party'));
});

test('the pseudo-task array identity is stable while the store is unchanged', () => {
  const c = make();
  c.saveCalEvents([{ cid:'c', eid:'e', name:'X', start:1, end:2, allDay:true }]);
  assert.equal(c.calEventTasks(), c.calEventTasks(), 'memoized, so the cache key above is meaningful');
});

test('the pseudo-task array identity changes when the store changes', () => {
  const c = make();
  c.saveCalEvents([{ cid:'c', eid:'e', name:'X', start:1, end:2, allDay:true }]);
  const a = c.calEventTasks();
  c.saveCalEvents([{ cid:'c', eid:'e2', name:'Y', start:1, end:2, allDay:true }]);
  assert.notEqual(c.calEventTasks(), a);
});

/* A repaint is the other half: nothing else in the render path can notice a pp-calevents write. */
test('a display-event write repaints, and an identical rewrite does not', () => {
  const c = make();
  let paints = 0; c.forceUpdate = () => { paints++; };
  c.saveCalEvents([{ cid:'c', eid:'e', name:'X', start:1, end:2, allDay:true }]);
  assert.equal(paints, 1, 'a change repaints');
  c.saveCalEvents([{ cid:'c', eid:'e', name:'X', start:1, end:2, allDay:true }]);
  assert.equal(paints, 1, 'an idle poll re-storing identical events does not');
});

/* ---- reclassification is not limited to the import window ------------------- */

/* PP-EXT (owner 2026-08-31): owner report — with a 30-day window every birthday became display-only
   EXCEPT "Alex Rivera's birthday", whose occurrence had just passed. A yearly series whose next
   occurrence is 11 months out appears in NO events.list until then, so `displayKeys` (built only from
   fetched events) could never contain it and the row stayed a task. The by-id probe that already runs
   for exactly these rows now classifies them. */
test('a linked row whose event is outside the window is still reclassified', async () => {
  const c = harness({ [PRIMARY]: [], [BIRTHDAYS]: [] },
    { mstr9: primaryBirthdayMaster("Alex Rivera's birthday", 'mstr9') });
  const lastYear = B() - 9*DAY;
  c.state.tasks = [ c.normalizeTask({ id:'alex', name:"Alex Rivera's birthday",
    calendarId:PRIMARY, eventId:'mstr9', start:lastYear, end:lastYear+DAY, allDay:true,
    recur:{kind:'year', n:1} }) ];

  c.gcalImport({}); await settle();

  assert.equal(c.state.tasks.length, 0, 'the row is gone even though no events.list returned it');
  /* …and it is still a birthday. Owner: "her birthday should still be treated as a birthday." Demoting a
     task must not delete the fact — the probe fetched the whole master, so it is stored WITH its yearly
     rule and renders on its own dates, window or no window. */
  const [rec] = Array.from(c.loadCalEvents());
  assert.equal(rec.name, "Alex Rivera's birthday");
  assert.equal(rec.recur && rec.recur.kind, 'year', 'stored as a yearly series, not a single date');
  assert.equal(rec.eid, 'mstr9', 'anchored on the master, so one record covers every year');
  assert.deepEqual(Array.from(Object.keys(c.loadTombstones())), [], 'still a local splice, not a delete');
  assert.equal(c.loadQueue().filter(op=>op.op==='delete').length, 0);
});

/* The control: the same out-of-window probe must NOT prune an ordinary event. Only a 404/410/cancelled
   may do that, and only the classifier may demote — an out-of-window meeting is neither. */
test('an out-of-window row whose event is an ordinary meeting survives', async () => {
  const c = harness({ [PRIMARY]: [], [BIRTHDAYS]: [] },
    { mtgX: meeting('mtgX', 'Quarterly review', B()+300*DAY, B()+300*DAY+3600000) });
  c.state.tasks = [ c.normalizeTask({ id:'q', name:'Quarterly review',
    calendarId:PRIMARY, eventId:'mtgX', start:B()+300*DAY, end:B()+300*DAY+3600000 }) ];

  c.gcalImport({}); await settle();
  assert.deepEqual(Array.from(c.state.tasks, t=>t.name), ['Quarterly review']);
});

/* PP-EXT (owner 2026-08-31): "her birthday should still be treated as a birthday." A yearly series is a
   standing fact, not a row that is true for the thirty days the import window happens to cover, so the
   stored record carries the master's rule and the projection expands it on demand. */
test('a recurring display event renders on a future occurrence, far outside the window', async () => {
  const c = harness({ [PRIMARY]: [], [BIRTHDAYS]: [] },
    { mstr9: primaryBirthdayMaster("Alex Rivera's birthday", 'mstr9') });
  const past = B() - 9*DAY;
  c.state.tasks = [ c.normalizeTask({ id:'alex', name:"Alex Rivera's birthday",
    calendarId:PRIMARY, eventId:'mstr9', start:past, end:past+DAY, allDay:true,
    recur:{kind:'year', n:1} }) ];
  c.gcalImport({}); await settle();

  /* The master is anchored at 2007-06-30 (see primaryBirthdayMaster), so the next 30 June is the day to
     look at — comfortably outside any import window, and the exact case that used to render nothing. */
  const now = new Date(); const y = (now.getMonth() > 5) ? now.getFullYear()+1 : now.getFullYear();
  const day = new Date(y, 5, 30).setHours(0,0,0,0);
  assert.deepEqual(Array.from(c.calEventsOnDay(day), t=>t.name), ["Alex Rivera's birthday"],
    'the day band finds it by expanding the rule');
  assert.ok(c.tasksOnDay(day, c.calEventTasks()).length === 1,
    'and so does the month grid, which shares tasksOnDay');
});

/* Storing occurrences rather than the series drew one chip per occurrence. One series = one record. */
test('many occurrences of one series collapse to a single stored record', async () => {
  const d1 = B() + 3*DAY, d2 = B() + 10*DAY;
  const c = harness({
    [PRIMARY]: [ primaryBirthday(null, "Riley's birthday", d1, 'mstr2'),
                 primaryBirthday(null, "Riley's birthday", d2, 'mstr2') ],
    [BIRTHDAYS]: [],
  }, { mstr2: primaryBirthdayMaster("Riley's birthday", 'mstr2') });

  c.gcalImport({}); await settle();
  assert.equal(c.loadCalEvents().length, 1, 'one series, one record');
  assert.equal(c.loadCalEvents()[0].recur.kind, 'year');
});

/* ---- discovery is no longer window-bounded --------------------------------- */

/* PP-EXT (owner 2026-08-31): "Why do I not see birthdays say in 2028? Now that they don't occupy a row
   we should import all occurrences." The windowed pass can only ever discover what falls inside the
   window, so a birthday eleven months out was never fetched at all — nothing to expand. The display pass
   asks `singleEvents=false`, which returns the MASTER of an endless yearly series whatever the date of
   its next occurrence. */
test('a birthday whose next occurrence is far outside the window is still discovered', async () => {
  const c = harness(
    { [PRIMARY]: [], [BIRTHDAYS]: [] },                                   /* the window returns nothing */
    {},
    { [PRIMARY]: [ primaryBirthdayMaster("Alex Rivera's birthday", 'mstr9') ], [BIRTHDAYS]: [] });

  c.gcalImport({}); await settle();

  const recs = Array.from(c.loadCalEvents());
  assert.deepEqual(recs.map(r=>r.name), ["Alex Rivera's birthday"],
    'discovered without any occurrence inside the window, and without a task row to probe from');
  assert.equal(recs[0].recur.kind, 'year');
  /* 2007-06-30 anchor + yearly ⇒ it must render on 30 June 2028, the owner’s actual question. */
  const day = new Date(2028, 5, 30).setHours(0,0,0,0);
  assert.deepEqual(Array.from(c.calEventsOnDay(day), t=>t.name), ["Alex Rivera's birthday"]);
});

/* The contacts calendar carries no RRULE at all — each year is its own event. A birthday is annual by
   definition, so the record is given a yearly rule rather than expiring after one year. */
test('a contacts birthday without an RRULE is stored as an annual series', async () => {
  const day = B() + 5*DAY;
  const c = harness({ [PRIMARY]: [], [BIRTHDAYS]: [ contactsBirthday("Jordan Lee's birthday", day, '2026_BIRTHDAY_jc') ] });

  c.gcalImport({}); await settle();

  const [rec] = Array.from(c.loadCalEvents());
  assert.equal(rec.name, "Jordan Lee's birthday");
  assert.equal(rec.recur && rec.recur.kind, 'year', 'annual, though Google sent no rule');
  const twoYears = new Date(new Date(day).getFullYear()+2, new Date(day).getMonth(), new Date(day).getDate()).setHours(0,0,0,0);
  assert.deepEqual(Array.from(c.calEventsOnDay(twoYears), t=>t.name), ["Jordan Lee's birthday"]);
});

/* …and once discovery is unbounded, that same person arrives once per year, each copy a distinct event
   whose id carries the year. Given a yearly rule each, they would stack N chips on one day. */
test('the per-year copies of one contacts birthday collapse to a single record', async () => {
  const day = B() + 5*DAY;
  const y = new Date(day).getFullYear(), mo = new Date(day).getMonth(), dom = new Date(day).getDate();
  const at = yr => new Date(yr, mo, dom).setHours(0,0,0,0);
  const c = harness({ [PRIMARY]: [], [BIRTHDAYS]: [] }, {}, { [PRIMARY]: [], [BIRTHDAYS]: [
    contactsBirthday("Jordan Lee's birthday", at(y),   y+'_BIRTHDAY_jc'),
    contactsBirthday("Jordan Lee's birthday", at(y+1), (y+1)+'_BIRTHDAY_jc'),
    contactsBirthday("Jordan Lee's birthday", at(y+2), (y+2)+'_BIRTHDAY_jc') ] });

  c.gcalImport({}); await settle();

  assert.equal(Array.from(c.loadCalEvents()).length, 1, 'one person, one series, one record');
  assert.equal(c.calEventsOnDay(at(y+1)).length, 1, 'and one chip on the day, not three');
});

/* A `tasks` calendar yields no display events by definition, so it must not pay for a second request. */
test('the display pass is skipped for a calendar pinned to the tasks tier', async () => {
  const c = harness({ [PRIMARY]: [], [BIRTHDAYS]: [] });
  c.state.gcal.tier = { [PRIMARY]:'tasks' };

  c.gcalImport({}); await settle();

  assert.deepEqual(c._fetched.display, [BIRTHDAYS], 'only the calendar that can produce display events');
  assert.equal(c._fetched.window.length, 2, 'both are still pulled for tasks');
});

/* A display pass that fails must not cost the calendar its events: the windowed pass still stores what
   it saw, exactly as it did before the second pass existed. */
test('a failed display pass falls back to the windowed events', async () => {
  const day = B() + 4*DAY;
  const c = harness({ [PRIMARY]: [], [BIRTHDAYS]: [ contactsBirthday("Avery's birthday", day, '2026_BIRTHDAY_ada') ] });
  const inner = c.gcalFetch;
  c.gcalFetch = url => /singleEvents=false/.test(url)
    ? Promise.reject(Object.assign(new Error('boom'), { status:500 })) : inner(url);

  c.gcalImport({}); await settle();

  assert.deepEqual(Array.from(c.loadCalEvents(), r=>r.name), ["Avery's birthday"]);
});
