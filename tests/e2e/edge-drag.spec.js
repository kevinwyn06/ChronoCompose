const { test, expect } = require('@playwright/test');
const {
  bootToday, bootDays, cleanDaySettings, timelineBlocks, settleTimeline, dayColumns, task,
} = require('./_seed');

/* V4.2 — two gestures on one timeline block.
     · BODY-drag  → WHEN the work happens (a per-day drag-pin). Unchanged by V4.2; covered here only
                    where the new edge handle could have broken it.
     · EDGE-drag  → HOW MUCH of the day the task gets (a sticky manual allotted override written
                    through the existing `predicted`/`predictManual` pair).

   Why these live in the e2e layer and not in `tests/scheduling.gen.test.js`: the arithmetic already
   does live there (tests 27–29 — the delta→minutes step, which blocks are resizable, and that the
   override sticks while everyone else re-compresses). Nothing there is duplicated here. What is
   pinned here is what only a real browser can show: that the two gestures are actually SEPARATE
   under a trusted pointer, that the handle is a real hit target of the tenet's size, and that a
   press in the block's body still pins rather than resizing. Synthetic MouseEvents would skip
   hit-testing and pointer capture and would prove none of it.

   ── Reading minutes off the screen ──────────────────────────────────────────────────────────────
   The fixtures use `cleanDaySettings`: one window, no meals, no free-time reserve, `breakMin` 0 and
   `packFromNow:false`. The flexible tasks therefore TILE the window exactly, so the drawn blocks sum
   to the window's minutes and calibrate the px scale without needing an appointment to measure. */

const WINDOW_MIN = 600;                 // 00:00–10:00
const SETTINGS = cleanDaySettings('10:00');

/* Two flexible tasks, planned 100 : 500, so the 600-minute pool splits exactly 100 : 500 and neither
   block is ever split (there is no appointment). 100 minutes is comfortably above the
   EDGE_MIN_BLOCK_PX gate, so `Resize me` is guaranteed to offer the handle and `Filler` — the block
   the override has to push around — is guaranteed to be the tall one. */
const resizeFixture = () => ({
  settings: SETTINGS,
  tasks: [
    task('rz', 'Resize me', { start: '0d', end: '+4d', planned: 100, priority: 1 }),
    task('fl', 'Filler', { start: '0d', end: '+4d', planned: 500, priority: 2 }),
  ],
});

const of = (blocks, name) => blocks.filter((b) => b.title === name);
/** px-per-minute, calibrated off the fact that the fixture's blocks tile the whole window. */
const pxPerMin = (blocks) => blocks.reduce((s, b) => s + b.h + 2, 0) / WINDOW_MIN;
/** Minutes a set of blocks draws, inverting `height = minutes*px - 2`. */
const mins = (blocks, px) => blocks.reduce((s, b) => s + (b.h + 2) / px, 0);

/** The edge handle belonging to one task. */
const edgeOf = (page, taskId) => page.locator(`[data-tl-edge-task="${taskId}"]`);

/**
 * Drag a block's bottom EDGE by `dy` viewport px with the real pointer, optionally running `mid`
 * while the button is still down. Grabs the handle at its own centre, so the press lands on the
 * handle and not on the body — which is the distinction under test.
 */
async function dragEdge(page, handleBox, dy, mid) {
  const cx = handleBox.x + handleBox.width / 2;
  const cy = handleBox.y + handleBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 12 });
  if (mid) await mid();
  await page.mouse.up();
  await settleTimeline(page);
}

/** Drag a block's BODY by `dy` viewport px. Presses in the upper quarter, which the handle can never
 *  reach (it is the bottom HIT_MIN_PX of a block at least 3×HIT_MIN_PX tall). */
async function dragBody(page, block, dy) {
  const x = block.x + block.w / 2;
  const y = block.y + block.h / 4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 12 });
  await page.mouse.up();
  await settleTimeline(page);
}

test.describe('Today timeline: body-drag vs edge-drag', () => {
  test('the edge handle is a HIT_MIN_PX target on auto blocks, and is offered on nothing else', async ({ page }) => {
    await bootToday(page, resizeFixture());
    const before = await timelineBlocks(page);

    /* Fixture preconditions, asserted so a later packer change cannot make this file pass while
       measuring something else. */
    expect(of(before, 'Resize me'), 'Resize me is drawn as one block').toHaveLength(1);
    expect(before.every((b) => b.kind === 'auto'), 'both fixture blocks are auto-scheduled').toBe(true);

    const box = await edgeOf(page, 'rz').boundingBox();
    const block = of(before, 'Resize me')[0];
    /* HIT_MIN_PX is 24 LOCAL px inside the app's `zoom:0.8` wrapper — 19.2 viewport px, the same
       number 04b's ✕ spec asserts. The GRIP inside it is 26×3; the target is the strip around it. */
    expect(box.height, 'at least HIT_MIN_PX tall').toBeGreaterThanOrEqual(19);
    /* Full block width inside the block's 1px border — the same inset 04b's ✕ spec allows for. */
    expect(box.width, 'and it spans the block, so it is not a corner target')
      .toBeGreaterThanOrEqual(block.w - 2);
    /* It sits at the BOTTOM edge — the only edge 04b's ✕/⧉ column and the ▶ timer left free. */
    expect(Math.abs((box.y + box.height) - (block.y + block.h)),
      'flush with the block\'s bottom, inside its 1px border').toBeLessThan(2);
    /* It advertises which gesture it is before the button goes down. */
    await expect(edgeOf(page, 'rz')).toHaveCSS('cursor', 'ns-resize');

    /* And it is offered on exactly the blocks whose allotment the compression seam decides — one per
       auto block here, and none once a block has been pinned (a pin's span is the pin's, not an
       allotment this override could move). */
    await expect(page.locator('[data-tl-edge]')).toHaveCount(2);
    await dragBody(page, block, 120);
    const pinned = of(await timelineBlocks(page), 'Resize me').filter((b) => b.pinned);
    expect(pinned, 'precondition: the body-drag pinned it').toHaveLength(1);
    await expect(edgeOf(page, 'rz'), 'a pinned block offers no allotment handle').toHaveCount(0);
  });

  test('a press in the block BODY still repositions it and does not change its minutes', async ({ page }) => {
    await bootToday(page, resizeFixture());
    const before = await timelineBlocks(page);
    const px = pxPerMin(before);
    const block = of(before, 'Resize me')[0];
    const wasMins = mins(of(before, 'Resize me'), px);

    /* The regression the new handle could have caused: a bottom strip that swallowed the press would
       turn every reposition into a resize. Pressing in the upper quarter must still be a body-drag. */
    await dragBody(page, block, 200);
    const after = await timelineBlocks(page);
    const mine = of(after, 'Resize me');

    expect(mine.filter((b) => b.pinned), 'the body-drag pinned the block').toHaveLength(1);
    expect(mine[0].y, 'and moved it down the day').toBeGreaterThan(block.y);
    expect(Math.abs(mins(mine, px) - wasMins), 'a reposition is a MOVE, not a grant of time')
      .toBeLessThan(2);
    await expect(page.getByText('⚠ Unscheduled')).toHaveCount(0);
  });

  test('an edge-drag grows the task\'s minutes and the other task re-compresses to fill the day', async ({ page }) => {
    await bootToday(page, resizeFixture());
    const before = await timelineBlocks(page);
    const px = pxPerMin(before);
    const wasMe = mins(of(before, 'Resize me'), px);
    const wasFiller = mins(of(before, 'Filler'), px);

    const box = await edgeOf(page, 'rz').boundingBox();
    let mid = null;
    await dragEdge(page, box, 140, async () => { mid = await timelineBlocks(page); });

    /* Mid-gesture: the block under the pointer previews its new size before anything is committed. */
    expect(mins(of(mid, 'Resize me'), px), 'the block grows while the button is still down')
      .toBeGreaterThan(wasMe + 20);

    const after = await timelineBlocks(page);
    const nowMe = mins(of(after, 'Resize me'), px);
    const nowFiller = mins(of(after, 'Filler'), px);
    expect(nowMe, 'the release wrote the bigger allotment').toBeGreaterThan(wasMe + 20);
    expect(nowFiller, 'the other task gave the minutes up').toBeLessThan(wasFiller - 20);
    /* Conservation: an edge-drag redistributes the day, it does not invent time. */
    expect(Math.abs((nowMe + nowFiller) - WINDOW_MIN), 'the day still holds exactly its window')
      .toBeLessThan(3);
    expect(Math.abs((nowMe - wasMe) + (nowFiller - wasFiller)),
      'what one task gained the other lost').toBeLessThan(3);
    /* The block was resized, not repositioned: nothing became a pin. */
    expect(after.filter((b) => b.pinned), 'an edge-drag pins nothing').toHaveLength(0);
    await expect(page.getByText('⚠ Unscheduled')).toHaveCount(0);
  });

  test('the override STICKS through a later re-compression', async ({ page }) => {
    await bootToday(page, resizeFixture());
    const px = pxPerMin(await timelineBlocks(page));

    await dragEdge(page, await edgeOf(page, 'rz').boundingBox(), 140);
    const resized = mins(of(await timelineBlocks(page), 'Resize me'), px);

    /* Force a real re-pack rather than a repaint: body-drag the OTHER task to a pin. That is a
       `commit()`, so the whole day is re-allotted and re-packed from scratch. A non-sticky override
       (one that recomputed from `planned`) would collapse back here.
       V4.3: the drag goes UP. Filler is the last block in the window, so a DOWNWARD drag clamps
       straight back to the position it started from — and since V4.3 a release on the original is a
       priority snap that leaves the block AUTO instead of pinning it where it already was, which
       would leave this test with no re-pack to observe. Dragging up is a real move, so it pins. */
    const filler = of(await timelineBlocks(page), 'Filler')[0];
    await dragBody(page, filler, -60);
    const after = await timelineBlocks(page);
    expect(after.filter((b) => b.pinned).length, 'precondition: the re-pack really happened')
      .toBeGreaterThan(0);

    expect(Math.abs(mins(of(after, 'Resize me'), px) - resized),
      'the manual allotment survived a full re-allot + re-pack').toBeLessThan(3);
  });

  test('Escape mid-edge-drag cancels it — nothing is written', async ({ page }) => {
    await bootToday(page, resizeFixture());
    const before = await timelineBlocks(page);
    const px = pxPerMin(before);
    const wasMe = mins(of(before, 'Resize me'), px);

    const box = await edgeOf(page, 'rz').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 140, { steps: 12 });
    expect(mins(of(await timelineBlocks(page), 'Resize me'), px),
      'precondition: the resize is in flight').toBeGreaterThan(wasMe + 20);

    await page.keyboard.press('Escape');
    await settleTimeline(page);
    expect(Math.abs(mins(of(await timelineBlocks(page), 'Resize me'), px) - wasMe),
      'the block snaps back to its computed size').toBeLessThan(2);

    await page.mouse.up();
    await settleTimeline(page);
    expect(Math.abs(mins(of(await timelineBlocks(page), 'Resize me'), px) - wasMe),
      'and the release that follows writes nothing').toBeLessThan(2);
  });
});

test.describe('multi-day grid: the same two gestures in a future column', () => {
  test('an edge-drag in TOMORROW\'s column resizes the block in that column', async ({ page }) => {
    await bootDays(page, 'day4', resizeFixture());
    const cols = await dayColumns(page);
    const tomorrow = cols[1].day;
    const inCol = (blocks, day, name) => blocks.filter((b) => b.day === day && b.title === name);

    const before = await timelineBlocks(page);
    /* Each column tiles its own window with the same two tasks, so the calibration is per column. */
    const px = pxPerMin(before.filter((b) => b.day === tomorrow));
    const wasMe = mins(inCol(before, tomorrow, 'Resize me'), px);
    const wasFiller = mins(inCol(before, tomorrow, 'Filler'), px);
    expect(inCol(before, tomorrow, 'Resize me'), 'fixture: one block per task in each column')
      .toHaveLength(1);

    /* There is one handle per resizable block per column, so address the one inside TOMORROW's
       column through the DOM rather than by task id alone. */
    const handle = page.locator(`[data-tl-col="${tomorrow}"] [data-tl-edge-task="rz"]`);
    await expect(handle).toHaveCount(1);
    await dragEdge(page, await handle.boundingBox(), 120);

    const after = await timelineBlocks(page);
    expect(mins(inCol(after, tomorrow, 'Resize me'), px), 'the block in that column grew')
      .toBeGreaterThan(wasMe + 20);
    expect(mins(inCol(after, tomorrow, 'Filler'), px), 'and its neighbour re-compressed')
      .toBeLessThan(wasFiller - 20);
    expect(after.filter((b) => b.pinned), 'an edge-drag in a future column pins nothing')
      .toHaveLength(0);
  });

  test('a BODY-drag in tomorrow\'s column still pins for tomorrow, not for today', async ({ page }) => {
    await bootDays(page, 'day4', resizeFixture());
    const cols = await dayColumns(page);
    const tomorrow = cols[1].day, today = cols[0].day;
    const before = await timelineBlocks(page);
    const block = before.find((b) => b.day === tomorrow && b.title === 'Resize me');

    /* The gesture 05 proved correct, re-run now that a handle shares the block: pressing the body
       must still be the reposition, and it must still land on the column it was pressed in. */
    await dragBody(page, block, 150);
    const after = await timelineBlocks(page);
    const pins = after.filter((b) => b.pinned);
    expect(pins, 'exactly one pin').toHaveLength(1);
    expect(pins[0].day, 'for tomorrow').toBe(tomorrow);
    expect(pins[0].taskId, 'and it is the block that was grabbed').toBe('rz');
    expect(after.filter((b) => b.day === today && b.pinned), 'today gained nothing').toHaveLength(0);
  });
});
