const test = require('node:test');
const assert = require('node:assert/strict');
const { make, DAY } = require('./_load.js');

/* Chain A, Task 21 — DIAGNOSIS: why does a task that draws as ONE continuous bar offer the ⧉ regroup
 * control, which exists to rejoin work the day has SPLIT?
 *
 * The owner's shape, verbatim: a fixed task 09:00–16:00 with a routine lunch 12:00–13:00 sitting inside
 * it. The bar looks like one bar. The gate is `mineHere.length > 1`, so if two chunks carry that task's
 * id the control appears whether or not there is a visible gap between them.
 */

const H = 3600000;
const at = (c, h) => c.startOfToday() + h * H;

function ownerShape(c) {
  const B = c.startOfToday();
  // The fixed 9–16 block. `uncompressable` + explicit clocks is what makes it FIXED rather than packed.
  const work = c.normalizeTask({ id: 'work', name: 'Work', type: 'Proportional', included: true,
    start: at(c, 9), end: at(c, 16), startClock: true, endClock: true, uncompressable: true,
    priority: 4, deps: [], pct: 0, planned: 420, spent: 0 });
  // The routine lunch. Since 0a26fe2 (2026-08-19) routines ARE tasks, so this is a second fixed task
  // whose span lands inside the first — which is the whole point of the reproduction.
  const lunch = c.normalizeTask({ id: 'lunch', name: 'Lunch', type: 'Proportional', included: true,
    start: at(c, 12), end: at(c, 13), startClock: true, endClock: true, uncompressable: true,
    priority: 4, deps: [], pct: 0, planned: 60, spent: 0 });
  c.state.tasks = [work, lunch];
  c.state.settings = Object.assign({}, c.state.settings, { packFromNow: false, dayStart: '08:00', dayEnd: '18:00' });
  return B;
}

/* PP-EXT (2026-08-21): every fixture below sets `packFromNow: false` EXPLICITLY. Without it the packer
   starts the flexible remainder at the wall clock instead of at the day start, so these tests passed or
   failed according to the time of day they were run — three of them were red at 11:22am on a tree with
   no relevant change in it. The assertions are about where the packer puts work RELATIVE to a pin, and
   that question only has a fixed answer once the day's start is fixed. */
const mine = (data, id) => data.chunks.filter(x => x.start && x.id === id);
const spans = (list, c) => list.map(x => c.fmtClock(x.start) + '–' + c.fmtClock(x.end)).join(', ');

test('chunk coalesce: a partially pinned task draws ONE bar and counts as one PIECE', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.settings = Object.assign({}, c.state.settings, { packFromNow: false, dayStart: '08:00', dayEnd: '18:00' });
  /* THE REPRODUCTION (Task 21). A partial drag-pin holds the first two hours; the packer places the
     remainder immediately after it. The two pieces ABUT at 10:00 — one continuous bar on screen — but
     they are two chunks carrying the same id, because the pinned piece is pushed into the list AFTER the
     packer's same-id merge has already run. `mineHere.length > 1` was the whole regroup gate, so the ⧉
     appeared on work there was nothing to rejoin. */
  c.state.tasks = [c.normalizeTask({ id: 'work', name: 'Work', type: 'Proportional', included: true,
    start: B, end: B + 3 * DAY, planned: 300, priority: 4, deps: [], pct: 0, spent: 0,
    pin: [{ day: B, start: at(c, 8), dur: 120, partial: true }] })];

  const data = c.buildDayTimeline(B);
  const raw = mine(data, 'work');
  assert.equal(raw.length, 2, 'the two CHUNKS stay: one block per pin record, so ✕ can unpin the pinned '
    + 'minutes and only those');
  const pieces = c.chunkPieces(data.chunks, 'work', (data.points || []).map(p => p.ms));
  assert.equal(pieces.length, 1,
    'but they are one visible PIECE: ' + spans(raw, c) + ' — and that is what "split" has to mean');
  assert.equal(pieces[0].start, raw[0].start);
  assert.equal(pieces[0].end, raw[1].end);
});

test('chunk coalesce: a run split at a keep-clear instant stays split', () => {
  const c = make();
  const B = c.startOfToday();
  /* A Point's clock splits a run on purpose — "no work crosses this moment". Two touching chunks at that
     instant are genuinely two pieces, and folding them would undo the split silently. */
  const chunks = [{ id: 'w', start: at(c, 9), end: at(c, 10) }, { id: 'w', start: at(c, 10), end: at(c, 11) }];
  assert.equal(c.chunkPieces(chunks, 'w', []).length, 1, 'touching, so one piece');
  assert.equal(c.chunkPieces(chunks, 'w', [at(c, 10)]).length, 2, 'unless the seam is a keep-clear clock');
});

test('chunk coalesce: the day total is unchanged by however the pieces are counted', () => {
  const c = make();
  const B = c.startOfToday();
  c.state.settings = Object.assign({}, c.state.settings, { packFromNow: false, dayStart: '08:00', dayEnd: '18:00' });
  c.state.tasks = [c.normalizeTask({ id: 'work', name: 'Work', type: 'Proportional', included: true,
    start: B, end: B + 3 * DAY, planned: 300, priority: 4, deps: [], pct: 0, spent: 0,
    pin: [{ day: B, start: at(c, 8), dur: 120, partial: true }] })];
  const minutes = mine(c.buildDayTimeline(B), 'work')
    .reduce((n, x) => n + (x.end - x.start) / 60000, 0);
  assert.equal(minutes, 300, 'the accounting invariant 04b established: coalescing moves no minutes');
});

test("chunk coalesce: the owner's literal shape was NOT the reproduction", () => {
  const c = make();
  const B = ownerShape(c);
  /* Recorded because it was the ranked hypothesis and it is FALSE, which is worth as much as the one
     that held. A fixed 09:00–16:00 task with a fixed lunch inside it emits exactly one busy record per
     fixed task (`fixedBlocksToday` returns early after pushing one), and the lunch carries its own id,
     so the work bar is one chunk and the ⧉ correctly stays away. */
  const got = mine(c.buildDayTimeline(B), 'work');
  assert.equal(got.length, 1, 'one fixed task, one chunk: ' + spans(got, c));
});

test('chunk coalesce: genuinely split work still counts as split', () => {
  const c = make();
  const B = c.startOfToday();
  /* A packed task that cannot fit in one run: a fixed appointment sits in the middle of the day and the
     flexible work has to go round it, leaving a REAL gap between two pieces. This is the case the ⧉
     exists for, and it must survive whatever fixes the case above. */
  c.state.settings = Object.assign({}, c.state.settings, { packFromNow: false, dayStart: '09:00', dayEnd: '17:00' });
  c.state.tasks = [
    c.normalizeTask({ id: 'appt', name: 'Appointment', type: 'Proportional', included: true,
      start: at(c, 12), end: at(c, 13), startClock: true, endClock: true, uncompressable: true,
      priority: 1, deps: [], pct: 0, planned: 60, spent: 0 }),
    c.normalizeTask({ id: 'flex', name: 'Flexible work', type: 'Proportional', included: true,
      start: B, end: B + 3 * DAY, priority: 4, deps: [], pct: 0, planned: 300, spent: 0 }),
  ];
  const data = c.buildDayTimeline(B);
  const got = mine(data, 'flex');
  assert.ok(got.length > 1, 'precondition: the appointment really does split it — got ' + spans(got, c));
  const gap = got[1].start - got[0].end;
  assert.ok(gap > 60000, 'and the pieces are visibly apart, not merely adjacent: ' + spans(got, c));
});

test('chunk coalesce: the regroup gate itself is off on one bar and on across a real gap', () => {
  const c = make();
  const B = c.startOfToday();
  const kcOf = (data) => (data.points || []).map(p => p.ms);

  // One continuous bar, however many chunks it is made of: no ⧉.
  c.state.settings = Object.assign({}, c.state.settings, { packFromNow: false, dayStart: '08:00', dayEnd: '18:00' });
  c.state.tasks = [c.normalizeTask({ id: 'work', name: 'Work', type: 'Proportional', included: true,
    start: B, end: B + 3 * DAY, planned: 300, priority: 4, deps: [], pct: 0, spent: 0,
    pin: [{ day: B, start: at(c, 8), dur: 120, partial: true }] })];
  let data = c.buildDayTimeline(B);
  assert.equal(c.chunkPieces(data.chunks, 'work', kcOf(data)).length, 1);

  // Genuinely fragmented work still offers it — the fix must not suppress the button everywhere.
  c.state.settings = Object.assign({}, c.state.settings, { packFromNow: false, dayStart: '09:00', dayEnd: '17:00' });
  c.state.tasks = [
    c.normalizeTask({ id: 'appt', name: 'Appointment', type: 'Proportional', included: true,
      start: at(c, 12), end: at(c, 13), startClock: true, endClock: true, uncompressable: true,
      priority: 1, deps: [], pct: 0, planned: 60, spent: 0 }),
    c.normalizeTask({ id: 'flex', name: 'Flexible work', type: 'Proportional', included: true,
      start: B, end: B + 3 * DAY, priority: 4, deps: [], pct: 0, planned: 300, spent: 0 }),
  ];
  data = c.buildDayTimeline(B);
  assert.ok(c.chunkPieces(data.chunks, 'flex', kcOf(data)).length > 1,
    'work split across a real gap is still split');
});
