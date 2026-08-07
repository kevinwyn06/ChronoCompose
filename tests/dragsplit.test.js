// Serial chain block 11 — a dragged block splits around BLOCKING busy.
//
// Owner, 2026-08-06: *split around it; Alt to overlap.* Block 10 put a resolved boolean `blocking` on
// every busy interval and changed no behaviour; this block is its first consumer.
//
// The geometry is the easy half. The trap is the ACCOUNTING: a drop that lands as several pieces must
// not double-count a minute, and the task's total minutes for the day must be identical before and
// after a drag whether it split or not — the same invariant 04b had to repair. Those tests are the
// second half of this file and they are the point of it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY, withNow } = require('./_load.js');

const H = 3600000, M = 60000;

/* A day 00:00–20:00 with a 12:30–13:00 lunch and nothing else. Lunch is BLOCKING (block 10), so it is
   the obstacle every split test below is written around. */
function lunchDay(c){
  cleanDay(c, '20:00');
  Object.assign(c.state.settings, { lunchStart:'12:30', lunchEnd:'13:00' });
}
const spanMins = recs => Array.from(recs).reduce((a,p)=>a+p.dur, 0);
/* The component runs in a VM sandbox, so the arrays it returns carry the SANDBOX's Array prototype and
   `assert.deepEqual` (strict) rejects them against a host literal even when the values match. Every
   comparison below is therefore made through this host-realm projection. */
const plain = (recs, base) => Array.from(recs, p => [p.start-(base||0), p.dur]);
/* Minutes the timeline actually DRAWS for a task on day B — the screen's answer to "how much of the
   day does this task hold", independent of how many chunks it is drawn in. */
function drawnMins(c, B, id){
  return c.buildDayTimeline(B).chunks
    .filter(ch=>ch.id===id && ch.start)
    .reduce((a,ch)=>a+(ch.end-ch.start)/M, 0);
}

// =======================================================================
// splitDropPieces — pure geometry
// =======================================================================
test('splitDropPieces: a 90-minute drop across a 30-minute lunch becomes two pieces', () => {
  const c = make();
  const B = 0, lunch = [{start:B+12.5*H, end:B+13*H}];
  const out = c.splitDropPieces(B+12*H, 90, lunch, B+20*H);
  assert.deepEqual(plain(out), [[12*H, 30], [13*H, 60]]);
  assert.equal(spanMins(out), 90, 'every dropped minute is still placed — exactly once');
});

test('splitDropPieces: nothing blocking in the way ⇒ one piece at the drop, byte-identical to pre-11', () => {
  const c = make();
  assert.deepEqual(plain(c.splitDropPieces(9*H, 60, [{start:14*H, end:15*H}], 20*H)), [[9*H, 60]]);
});

test('splitDropPieces: a drop INSIDE blocking busy starts after it, never inside it', () => {
  const c = make();
  assert.deepEqual(plain(c.splitDropPieces(12.5*H+10*M, 60, [{start:12.5*H, end:13*H}], 20*H)),
    [[13*H, 60]], 'pushed past the wall, not laid through it');
});

test('splitDropPieces: no piece ever intersects a wall, and pieces never overlap each other', () => {
  const c = make();
  const walls = [{start:12.5*H, end:13*H}, {start:15*H, end:15.5*H}, {start:17*H, end:18*H}];
  const out = c.splitDropPieces(12*H, 300, walls, 20*H);
  assert.equal(spanMins(out), 300);
  const spans = Array.from(out, p=>({start:p.start, end:p.start+p.dur*M}));
  walls.forEach(w=>spans.forEach(s=>assert.ok(s.end<=w.start || s.start>=w.end,
    'piece '+s.start+'-'+s.end+' ran through the wall '+w.start+'-'+w.end)));
  spans.slice(1).forEach((s,i)=>assert.ok(s.start>=spans[i].end, 'pieces are disjoint and in order'));
});

test('splitDropPieces: unsorted and overlapping walls are merged, not double-subtracted', () => {
  const c = make();
  const messy = [{start:13*H, end:14*H}, {start:12.5*H, end:13.5*H}];
  assert.deepEqual(plain(c.splitDropPieces(12*H, 90, messy, 20*H)),
    plain(c.splitDropPieces(12*H, 90, [{start:12.5*H, end:14*H}], 20*H)));
});

test('splitDropPieces: minutes that cannot fit return null, so the caller keeps ONE contiguous pin', () => {
  const c = make();
  /* 120 minutes dropped at 19:00 with a wall at 19:30–20:00: only 30 free minutes remain in the day.
     Placing what fits and discarding the rest would silently delete the task's minutes. */
  assert.equal(c.splitDropPieces(19*H, 120, [{start:19.5*H, end:20*H}], 20*H), null);
  assert.equal(c.splitDropPieces(12*H, 0, [], 20*H), null, 'a zero-length drop has nothing to lay');
});

// =======================================================================
// dropWallsOn — WHICH busy is an obstacle
// =======================================================================
test('dropWallsOn: meals and blocking appointments are walls; background, pins and self are not', () => {
  withNow(() => {
    const c = make(); lunchDay(c);
    const B = c.startOfToday();
    const appt = activeTask(c, { id:'ap', start:B+9*H, end:B+10*H, startClock:true, endClock:true, planned:60 });
    const work = activeTask(c, { id:'wk', start:B+14*H, end:B+18*H, startClock:true, endClock:true, planned:240, blocking:false });
    const other = activeTask(c, { id:'ot', start:B-DAY, end:B+DAY, planned:60, pin:[{day:B, start:B+16*H, dur:60, partial:true}] });
    const me = activeTask(c, { id:'me', start:B-DAY, end:B+DAY, planned:60, pin:[{day:B, start:B+11*H, dur:60, partial:true}] });
    c.state.tasks = [appt, work, other, me];
    const w = c.dropWallsOn(B, 'me');
    const notes = Array.from(w.walls, b=>b.note).sort();
    assert.deepEqual(notes, ['Lunch', appt.name].sort(), 'only blocking busy blocks a drop');
    assert.equal(w.winEnd, B+20*H, 'the window end comes from the same dayIntervals call');
    const wall = id => Array.from(w.walls).some(b=>b.taskId===id);
    assert.ok(!wall('wk'), 'a background "Work" container is worked INSIDE, not around');
    assert.ok(!wall('ot'), 'another hand-placed block may still be overlapped (owner, block 04)');
    assert.ok(!wall('me'), "and a task never splits around its own blocks");
  });
});

// =======================================================================
// pinBlockAt — the drop
// =======================================================================
function dropFixture(){
  const c = make(); lunchDay(c);
  const B = c.startOfToday();
  const t = activeTask(c, { id:'d1', start:B-DAY, end:B+DAY, planned:600 });
  c.state.tasks = [t];
  return {c, B};
}

test('a drop across lunch writes one pin record per piece, and lunch survives between them', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B});
    const pins = c.pinsOf(c.state.tasks[0]);
    assert.equal(pins.length, 2, 'two records — dragBlocksOn already returns a list');
    assert.deepEqual(plain(pins, B), [[12*H, 30], [13*H, 60]]);
    assert.ok(Array.from(pins).every(p=>p.partial), 'both pieces inherit the drag chunk\'s partial-ness');
    const blocks = c.fixedBlocksToday(B, c.state.tasks);
    assert.equal(blocks.length, 2, 'fixedBlocksToday already emits one busy block per record');
    const di = c.dayIntervals(B, null, blocks, []);
    assert.ok(Array.from(di.busy).some(b=>b.note==='Lunch' && b.start===B+12.5*H && b.end===B+13*H),
      'lunch is intact between the two pieces, not overwritten by the drop');
  });
});

test('Alt (opts.free) keeps the drop contiguous, overlap and all — the V4.3 modifier, reused', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B, free:true});
    const pins = c.pinsOf(c.state.tasks[0]);
    assert.equal(pins.length, 1, 'one contiguous span, exactly as before block 11');
    assert.equal(pins[0].dur, 90);
    assert.equal(pins[0].start, B+12*H);
  });
});

test('a drop inside a BACKGROUND appointment stays one block — the Work container is not a wall', () => {
  withNow(() => {
    const c = make(); lunchDay(c);
    const B = c.startOfToday();
    const work = activeTask(c, { id:'wk', start:B+8*H, end:B+11*H, startClock:true, endClock:true, planned:180, blocking:false });
    const t = activeTask(c, { id:'d1', start:B-DAY, end:B+DAY, planned:600 });
    c.state.tasks = [work, t];
    c.pinBlockAt('d1', B+9*H, 60, [], B, {partial:true, origStart:B});
    const pins = c.pinsOf(c.state.tasks.find(x=>x.id==='d1'));
    assert.deepEqual(plain(pins, B), [[9*H, 60]],
      'dropped inside the workday container and left there, in one piece');
  });
});

test('a drop clear of every wall is unchanged by block 11', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    c.pinBlockAt('d1', B+9*H, 60, [], B, {partial:true, origStart:B});
    assert.deepEqual(plain(c.pinsOf(c.state.tasks[0]), B), [[9*H, 60]]);
  });
});

test('a split drop is ONE undoable edit', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    const before = c.history.length;
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B});
    assert.equal(c.history.length, before+1, 'one commit(), not one per piece');
    c.undo();
    assert.equal(c.pinsOf(c.state.tasks[0]).length, 0, 'undo takes the whole placement back');
  });
});

test('re-dragging one piece of a split drop replaces only that piece', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B});
    const [first, second] = c.pinsOf(c.state.tasks[0]);
    c.pinBlockAt('d1', B+16*H, first.dur, [], B, {partial:true, origStart:first.start});
    const pins = Array.from(c.pinsOf(c.state.tasks[0])).sort((a,b)=>a.start-b.start);
    assert.deepEqual(plain(pins, B), [[13*H, 60], [16*H, 30]],
      'the sibling piece is untouched — (day,start) is still the pin identity');
    assert.equal(second.start, B+13*H);
  });
});

// =======================================================================
// THE ACCOUNTING — the trap, not the geometry
// =======================================================================
test("a split drop does not change the task's minutes for the day", () => {
  withNow(() => {
    const {c, B} = dropFixture();
    const was = c.computeAllotted(c.state.tasks)['d1'].allotted;
    const wasDrawn = drawnMins(c, B, 'd1');
    assert.equal(was, 1170, 'fixture: a 20-hour window minus a 30-minute lunch');
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B});
    assert.equal(c.computeAllotted(c.state.tasks)['d1'].allotted, was,
      'the seam divides the SAME pool it would have divided with no pin at all');
    assert.equal(drawnMins(c, B, 'd1'), wasDrawn, 'and the screen draws the same number of minutes');
  });
});

test('Alt-overlapping the same drop also leaves the day total unchanged (04b, re-verified)', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    const was = c.computeAllotted(c.state.tasks)['d1'].allotted;
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B, free:true});
    assert.equal(c.computeAllotted(c.state.tasks)['d1'].allotted, was,
      'the minutes shared with lunch were never free, so they are not added back');
  });
});

test('netBusyClaim attributes each minute of a split drop exactly once', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B});
    const di = c.dayIntervals(B, null, c.fixedBlocksToday(B, c.state.tasks), []);
    const claim = c.netBusyClaim(di.busy, b=>b.taskId==='d1', di.lo, di.winEnd);
    assert.equal(claim.byTask['d1'], 90, 'both pieces land in free time, so all 90 minutes count');
    assert.equal(claim.total, 90, 'and none of them counts twice');
  });
});

test('the split never claims a minute lunch already owns', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    /* Contrast: Alt-dropped, the same 90 minutes overlap lunch by 30, and only 60 were ever free. */
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B, free:true});
    const di = c.dayIntervals(B, null, c.fixedBlocksToday(B, c.state.tasks), []);
    assert.equal(c.netBusyClaim(di.busy, b=>b.taskId==='d1', di.lo, di.winEnd).total, 60,
      'the 30 minutes shared with lunch were never free time to claim');
  });
});

test('a WHOLE-task pin that splits keeps all of its minutes (the per-block overwrite regression)', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    /* No `partial` ⇒ the pre-04 whole-task pin. computeAllotted used to ASSIGN the fixed minutes per
       block, which was right while a whole pin was always one record; with pieces, the last one would
       have overwritten the first and shrunk the task's day from 90 minutes to 60. */
    c.pinBlockAt('d1', B+12*H, 90, [], B);
    const pins = c.pinsOf(c.state.tasks[0]);
    assert.equal(pins.length, 2);
    assert.ok(Array.from(pins).every(p=>!p.partial), 'still a whole-task pin, just in two pieces');
    const m = c.computeAllotted(c.state.tasks)['d1'];
    assert.equal(m.fixed, true);
    assert.equal(m.allotted, 90, 'the pieces accumulate — 30 + 60, not just the last one');
    assert.equal(drawnMins(c, B, 'd1'), 90);
    assert.equal(c.hasFullDragPinToday(c.state.tasks[0], B), true,
      'every record is whole, so the task is still fully hand-placed for the day');
  });
});

// =======================================================================
// the way back
// =======================================================================
test('unpinning a split WHOLE pin takes the whole placement off in one ✕', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    c.pinBlockAt('d1', B+12*H, 90, [], B);
    c.unpinBlock('d1', B, B+12*H);
    assert.equal(c.state.tasks[0].pin, null,
      'one gesture placed it, so one ✕ takes it back — not piece by piece');
  });
});

test('unpinning a PARTIAL piece still removes only that record', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B});
    c.unpinBlock('d1', B, B+12*H);
    assert.deepEqual(plain(c.pinsOf(c.state.tasks[0]), B), [[13*H, 60]],
      'partial pins are separate chunks by construction');
  });
});

test('a pin on another day is never touched by a split drop', () => {
  withNow(() => {
    const {c, B} = dropFixture();
    c.state.tasks[0].pin = [{day:B+DAY, start:B+DAY+9*H, dur:45}];
    c.pinBlockAt('d1', B+12*H, 90, [], B, {partial:true, origStart:B});
    const other = Array.from(c.pinsOf(c.state.tasks[0])).filter(p=>p.day===B+DAY);
    assert.deepEqual(other.map(p=>p.dur), [45]);
  });
});
