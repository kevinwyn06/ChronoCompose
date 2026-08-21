// Owner rulings, 2026-08-21 — rulings 2 and 5, the two halves of one report.
//
// Owner: *"the (x) is always present when the pin is present, so there's extraneous info there ...
// (x) survives."* Two separate defects hide in that sentence, and fixing either alone leaves the
// complaint standing:
//
//   Ruling 2 — the (x) appears on blocks the user did not really move. `blockOverridden` is
//   action-driven: ANY pin record for the day counts as an override, including one that names exactly
//   the position the packer would have chosen anyway. V4.3's original-magnet already hands the pin back
//   when the release lands on the snap (`bd.atOrig`), but an Alt-free placement, or any drop that simply
//   coincides with the auto position, leaves a no-op pin behind. The owner chose the CHEAP fix — refuse
//   to write such a pin — over re-packing per block at render time.
//
//   Ruling 5 — two marks say the same thing. 📍 (drag-pin) is redundant with the (x) beside it; 📌
//   (fixed window) is not, because such a block carries no (x) at all.
//
// The tests below pin BOTH directions of each, because the failure mode of an over-eager fix is worse
// than the defect: a pin silently discarded when the user DID move the block loses their placement.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { make, activeTask, cleanDay, DAY, withNow } = require('./_load.js');

const H = 3600000;

// One flexible task in an otherwise empty day, so `autoStartFor` has a single, stable answer.
function soloDay(){
  const c = make();
  cleanDay(c, '20:00');
  const B = c.startOfToday();
  const t = activeTask(c, { id:'solo', start:B-DAY, end:B+DAY, planned:60 });
  c.state.tasks = [t];
  return { c, B };
}
/* Projected into the HOST realm: the component runs in a VM sandbox, so the arrays it returns carry the
   sandbox's Array prototype and strict deepEqual rejects them against a host literal even when the
   values match (the same trap tests/dragsplit.test.js documents). */
const dayPins = (c, id, B) => Array.from(
  c.pinsOf((c.state.tasks||[]).find(t=>t.id===id)).filter(p=>p.day===B),
  p => [p.day, p.start, p.dur]);

// =======================================================================
// Ruling 2 — a no-op pin is never written
// =======================================================================

test('a drop at the auto position writes no pin at all', () => {
  withNow(() => {
    const { c, B } = soloDay();
    const auto = c.autoStartFor('solo', B);
    assert.ok(auto != null, 'fixture precondition: the task schedules when unpinned');
    c.pinBlockAt('solo', auto, 60, [], B, {});
    assert.deepEqual(dayPins(c, 'solo', B), [], 'dropping a block where it already was is not an override');
    assert.equal(c.blockOverridden((c.state.tasks||[]).find(t=>t.id==='solo'), B), false,
      'and therefore offers no ✕ — the whole point of the ruling');
  });
});

test('a drop somewhere else still pins, exactly as before', () => {
  withNow(() => {
    const { c, B } = soloDay();
    const auto = c.autoStartFor('solo', B);
    c.pinBlockAt('solo', auto + 3*H, 60, [], B, {});
    const pins = dayPins(c, 'solo', B);
    assert.equal(pins.length, 1, 'a real placement is still recorded');
    assert.equal(pins[0][1], auto + 3*H, 'at the position the user chose');
    assert.equal(c.blockOverridden((c.state.tasks||[]).find(t=>t.id==='solo'), B), true,
      'and it still offers the way back');
  });
});

test('dragging an already-pinned block back to its auto position clears the pin', () => {
  withNow(() => {
    const { c, B } = soloDay();
    const auto = c.autoStartFor('solo', B);
    c.pinBlockAt('solo', auto + 3*H, 60, [], B, {});
    assert.equal(dayPins(c, 'solo', B).length, 1, 'precondition: pinned away from auto');
    // `autoStartFor` re-packs against a copy with this day's pins removed, so it still answers the
    // same question while the old pin is live — that is what makes the return trip detectable.
    assert.equal(c.autoStartFor('solo', B), auto, 'the auto answer is independent of the live pin');
    c.pinBlockAt('solo', auto, 60, [], B, {});
    assert.deepEqual(dayPins(c, 'solo', B), [], 'the return trip removes the override rather than rewriting it');
  });
});

test("a no-op drop leaves other days' pins alone", () => {
  withNow(() => {
    const { c, B } = soloDay();
    const t = (c.state.tasks||[]).find(x=>x.id==='solo');
    t.pin = [{ day:B+DAY, start:B+DAY+9*H, dur:60 }];
    const auto = c.autoStartFor('solo', B);
    c.pinBlockAt('solo', auto, 60, [], B, {});
    const all = c.pinsOf((c.state.tasks||[]).find(x=>x.id==='solo'));
    assert.equal(all.length, 1, 'tomorrow is not this drop\'s business');
    assert.equal(all[0].day, B+DAY);
  });
});

test('a no-op drop on an unpinned block opens no undo entry', () => {
  withNow(() => {
    const { c, B } = soloDay();
    /* `commit()` pushes onto `this.history` (HISTORY_MAX-capped); that stack IS the undo depth. */
    const before = c.history.length;
    assert.ok(before === 0 || before > 0, 'the stack exists — guards this test against silently reading undefined');
    c.pinBlockAt('solo', c.autoStartFor('solo', B), 60, [], B, {});
    assert.equal(c.history.length, before,
      'nothing changed, so there must be nothing to undo — an empty undo entry is a defect of its own');
  });
});

// =======================================================================
// Ruling 5 — one glyph goes, one stays
// =======================================================================

test('blockGlyph: the drag-pin mark is gone, the fixed-window mark stays', () => {
  const c = make();
  assert.equal(c.blockGlyph({ type:'fixed', dragPin:true }), '',
    'a drag-pinned block already carries the ✕; the 📍 beside it was the extraneous half');
  assert.equal(c.blockGlyph({ type:'fixed', dragPin:false }), '\u{1F4CC} ',
    'a fixed window carries no ✕, so its 📌 is the only mark that says the task owns a time');
  assert.equal(c.blockGlyph({ type:'scheduled' }), '', 'auto-packed work is unmarked, as it always was');
  assert.equal(c.blockGlyph({ type:'meal' }), '', 'and so is a meal');
  assert.equal(c.blockGlyph(null), '', 'null is a real input here — chunks without a task reach the renderer');
});
