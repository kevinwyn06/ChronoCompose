// UI revamp block 5 — quick-add correctness, test-first.
// 1. The preview chips are built from the SAME shaped task that gets committed, and labelled
//    (Starts / Due / Ends / Takes / Repeats). Preview == saved is asserted for a table of phrasings.
// 2. A bare duration next to a date ("Friday 2pm 30m", "Quiz prep 1.5h tomorrow") sets `planned`.
// 3. A month word inside a title is not a date unless it reads as one (a day number, or a cue: "in may").
// 4. "every weekday" starts on a weekday; an explicit "at 7am" / "at noon" is a start, not a question.
// 5. A typed day range stores the same inclusive end the When line does ("Oct 10 to Oct 12" -> Oct 12).
// 6. Adding closes quick add and confirms through the toast layer, with Undo.
// 7. A weekly repeat receives time only on its occurrence days.
const test = require('node:test');
const assert = require('node:assert');
const { make, DAY, withNow } = require('./_load.js');

// Sunday 2026-10-04, 3pm local — the day the audit ran, and a weekend day on purpose.
const SUN = new Date(2026, 9, 4, 15, 0, 0, 0).getTime();
const day = (y, m, d, h, mi) => new Date(y, m, d, h || 0, mi || 0, 0, 0).getTime();

function setup() {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.firstRunSeen = true;
  c.state.sections = [];
  c.state.tasks = [];
  c.renderVals();
  return c;
}
const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};
const plain = (x) => JSON.parse(JSON.stringify(x));

// Type into quick add, read the preview, press Enter, and return both halves.
function addVia(c, text, choice) {
  c.setState({ quickOpen: true, quickText: text, quickChoice: choice || 'anchor' });
  const preview = plain(c.quickChips(c.quickShape(text, choice || 'anchor')));
  const before = c.state.tasks.length;
  c.runQuickAdd('bottom');
  assert.equal(c.state.tasks.length, before + 1, text + ': one task added');
  const saved = c.state.tasks[c.state.tasks.length - 1];
  return { preview, saved, chips: plain(c.quickChips(saved)) };
}
const chip = (chips, kind) => (chips.find((x) => x.kind === kind) || {}).value;

// ---------------------------------------------------------------------------
// 1. Preview == saved, and the chips are labelled
// ---------------------------------------------------------------------------

const PHRASINGS = [
  'Email advisor Friday 2pm 30m',
  'Quiz prep 1.5h tomorrow',
  'Call May about March budget',
  'Gym every weekday 7am',
  'Lunch with Sam at noon',
  'by Oct 20 at 5pm for 3h',
  'Trip from Oct 10 to Oct 12',
  'Read paper 2h',
  'Meeting Tuesday 2-3pm',
  'Standup every monday 9-9:15am',
  'Water plants daily',
  'Taxes by friday',
  'Buy milk @errands p1',
];

test('preview chips equal the chips of the task that was saved, for every phrasing', () => withNow(SUN, () => {
  for (const text of PHRASINGS) {
    const c = setup();
    const { preview, chips } = addVia(c, text);
    assert.deepStrictEqual(preview, chips, text + ': preview == saved');
  }
}));

test('chips are labelled Starts / Due / Ends / Takes / Repeats, in sentence case', () => withNow(SUN, () => {
  const c = setup();
  const labels = (text) => plain(c.quickChips(c.quickShape(text, 'anchor'))).map((x) => x.label);
  assert.deepStrictEqual(labels('Meeting Tuesday 2-3pm'), ['Starts', 'Ends', 'Takes']);
  assert.deepStrictEqual(labels('Taxes by friday'), ['Due']);
  assert.deepStrictEqual(labels('Read paper 2h'), ['Takes']);
  assert.deepStrictEqual(labels('Water plants daily'), ['Repeats', 'Starts']);
}));

test('"by Oct 20 at 5pm for 3h" previews the 2pm start it saves (it used to preview 5pm)', () => withNow(SUN, () => {
  const c = setup();
  const { preview, saved } = addVia(c, 'by Oct 20 at 5pm for 3h');
  assert.equal(saved.start, day(2026, 9, 20, 14));
  assert.equal(saved.end, day(2026, 9, 20, 17));
  assert.match(chip(preview, 'start'), /2:00pm/);
  assert.doesNotMatch(chip(preview, 'start'), /5:00pm/);
  assert.equal(chip(preview, 'takes'), '3h');
}));

test('the rendered chips carry their label and read at >= 11px after the 0.8 shell zoom', () => withNow(SUN, () => {
  const c = setup();
  c.setState({ quickOpen: true, quickText: 'Email advisor Friday 2pm 30m' });
  const tree = c.renderQuickAddPopup();
  const chips = find(tree, (p) => p['data-qa'] === 'quick-chip');
  assert.ok(chips.length >= 2, 'labelled chips are rendered');
  const kinds = chips.map((n) => n.props['data-kind']);
  assert.ok(kinds.includes('start') && kinds.includes('takes'), 'start and takes chips: ' + kinds);
  const starts = chips.find((n) => n.props['data-kind'] === 'start');
  assert.match(textOf(starts), /^Starts\s*Fri Oct 09, 2:00pm$/);
  for (const n of chips) {
    const px = parseFloat(n.props.style.fontSize);
    assert.ok(px * c.SHELL_ZOOM >= 11, 'chip renders >= 11px, got ' + px + 'px CSS');
    assert.doesNotMatch(JSON.stringify(n.props.style), /#[0-9a-f]{3,6}\b/i, 'chip styling reads tokens, not hex');
  }
}));

// ---------------------------------------------------------------------------
// 2. Bare durations next to a date
// ---------------------------------------------------------------------------

test('"Email advisor Friday 2pm 30m" keeps the 30 minutes and leaves the title clean', () => withNow(SUN, () => {
  const c = setup();
  const { saved } = addVia(c, 'Email advisor Friday 2pm 30m', 'anchor');
  assert.equal(saved.name, 'Email advisor');
  assert.equal(saved.planned, 30);
  assert.equal(saved.start, day(2026, 9, 9, 14));
  assert.equal(saved.end, day(2026, 9, 9, 14, 30), 'the same reading as "Friday 2pm for 30m"');
}));

test('"Quiz prep 1.5h tomorrow" is 90 minutes tomorrow, title "Quiz prep"', () => withNow(SUN, () => {
  const c = setup();
  const { saved } = addVia(c, 'Quiz prep 1.5h tomorrow');
  assert.equal(saved.name, 'Quiz prep');
  assert.equal(saved.planned, 90);
  assert.equal(saved.start, day(2026, 9, 5));
  assert.equal(saved.end, null, 'a bare day plus a budget stays a movable budget');
}));

test('a duration that is NOT next to the date stays title text', () => withNow(SUN, () => {
  const c = setup();
  const s = c.quickShape('Run 5m sprints tomorrow', 'anchor');
  assert.equal(s.name, 'Run 5m sprints');
  assert.equal(s.planned, null);
  assert.equal(s.start, day(2026, 9, 5));
}));

// ---------------------------------------------------------------------------
// 3. Month words inside titles
// ---------------------------------------------------------------------------

test('a month word in a title is not a date', () => withNow(SUN, () => {
  const c = setup();
  for (const text of ['Call May about March budget', 'Plan march madness bracket', 'Ask Jan about the slides']) {
    const s = c.quickShape(text, 'anchor');
    assert.equal(s.name, text, text + ': title intact');
    assert.equal(s.start, null, text + ': no start');
    assert.equal(s.end, null, text + ': no end');
  }
}));

test('a month still reads as a date beside a day number, or after "in"/"by"', () => withNow(SUN, () => {
  const c = setup();
  const a = c.quickShape('Pay rent may 1', 'anchor');
  assert.equal(a.name, 'Pay rent'); assert.equal(a.start, day(2027, 4, 1));
  const b = c.quickShape('Review march 3 notes', 'anchor');
  assert.equal(b.name, 'Review notes'); assert.equal(b.start, day(2027, 2, 3));
  const d = c.quickShape('Dinner in may', 'anchor');
  assert.equal(d.name, 'Dinner'); assert.equal(d.start, day(2027, 4, 1));
  const e = c.quickShape('Call May about the budget tomorrow', 'anchor');
  assert.equal(e.name, 'Call May about the budget');
  assert.equal(e.start, day(2026, 9, 5), 'the real date still wins');
}));

// ---------------------------------------------------------------------------
// 4. "every weekday" and the At/By chooser
// ---------------------------------------------------------------------------

test('"every weekday" typed on a Sunday starts on Monday', () => withNow(SUN, () => {
  const c = setup();
  const a = c.quickShape('Gym every weekday 7am', 'anchor');
  assert.equal(a.start, day(2026, 9, 5, 7), 'Mon Oct 5, 7am');
  const p = c.parseDateText('every weekday');
  const b = c.shapeParsedTask(p, 'anchor');
  assert.equal(b.start, day(2026, 9, 5), 'Mon Oct 5');
  assert.deepStrictEqual(plain(c.ambigChoiceLabels(p)), { anchor: 'On weekdays', due: 'By weekdays' });
}));

test('"every weekday" typed on a weekday starts that day', () => withNow(day(2026, 9, 7, 6), () => {
  const c = setup();
  assert.equal(c.quickShape('Gym every weekday 7am', 'anchor').start, day(2026, 9, 7, 7));
}));

test('an explicit "at <clock>" is a start time: the At/By chooser does not ask', () => withNow(SUN, () => {
  const c = setup();
  for (const text of ['Lunch with Sam at noon', 'Gym at 7am', 'Call Bob friday at 3pm']) {
    const p = c.parseDateText(text);
    assert.equal(p.ambiguous, null, text + ': not ambiguous');
    assert.equal(c.ambigChoiceLabels(p), null, text + ': no chooser');
    assert.equal(c.shapeParsedTask(p, 'anchor').startClock, true, text + ': a start clock');
  }
  // Without "at", a bare clock is still genuinely two readings.
  assert.equal(c.parseDateText('Gym 7am').ambiguous, 'time');
}));


// ---------------------------------------------------------------------------
// 5. A typed day range ends on the day it names (the When line's rule)
// ---------------------------------------------------------------------------

test('quick add stores "Oct 10 to Oct 12" with the inclusive end the When line stores', () => withNow(SUN, () => {
  const c = setup();
  const { saved } = addVia(c, 'Trip from Oct 10 to Oct 12');
  assert.equal(saved.name, 'Trip');
  assert.equal(saved.start, day(2026, 9, 10));
  assert.equal(saved.end, day(2026, 9, 12), 'Oct 12 00:00 — not Oct 13');
  assert.equal(c.startOfDay(c.dueMsOf(saved, c.startOfToday()) - 1), day(2026, 9, 12), 'due by the end of Oct 12, not a day late');
  // Same rule as the When line, by construction.
  c.state.tasks.push(c.normalizeTask({ id: 'w', name: 'w', type: 'Proportional', priority: 4, deps: [], pct: 0, labels: [] }));
  c.applyWhenText('w', 'Oct 10 to Oct 12');
  const w = c.state.tasks.find((t) => t.id === 'w');
  assert.equal(w.end, saved.end);
}));

test('a title edit stores the same inclusive end', () => withNow(SUN, () => {
  const c = setup();
  c.state.tasks = [c.normalizeTask({ id: 'a', name: 'Trip', type: 'Proportional', priority: 4, deps: [], pct: 0, labels: [] })];
  c.rename('a', 'Trip from Oct 10 to Oct 12');
  const t = c.state.tasks[0];
  assert.equal(t.start, day(2026, 9, 10));
  assert.equal(t.end, day(2026, 9, 12));
}));

test('a repeat window keeps its exclusive series end (not shifted by the inclusive rule)', () => withNow(SUN, () => {
  const c = setup();
  const s = c.quickShape('Standup every monday from Oct 5 to Oct 26', 'anchor');
  assert.equal(s.end, day(2026, 9, 27), 'series end is the exclusive next midnight, as before');
}));

// ---------------------------------------------------------------------------
// 6. Adding closes quick add and confirms with Undo
// ---------------------------------------------------------------------------

test('Enter adds, closes quick add, and raises "Added “X” · <when>" with Undo', () => withNow(SUN, () => {
  const c = setup();
  c.setState({ quickOpen: true, quickText: 'Email advisor Friday 2pm 30m' });
  c.runQuickAdd('bottom');
  assert.equal(c.state.quickOpen, false, 'quick add closed');
  assert.equal(c.state.quickText, '');
  const t = c.state.toast;
  assert.ok(t, 'a toast was raised');
  assert.equal(t.msg, 'Added “Email advisor” · Fri Oct 09, 2:00pm–2:30pm');
  assert.equal(c.toastUndoLive(t), true, 'Undo is live');
  c.undoFromToast();
  assert.equal(c.state.tasks.length, 0, 'Undo removes the added task');
}));

test('a dateless add says so', () => withNow(SUN, () => {
  const c = setup();
  c.setState({ quickOpen: true, quickText: 'Read paper 2h' });
  c.runQuickAdd('bottom');
  assert.equal(c.state.toast.msg, 'Added “Read paper” · no date, 2h');
}));

// ---------------------------------------------------------------------------
// 7. A weekly repeat receives time only on its occurrence days
// ---------------------------------------------------------------------------

function labMeeting(c, extra) {
  const B = c.startOfDay(Date.now());
  // Mondays 10:00–11:00, anchored last Monday; `included:true` is the creation default seeds carry.
  return c.normalizeTask(Object.assign({ id: 'lab', name: 'Lab meeting', type: 'Proportional', priority: 2, deps: [], pct: 0,
    labels: [], included: true, start: day(2026, 8, 28, 10), end: null, startClock: true, planned: 60,
    recur: { kind: 'week', n: 1, label: 'Weekly', shifts: [], overrides: {}, durMs: 3600000 } }, extra || {}));
}

test('a weekly Monday repeat gets no time on Sunday (it was packed 0:24 there)', () => withNow(SUN, () => {
  const c = setup();
  c.state.tasks = [labMeeting(c)];
  c.renderVals();
  const B = c.startOfToday();
  const t = c.state.tasks[0];
  assert.equal(c.isActiveOn(t, B), false, 'not active on a day it does not occur');
  assert.equal(c.computeAllotted(c.state.tasks, B).lab.allotted, 0);
  const tl = c.buildDayTimeline(B, c.state.tasks);
  assert.equal((tl.chunks || []).filter((x) => x.taskId === 'lab').length, 0, 'nothing drawn for it on Sunday');
  // Monday, as a future day, it still holds its hour.
  assert.equal(c.isActiveOn(t, B + DAY), true);
}));

test('the same repeat, on its own day, still gets its time', () => withNow(day(2026, 9, 5, 8), () => {
  const c = setup();
  c.state.tasks = [labMeeting(c)];
  c.renderVals();
  const B = c.startOfToday();
  assert.equal(c.isActiveOn(c.state.tasks[0], B), true);
  assert.ok(c.computeAllotted(c.state.tasks, B).lab.allotted > 0);
}));

test('an untimed daily repeat still packs today (regression guard for #200)', () => withNow(SUN, () => {
  const c = setup();
  c.state.tasks = [c.normalizeTask({ id: 'd', name: 'Capstone', type: 'Proportional', priority: 1, deps: [], pct: 0, labels: [],
    included: true, start: day(2026, 8, 20), end: null, planned: 60,
    recur: { kind: 'day', n: 1, label: 'Daily', shifts: [], overrides: {}, durMs: 0 } })];
  c.renderVals();
  const B = c.startOfToday();
  assert.equal(c.isActiveOn(c.state.tasks[0], B), true);
  assert.ok(c.computeAllotted(c.state.tasks, B).d.allotted > 0);
}));

test('an explicit press on an off-day still pulls the repeat in (a press outranks the dates)', () => withNow(SUN, () => {
  const c = setup();
  c.state.tasks = [labMeeting(c, { includedExplicit: true })];
  c.renderVals();
  assert.equal(c.isActiveOn(c.state.tasks[0], c.startOfToday()), true);
}));
