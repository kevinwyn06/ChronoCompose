// Owner report, 2026-08-16: "0 minute tasks are getting 30 minutes while 1 hour tasks get just a few
// minutes." This file pins the two halves of the fix — what one task ASKS the day for
// (requestedMinutes), and how the day DIVIDES itself between those asks (compressionSeam).
const test = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY, withNow } = require('./_load.js');

const HOUR = 3600000;

test('DEFAULT_TASK_MINUTES is 5', () => {
  const c = make();
  assert.equal(c.DEFAULT_TASK_MINUTES, 5,
    '30 was a real draggable slice; 5 is a deliberate nudge to estimate');
});

test('normalizeTask keeps "unset" and "deliberately zero" apart', () => {
  const c = make();
  assert.equal(c.normalizeTask({ id: 'x', name: 'x' }).planned, null,
    'no estimate given → null, not 0');
  assert.equal(c.normalizeTask({ id: 'x', name: 'x', planned: 0 }).planned, 0,
    'a typed 0 is a decision and survives normalization');
  assert.equal(c.normalizeTask({ id: 'x', name: 'x', planned: 60 }).planned, 60,
    'a real estimate is carried through untouched');
});

test('requestedMinutes: the four-branch ladder, in order', () => {
  const c = make();
  const day = c.startOfToday();
  assert.equal(c.requestedMinutes({ id: '1', predictManual: true, predicted: 45, planned: 600 }), 45,
    '1. a manual Predict is a promise the user typed and overrides everything');
  assert.equal(c.requestedMinutes({ id: '2', planned: 90 }), 90,
    '2. planned != null is the figure');
  assert.equal(c.requestedMinutes({ id: '3', planned: 0 }), 0,
    '2. ...and a deliberate 0 asks for nothing, rather than drawing the default');
  const appt = c.normalizeTask({
    id: '4', name: 'Work', planned: null,
    start: day + 10.5 * HOUR, end: day + 12 * HOUR,
    startClock: true, endClock: true,
  });
  assert.equal(c.requestedMinutes(appt, day), 90,
    '3. a fixed appointment carries its duration in its clocks, not in a typed estimate — ' +
    'without this branch the 30→5 change would shrink every unestimated appointment to 5 minutes');
  assert.equal(c.requestedMinutes({ id: '5', planned: null }), 5,
    '4. otherwise the default slice');
  assert.equal(c.requestedMinutes(null), 0, 'no task asks for nothing');
});

test('fmtDur renders an unset planned as an em dash', () => {
  const c = make();
  assert.equal(c.fmtDur(null), '—', 'the Planned cell shows — for "no time given"');
  assert.equal(c.fmtDur(0), '0:00', '...and 0:00 for a deliberate zero');
});

test('parsePlannedDur distinguishes a blank box from a typed zero', () => {
  const c = make();
  assert.equal(c.parsePlannedDur(''), null, 'blank means "no estimate"');
  assert.equal(c.parsePlannedDur('   '), null, 'whitespace is still blank');
  assert.equal(c.parsePlannedDur('—'), null, 'the rendered placeholder round-trips to null');
  assert.equal(c.parsePlannedDur('0'), 0, 'a typed 0 is a decision');
  assert.equal(c.parsePlannedDur('0:00'), 0, 'and so is a typed 0:00');
  assert.equal(c.parsePlannedDur('1:30'), 90, 'otherwise it parses exactly like every other duration');
  assert.equal(c.parseDur(''), 0,
    'parseDur is UNCHANGED — every other duration field wants blank-means-zero');
});

test('clockSpanMinutes refuses a span that does not fit in one day', () => {
  const c = make();
  const day = c.startOfToday();
  // hasStartTime/hasEndTime DERIVE a clock from the timestamp when the flags are null, so a plain
  // multi-day window at non-midnight timestamps reads as a "clocked span". Without the day-fit guard
  // this method — whose whole contract is a PER-DAY figure — would hand back 2880 minutes for a 2-day
  // window, and in the new seam `demand` is both the weight AND the cap, so that inflated figure would
  // raise the row's ceiling as well as mis-weighting the day.
  const wide = { id: 'w', name: 'w', start: day + 9 * HOUR, end: day + 2 * DAY + 9 * HOUR,
    startClock: true, endClock: true };
  assert.equal(c.clockSpanMinutes(wide, day), null,
    'a 2-day clocked window is not an appointment; there is no per-day span to read');
  assert.equal(c.requestedMinutes(wide, day), c.DEFAULT_TASK_MINUTES,
    '...so it falls through to the default slice like any other unestimated work');
  const fits = { id: 'f', name: 'f', start: day + 9 * HOUR, end: day + 10 * HOUR,
    startClock: true, endClock: true };
  assert.equal(c.clockSpanMinutes(fits, day), 60,
    'a span that does fit in a day is still read exactly');
});

test('setPlanned writes null for a blank box and 0 for a typed zero', () => {
  const c = make();
  c.state.tasks = [c.normalizeTask({ id: 'p1', name: 'p1', planned: 60 })];
  c.setPlanned('p1', '');
  assert.equal(c.state.tasks[0].planned, null, 'clearing the box retracts the estimate, it does not zero it');
  c.setPlanned('p1', '0');
  assert.equal(c.state.tasks[0].planned, 0, 'typing 0 is a decision to ask the day for nothing');
  c.setPlanned('p1', '2:15');
  assert.equal(c.state.tasks[0].planned, 135, 'and a normal figure still parses as minutes');
});

// ---------------------------------------------------------------------------
// The seam: reserve -> share -> cap.
// ---------------------------------------------------------------------------
// Feature rows exactly as computeAllotted builds them: the task shape plus `spent` and the
// day-resolved `demand`.
function feats(c, specs) {
  return specs.map((s, i) => {
    const r = Object.assign({ id: 'r' + i, spent: 0 }, s);
    r.demand = c.requestedMinutes(r);
    return r;
  });
}

test('the owner report: unestimated tasks no longer starve estimated ones', () => {
  const c = make();
  // The measured middle row of the spec: a 4h pool, 8 unestimated tasks and 2 one-hour tasks.
  // Before the fix the 8 were paid 30m each off the top and the 1-hour tasks got 0.
  const f = feats(c, [
    ...Array.from({ length: 8 }, () => ({ planned: null })),
    { planned: 60 }, { planned: 60 },
  ]);
  const out = c.compressionSeam(f, 240);
  assert.ok(out.r8.allotted > 0, 'a 1-hour task on a busy day gets a share, not nothing');
  assert.ok(out.r9.allotted > 0, 'and so does the other one');
  // By hand: sum(demand) = 8x5 + 2x60 = 160; nothing is reserved, so pool = 240. Every share is
  // demand/160 x 240 = 1.5 x demand, so the cap min(share, demand - spent) binds on every row and
  // each gets exactly its own ask: 5 and 60. Sum = 160, and the remaining 80 minutes stay
  // UNALLOCATED — the deliberate single-pass form.
  assert.equal(out.r8.allotted, 60, 'demand 60 caps the 1.5x share at the hour that was asked for');
  assert.equal(out.r0.allotted, 5, 'and an unestimated row is capped at the default slice');
});

test('the cap: a loose day never inflates a task past its own estimate', () => {
  const c = make();
  // The measured bottom row: a 24h pool, 2 unestimated and 2 one-hour tasks. Before the fix each
  // 1-hour task was handed 690 minutes — 1150% of its planned figure — because `planned` was used
  // only as a WEIGHT and never as a TARGET.
  const f = feats(c, [
    { planned: null }, { planned: null }, { planned: 60 }, { planned: 60 },
  ]);
  const out = c.compressionSeam(f, 24 * 60);
  assert.ok(out.r2.allotted <= 60, 'a 1-hour task is never allotted more than an hour');
  assert.ok(out.r3.allotted <= 60, 'and neither is the other');
  assert.ok(out.r0.allotted <= 5, 'and an unestimated task never draws more than the default slice');
  // By hand: sum(demand) = 5 + 5 + 60 + 60 = 130 against a 1440 pool, so every share is ~11x its
  // demand and the cap binds everywhere. Sum allotted = 130; the other 1310 minutes are real free time.
  assert.equal(out.r2.allotted, 60, 'exactly the hour it asked for');
  assert.equal(out.r0.allotted, 5, 'exactly the default slice it asked for');
});

test('an over-full day still compresses — every row shrinks in proportion', () => {
  const c = make();
  // Deliberate over-subscription stays a FEATURE. The defect was that compression was applied
  // SELECTIVELY; it is still applied when demand genuinely exceeds the pool.
  // By hand: sum(demand) = 120 + 60 + 60 = 240 against a 120 pool, so every share is demand/2 —
  // 60, 30, 30 — and the cap (demand - spent) never binds because every share is below its demand.
  const out = c.compressionSeam(feats(c, [
    { planned: 120 }, { planned: 60 }, { planned: 60 },
  ]), 120);
  assert.equal(out.r0.allotted, 60, 'the 2-hour task keeps half of the halved day');
  assert.equal(out.r1.allotted, 30, 'and the hour tasks are halved too');
  assert.equal(out.r2.allotted, 30, 'proportionally, not selectively');
});

test('no row exceeds its own remaining demand, and the pool is never overdrawn', () => {
  const c = make();
  for (const pool of [30, 120, 240, 480, 1440]) {
    const f = feats(c, [
      { planned: 60, spent: 20 }, { planned: 0 }, { planned: null },
      { planned: 240 }, { predictManual: true, predicted: 45 },
    ]);
    const out = c.compressionSeam(f, pool);
    let flexSum = 0, reservedSum = 0;
    for (const r of f) {
      if (r.predictManual || r.uncompressable) { reservedSum += r.demand; continue; }
      flexSum += out[r.id].allotted;
      assert.ok(out[r.id].allotted <= Math.max(0, r.demand - (r.spent || 0)),
        'row ' + r.id + ' at pool ' + pool + ' outgrew its own remaining ask');
    }
    // The compressible rows share only what the reserve left, so THEIR sum is the invariant the packer
    // depends on. A RESERVED figure is honoured in full even on a day too small to hold it — that is
    // what "off the top, never squeezed" has always meant for predictManual, and it is unchanged here.
    // (The plan's draft asserted total <= pool, which the 45-minute Predict on a 30-minute day below has
    // always violated; the reserve, not the cap, is what puts it over.)
    assert.ok(flexSum <= Math.max(0, pool - reservedSum) + 1e-9,
      'the compressible rows must never overdraw what the reserve left (pool ' + pool + ')');
  }
});

test('a task already worked on today is capped at what REMAINS of its ask', () => {
  const c = make();
  // By hand: one row, demand 60, spent 20, alone on a 480-minute day. Its share is the whole pool,
  // so the binding term is the cap: max(0, 60 - 20) = 40.
  const out = c.compressionSeam(feats(c, [{ planned: 60, spent: 20 }]), 480);
  assert.equal(out.r0.allotted, 40, 'the 20 minutes already worked are not re-allotted');
});

test('a deliberately-zero task is allotted zero and does not draw the default', () => {
  const c = make();
  const out = c.compressionSeam(feats(c, [{ planned: 0 }, { planned: 60 }]), 240);
  assert.equal(out.r0.allotted, 0, 'planned:0 competes normally and is allotted 0');
  assert.equal(out.r1.allotted, 60, 'and its neighbour is still capped at its own hour');
});

test('an uncompressable row is reserved off the top at its full demand', () => {
  const c = make();
  const out = c.compressionSeam(feats(c, [
    { planned: 90, uncompressable: true }, { planned: 60 }, { planned: 60 },
  ]), 120);
  assert.equal(out.r0.allotted, 90, 'reserved = the figure, never squeezed');
  assert.ok(out.r1.allotted + out.r2.allotted <= 30,
    'the rest share only what the reserve left behind');
  // By hand: pool = 120 - 90 = 30, sum(compressible demand) = 120, so each share is 60/120 x 30 = 15.
  assert.equal(out.r1.allotted, 15, 'half of the 30 minutes the reserve left');
  assert.equal(out.r2.allotted, 15, 'and the other half');
});

test('a predictManual row is still reserved off the top at exactly its figure', () => {
  const c = make();
  // By hand: 45 reserved, pool = 240 - 45 = 195, one compressible row of demand 60 -> share 195,
  // capped at 60.
  const out = c.compressionSeam(feats(c, [
    { predictManual: true, predicted: 45, planned: 600 }, { planned: 60 },
  ]), 240);
  assert.equal(out.r0.allotted, 45, 'a typed Predict is a promise, not a share to shave');
  assert.equal(out.r1.allotted, 60, 'and the rest of the day divides what the promise left');
});

test('reserved demand larger than the day leaves the compressible rows nothing', () => {
  const c = make();
  // pool = max(0, 60 - 300) = 0, so every compressible share is 0. The reserve is still honoured in
  // full: sum allotted may exceed availableMinutes ONLY through reserved rows, which is what
  // "reserved off the top, never squeezed" means, and is unchanged from predictManual's old contract.
  const out = c.compressionSeam(feats(c, [
    { planned: 300, uncompressable: true }, { planned: 60 },
  ]), 60);
  assert.equal(out.r0.allotted, 300, 'the reserve is not squeezed by a day too small to hold it');
  assert.equal(out.r1.allotted, 0, 'and there is nothing left for anyone else');
});

test('the seam is deterministic', () => {
  const c = make();
  const build = () => feats(c, [{ planned: 50 }, { planned: 50 }, { planned: 50 }]);
  assert.deepEqual(c.compressionSeam(build(), 101), c.compressionSeam(build(), 101),
    'ties break on original position, so two calls on the same input agree');
});

test('apportionment runs AFTER the cap and hands out only whole minutes', () => {
  const c = make();
  // By hand: sum(demand) = 150 against a 101 pool, so each share is 50/150 x 101 = 33.666...; the
  // cap (50) never binds. Largest-remainder: floor = 33 each (99), and the 2 whole minutes left over
  // go to the two largest fractional parts, ties broken on original position -> 34, 34, 33.
  const out = c.compressionSeam(feats(c, [{ planned: 50 }, { planned: 50 }, { planned: 50 }]), 101);
  assert.deepEqual([out.r0.allotted, out.r1.allotted, out.r2.allotted], [34, 34, 33],
    'whole-minute apportionment, not independent rounding');
  // And with the cap binding, the leftover minutes must NOT be pushed onto a capped row: each row
  // asks for 1 minute of a 101-minute day, so the capped total is 3 and 98 minutes stay free.
  const capped = c.compressionSeam(feats(c, [{ planned: 1 }, { planned: 1 }, { planned: 1 }]), 101);
  assert.deepEqual([capped.r0.allotted, capped.r1.allotted, capped.r2.allotted], [1, 1, 1],
    'a leftover whole minute never pushes a row past its own estimate');
});

test('uncompressable derives from the clocks and respects an explicit untick', () => {
  const c = make();
  const day = c.startOfToday();
  const clocked = { id: 'c1', name: 'Work', start: day + 10.5 * HOUR, end: day + 12 * HOUR,
    startClock: true, endClock: true };
  assert.equal(c.isUncompressable(c.normalizeTask(clocked)), true,
    'both clocks → uncompressable by default: an appointment\'s duration is the least sensible thing to squeeze');
  assert.equal(c.isUncompressable(c.normalizeTask({ id: 'd', name: 'Dateless' })), false,
    'no clocks → nothing to hold, so it competes in the pool like everything else');
  assert.equal(c.isUncompressable(c.normalizeTask(Object.assign({}, clocked, { uncompressable: false }))), false,
    'a stored false is a DECISION, not a missing value — it must survive every reload');
});

// Owner, 2026-08-16: "uncompressable should rederive." normalizeTask used to STAMP the derived boolean,
// which answered the question once, at creation, and never again — so adding clock times to an existing
// task left it Flexible. The field is now tri-state and normalizeTask stores nothing.
test('uncompressable re-derives when a task gains clocks later, unless the user has decided', () => {
  const c = make();
  const day = c.startOfToday();
  const t = c.normalizeTask({ id: 'r1', name: 'Later an appointment' });
  assert.equal(t.uncompressable, null, 'normalizeTask stores NOTHING — null is "never decided"');
  assert.equal(c.isUncompressable(t), false, 'with no clocks it derives Flexible');

  Object.assign(t, { start: day + 9 * HOUR, end: day + 10 * HOUR, startClock: true, endClock: true });
  assert.equal(c.isUncompressable(t), true,
    'the same task, now clocked, derives Exact — no re-normalize, no migration, no second edit');

  Object.assign(t, { start: null, end: null, startClock: null, endClock: null });
  assert.equal(c.isUncompressable(t), false, 'and back again when the clocks are removed');

  const decided = Object.assign({}, t, { uncompressable: false,
    start: day + 9 * HOUR, end: day + 10 * HOUR, startClock: true, endClock: true });
  assert.equal(c.isUncompressable(decided), false,
    'an explicit Flexible outranks the derivation — deciding is what stops the re-derivation');
  assert.equal(c.isUncompressable({ id: 'x', uncompressable: true }), true,
    'and an unclocked task can be declared Exact, which nothing about the clocks can undo');
});

test('uncompressable derives true only for an APPOINTMENT-shaped span, not any two clocks', () => {
  const c = make();
  const day = c.startOfToday();
  // hasStartTime/hasEndTime derive a clock from the timestamp, so a plain multi-day window whose
  // endpoints happen to sit at 09:00 reads as "both clocks". Defaulting it to uncompressable put it on
  // the seam's RESERVE path — full ask off the top of the pool — while its >1-day span means isFixedOn
  // never treats it as an appointment, so it reserved against EVERY day. Same trap clockSpanMinutes
  // documents; the default now shares that day-fit predicate.
  const wide = { id: 'w1', name: 'Multi-day', start: day + 9 * HOUR, end: day + 2 * DAY + 9 * HOUR,
    startClock: true, endClock: true };
  assert.equal(c.clockSpanMinutes(wide), null,
    'precondition: the shared predicate already rejects a span that cannot fit in a day');
  assert.equal(c.isUncompressable(c.normalizeTask(wide)), false,
    'a 2-day window with incidental times is not an appointment and must not reserve off the top');
  const sameDay = { id: 'w2', name: 'Appt', start: day + 9 * HOUR, end: day + 10 * HOUR,
    startClock: true, endClock: true };
  assert.equal(c.isUncompressable(c.normalizeTask(sameDay)), true,
    'a genuine same-day clocked appointment still derives uncompressable');
  assert.equal(c.isUncompressable(c.normalizeTask(Object.assign({}, wide, { uncompressable: true }))), true,
    'an explicit true on a multi-day span SURVIVES — the day-fit rule governs the DEFAULT only, ' +
    'and a user decision is never overridden by the derivation');
});

test('recurring appointments derive Exact only on their real occurrence day', () => withNow(() => {
  const c = make();
  cleanDay(c, '02:00');
  const monday = c.startOfToday();
  const thursday = monday + 3 * DAY;
  const friday = thursday + DAY;
  const appointment = c.normalizeTask({
    id: 'weekly', name: 'Weekly appointment', included: true, planned: null,
    start: monday - 4 * DAY + 14 * HOUR, end: monday - 4 * DAY + 15 * HOUR,
    startClock: true, endClock: true,
    recur: { kind: 'week', n: 1, shifts: [], overrides: {} },
  });
  const first = activeTask(c, { id: 'first', included: true, planned: 60 });
  const second = activeTask(c, { id: 'second', included: true, planned: 60 });
  c._horizon = monday + 14 * DAY;

  assert.equal(c.occOnDay(appointment, monday), null,
    'an honest day lookup says there is no Monday occurrence instead of returning Thursday');
  assert.equal(c.isUncompressable(appointment, monday), false,
    'a recurring appointment is Flexible on a day when it does not occur');
  assert.equal(c.isUncompressable(appointment, thursday), true,
    'the same appointment is still Exact on its real occurrence day');
  assert.equal(c.isFixedOn(appointment, thursday), true,
    'and its real occurrence remains a fixed block');
  assert.equal(c.dueMsOf(appointment, friday), friday + DAY,
    'a non-occurrence day gets that day\'s neutral deadline, never the prior occurrence\'s past due instant');

  const allotted = c.computeAllotted([appointment, first, second], monday);
  assert.deepEqual(
    [allotted.weekly.allotted, allotted.first.allotted, allotted.second.allotted],
    /* UI revamp block 5 (owner walk 2026-10-04): this used to pin [5, 58, 57] — the absent appointment
       competing as a 5-minute flexible default on a day it does not occur. The owner's rule is that a
       repeat receives time only on its occurrence days, so on Monday it now holds nothing at all. */
    [0, 60, 60],
    'the absent appointment takes nothing on a day it does not occur, and reserves nothing off the top');

  const stored = Object.assign({}, appointment, { uncompressable: true });
  assert.equal(c.isUncompressable(stored, monday), true,
    'a stored Exact decision still outranks day-aware derivation on every day');
}));

test('isFixedOn is gated by uncompressable — an unticked appointment compresses', () => {
  const c = make();
  const day = c.startOfToday();
  const base = c.normalizeTask({ id: 'c1', name: 'Work', included: true,
    start: day + 10.5 * HOUR, end: day + 12 * HOUR, startClock: true, endClock: true });
  assert.equal(c.isFixedOn(base, day), true, 'ticked, it is a fixed block as before');
  const loose = Object.assign({}, base, { uncompressable: false });
  assert.equal(c.isFixedOn(loose, day), false,
    'unticked, it leaves the fixed path and joins the seam\'s compressible set');
  assert.equal(c.notBeforeMsOf(loose, day), day + 10.5 * HOUR,
    'but its START still holds — notBeforeMsOf is deliberately untouched, so only the end floats');
});

test('an uncompressable row reserves its REMAINING demand, a predictManual row the figure typed', () => {
  const c = make();
  // 90-minute uncompressable task, 40 minutes of it already worked today. It still needs 50 minutes,
  // so 50 is what the day must set aside: 90 would double-book the 40 already in the day's ledger.
  // Precedent: V5 block 34 — "what is freed is the REMAINING demand only; minutes already spent today
  // stay spent." `allotted` means "minutes still to schedule today" everywhere else in computeAllotted.
  const u = c.compressionSeam([{ id: 'u', demand: 90, spent: 40, uncompressable: true }], 600);
  assert.equal(u.u.allotted, 50,
    'reserved off a checkbox = demand − spent; ticking a part-worked task must not re-reserve the whole');
  const m = c.compressionSeam([{ id: 'm', demand: 90, spent: 40, predictManual: true }], 600);
  assert.equal(m.m.allotted, 90,
    'a re-typed figure means "this much MORE" — predictManual keeps its historic verbatim behaviour');
  // The pool must shrink by what was actually reserved, not by the raw ask: 600 − 50 = 550 for the flex row.
  const mix = c.compressionSeam([
    { id: 'u', demand: 90, spent: 40, uncompressable: true },
    { id: 'f', demand: 900, spent: 0 },
  ], 600);
  assert.equal(mix.f.allotted, 550, 'the flexible row sees pool = 600 − 50, not 600 − 90');
});

test('a NaN demand cannot poison the day', () => {
  const c = make();
  // Math.max(0, NaN) is NaN, so the old coercion would have propagated it into every share silently.
  const out = c.compressionSeam([{ id: 'bad', demand: NaN, spent: 0 },
    { id: 'ok', demand: 60, spent: 0 }], 600);
  assert.equal(out.bad.allotted, 0, 'a NaN ask is read as zero, not as a poison value');
  assert.equal(out.ok.allotted, 60, 'and its neighbour is unaffected: 60/60 × 600, capped at its own 60');
});

test('uncompressable is mirrored to the backend', () => {
  const c = make();
  assert.ok(c.SYNC_FIELDS().includes('uncompressable'),
    'needs supabase migration 0013 applied FIRST — the 0012 ordering rule');
});

test('a reserved row reports the COUNTERFACTUAL auto value in `computed`, not a copy of `allotted`', () => {
  const c = make();
  // `computed` is documented as "the auto value (for the override toggle)". Two consumers compare it
  // against `allotted`: togglePredictManual (∿/✎ seeds the manual figure from the auto one) and the
  // V4.3 edge-drag `orig` snap-back, which clears the override when a drag lands back on the auto value.
  // Make them equal and a drag-back can never be recognised — it rewrites the override instead.
  //
  // BY HAND. avail = 300. m is predictManual with demand 200; f is flexible with demand 400.
  //   reservedSum = 200 → pool = 300 − 200 = 100; demandSum (compressible) = 400.
  //   m.allotted  = 200 (the typed figure, verbatim, off the top).
  //   m.computed  = the counterfactual: demand back into the sum (400 + 200 = 600), reserve back into
  //                 the pool (300 − 0 other reserves = 300) → share = 200/600 × 300 = 100,
  //                 capped at max(0, 200 − 0) = 200 → 100.
  const out = c.compressionSeam([
    { id: 'm', demand: 200, spent: 0, predictManual: true },
    { id: 'f', demand: 400, spent: 0 },
  ], 300);
  assert.equal(out.m.allotted, 200, 'the reserve is honoured in full');
  assert.equal(out.m.computed, 100, 'and `computed` is the share it would have won had it competed');
  assert.notEqual(out.m.computed, out.m.allotted,
    'the two must be able to differ — equal values are what broke the V4.3 drag-back to AUTO');

  // And the counterfactual is the REAL auto value: drop the flag and the row is allotted exactly that.
  const auto = c.compressionSeam([
    { id: 'm', demand: 200, spent: 0 },
    { id: 'f', demand: 400, spent: 0 },
  ], 300);
  assert.equal(auto.m.allotted, out.m.computed,
    'untick the override and the row really is allotted the figure `computed` promised');
});

test('the counterfactual is weighted by the AUTO demand, not by the manual override', () => {
  const c = make();
  // A predictManual row's `demand` IS the typed override, so weighting the counterfactual by it asks
  // "what would I get if I competed while still overriding" — a question nobody asks, and the number it
  // produces grows with the override, so a resized block can never be dragged back to auto.
  // computeAllotted therefore precomputes `autoDemand` = requestedMinutes with the manual branch off.
  //
  // BY HAND. avail = 300. m has planned 100 but a typed override of 200; f is flexible with demand 400.
  //   reservedSum = 200 → pool = 100; demandSum = 400.  m.allotted = 200 (the typed figure).
  //   m.computed  = weight 100 (the AUTO ask): 100/(400+100) × 300 = 60, capped at 100 → 60.
  const out = c.compressionSeam([
    { id: 'm', demand: 200, autoDemand: 100, spent: 0, predictManual: true },
    { id: 'f', demand: 400, spent: 0 },
  ], 300);
  assert.equal(out.m.allotted, 200);
  assert.equal(out.m.computed, 60, 'the override does not inflate the auto value it is measured against');

  // And it is the real auto value: with the override off the row asks for 100 and is allotted exactly 60.
  const auto = c.compressionSeam([
    { id: 'm', demand: 100, spent: 0 },
    { id: 'f', demand: 400, spent: 0 },
  ], 300);
  assert.equal(auto.m.allotted, out.m.computed,
    'untick the override and the row really is allotted the figure `computed` promised');

  // computeAllotted must supply it. Window 00:00–10:00 = 600 min, breakMin 0 (cleanDay), two families:
  // rz asks 100 while overriding to 240, fl asks 500. pool = 600 − 240 = 360, demandSum = 500 → fl 360.
  // rz.computed = 100/(500+100) × 600 = 100, capped at its own 100 → 100.
  cleanDay(c, '10:00');
  const B = c.startOfToday();
  c.state.tasks = [
    activeTask(c, { id: 'rz', start: B - DAY, end: B + DAY, planned: 100, predicted: 240, predictManual: true }),
    activeTask(c, { id: 'fl', start: B - DAY, end: B + DAY, planned: 500 }),
  ];
  const m = c.computeAllotted(c.state.tasks, B);
  assert.equal(m['rz'].allotted, 240, 'the override is honoured');
  assert.equal(m['rz'].computed, 100, 'and `computed` is the auto value the V4.3 drag-back snaps to');
});

// Owner, 2026-08-17: "I wanted it as a column, not as something inside the detail panel."
test('Time needed is a first-class sheet column, sortable on the RESOLVED value', () => {
  const c = make();
  const day = c.startOfToday();
  const keys = c.colDefs().map(col => col.k);
  assert.ok(keys.includes('exact'), 'the column exists in colDefs, so hide/reorder/resize/reset all reach it');
  assert.equal(c.colDefs().find(col => col.k === 'exact').l, 'Time needed',
    'and it carries the same label the detail-panel control does — one name for one concept');
  assert.equal(c.colType('exact'), 'bool',
    'bool, like `incl`: the filter widget is a yes/no, not a number box');
  assert.ok(c.SORT_KEYS().includes('exact'), 'sortable');

  const derived = c.normalizeTask({ id: 'e1', name: 'Appt', start: day + 9 * HOUR, end: day + 10 * HOUR,
    startClock: true, endClock: true });
  const decidedOff = Object.assign({}, derived, { uncompressable: false });
  assert.equal(c.sortValue(derived, 'exact'), 1,
    'a never-decided appointment sorts as Exact — the sort asks the resolved question, not the stored one');
  assert.equal(c.sortValue(decidedOff, 'exact'), 0, 'and an explicit Flexible sorts as Flexible');
  assert.equal(c.sortValue(c.normalizeTask({ id: 'e2', name: 'Bare' }), 'exact'), 0,
    'an unclocked, undecided task sorts as Flexible');
});
