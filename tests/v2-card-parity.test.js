// V2.11 — the Selection/Matrix cards ARE the list row (owner, 2026-08-04: *"we should be able to do
// everything we can do in the list view in the selection and matrix view"*).
//
// The guarantee is structural, not visual: both renderers call the SAME builders, so a control added to
// one appears in the other. These tests pin that the builders exist, that the card actually invokes them,
// and that the card carries the row's three gestures. Two copies agreeing today is what drifted twice
// before in this repo (`tasksByTagSection`, the two `_yTop` call sites) — hence testing the sharing itself.
const test = require('node:test');
const assert = require('node:assert');
const { make, activeTask, DAY } = require('./_load.js');

// The mocked React puts children on `.children` and props (including key) on `.props`.
function walk(node, out) {
  out = out || [];
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => walk(n, out)); return out; }
  out.push(node);
  walk(node.children, out);
  return out;
}
function titles(node) {
  return walk(node).map(n => n.props && n.props.title).filter(Boolean);
}

test('every shared task control exists as one named builder', () => {
  const c = make();
  ['taskDisp','taskDoneCircle','taskDueRecurChip','taskInlineTags','taskDepChips',
   'taskInclControl','taskFlowCell','taskTimerBtn','taskAddTimeBtn','taskDescToggle']
    .forEach(m => assert.strictEqual(typeof c[m], 'function', m + ' is a shared builder'));
});

test('a plan card carries the list row controls: complete, tags, inclusion, timer, add-time, planned', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id:'t', start:B, end:B+DAY, included:true, labels:['work'], planned:60 });
  c.state.tasks = [t];
  const card = c.planCard(t);
  const ttl = titles(card).join(' | ');

  assert.match(ttl, /Click to complete/, 'complete + priority');
  assert.match(ttl, /Remove @work/, 'tag removal');
  assert.match(ttl, /Add a tag/, 'tag add');
  assert.match(ttl, /click to change/, 'inclusion control');
  assert.match(ttl, /Start timer|Stop timer/, 'timer');
  // Task 26 (2026-08-20): the `+15` button became a box that SETS today's figure, so the shared
  // builder's title changed with its behaviour. The parity rule is unchanged — the card offers what
  // the row offers — which is why this asserts the new control rather than dropping the line.
  assert.match(ttl, /Time worked today/, 'set-time-worked box');
  assert.match(ttl, /Planned time/, 'planned is editable on the card');
  assert.match(ttl, /description/i, 'description disclosure');
});

test('a card opens details on click, activates on double-click, and opens the row menu on right-click', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id:'t', start:B, end:B+DAY });
  c.state.tasks = [t];
  const card = c.planCard(t);
  ['onClick','onDoubleClick','onContextMenu'].forEach(k =>
    assert.strictEqual(typeof card.props[k], 'function', 'card wires ' + k));
  // A8b (2026-08-21): `onMouseDown` is gone with the card drag — there is no surface left to start one.
  assert.strictEqual(typeof card.props.onMouseDown, 'undefined', 'no card drag to arm');
});

// A8b (2026-08-21): the card-drag test is DELETED with `cardPointerDown`. Parity never depended on the
// drag — it is about the two surfaces offering the same CONTROLS, which the tests above still pin.
test('card description state is separate from the sheet, so a card cannot offset the Gantt rows', () => {
  const c = make();
  const t = activeTask(c, { id:'t' });
  c.state.tasks = [t];
  c.setState = function (o) { Object.assign(this.state, o); };
  c.toggleCardDesc('t');
  assert.ok((c.state.cardDescOpen || {})['t'], 'card-local open state is set');
  assert.ok(!(c.state.descOpen || {})['t'],
    'and state.descOpen — which observeDescPanel measures for row alignment — is untouched');
});

test('the inclusion control offers four states and never the retired Off', () => {
  const c = make();
  const B = c.startOfToday();
  const mk = over => c.normalizeTask(Object.assign({ id:'g'+Math.random().toString(36).slice(2,7),
    /* V5 block 20 (F19): a window that OPENS today now auto-includes, so `included:null` there renders
       as pressed and could not exercise the unpressed glyph. A not-yet-open window keeps all four
       states reachable, which is what this test is about. */
    name:'t', type:'Proportional', start:B+2*DAY, end:B+4*DAY, priority:4, deps:[], pct:0, planned:60, spent:0 }, over));
  const glyph = t => { c.state.tasks=[t]; return c.taskInclControl(t).children[0]; };
  assert.strictEqual(glyph(mk({ included:true })), '☑', 'pressed');
  assert.strictEqual(glyph(mk({ included:null })), '☐', 'unpressed');
  assert.strictEqual(glyph(mk({ included:true, snoozeUntil:B+DAY })), '💤', 'snoozed');
  // ⊘ was the Off glyph; nothing may render it any more
  [true, null].forEach(v => assert.notStrictEqual(glyph(mk({ included:v })), '⊘'));
});

// Owner, 2026-08-12: *"shouldn't the active task timer just be toggled by the pause/play button? Why in
// the world would the checkbox also become a play button?"* The 'active' state used to render ▶ in the
// inclusion slot, so a running task showed a play triangle beside taskTimerBtn's ■ (stop) — two controls
// that appeared to contradict each other, and the play-shaped one opened the inclusion popover instead of
// touching the timer. 'active' is a strictly stronger form of 'pressed' and must stay in the checkbox
// family; the accent colour and the active ring/wash are the only distinction.
test('the active-state inclusion glyph is a checkbox, never a play triangle', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id:'ac', start:B, end:B+DAY, included:true, planned:60 });
  c.state.tasks = [t]; c.renderVals();
  c.startTimer('ac');
  const live = c.state.tasks.find(x => x.id === 'ac');
  assert.strictEqual(c.inclState(live), 'active', 'premise: a running task reads as active');

  const glyphOf = x => { c.state.tasks = [x]; return [].concat(c.taskInclControl(x).children).join(''); };
  const activeGlyph = glyphOf(live);
  assert.notStrictEqual(activeGlyph, '▶', 'the inclusion control is not a timer control');

  // Parity with pressed is the actual contract: same mark, differing only in colour.
  const pressed = c.normalizeTask({ id:'pr', name:'p', type:'Proportional',
    start:B+2*DAY, end:B+4*DAY, priority:4, deps:[], pct:0, planned:60, spent:0, included:true });
  assert.strictEqual(activeGlyph, glyphOf(pressed), 'active renders the pressed mark');
  assert.strictEqual(activeGlyph, '☑');

  // The colour channel still separates them, so nothing was flattened away.
  c.state.tasks = [live];
  const aColor = String(c.taskInclControl(live).props.style.color);
  c.state.tasks = [pressed];
  const pColor = String(c.taskInclControl(pressed).props.style.color);
  assert.notStrictEqual(aColor, pColor, 'active is distinguished by accent colour, not by a new shape');

  // ...and the title no longer advertises the depth channel V2.9 §2 removed.
  c.state.tasks = [live];
  const title = String(c.taskInclControl(live).props.title);
  assert.ok(!/stronger pressed/.test(title), 'the stale depth wording is gone');
  assert.match(title, /timer running/);
});

const got0 = (c) => c.state.tasks.find(x => x.id === 'late');

test('rescheduleToToday moves the due date to today and presses the task in', () => {
  const c = make();
  const B = c.startOfToday();
  const late = activeTask(c, { id:'late', start:B-3*DAY, end:B-DAY, included:null, pct:20 });
  c.state.tasks = [late];
  assert.strictEqual(c.isOverdueToday(late), true, 'precondition: overdue');

  // The task's HISTORY is played out first, because that is the order it happens in: the sweep runs on
  // each day the task lives, long before the user reaches for "→ Today".
  c.sweepOnListSince(c.state.tasks, B - 2 * DAY, Date.now());   // on the list two days ago: key stamped
  assert.strictEqual(got0(c).onListSince, c.ymdOf(B - 2 * DAY), 'it was on the list back then');
  c.sweepOnListSince(c.state.tasks, B, Date.now());             // window has passed: the key is HELD
  assert.strictEqual(got0(c).onListSince, c.ymdOf(B - 2 * DAY),
    'A8c: going overdue is not leaving the list, so the arrival day survives');

  c.rescheduleToToday('late');
  const got = got0(c);
  assert.strictEqual(c.isOverdueToday(got), false, 'no longer overdue');
  assert.strictEqual(got.included, true, 'rescuing work from overdue also decides to do it');
  // A8c, ruled by the owner 2026-08-21: a rescued overdue task is old work still being carried, not
  // something newly decided today. `rescheduleToToday` is unchanged — `tickOnToday` only stamps a NULL
  // key — so this follows entirely from the sweep no longer treating a passed window as a departure.
  assert.strictEqual(c.originOf(got), 'continued', 'and it leaves the Overdue bucket carrying its age');
});

test('the Overdue column renders only when something is in it', () => {
  const c = make();
  const B = c.startOfToday();
  const clean = activeTask(c, { id:'ok', start:B, end:B+DAY, included:true });
  let p = c.selectionProjection([clean]);
  assert.strictEqual(p.colCount.overdue, 0, 'nothing overdue on a clean day');

  const late = activeTask(c, { id:'late', start:B-3*DAY, end:B-DAY, included:null, pct:20 });
  p = c.selectionProjection([clean, late]);
  assert.strictEqual(p.colCount.overdue, 1, 'and it appears the moment something is late');
});
