const { test, expect } = require('@playwright/test');
const { boot, bootToday, cleanDaySettings, task } = require('./_seed');

/* Chain A, Task 20 — drag autoscroll.
 *
 * The ramp arithmetic is unit-tested (`autoScrollStep`). What only a browser has is the thing the
 * feature is FOR: a real scroller with real overflow, and a real pointer held against its edge. The
 * pointer must be moving for the scroll to continue — the helper is driven by move events rather than a
 * timer, deliberately, so a stationary pointer stops and there is no interval to leak — which is why
 * every assertion below jitters the pointer inside the zone rather than parking it there.
 *
 * The plan named three surfaces. A8b deleted the Selection card drag the same day, so there are two:
 * the timeline drawer and the sheet.
 */

const scrollTopOf = (page, sel) => page.locator(sel).first().evaluate(el => el.scrollTop);

/** Hold the pointer in the edge zone and jitter it, so the move-driven scroller keeps stepping. */
async function pressAtEdge(page, x, y, ticks = 14) {
  for (let i = 0; i < ticks; i++) await page.mouse.move(x, y + (i % 2), { steps: 1 });
}

test.describe('Drag autoscroll', () => {
  test('dragging a timeline block to the bottom edge scrolls the drawer, and to the top scrolls back',
    async ({ page }) => {
      /* A tall day at expanded zoom: the drawer must genuinely overflow, or there is nothing to scroll
         and the test would pass by doing nothing. */
      await bootToday(page, {
        settings: cleanDaySettings('23:00'),
        tasks: Array.from({ length: 10 }, (_, i) =>
          task('t' + i, 'Task ' + i, { start: '0d', end: '+3d', planned: 90, priority: 1 })),
      });
      await page.locator('[data-tl-zoom]').click();          // expand: taller hours, real overflow

      const wrap = page.locator('[data-tl-zoom]').locator('..').locator('..')
        .locator('div[style*="overflow"]').first();
      const box = await wrap.boundingBox();
      expect(await scrollTopOf(page, '[data-tl-block]'), 'sanity').toBeDefined();

      const block = page.locator('[data-tl-block]').first();
      const bb = await block.boundingBox();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 4);
      await page.mouse.down();

      const before = await wrap.evaluate(el => el.scrollTop);
      await pressAtEdge(page, bb.x + bb.width / 2, box.y + box.height - 6);
      const down = await wrap.evaluate(el => el.scrollTop);
      expect(down, 'the drawer scrolled down under the drag').toBeGreaterThan(before);

      await pressAtEdge(page, bb.x + bb.width / 2, box.y + 6);
      const up = await wrap.evaluate(el => el.scrollTop);
      expect(up, 'and back up at the other edge').toBeLessThan(down);

      await page.mouse.up();
      const parked = await wrap.evaluate(el => el.scrollTop);
      await page.mouse.move(bb.x + bb.width / 2, box.y + box.height - 6);
      await page.mouse.move(bb.x + bb.width / 2, box.y + box.height - 5);
      expect(await wrap.evaluate(el => el.scrollTop),
        'the drag ended, so the edge is just an edge again').toBe(parked);
    });

  test('dragging a sheet row to the bottom edge scrolls the sheet', async ({ page }) => {
    await boot(page, {
      tasks: Array.from({ length: 40 }, (_, i) =>
        task('r' + i, 'Row ' + i, { start: '0d', end: '+2d', included: true })),
    });

    const sheet = page.locator('[data-task-id]').first()
      .evaluate(el => { let n = el.parentElement;
        while (n && !(n.scrollHeight > n.clientHeight + 8)) n = n.parentElement;
        if (n) n.setAttribute('data-autoscroll-probe', '1');
        return !!n; });
    expect(await sheet, 'the sheet must actually overflow for this to mean anything').toBe(true);

    const probe = page.locator('[data-autoscroll-probe]');
    const box = await probe.boundingBox();
    const row = page.locator('[data-task-id="r0"] [data-task-name]');
    const rb = await row.boundingBox();

    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    /* Past the 4px promotion threshold first: below it this is still a click, not a drag. */
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2 + 12, { steps: 4 });

    const before = await probe.evaluate(el => el.scrollTop);
    await pressAtEdge(page, rb.x + rb.width / 2, box.y + box.height - 6, 18);
    const after = await probe.evaluate(el => el.scrollTop);
    await page.mouse.up();

    expect(after, 'the sheet scrolled while the row was held at its edge').toBeGreaterThan(before);
  });
});
