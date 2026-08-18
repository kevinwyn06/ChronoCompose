// Spec-derived unit tests for Phase 8 — notifications.
// Behavior derived from ROADMAP.md Phase 8 + CLAUDE.md invariants. Pure logic only
// (notifyPlan / morningSummaryData / notifyTick's summary path); the browser Notification
// side of notifyTick is exercised via the 'unsupported' gate (no Notification global in the sandbox).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, DAY } = require('./_load.js');

const MIN = 60000, HOUR = 3600000;

// A scheduled task active today. `over` overrides fields.
function T(c, over){
  return c.normalizeTask(Object.assign({
    id:'id'+Math.random().toString(36).slice(2,8), name:'t', type:'Proportional',
    start:Date.now()-DAY, end:Date.now()+DAY, priority:4, deps:[], pct:0, planned:10, spent:0, included:true,
  }, over||{}));
}
function keys(list){ return list.map(s=>s.key); }
function byType(list, type){ return list.filter(s=>s.type===type); }

// ---------------------------------------------------------------------------
// notifyPlan — the day's FIRST task start (owner 2026-08-16: `startPin` merged into `taskBoundary`,
// and the 5-minute lead window is gone — it fires AT the start, not before it).
// ---------------------------------------------------------------------------
test('the day\'s first clocked start fires at the start instant, once', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [ T(c, {id:'A', name:'Standup', start:now, end:B+18*HOUR}) ];
  const s = byType(c.notifyPlan(now, {}), 'taskBoundary');
  assert.equal(s.length, 1, 'the first start of the day is its own trigger');
  assert.equal(s[0].urgent, false, 'no boundary is urgent now that the heads-up is gone');
  assert.equal(s[0].key, 'bnd:'+now, 'the key is the instant, so one instant can only fire once');
});

test('a start does NOT fire early — there is no lead time any more', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  const soon = T(c, {id:'E', start:now+2*MIN, end:B+18*HOUR});   // was inside the old 5-min lead window
  const later = T(c, {id:'L', start:now+30*MIN, end:B+18*HOUR});
  c.state.tasks = [soon, later];
  assert.equal(c.notifyPlan(now, {}).length, 0,
    'the old T−5 heads-up is deleted: nothing fires before the boundary itself');
});

test('the boundary respects the fired ledger (dedup)', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [ T(c, {id:'A', start:now, end:B+18*HOUR}) ];
  assert.equal(c.notifyPlan(now, {['bnd:'+now]: now}).length, 0, 'already fired at this instant');
});

test('an explicitly untimed start gets no boundary notification', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [ T(c, {id:'A', startClock:false, start:now, end:B+18*HOUR}) ];
  assert.equal(c.notifyPlan(now, {}).length, 0, 'no written clock ⇒ not a boundary');
});

// ---------------------------------------------------------------------------
// notifyPlan — block end (was `blockEnd`, now the "has ended" half of `taskBoundary`)
// ---------------------------------------------------------------------------
test('fixed appointment end fires within the grace window, normal urgency', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [ T(c, {id:'A', name:'Focus', start:B+7*HOUR, end:now-1*MIN}) ];
  const s = byType(c.notifyPlan(now, {}), 'taskBoundary');
  assert.equal(s.length, 1, 'the end of every block is a trigger');
  assert.equal(s[0].urgent, false);
  assert.equal(s[0].body, 'Focus has ended', 'end half alone when nothing starts at that instant');
});

test('block end does not fire long after the end or for a clocked start without an end', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  const stale   = T(c, {id:'S', start:B+2*HOUR, end:now-30*MIN}); // grace passed
  const noEnd   = T(c, {id:'N', start:B+2*HOUR, end:null});
  c.state.tasks = [stale, noEnd];
  assert.equal(c.notifyPlan(now, {}).length, 0,
    'NOTIFY_GRACE_MS still bounds the window, and a task with no end ends no block');
});

test('one instant that both ends a block and starts the next emits ONE spec', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [
    T(c, {id:'A', name:'Work',     start:B+8*HOUR, end:now}),
    T(c, {id:'B', name:'Exercise', start:now,      end:B+10*HOUR}),
  ];
  const plan = c.notifyPlan(now, {});
  assert.equal(plan.length, 1, 'the instant is the key, so the pair cannot double-fire');
  assert.equal(plan[0].body, 'Work has ended · Exercise will start', 'both halves, one notification');
});

// deadlineRisk had three cases here. Owner 2026-08-16: "its just a nuisance alarm" — the type is
// deleted outright, so the replacement assertion is that a would-have-fired setup now stays silent.
test('a task whose remaining work exceeds the time left no longer notifies at all', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 19*HOUR;
  // due at 20:00; 60 min left, 600 min of work remaining — the old deadlineRisk trigger exactly.
  c.state.tasks = [ T(c, {id:'A', name:'Report', planned:600, pct:0, start:B-DAY, end:B+20*HOUR}) ];
  assert.equal(c.notifyPlan(now, {}).length, 0, 'deadlineRisk is deleted; no nuisance alarm fires');
});

// ---------------------------------------------------------------------------
// Milestones / archived are never notified
// ---------------------------------------------------------------------------
test('milestones and archived tasks produce no notifications', () => {
  const c = make();
  const B = c.startOfToday(), now = B + 9*HOUR;
  c.state.tasks = [
    T(c, {id:'M', type:'Milestone', start:now+2*MIN, end:now+2*MIN}),
    T(c, {id:'X', planned:600, pct:0, start:now+2*MIN, end:B+20*HOUR, archivedAt:Date.now()}),
  ];
  assert.equal(c.notifyPlan(now, {}).length, 0);
});

// ---------------------------------------------------------------------------
// notifyOn — per-trigger toggle defaults ON, honours explicit false
// ---------------------------------------------------------------------------
test('notifyOn defaults ON and respects an explicit false', () => {
  const c = make();
  assert.equal(c.notifyOn('taskBoundary'), true);             // unset ⇒ on
  c.state.settings.notify = { taskBoundary:false };
  assert.equal(c.notifyOn('taskBoundary'), false);
  assert.equal(c.notifyOn('morningSummary'), true);           // sibling still on
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
  c.state.tasks = [ T(c, {id:'A', start:now+2*MIN, end:B+18*HOUR}) ];
  assert.equal(c.notifyPermission(), 'unsupported'); // sandbox has no Notification global
  c.notifyTick(now);
  assert.ok(c.state.summary, 'summary still raised without notification permission');
  assert.deepEqual(c._notify.fired, {}, 'no OS notifications marked fired when unsupported');
});
