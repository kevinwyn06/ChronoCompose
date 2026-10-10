const test = require('node:test');
const assert = require('node:assert/strict');
const { make, DAY } = require('./_load.js');

/* Chain A, Task 18 — the timeline block's hover card (spec D2, owner-approved mockup
 *.
 *
 * The interesting part of this feature is not the card, it is the CHOICE of countdown, and that choice
 * is a statement about who decided the time. `blockTooltipModel` is pure so the choice can be tested
 * without a browser; the card that draws its output is checked by eye against the mockup.
 */

const H = 3600000;
const at = (c, h, m) => c.startOfToday() + h * H + (m || 0) * 60000;

function task(c, over) {
  return c.normalizeTask(Object.assign({ id: 't', name: 'Standup', type: 'Proportional',
    priority: 4, deps: [], pct: 0, planned: 60, spent: 0 }, over || {}));
}

test('hover tooltip: a start-clock task leads with "starts in"', () => {
  const c = make();
  const now = at(c, 8, 20);
  const t = task(c, { start: at(c, 9, 0), end: at(c, 9, 15), startClock: true, endClock: true });
  c.state.tasks = [t];
  const m = c.blockTooltipModel({ id: 't', title: 'Standup', type: 'fixed',
    start: at(c, 9, 0), end: at(c, 9, 15) }, t, now);

  assert.equal(m.title, 'Standup');
  assert.equal(m.window, '9:00am – 9:15am', 'the window is the 12-hour formatter, both ends');
  assert.equal(m.planned, false, 'the owner committed to this clock, so it is not "planned"');
  assert.equal(m.primary, 'starts in 40m');
  assert.equal(m.secondary, 'ends in 55m');
  assert.equal(m.progress, null);
});

test('hover tooltip: a deadline-only task leads with "due in", and its start is secondary', () => {
  const c = make();
  const now = at(c, 8, 0);
  // No start clock: the packer chose 2:00–4:00pm, and that is exactly why it is the SECONDARY line.
  const t = task(c, { start: null, end: at(c, 14, 0) + 6 * H, endClock: true, planned: 120 });
  c.state.tasks = [t];
  const m = c.blockTooltipModel({ id: 't', title: 'Essay draft', type: 'scheduled',
    start: at(c, 14, 0), end: at(c, 16, 0) }, t, now);

  assert.equal(m.planned, true, 'the packer placed it, so the window says so');
  assert.match(m.primary, /^due in /);
  assert.equal(m.secondary, 'starts in 6h');
});

test('hover tooltip: a running task shows progress and one countdown', () => {
  const c = make();
  const now = at(c, 9, 30);
  const t = task(c, { start: at(c, 9, 0), end: at(c, 10, 0), startClock: true, endClock: true });
  c.state.tasks = [t];
  c.state.running = { t: now - 10 * 60000 };
  const m = c.blockTooltipModel({ id: 't', title: 'Standup', type: 'fixed',
    start: at(c, 9, 0), end: at(c, 10, 0) }, t, now);

  assert.equal(m.progress, 0.5, 'halfway through the block');
  assert.equal(m.primary, 'ends in 30m');
  assert.equal(m.secondary, null, 'while it runs, how far through it is IS the question');
});

test('hover tooltip: the secondary is dropped when it says the same thing', () => {
  const c = make();
  const now = at(c, 8, 0);
  // A zero-length block: "starts in 1h" and "ends in 1h" are the same fact in two weights.
  const t = task(c, { start: at(c, 9, 0), end: at(c, 9, 0), startClock: true, endClock: true });
  c.state.tasks = [t];
  const m = c.blockTooltipModel({ id: 't', title: 'Water plants', type: 'fixed',
    start: at(c, 9, 0), end: at(c, 9, 0) }, t, now);
  assert.equal(m.primary, 'starts in 1h');
  assert.equal(m.secondary, null);
});

test('hover tooltip: countdowns read in the units a person would say', () => {
  const c = make();
  assert.equal(c.fmtCountdown(40 * 60000), '40m');
  assert.equal(c.fmtCountdown(60 * 60000), '1h');
  assert.equal(c.fmtCountdown(95 * 60000), '1h 35m');
  assert.equal(c.fmtCountdown(6 * H), '6h');
  assert.equal(c.fmtCountdown(DAY + 3 * H), '1d 3h');
  assert.equal(c.fmtCountdown(0), 'now');
  assert.equal(c.fmtCountdown(-5 * 60000), 'now', 'a countdown never runs backwards');
});

/* ---------------------------------------------------------------------------
 * Task 24 — the Schedule view's "now" marker. The Schedule view is an agenda LIST, so the marker is a
 * rule BETWEEN entries rather than the day timeline's absolutely-positioned line. What has to be true is
 * where it lands in the order, and that is assertable off the render tree.
 */
const walk = (n, out) => { out = out || []; if (!n || typeof n !== 'object') return out;
  out.push(n); (n.children || []).forEach(k => walk(k, out)); return out; };

function schedule(c) {
  const B = c.startOfToday();
  c.state.nowTick = at(c, 11, 0);
  c.state.settings = Object.assign({}, c.state.settings, { dayStart: '08:00', dayEnd: '18:00' });
  c.state.tasks = [
    task(c, { id: 'am', name: 'Morning', start: at(c, 9, 0), end: at(c, 10, 0),
      startClock: true, endClock: true, uncompressable: true, included: true }),
    task(c, { id: 'pm', name: 'Afternoon', start: at(c, 14, 0), end: at(c, 15, 0),
      startClock: true, endClock: true, uncompressable: true, included: true }),
  ];
  return B;
}

test('schedule now-marker: it lands between the chips it belongs between', () => {
  const c = make();
  schedule(c);
  const nodes = walk(c.renderScheduleView());
  const flat = nodes.filter(n => n.props
    && (n.props['data-sched-now'] || (n.props.title && /Morning|Afternoon/.test(n.props.title))));
  const order = flat.map(n => n.props['data-sched-now'] ? 'NOW' : n.props.title);
  assert.equal(order.length, 3);
  assert.equal(order[1], 'NOW', '11:00 sits after the 9am block and before the 2pm one: ' + order.join(' | '));
});

test('schedule now-marker: only today gets one', () => {
  const c = make();
  schedule(c);
  const marks = walk(c.renderScheduleView()).filter(n => n.props && n.props['data-sched-now']);
  assert.equal(marks.length, 1, 'seven sections, one marker — the other six days have no "now"');
});

test('schedule now-marker: it reads nowTick, so it moves with the rest of the view', () => {
  const c = make();
  schedule(c);
  c.state.nowTick = at(c, 16, 0);
  const nodes = walk(c.renderScheduleView());
  const flat = nodes.filter(n => n.props
    && (n.props['data-sched-now'] || (n.props.title && /Morning|Afternoon/.test(n.props.title))));
  assert.equal(flat.map(n => n.props['data-sched-now'] ? 'NOW' : n.props.title)[2], 'NOW',
    'at 4pm it is last, after both blocks');
});

test('schedule now-marker: a chip starting exactly now comes first', () => {
  const c = make();
  schedule(c);
  c.state.nowTick = at(c, 9, 0);
  const flat = walk(c.renderScheduleView()).filter(n => n.props
    && (n.props['data-sched-now'] || (n.props.title && /Morning|Afternoon/.test(n.props.title))));
  assert.equal(flat.map(n => n.props['data-sched-now'] ? 'NOW' : n.props.title)[0], 'Morning',
    'a tie goes to the block: the rule marks where you are UP TO, so it sits below what starts now');
});
