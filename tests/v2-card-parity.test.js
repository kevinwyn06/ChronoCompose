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
  const card = c.planCard(t, 'incl:included');
  const ttl = titles(card).join(' | ');

  assert.match(ttl, /Click to complete/, 'complete + priority');
  assert.match(ttl, /Remove @work/, 'tag removal');
  assert.match(ttl, /Add a tag/, 'tag add');
  assert.match(ttl, /click to change/, 'inclusion control');
  assert.match(ttl, /Start timer|Stop timer/, 'timer');
  assert.match(ttl, /minutes worked/, 'add-time');
  assert.match(ttl, /Planned time/, 'planned is editable on the card');
  assert.match(ttl, /description/i, 'description disclosure');
});

test('a card opens details on click, activates on double-click, and opens the row menu on right-click', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id:'t', start:B, end:B+DAY });
  c.state.tasks = [t];
  const card = c.planCard(t, 'incl:included');
  ['onClick','onDoubleClick','onContextMenu','onMouseDown'].forEach(k =>
    assert.strictEqual(typeof card.props[k], 'function', 'card wires ' + k));
});

test('the card drag still owns mousedown, so parity did not steal the include/exclude gesture', () => {
  const c = make();
  const B = c.startOfToday();
  const t = activeTask(c, { id:'t', start:B, end:B+DAY });
  c.state.tasks = [t];
  c.planCard(t, 'incl:included').props.onMouseDown({ button:0, clientX:5, clientY:5,
    stopPropagation(){}, preventDefault(){} });
  assert.ok(c.cardPending && c.cardPending.id === 't', 'mousedown arms the card drag');
  assert.strictEqual(c.cardPending.zone, 'incl:included');
});

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
    name:'t', type:'Proportional', start:B, end:B+DAY, priority:4, deps:[], pct:0, planned:60, spent:0 }, over));
  const glyph = t => { c.state.tasks=[t]; return c.taskInclControl(t).children[0]; };
  assert.strictEqual(glyph(mk({ included:true })), '☑', 'pressed');
  assert.strictEqual(glyph(mk({ included:null })), '☐', 'unpressed');
  assert.strictEqual(glyph(mk({ included:true, snoozeUntil:B+DAY })), '💤', 'snoozed');
  // ⊘ was the Off glyph; nothing may render it any more
  [true, null].forEach(v => assert.notStrictEqual(glyph(mk({ included:v })), '⊘'));
});

test('rescheduleToToday moves the due date to today and presses the task in', () => {
  const c = make();
  const B = c.startOfToday();
  const late = activeTask(c, { id:'late', start:B-3*DAY, end:B-DAY, included:null, pct:20 });
  c.state.tasks = [late];
  assert.strictEqual(c.isOverdueToday(late), true, 'precondition: overdue');

  c.rescheduleToToday('late');
  const got = c.state.tasks.find(x => x.id === 'late');
  assert.strictEqual(c.isOverdueToday(got), false, 'no longer overdue');
  assert.strictEqual(got.included, true, 'rescuing work from overdue also decides to do it');
  // It lands in Existing, not New: its window still covers yesterday and it is still unfinished, so it
  // genuinely IS a leftover. Rescheduling changes the deadline, not the history.
  assert.strictEqual(c.originOf(got), 'existing', 'and it leaves the Overdue column');
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
