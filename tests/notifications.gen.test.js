// Spec-derived unit tests for Phase 8 — notifications.
// Behavior derived from ROADMAP.md Phase 8 + CLAUDE.md invariants. Pure logic only
// (notifyPlan / morningSummaryData / notifyTick's summary path); the browser Notification
// side of notifyTick is exercised via the 'unsupported' gate (no Notification global in the sandbox).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, DAY } = require('./_load.js');

const MIN = 60000, HOUR = 3600000;

// A scheduled task active today, with explicit pins. `over` overrides fields.
function T(c, over){
  return c.normalizeTask(Object.assign({
    id:'id'+Math.random().toString(36).slice(2,8), name:'t', type:'Proportional',
    start:Date.now()-DAY, end:Date.now()+DAY, priority:4, deps:[], pct:0, planned:10, spent:0,
  }, over||{}));
}
function keys(list){ return list.map(s=>s.key); }
function byType(list, type){ return list.filter(s=>s.type===type); }

// ---------------------------------------------------------------------------
// notifyPlan — start-pin heads-up (T−5, urgent)
// ---------------------------------------------------------------------------
test('start-pin fires in the 5-min lead window, urgent, once', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  // starts in 2 min → inside [start−LEAD, start)
  c.state.tasks = [ T(c, {id:'A', name:'Standup', pinStart:true, start:now+2*MIN, end:B+18*HOUR}) ];
  const plan = c.notifyPlan(now, {});
  const s = byType(plan, 'startPin');
  assert.equal(s.length, 1);
  assert.equal(s[0].urgent, true);
  assert.equal(s[0].key, 'start:A:'+(now+2*MIN));
});

test('start-pin does NOT fire before the lead window or after the start', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  const early = T(c, {id:'E', pinStart:true, start:now+30*MIN, end:B+18*HOUR}); // >5 min away
  const past  = T(c, {id:'P', pinStart:true, start:now-1*MIN,  end:B+18*HOUR}); // already started
  c.state.tasks = [early, past];
  assert.equal(byType(c.notifyPlan(now, {}), 'startPin').length, 0);
});

test('start-pin respects the fired ledger (dedup)', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  const start = now + 2*MIN;
  c.state.tasks = [ T(c, {id:'A', pinStart:true, start, end:B+18*HOUR}) ];
  assert.equal(c.notifyPlan(now, {['start:A:'+start]: now}).length, 0);
});

test('a task with no start pin gets no start-pin notification', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [ T(c, {id:'A', pinStart:false, start:now+2*MIN, end:B+18*HOUR}) ];
  assert.equal(byType(c.notifyPlan(now, {}), 'startPin').length, 0);
});

// ---------------------------------------------------------------------------
// notifyPlan — scheduled-block end (normal), only for both-pinned blocks
// ---------------------------------------------------------------------------
test('both-pinned block end fires within the grace window, normal urgency', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [ T(c, {id:'A', name:'Focus', pinStart:true, pinEnd:true, start:B+7*HOUR, end:now-1*MIN}) ];
  const s = byType(c.notifyPlan(now, {}), 'blockEnd');
  assert.equal(s.length, 1);
  assert.equal(s[0].urgent, false);
});

test('block end does not fire long after the end (grace expired) or without an end pin', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  const stale   = T(c, {id:'S', pinStart:true, pinEnd:true, start:B+2*HOUR, end:now-30*MIN}); // grace passed
  const noEnd   = T(c, {id:'N', pinStart:true, pinEnd:false, start:B+2*HOUR, end:now-1*MIN}); // no end pin
  c.state.tasks = [stale, noEnd];
  assert.equal(byType(c.notifyPlan(now, {}), 'blockEnd').length, 0);
});

// ---------------------------------------------------------------------------
// notifyPlan — deadline at risk (urgent, once/day)
// ---------------------------------------------------------------------------
test('deadline-at-risk fires when remaining work exceeds time left before due', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 19*HOUR;
  // due at 20:00 (has a clock ⇒ dueMsOf = end); 60 min left, 600 min of work remaining
  c.state.tasks = [ T(c, {id:'A', name:'Report', pinStart:false, planned:600, pct:0, start:B-DAY, end:B+20*HOUR}) ];
  const s = byType(c.notifyPlan(now, {}), 'deadlineRisk');
  assert.equal(s.length, 1);
  assert.equal(s[0].urgent, true);
  assert.equal(s[0].key, 'risk:A:'+B); // throttle key is per-day
});

test('deadline-at-risk stays silent when the work still fits', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 19*HOUR;
  c.state.tasks = [ T(c, {id:'A', planned:30, pct:0, start:B-DAY, end:B+20*HOUR}) ]; // 30 min work, 60 left
  assert.equal(byType(c.notifyPlan(now, {}), 'deadlineRisk').length, 0);
});

test('deadline-at-risk ignores completed tasks and is deduped per day', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 19*HOUR;
  c.state.tasks = [
    T(c, {id:'done', planned:600, pct:100, start:B-DAY, end:B+20*HOUR}),
    T(c, {id:'A',    planned:600, pct:0,   start:B-DAY, end:B+20*HOUR}),
  ];
  assert.equal(byType(c.notifyPlan(now, {}), 'deadlineRisk').length, 1);            // 'done' excluded
  assert.equal(c.notifyPlan(now, {['risk:A:'+B]: now}).length, 0);                  // already fired today
});

// ---------------------------------------------------------------------------
// Milestones / archived are never notified
// ---------------------------------------------------------------------------
test('milestones and archived tasks produce no notifications', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [
    T(c, {id:'M', type:'Milestone', pinStart:true, start:now+2*MIN, end:now+2*MIN}),
    T(c, {id:'X', pinStart:true, planned:600, pct:0, start:now+2*MIN, end:B+20*HOUR, archivedAt:Date.now()}),
  ];
  assert.equal(c.notifyPlan(now, {}).length, 0);
});

// ---------------------------------------------------------------------------
// notifyOn — per-trigger toggle defaults ON, honours explicit false
// ---------------------------------------------------------------------------
test('notifyOn defaults ON and respects an explicit false', () => {
  const c = make();
  assert.equal(c.notifyOn('startPin'), true);                 // unset ⇒ on
  c.state.settings.notify = { startPin:false };
  assert.equal(c.notifyOn('startPin'), false);
  assert.equal(c.notifyOn('deadlineRisk'), true);             // sibling still on
});

// ---------------------------------------------------------------------------
// morningSummaryData — counts + needs-planning list
// ---------------------------------------------------------------------------
test('morningSummaryData reports today/done/overdue counts and unplanned tasks', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 8*HOUR;
  c.state.tasks = [
    T(c, {id:'a', name:'Active',   planned:60, pct:0,   start:B-DAY, end:B+DAY}),
    T(c, {id:'d', name:'Done',     planned:60, pct:100, start:B-DAY, end:B+DAY}),
    T(c, {id:'o', name:'Overdue',  planned:60, pct:0,   start:B-2*DAY, end:B-DAY}),   // due yesterday
    T(c, {id:'u', name:'Unplanned',planned:0,  pct:0,   start:B, end:B+DAY}),          // planned 0 ⇒ needs planning
    T(c, {id:'m', name:'Mile', type:'Milestone', start:B, end:B}),
  ];
  const d = c.morningSummaryData(now);
  assert.equal(d.doneCount, 1);
  assert.ok(d.overdueCount >= 1);
  assert.equal(d.unplannedTotal, 1);
  assert.deepEqual(Array.from(d.unplanned), ['Unplanned']);
});

// ---------------------------------------------------------------------------
// maybeMorningSummary — once per calendar day, gated by the toggle
// ---------------------------------------------------------------------------
test('maybeMorningSummary raises the popup once per day, then not again', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 8*HOUR;
  c._notify = { fired:{}, summaryDay:null };
  c.state.tasks = [ T(c, {id:'a', planned:60, pct:0, start:B-DAY, end:B+DAY}) ];
  c.maybeMorningSummary(now);
  assert.ok(c.state.summary, 'first call of the day raises the summary');
  assert.equal(c._notify.summaryDay, B);
  c.setState({summary:null});
  c.maybeMorningSummary(now + HOUR); // same day
  assert.equal(c.state.summary, null, 'same-day second call does not re-raise');
});

test('maybeMorningSummary is suppressed when the toggle is off but still marks the day', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 8*HOUR;
  c._notify = { fired:{}, summaryDay:null };
  c.state.settings.notify = { morningSummary:false };
  c.maybeMorningSummary(now);
  assert.equal(c.state.summary, null, 'toggle off ⇒ no popup');
  assert.equal(c._notify.summaryDay, B, 'day still marked so it stays once-a-day if re-enabled');
});

// ---------------------------------------------------------------------------
// notifyTick — with no Notification support, skips OS notifs but still summarises
// ---------------------------------------------------------------------------
test('notifyTick without Notification support raises the summary and fires no OS notifications', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 8*HOUR;
  c._notify = { fired:{}, summaryDay:null };
  c.state.tasks = [ T(c, {id:'A', pinStart:true, start:now+2*MIN, end:B+18*HOUR}) ];
  assert.equal(c.notifyPermission(), 'unsupported'); // sandbox has no Notification global
  c.notifyTick(now);
  assert.ok(c.state.summary, 'summary still raised without notification permission');
  assert.deepEqual(c._notify.fired, {}, 'no OS notifications marked fired when unsupported');
});
