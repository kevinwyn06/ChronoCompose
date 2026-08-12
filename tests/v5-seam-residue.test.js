// Chain 4 / block 28 — the seam's rounding residue, and the appointment-only day.
//
// 28a. `compressionSeam` used to round each task's share with `Math.round` INDEPENDENTLY, while the
// packer filled the unrounded pool. With n flexible tasks Σ round(share) could overshoot the pool by
// up to n/2 minutes, so the last task placed was drawn a minute short of the number the sheet printed
// beside its name — silently, with no Unscheduled entry. One minute of user impact; the invariant it
// broke is the pool-agreement invariant that V4's whole allotment story rests on.
//
// 28b. On a day whose hours are entirely appointments or keep-clear the pool is zero, and the
// capacity indicator printed a calm "0%" over an empty track — which reads as "nothing on" on the
// single busiest day of the week. The two numbers are correct; what they SAY was not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY } = require('./_load.js');

const HOUR = 3600000;

function poolDay(c, mins){
  cleanDay(c, '23:59');
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  Object.assign(c.state.settings, { dayStart: '00:00', dayEnd: hh + ':' + mm, breakMin: 0 });
}

const sum = out => Object.keys(out).reduce((a, k) => a + out[k].allotted, 0);

// --- 28a: the seam never charges more whole minutes than the pool holds --------------------------

test('Σ of the rounded shares never exceeds the pool the packer fills', () => {
  const c = make();
  // The exact residue case: three tasks, a 101-minute pool. Independent rounding gave 21+34+47 = 102.
  const feats = [27, 44, 61].map((p, i) => ({ id: 't' + i, planned: p, spent: 0 }));
  const out = c.compressionSeam(feats, 101);
  assert.equal(sum(out), 101, 'charged whole minutes = the pool, not one more');
});

test('…across a wide sweep of pools and task counts, not just the one case that caught it', () => {
  const c = make();
  let worst = 0;
  for(let pool = 7; pool <= 900; pool++){
    for(let n = 1; n <= 9; n++){
      const feats = [];
      for(let i = 1; i <= n; i++) feats.push({ id: 't' + i, planned: 10 + (i * 17) % 53, spent: 0 });
      const out = c.compressionSeam(feats, pool);
      const s = sum(out);
      assert.ok(s <= pool, 'pool ' + pool + ' / ' + n + ' tasks charged ' + s);
      worst = Math.max(worst, pool - s);
    }
  }
  assert.ok(worst < 1.0000001, 'and it never under-charges by a whole minute either (worst ' + worst + ')');
});

test('no single task loses or gains a whole minute against its true share', () => {
  const c = make();
  const feats = [27, 44, 61, 15, 90].map((p, i) => ({ id: 't' + i, planned: p, spent: 0 }));
  const pool = 337;
  const out = c.compressionSeam(feats, pool);
  const planSum = feats.reduce((a, f) => a + f.planned, 0);
  feats.forEach(f => {
    const exact = f.planned / planSum * pool;
    assert.ok(Math.abs(out[f.id].allotted - exact) < 1,
      f.id + ': charged ' + out[f.id].allotted + ' against a true share of ' + exact.toFixed(3));
  });
});

test('apportionment is deterministic — the same input twice gives the same day', () => {
  const c = make();
  const feats = [27, 44, 61, 15, 90, 33, 12].map((p, i) => ({ id: 't' + i, planned: p, spent: 0 }));
  assert.deepEqual(c.compressionSeam(feats, 419), c.compressionSeam(feats, 419));
});

test('a manual Predict is a promise the user typed, and is never shaved to make the sum fit', () => {
  const c = make();
  const feats = [
    { id: 'm', planned: 30, spent: 0, predicted: 45, predictManual: true },
    { id: 'a', planned: 27, spent: 0 },
    { id: 'b', planned: 44, spent: 0 },
  ];
  const out = c.compressionSeam(feats, 146);
  assert.equal(out.m.allotted, 45, 'the typed figure survives intact');
  assert.ok(sum(out) <= 146, 'and the flexible remainder still fits: ' + sum(out));
});

test('end to end: what computeAllotted charges a day fits inside the day it charges it to', () => {
  const c = make();
  poolDay(c, 101);
  c.state.tasks = [27, 44, 61].map((p, i) => activeTask(c, { id: 't' + i, planned: p }));
  const map = c.computeAllotted(c.state.tasks, c.startOfToday());
  const charged = c.state.tasks.reduce((a, t) => a + map[t.id].allotted, 0);
  const cap = c.dayCapacity(c.startOfToday());
  assert.ok(charged <= cap.pool, 'charged ' + charged + ' into a pool of ' + cap.pool);
});

// --- 28b: the appointment-only day ---------------------------------------------------------------

function bookedSolid(){
  const c = make();
  cleanDay(c, '23:59');
  Object.assign(c.state.settings, { dayStart: '09:00', dayEnd: '17:00', breakMin: 0 });
  const today = c.startOfToday();
  const appt = (id, h0, h1) => c.normalizeTask({ id, name: id, type: 'Proportional', priority: 4,
    deps: [], pct: 0, planned: (h1 - h0) * 60, spent: 0,
    start: today + h0 * HOUR, end: today + h1 * HOUR, startClock: true, endClock: true });
  c.state.tasks = [appt('m1', 9, 12), appt('m2', 12, 14), appt('m3', 14, 17)];
  return { c, today };
}

test('a day booked solid with appointments has a pool of zero, and says so', () => {
  const { c, today } = bookedSolid();
  const cap = c.dayCapacity(today);
  assert.deepEqual({ demand: cap.demand, pool: cap.pool, booked: cap.booked },
    { demand: 0, pool: 0, booked: true },
    'the appointments are placed work, not flexible demand — so both numbers are zero');
});

test('…and the indicator reads "no room", not "0% of nothing"', () => {
  const { c, today } = bookedSolid();
  const full = c.renderCapacityBar(today);
  assert.equal(full.props['data-cap-booked'], '1');
  assert.equal(full.props['data-cap-over'], '0', 'a fully committed day is not an alarm');
  assert.match(full.props.title, /no free time — the day is fully committed/);
  const labels = full.children.filter(x => x && x.children && typeof x.children[0] === 'string')
    .map(x => x.children[0]);
  assert.ok(labels.includes('no room'), 'the right-hand figure is a word, not "0m free": ' + labels.join(' | '));

  const mini = c.renderCapacityBar(today, true);
  const pct = mini.children[mini.children.length - 1].children[0];
  assert.equal(pct, 'full', 'the Week strip reads "full" rather than a calm 0%');
});

test('…and the track is drawn FULL rather than empty, so it cannot be read as an empty day', () => {
  const { c, today } = bookedSolid();
  const track = c.renderCapacityBar(today).children[1];
  assert.equal(track.children[0].props.style.width, '100%', 'the committed bar spans the whole track');
  assert.equal(track.children[1], null, 'and nothing is coloured as overshoot — nothing overshot');
});

test('a zero pool with real flexible demand still reads as demand with nowhere to go', () => {
  const { c, today } = bookedSolid();
  c.state.tasks.push(activeTask(c, { id: 'flex', planned: 60 }));
  const cap = c.dayCapacity(today);
  assert.equal(cap.booked, true);
  assert.equal(cap.over, true, '60 minutes asked of a day with none left really is over');
  const mini = c.renderCapacityBar(today, true);
  assert.equal(mini.children[mini.children.length - 1].children[0], '—',
    'a ratio against zero is not a number, and pretending otherwise was the original defect');
});

test('a day that still has free time is untouched by any of this', () => {
  const c = make();
  poolDay(c, 540);
  c.state.tasks = [activeTask(c, { id: 'a', planned: 120 })];
  const cap = c.dayCapacity(c.startOfToday());
  assert.equal(cap.booked, false);
  const mini = c.renderCapacityBar(c.startOfToday(), true);
  assert.equal(mini.children[mini.children.length - 1].children[0], '22%');
  assert.equal(c.renderCapacityBar(c.startOfToday() - DAY), null, 'and a past day still draws nothing');
});
