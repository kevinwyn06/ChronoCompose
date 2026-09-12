const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* Owner ask 2026-09-12: the Focus-mode timeline starts at max(day start, now), fills its panel, and
 * never needs a scroll — even with an Unscheduled list. Layout (fill, overflow) is exactly what the mock
 * DOM cannot measure, so it lives here. */

const COL = '[data-focus-timeline]';

// Far more planned time than a day holds, all due today, so the packer must leave tasks unscheduled.
const overbooked = Array.from({ length: 60 }, (_, i) =>
  task('ob' + i, 'Overbooked ' + i, { start: '0d', end: '0d+23h', planned: 600 }));

test('Focus timeline fills its panel, starts at now, and never scrolls with unscheduled tasks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1400, height: 800 });
  await bootSurface(page, { dashMode: 'focus' },
    { tasks: overbooked, settings: { dayStart: '00:00', dayEnd: '23:59', freeTime: 0 } });

  await expect(page.locator(COL + ' [data-tl-fill]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator(COL + ' [data-tl-unsched]')).toBeVisible();
  await expect(page.locator(COL).getByText(/more unscheduled/)).toBeVisible();
  // The slot's measured height feeds back through ResizeObserver, so the fit settles a frame later.
  await expect.poll(() => page.evaluate((sel) => {
    const slot = document.querySelector(sel + ' [data-tl-fill]');
    return Math.abs(slot.clientHeight - slot.firstElementChild.offsetHeight);
  }, COL)).toBeLessThanOrEqual(2);

  const m = await page.evaluate((sel) => {
    const col = document.querySelector(sel);
    const slot = col.querySelector('[data-tl-fill]');
    const scrollers = [col, ...col.querySelectorAll('*')]
      .filter((el) => el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'hidden' && getComputedStyle(el).overflowY !== 'visible');
    return {
      colOverflow: col.scrollHeight - col.clientHeight,
      scrollers: scrollers.length,
      slotH: slot.clientHeight, bodyH: slot.firstElementChild.offsetHeight,
      startHandles: col.querySelectorAll('.pp-daybound').length,
    };
  }, COL);

  expect(m.colOverflow).toBeLessThanOrEqual(1);
  expect(m.scrollers).toBe(0);
  expect(Math.abs(m.slotH - m.bodyH)).toBeLessThanOrEqual(2); // fitted to the slot, not a fixed scale
  expect(m.startHandles).toBe(1); // day start (00:00) is behind now, so only the end handle is on canvas
  expect(errors).toEqual([]);
});
