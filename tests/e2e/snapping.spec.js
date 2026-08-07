const { test, expect } = require('@playwright/test');
const {
  bootToday, cleanDaySettings, timelineBlocks, settleTimeline, task,
} = require('./_seed');

/* V4.3 — snapping: priority snap-to-original, Alt-disable, Reset.

   The arithmetic of all three lives in `tests/scheduling.gen.test.js` (tests 30–33: the precedence of
   the original over the grid and the neighbour magnet on both axes, Alt's bypass, Reset's single
   commit, and undo). Nothing there is repeated here.

   What only a real browser can establish, and therefore all this file holds:
     · Alt-modified dragging. A modifier is a property of TRUSTED input — a dispatched MouseEvent can
       claim `altKey` without the browser ever having had the key down, so it proves nothing about the
       gesture a user performs. `page.keyboard.down('Alt')` + `page.mouse` is the real thing.
     · That the snap-back actually changes the block's FORMATTING (`data-tl-kind`), which is a render
       fact, not a scheduling one.
     · That Reset is a real, tenet-sized hit target that a click reaches.

   Geometry note (same as edge-drag.spec.js): `cleanDaySettings` makes the flexible blocks tile the
   window exactly, so px-per-minute is Σ(h+2) / windowMinutes with no appointment needed as a ruler. */

const WINDOW_MIN = 600;                 // 00:00–10:00
const SETTINGS = cleanDaySettings('10:00');

const fixture = () => ({
  settings: SETTINGS,
  tasks: [
    task('rz', 'Resize me', { start: '0d', end: '+4d', planned: 100, priority: 1 }),
    task('fl', 'Filler', { start: '0d', end: '+4d', planned: 500, priority: 2 }),
  ],
});

const of = (blocks, name) => blocks.filter((b) => b.title === name);
const pxPerMin = (blocks) => blocks.reduce((s, b) => s + b.h + 2, 0) / WINDOW_MIN;
const mins = (blocks, px) => blocks.reduce((s, b) => s + (b.h + 2) / px, 0);
const edgeOf = (page, id) => page.locator(`[data-tl-edge-task="${id}"]`);
const resetOf = (page, id) => page.locator(`[data-tl-reset-task="${id}"]`);

/** Drag from a point by `dy` viewport px with the real pointer, optionally holding Alt throughout. */
async function drag(page, x, y, dy, { alt = false } = {}) {
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 12 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await settleTimeline(page);
}
const dragEdge = (page, box, dy, opts) =>
  drag(page, box.x + box.width / 2, box.y + box.height / 2, dy, opts);
/** Presses in the block's upper quarter, which the bottom edge handle can never reach. */
const dragBody = (page, block, dy, opts) =>
  drag(page, block.x + block.w / 2, block.y + block.h / 4, dy, opts);

test.describe('Today timeline: snapping, Alt and Reset', () => {
  test('Reset restores the computed allotment, is a HIT_MIN_PX target, and Ctrl+Z brings the override back', async ({ page }) => {
    await bootToday(page, fixture());
    const before = await timelineBlocks(page);
    const px = pxPerMin(before);
    const was = mins(of(before, 'Resize me'), px);
    await expect(resetOf(page, 'rz'), 'an auto block offers no Reset — there is nothing to restore').toHaveCount(0);

    await dragEdge(page, await edgeOf(page, 'rz').boundingBox(), 140);
    const seized = mins(of(await timelineBlocks(page), 'Resize me'), px);
    expect(seized, 'precondition: the block was actually resized').toBeGreaterThan(was + 20);

    /* The control appears only once the block carries an override, and it is a real target: the tenet
       is HIT_MIN_PX=24 local px, which is 19.2 viewport px inside the zoom:0.8 wrapper. */
    await expect(resetOf(page, 'rz')).toHaveCount(1);
    const box = await resetOf(page, 'rz').boundingBox();
    expect(box.width, 'Reset is a generous target, not a 16px glyph').toBeGreaterThanOrEqual(19);
    expect(box.height).toBeGreaterThanOrEqual(19);

    await resetOf(page, 'rz').click();
    await settleTimeline(page);
    const after = await timelineBlocks(page);
    expect(Math.abs(mins(of(after, 'Resize me'), px) - was), 'Reset restores the COMPUTED allotment')
      .toBeLessThan(4);
    await expect(resetOf(page, 'rz'), 'and the control retires with the override').toHaveCount(0);
    expect(of(after, 'Resize me')[0].kind, 'the block is auto again').toBe('auto');

    /* Undo is the ordinary history stack — Reset went through commit(), so one Ctrl+Z is enough. */
    await page.keyboard.press('Control+z');
    await settleTimeline(page);
    expect(mins(of(await timelineBlocks(page), 'Resize me'), px), 'Ctrl+Z recovers the seized allotment')
      .toBeGreaterThan(was + 20);
  });

  test('dragging a resized block back to its original size makes it AUTO again, not manual at the same number', async ({ page }) => {
    await bootToday(page, fixture());
    const px = pxPerMin(await timelineBlocks(page));

    await dragEdge(page, await edgeOf(page, 'rz').boundingBox(), 140);
    await expect(resetOf(page, 'rz'), 'precondition: the block is overridden').toHaveCount(1);

    /* Drag the handle back up by the same distance. The priority snap catches it near the computed
       value, and the RELEASE clears the override rather than re-writing the same number — the block
       has to come back as auto, or it would sit out every future re-compression. */
    await dragEdge(page, await edgeOf(page, 'rz').boundingBox(), -140);
    await expect(resetOf(page, 'rz'), 'the override is gone, not merely equal to the computed value').toHaveCount(0);
    const back = of(await timelineBlocks(page), 'Resize me');
    expect(back[0].kind).toBe('auto');
    expect(Math.abs(mins(back, px) - 100), 'and the computed minutes are back').toBeLessThan(6);
  });

  test('a small body-drag snaps back to the original and pins nothing — holding Alt places it freely', async ({ page }) => {
    await bootToday(page, fixture());
    const before = await timelineBlocks(page);
    const block = of(before, 'Resize me')[0];

    /* ~12 viewport px is roughly 11 minutes at this scale: past the 4px promotion threshold, inside
       PIN_ORIG_MAGNET. The priority snap returns it to where it started, so nothing is written. */
    await dragBody(page, block, 12);
    let after = await timelineBlocks(page);
    expect(after.filter((b) => b.pinned), 'a drag that returns to the original pins nothing').toHaveLength(0);
    expect(of(after, 'Resize me')[0].kind, 'and the block keeps its auto formatting').toBe('auto');
    expect(Math.abs(of(after, 'Resize me')[0].y - block.y), 'it did not move').toBeLessThan(2);

    /* Same gesture, Alt held: no snap at all, so the block is placed where the pointer left it. */
    await dragBody(page, of(after, 'Resize me')[0], 12, { alt: true });
    after = await timelineBlocks(page);
    const mine = of(after, 'Resize me')[0];
    expect(after.filter((b) => b.pinned).length, 'Alt disables the snap, so the drop is a real placement')
      .toBeGreaterThan(0);
    expect(mine.kind, 'and the block is now hand-placed').toBe('pinned');
    expect(mine.y, 'it moved down by roughly the pointer distance').toBeGreaterThan(block.y + 6);
  });

  test('a pinned block dragged back to where the app would put it gives its pin back', async ({ page }) => {
    await bootToday(page, fixture());
    const before = await timelineBlocks(page);
    const block = of(before, 'Resize me')[0];

    /* Seize it: a long drag is well outside the magnet, so it pins. */
    await dragBody(page, block, 120);
    let after = await timelineBlocks(page);
    expect(of(after, 'Resize me')[0].kind, 'precondition: hand-placed').toBe('pinned');

    /* Now drag it back up to the top of the day — the position the packer would choose for it. The
       priority snap catches it there and the release UNPINS instead of re-pinning, which is what
       "regains its auto formatting" means for the position axis. */
    await dragBody(page, of(after, 'Resize me')[0], -200);
    after = await timelineBlocks(page);
    expect(after.filter((b) => b.pinned), 'the pin was handed back').toHaveLength(0);
    expect(of(after, 'Resize me')[0].kind).toBe('auto');
    expect(Math.abs(of(after, 'Resize me')[0].y - block.y), 'and it is back where the app had it')
      .toBeLessThan(3);
  });
});
