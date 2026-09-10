const { test, expect } = require('@playwright/test');
const { bootToday, cleanDaySettings, settleTimeline, task } = require('./_seed');

/* PP-EXT (owner 2026-09-10): the red inside-facing rule on a pinned block edge.
 *
 * Owner: *"Give tasks with pins and times a inside facing red border on the side(s) with the pin in the
 * timelines."* The unit layer (`tests/pinned-block-edges.test.js`) owns which edges are fixed and why;
 * what only a live mount can answer is whether the paint actually reaches the block — the rule rides two
 * `inset` layers of a multi-layer `box-shadow` that already carries a drop shadow and the left rail, and
 * a mocked DOM computes no box-shadow at all. `data-tl-fixedge` is asserted alongside it so a failure
 * reads as "the derivation said top" rather than as a colour mystery. */

const WINDOW_END = '10:00';

/* An appointment with both clocks (02:00–03:00) beside a flexible task the packer places itself. */
const fixture = () => ({
  settings: cleanDaySettings(WINDOW_END),
  tasks: [
    task('appt', 'Standup', { start: '0d+2h', end: '0d+3h', startClock: true, endClock: true, planned: 60 }),
    task('flex', 'Flexible task', { start: '0d', end: '+2d', planned: 120 }),
  ],
});

const blockFor = (page, id) => page.locator(`[data-tl-block][data-tl-task="${id}"]`).first();

test('a clock-fixed appointment carries the red rule on both edges; an auto-scheduled block carries none', async ({ page }) => {
  await bootToday(page, fixture());
  await settleTimeline(page);

  const appt = blockFor(page, 'appt');
  await expect(appt).toHaveAttribute('data-tl-fixedge', 'both');

  const shadow = await appt.evaluate((el) => getComputedStyle(el).boxShadow);
  /* Two inset layers, one per edge. The colour resolves to the theme's --tl-pin-edge; asserting the
     COUNT of inset layers plus their direction is what makes this about the rule and not about a hex. */
  const insets = shadow.split(/,(?![^(]*\))/).map((s) => s.trim()).filter((s) => s.includes('inset'));
  expect(insets.length).toBeGreaterThanOrEqual(3); // top edge + bottom edge + the left rail

  const flex = blockFor(page, 'flex');
  await expect(flex).not.toHaveAttribute('data-tl-fixedge', 'both');
  await expect(flex).not.toHaveAttribute('data-tl-fixedge', 'top');
  await expect(flex).not.toHaveAttribute('data-tl-fixedge', 'bottom');
});

test('a drag pin nails both edges of the block it places', async ({ page }) => {
  await bootToday(page, {
    settings: cleanDaySettings(WINDOW_END),
    tasks: [
      task('solo', 'Solo task', { start: '0d', end: '+2d', planned: 60, priority: 1 }),
      task('filler', 'Filler task', { start: '0d', end: '+2d', planned: 540, priority: 2 }),
    ],
  });
  await settleTimeline(page);

  const solo = blockFor(page, 'solo');
  await expect(solo).not.toHaveAttribute('data-tl-fixedge', 'both');

  /* A real pointer drag — a dispatched MouseEvent skips the hit-testing and pointer capture the 4px
     promotion threshold depends on, so it is not evidence for this gesture. */
  const box = await solo.boundingBox();
  await page.mouse.move(box.x + 200, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + box.height / 2 + 120, { steps: 12 });
  await page.mouse.up();
  await settleTimeline(page);

  const pinned = blockFor(page, 'solo');
  await expect(pinned).toHaveAttribute('data-tl-fixedge', 'both');
});
