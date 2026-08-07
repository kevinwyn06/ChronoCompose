const { test, expect } = require('@playwright/test');
const { bootToday, cleanDaySettings, timelineBlocks, settleTimeline, task } = require('./_seed');

/* Dragging a block in the Today timeline (`renderDayColumn` → `blockPointerDown` → `onMouseMove`
   → `onMouseUp` → `pinBlockAt`).

   Why this file exists: block 04 rewrote the drag so the dragged CHUNK's own minutes pin at the drop
   time and the task's remaining minutes repack around the pin. That landed with unit coverage only —
   no browser had ever exercised the gesture, and blocks 05/06 rewrite the same rendering. The unit
   layer (`tests/scheduling.gen.test.js` 18–22) already owns the split/repack arithmetic; this file
   deliberately does NOT re-test it. What is pinned here is the part the mock DOM structurally cannot
   reach: a trusted pointer press on a real block, the 4px promotion threshold, what moves while the
   button is still down, and what the user sees after the release.

   ── Addressing blocks ────────────────────────────────────────────────────────────────────────────
   Timeline blocks carry no `data-*` hook, so `timelineBlocks()` finds them by the three tooltips
   `renderDayColumn` writes ('Drag to pin at a time' / 'Pinned to this day…' / 'Pinned at its clock
   time…'). That is a known fragility: a block-05/06 rewrite that changes a tooltip breaks every test
   here at once, and it will look like a gesture regression when it is a selector regression. Adding a
   `data-` attribute would be a production edit, which this block is not allowed to make.

   ── Reading "minutes" off the screen ─────────────────────────────────────────────────────────────
   A block's height is `max(13, minutes*px - 2)`. The appointment is a known 60 minutes, so it
   calibrates px, and `blockMins()` inverts the formula. Assertions compare a total before a drag with
   the same total after, so an exact px scale never has to be known — only that it did not change,
   which holds because nothing here resizes the pane or touches the zoom buttons. The 13px floor is
   never hit: the smallest fixture block is 60 minutes. */

const WINDOW_END = '10:00';

/* Window 00:00–10:00, an appointment at 02:00–03:00, one flexible task. `allotMode:'today'` hands the
   single flexible task the whole remaining pool, so it is drawn across the appointment and the packer
   splits it: 00:00–02:00 and 03:00–10:00. The split is asserted, never assumed. */
const splitFixture = () => ({
  settings: cleanDaySettings(WINDOW_END),
  tasks: [
    task('appt', 'Standup', { start: '0d+2h', end: '0d+3h', startClock: true, endClock: true, planned: 60 }),
    task('split', 'Split task', { start: '0d', end: '+2d', planned: 120 }),
  ],
});

/* No appointment: two flexible tasks share the pool in proportion to `planned`, so the small one is
   drawn as ONE block and can be dragged without ever being split. */
const soloFixture = () => ({
  settings: cleanDaySettings(WINDOW_END),
  tasks: [
    task('solo', 'Solo task', { start: '0d', end: '+2d', planned: 60, priority: 1 }),
    task('filler', 'Filler task', { start: '0d', end: '+2d', planned: 540, priority: 2 }),
  ],
});

const of = (blocks, name) => blocks.filter((b) => b.title === name);
/** px-per-minute, calibrated off the 60-minute appointment (or any block of known length). */
const pxPerMin = (blocks, name, knownMins) => (blocks.find((b) => b.title === name).h + 2) / knownMins;
/** Minutes a set of blocks draws, inverting `height = minutes*px - 2`. */
const blockMins = (blocks, px) => blocks.reduce((s, b) => s + (b.h + 2) / px, 0);

/**
 * Press a block and drag it down by `dy` viewport px with the real pointer, running `mid` (if given)
 * while the button is still down. `dy` may overshoot the column: `snapPinStart` clamps the drop to
 * `windowEnd - duration`, which is what makes "drag it to the bottom" a drop target that does not
 * depend on the px→minute calibration being right.
 */
async function dragBlock(page, block, dy, mid) {
  await page.mouse.move(block.x + 200, block.y + block.h / 2);
  await page.mouse.down();
  await page.mouse.move(block.x + 200, block.y + block.h / 2 + dy, { steps: 12 });
  if (mid) await mid();
  await page.mouse.up();
  await settleTimeline(page);
}

/** Drag far enough down that the drop always clamps to the bottom of the window. */
const toBottom = (page, block) => page.viewportSize().height - 5 - (block.y + block.h / 2);

test.describe('Today timeline: dragging a scheduled block', () => {
  test('an appointment splits a flexible task into two blocks', async ({ page }) => {
    await bootToday(page, splitFixture());
    const b = await timelineBlocks(page);

    /* The precondition every other test in this file rests on. If the packer stops splitting, these
       tests would still pass while testing something else entirely — so it is asserted here. */
    expect(of(b, 'Split task'), 'the appointment splits the task into two blocks').toHaveLength(2);
    expect(of(b, 'Standup')).toHaveLength(1);
    /* …and the appointment sits between them, which is what makes them two chunks of one task
       rather than two unrelated blocks. */
    const [first, second] = of(b, 'Split task');
    const appt = b.find((x) => x.title === 'Standup');
    expect(first.y).toBeLessThan(appt.y);
    expect(second.y).toBeGreaterThan(appt.y);
  });

  test('dragging the first chunk moves only that chunk — the sibling does not stack onto it', async ({ page }) => {
    await bootToday(page, splitFixture());
    const before = await timelineBlocks(page);
    const [first, second] = of(before, 'Split task');

    let mid = null;
    await dragBlock(page, first, 40, async () => { mid = await timelineBlocks(page); });

    /* This is the regression block 04 fixed: the render used to match the drag by task id alone, so
       EVERY chunk of the dragged task floated to the preview position and they visibly stacked —
       while the button was still down, before any commit. Hence a mid-gesture assertion; nothing
       after the release could see it. */
    const dragging = of(mid, 'Split task');
    expect(dragging, 'both chunks are still drawn during the drag').toHaveLength(2);
    expect(dragging[0].y, 'the two chunks did not collapse onto one position').not.toBeCloseTo(dragging[1].y, 0);

    const wasAt = [first.y, second.y];
    const stayed = dragging.filter((x) => wasAt.some((y) => Math.abs(x.y - y) <= 1));
    const moved = dragging.filter((x) => !wasAt.some((y) => Math.abs(x.y - y) <= 1));
    expect(moved, 'exactly one chunk moved').toHaveLength(1);
    expect(stayed.map((x) => Math.round(x.y)), 'the sibling chunk stayed exactly where it was')
      .toEqual([Math.round(second.y)]);
    expect(moved[0].y, 'the dragged chunk followed the pointer downwards').toBeGreaterThan(first.y);
    /* The appointment is not part of the drag either. */
    const appt = mid.find((x) => x.title === 'Standup');
    expect(appt.y).toBeCloseTo(before.find((x) => x.title === 'Standup').y, 0);
  });

  test('on release the dragged chunk is pinned at the drop and the sibling is still scheduled', async ({ page }) => {
    await bootToday(page, splitFixture());
    const before = await timelineBlocks(page);
    const [first] = of(before, 'Split task');

    await dragBlock(page, first, toBottom(page, first));
    const after = await timelineBlocks(page);

    const mine = of(after, 'Split task');
    const pinned = mine.filter((x) => x.pinned);
    expect(pinned, 'the dragged chunk became a pinned block').toHaveLength(1);
    expect(pinned[0].y, 'at the bottom of the window, where it was dropped').toBeGreaterThan(first.y);
    /* Pinning one chunk must not turn the whole task into fixed work — the rest stays flexible and
       is still drawn somewhere. */
    expect(mine.filter((x) => !x.pinned).length, 'the task\'s other minutes are still scheduled')
      .toBeGreaterThan(0);
    /* And the pinned block advertises its own way out. */
    await expect(page.locator('[title="Unpin (return to flexible scheduling)"]')).toHaveCount(1);
  });

  test('the drag does not change how many minutes the task holds that day', async ({ page }) => {
    await bootToday(page, splitFixture());
    const before = await timelineBlocks(page);
    const px = pxPerMin(before, 'Standup', 60);
    const wasMins = blockMins(of(before, 'Split task'), px);
    const [first] = of(before, 'Split task');

    await dragBlock(page, first, toBottom(page, first));
    const after = await timelineBlocks(page);

    /* The invariant block 04 built the pool arithmetic around: the seam divides the same pool it
       would have divided with no pin at all, so a drag is a MOVE, never a grant of extra time.
       Tolerance is 2 minutes — sub-pixel layout rounding, well under the 15-minute snap step that a
       real arithmetic slip would show up as. */
    expect(Math.abs(blockMins(of(after, 'Split task'), px) - wasMins),
      'pinned + repacked = the same daily minutes').toBeLessThan(2);
    /* Nothing spilled out of the day: the appointment is untouched and still exactly one block. */
    expect(of(after, 'Standup')).toHaveLength(1);
    await expect(page.getByText('⚠ Unscheduled')).toHaveCount(0);
  });

  test('a press that never crosses the 4px threshold does not pin anything', async ({ page }) => {
    await bootToday(page, splitFixture());
    const before = await timelineBlocks(page);
    const [first] = of(before, 'Split task');

    await page.mouse.move(first.x + 200, first.y + first.h / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 200, first.y + first.h / 2 + 3); /* under threshold */
    await page.mouse.up();
    await settleTimeline(page);

    const after = await timelineBlocks(page);
    expect(after.filter((b) => b.pinned), 'nothing was pinned').toHaveLength(0);
    expect(of(after, 'Split task').map((b) => Math.round(b.y)))
      .toEqual(of(before, 'Split task').map((b) => Math.round(b.y)));
  });
});

test.describe('Today timeline: an unsplit task', () => {
  test('drags to a pin, and the unpin ✕ puts it back', async ({ page }) => {
    await bootToday(page, soloFixture());
    const before = await timelineBlocks(page);
    expect(of(before, 'Solo task'), 'fixture: the small task is ONE block').toHaveLength(1);
    const solo = of(before, 'Solo task')[0];
    const filler = of(before, 'Filler task')[0];
    expect(solo.y, 'fixture: it starts above the filler').toBeLessThan(filler.y);
    const px = pxPerMin(before, 'Solo task', 60);
    const wasMins = blockMins(of(before, 'Filler task'), px);

    await dragBlock(page, solo, toBottom(page, solo));
    const after = await timelineBlocks(page);

    const mine = of(after, 'Solo task');
    expect(mine, 'still one block — an unsplit task pins whole').toHaveLength(1);
    expect(mine[0].pinned, 'and it is now a pin').toBe(true);
    expect(mine[0].y, 'dropped below the filler, where it was released')
      .toBeGreaterThan(of(after, 'Filler task')[0].y);
    /* The other task repacked around the pin without gaining or losing time. */
    expect(Math.abs(blockMins(of(after, 'Filler task'), px) - wasMins),
      'the other task neither gained nor lost minutes').toBeLessThan(2);

    /* ── the way back ── */
    await page.locator('[title="Unpin (return to flexible scheduling)"]').click();
    await settleTimeline(page);
    const undone = await timelineBlocks(page);

    expect(undone.filter((b) => b.pinned), 'the pin is gone').toHaveLength(0);
    expect(of(undone, 'Solo task')).toHaveLength(1);
    expect(of(undone, 'Solo task')[0].y, 'and the task is back where flexible packing puts it')
      .toBeCloseTo(solo.y, 0);
    await expect(page.locator('[title="Unpin (return to flexible scheduling)"]')).toHaveCount(0);
  });
});

/* ══ Two defects 04v pinned as `test.fail()`, fixed by 04b — markers removed ══════════════════════
   Neither assertion was changed when the fix landed; only the `test.fail()` markers and the "OBSERVED"
   notes went away. See `.orchestration/04b-drag-recovery.handoff.md`. */

test.describe('Today timeline: pointer fidelity and drop accounting', () => {
  test('a drop that overlaps an appointment does not grant the task extra minutes', async ({ page }) => {
    /* Overlapping an appointment is PERMITTED (owner, 2026-08-04) — `snapPinStart` has no collision
       check on purpose. What 04b fixed is the arithmetic behind it: `computeAllotted` used to add the
       pin's whole span back into the pool, but the minutes it shares with the appointment were never
       free, so the task came out of the drag holding more of the day than it went in with. The pin's
       drawn span and the free time it consumes are now two separate measures. */
    await bootToday(page, splitFixture());
    const before = await timelineBlocks(page);
    const px = pxPerMin(before, 'Standup', 60);
    const wasMins = blockMins(of(before, 'Split task'), px);
    const [first] = of(before, 'Split task');
    const appt = before.find((x) => x.title === 'Standup');

    /* Land the chunk's START 30 minutes inside the appointment. Derived from measured geometry rather
       than a hardcoded pixel count, so it stays a real overlap whatever the column's scale is — and 30
       minutes is comfortably outside PIN_MAGNET (10), so the magnet cannot pull the block flush and
       quietly delete the overlap this test exists to exercise. */
    await dragBlock(page, first, (appt.y + 30 * px) - first.y);
    const after = await timelineBlocks(page);

    expect(after.filter((b) => b.pinned), 'precondition: the drop landed as a pin').toHaveLength(1);
    expect(Math.abs(blockMins(of(after, 'Split task'), px) - wasMins),
      'the day total survives an overlapping drop').toBeLessThan(2);
    await expect(page.getByText('⚠ Unscheduled')).toHaveCount(0);
  });

  test('the dragged block follows the pointer', async ({ page }) => {
    /* `onMouseMove` converts `e.clientY - startClientY` (VIEWPORT px) with `bd.px`, which is
       `_curColPx` — px-per-minute in the app's LOCAL space, inside the `zoom:0.8` wrapper at
       `index.html:191`. The two spaces differ by exactly the zoom factor, so the block used to lag the
       cursor by 20% with the gap growing as the drag got longer. 04b applies the existing `uiPt` scale
       at that one call site; no global zoom value moved. */
    await bootToday(page, splitFixture());
    const before = await timelineBlocks(page);
    const [first] = of(before, 'Split task');

    const dy = 137;
    let mid = null;
    await dragBlock(page, first, dy, async () => { mid = await timelineBlocks(page); });

    /* The dragged chunk is the one that is at NEITHER original position. Picking "the first one that
       is not where `first` was" is not enough: once the block travels far enough it passes its own
       sibling, and the sibling then sorts first and is silently measured instead. */
    const wasAt = of(before, 'Split task').map((x) => x.y);
    const moved = of(mid, 'Split task').filter((x) => !wasAt.some((y) => Math.abs(x.y - y) <= 1))[0];
    /* Tolerance is half the 15-minute snap step in px, plus a pixel of rounding. */
    const px = pxPerMin(before, 'Standup', 60);
    expect(Math.abs((moved.y - first.y) - dy),
      'the block travels the same distance as the pointer').toBeLessThan(7.5 * px + 1);
  });
});

/* ══ 04b: recovery affordances ════════════════════════════════════════════════════════════════════
   Undo was already sound; what was missing was a way out of a drag that is going wrong (Esc), a ✕ big
   enough to hit (HIT_MIN_PX), and a way to re-join a task the day has split (regroup). */

test.describe('Today timeline: recovering from a drag', () => {
  test('Escape mid-drag cancels it — the block snaps back and nothing is pinned', async ({ page }) => {
    await bootToday(page, splitFixture());
    const before = await timelineBlocks(page);
    const [first] = of(before, 'Split task');

    await page.mouse.move(first.x + 200, first.y + first.h / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 200, first.y + first.h / 2 + 137, { steps: 12 });

    /* Precondition: the drag really is in flight, so a passing cancel is not a no-op. Stated as "the
       positions are not the resting ones" rather than "one block moved": a dragged chunk can land on
       top of where its own sibling sits, and a per-block identity check reads that as nothing moving. */
    const resting = of(before, 'Split task').map((b) => Math.round(b.y));
    expect(of(await timelineBlocks(page), 'Split task').map((b) => Math.round(b.y)),
      'precondition: the block is being dragged').not.toEqual(resting);

    await page.keyboard.press('Escape');
    await settleTimeline(page);
    expect(of(await timelineBlocks(page), 'Split task').map((b) => Math.round(b.y)),
      'the block returns to its real start the moment Escape is pressed')
      .toEqual(of(before, 'Split task').map((b) => Math.round(b.y)));

    /* …and the release that follows is a no-op: no pin, no detail panel, nothing to undo. */
    await page.mouse.up();
    await settleTimeline(page);
    const after = await timelineBlocks(page);
    expect(after.filter((b) => b.pinned), 'the cancelled drag pinned nothing').toHaveLength(0);
    expect(after.map((b) => Math.round(b.y))).toEqual(before.map((b) => Math.round(b.y)));
  });

  test('the unpin ✕ is a generous hit target, not just its glyph', async ({ page }) => {
    await bootToday(page, soloFixture());
    const before = await timelineBlocks(page);
    const solo = of(before, 'Solo task')[0];
    await dragBlock(page, solo, toBottom(page, solo));

    const pinned = of(await timelineBlocks(page), 'Solo task')[0];
    expect(pinned.pinned, 'precondition: there is a pin to undo').toBe(true);
    const x = await page.locator('[title="Unpin (return to flexible scheduling)"]').boundingBox();
    /* HIT_MIN_PX is 24 LOCAL px and the app renders inside a `zoom:0.8` wrapper, so 19.2 viewport px
       is the same target. The box also spans the block's full height — the old 16px glyph-as-hit-box
       covered only its top-left corner, on blocks whose height floors at 13px. */
    expect(x.width, 'at least HIT_MIN_PX wide').toBeGreaterThanOrEqual(19);
    /* Full height inside the block's 2px dashed border, so ~4 viewport px short of the outer box. */
    expect(x.height, 'and as tall as the block it sits in').toBeGreaterThanOrEqual(pinned.h - 4);

    /* Behavioural half: click the BOTTOM-left of the block, which the old 16×16 corner box never
       covered, and the pin must still come off. */
    expect(pinned.h, 'fixture: the block is taller than the old corner target').toBeGreaterThan(25);
    await page.mouse.click(pinned.x + 4, pinned.y + pinned.h - 3);
    await settleTimeline(page);
    const undone = await timelineBlocks(page);
    expect(undone.filter((b) => b.pinned), 'the pin came off from the far corner of the target')
      .toHaveLength(0);
    expect(of(undone, 'Solo task')[0].y, 'and the task is back where flexible packing puts it')
      .toBeCloseTo(solo.y, 0);
  });
});

/* Window 00:00–10:00 with a 01:00–02:00 appointment. `Split me` (planned 100) is drawn 00:00–01:00
   and then 02:00–02:40, and `Filler` soaks up the rest of the pool so a contiguous 100-minute slot
   still exists after the appointment — regroup is only offered when the day can actually do it. */
const regroupFixture = () => ({
  settings: cleanDaySettings(WINDOW_END),
  tasks: [
    task('appt', 'Standup', { start: '0d+1h', end: '0d+2h', startClock: true, endClock: true, planned: 60 }),
    task('split', 'Split me', { start: '0d', end: '+2d', planned: 100, priority: 1 }),
    task('filler', 'Filler', { start: '0d', end: '+2d', planned: 440, priority: 2 }),
  ],
});

test.describe('Today timeline: regroup', () => {
  test('re-joins a split task into one contiguous block, after what is in the way', async ({ page }) => {
    await bootToday(page, regroupFixture());
    const before = await timelineBlocks(page);
    expect(of(before, 'Split me'), 'fixture: the appointment splits it').toHaveLength(2);
    const px = pxPerMin(before, 'Standup', 60);
    const wasMine = blockMins(of(before, 'Split me'), px);
    const wasFiller = blockMins(of(before, 'Filler'), px);
    const appt = before.find((b) => b.title === 'Standup');

    await page.locator('[title^="Regroup"]').click();
    await settleTimeline(page);
    const after = await timelineBlocks(page);

    const mine = of(after, 'Split me');
    expect(mine, 'one contiguous block').toHaveLength(1);
    expect(Math.abs(blockMins(mine, px) - wasMine), 'holding the same minutes as its two chunks did')
      .toBeLessThan(2);
    expect(mine[0].pinned, 'held against the packer by a pin, so the ✕ is the way back').toBe(true);
    expect(mine[0].y, 'scheduled after the appointment that was in the way')
      .toBeGreaterThanOrEqual(appt.y + appt.h - 1);
    /* The other task is what moved, and it neither gained nor lost time. */
    expect(Math.abs(blockMins(of(after, 'Filler'), px) - wasFiller),
      'the filler repacked around it without changing size').toBeLessThan(2);
    expect(of(after, 'Standup'), 'the appointment is untouched').toHaveLength(1);
    await expect(page.getByText('⚠ Unscheduled')).toHaveCount(0);
  });

  test('is not offered on a task the day did not split', async ({ page }) => {
    await bootToday(page, soloFixture());
    expect(of(await timelineBlocks(page), 'Solo task'), 'fixture: one block').toHaveLength(1);
    await expect(page.locator('[title^="Regroup"]'),
      'nothing to re-join ⇒ no affordance').toHaveCount(0);
  });
});
