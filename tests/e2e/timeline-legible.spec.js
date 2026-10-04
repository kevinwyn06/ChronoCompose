/* UI revamp block 8 — timeline legibility.
 *
 * The unit layer (tests/ui-revamp-timeline.test.js) owns the rules: the compact-chip threshold, the chip
 * layout, the widened hour range, the month ranking and routine folding. What only a live mount can show:
 *   • the Week grid shows every column's Wakeup (at the day start) and Shutdown (near its end) fully —
 *     inside the column body and inside the scrolling viewport, text and all;
 *   • a short block's text is really visible (not covered by its neighbour) and RENDERS at ≥ 11px under
 *     the 0.8 shell zoom;
 *   • Month folds the routines into one line and its "+N more" opens the day's list (real click), which
 *     Escape closes.
 */
const { test, expect } = require('@playwright/test');
const { bootDays, bootToday, bootSurface, task } = require('./_seed');

const DAILY = (o) => Object.assign({ kind: 'day', n: 1, label: 'Daily', shifts: [], overrides: {} }, o || {});
const SECTIONS = [
  { id: 'sec-r', name: 'Routines', order: 0 },
  { id: 'sec-w', name: 'Work', order: 1 },
  { id: 'sec-p', name: 'Projects', order: 2 },
];
const routine = (id, name, h, m, dur) => task(id, name, {
  sectionId: 'sec-r', start: `-20d+${h}h${m}m`, end: null, startClock: true, uncompressable: true,
  planned: null, priority: 3, recur: DAILY({ durMs: dur * 60000 }),
});
const fixture = () => ({
  sections: SECTIONS,
  settings: { allotMode: 'today', packFromNow: false, freeTime: 0, breakMin: 0, dayStart: '07:00', dayEnd: '23:00' },
  tasks: [
    routine('r-wake', 'Wakeup', 7, 0, 15),
    routine('r-lunch', 'Lunch', 12, 30, 45),
    routine('r-dinner', 'Dinner', 17, 30, 45),
    routine('r-ex', 'Exercise', 19, 30, 60),
    routine('r-shut', 'Shutdown', 22, 30, 15),
    /* untimed daily repeats — work, not routines */
    task('d-cap', 'Capstone', { sectionId: 'sec-p', start: '-14d', end: null, planned: 60, priority: 1, recur: DAILY({ durMs: 0 }) }),
    task('d-gre', 'GRE prep', { sectionId: 'sec-p', start: '-14d', end: null, planned: 45, priority: 2, recur: DAILY({ durMs: 0 }) }),
    /* short tasks, all today */
    task('s-mail', 'Reply to department emails', { sectionId: 'sec-w', start: '0d', end: '0d', planned: 15, priority: 3 }),
    task('s-call', 'Call the registrar', { sectionId: 'sec-w', start: '0d', end: '0d', planned: 10, priority: 2 }),
    task('s-form', 'Sign the travel form', { sectionId: 'sec-w', start: '0d', end: '0d', planned: 20, priority: 4 }),
    task('w-long', 'Write the methods section', { sectionId: 'sec-p', start: '0d', end: '+2d', planned: 120, priority: 1 }),
  ],
});

/** Box of an element, its column body (the block's offsetParent) and the scrolling grid, in viewport px. */
async function boxes(locator) {
  return locator.evaluate((el) => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    const body = el.offsetParent;
    const scroller = el.closest('[data-tl-grid]') || body;
    const label = el.querySelector('[data-tl-chip-time]') || el;
    return { block: r(el), body: r(body), scroller: r(scroller), label: r(label), text: (label.textContent || '').trim() };
  });
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1600, height: 900 }); });

test('Week shows every Wakeup and Shutdown fully — the first and last blocks are not clipped', async ({ page }) => {
  await bootDays(page, 'week', fixture());
  for (const id of ['r-wake', 'r-shut']) {
    const blocks = page.locator(`[data-tl-block][data-tl-task="${id}"]`);
    await expect(blocks).toHaveCount(7);
    for (let i = 0; i < 7; i++) {
      const b = await boxes(blocks.nth(i));
      const where = `${id} in column ${i}`;
      expect(b.block.top, `${where}: top inside its column`).toBeGreaterThanOrEqual(b.body.top - 0.5);
      expect(b.block.bottom, `${where}: bottom inside its column`).toBeLessThanOrEqual(b.body.bottom + 0.5);
      expect(b.block.bottom, `${where}: bottom inside the visible grid`).toBeLessThanOrEqual(b.scroller.bottom + 0.5);
      expect(b.block.top - b.body.top, `${where}: not flush against the column top`).toBeGreaterThan(id === 'r-wake' ? 4 : -1);
      expect(b.body.bottom - b.block.bottom, `${where}: not flush against the column bottom`).toBeGreaterThan(id === 'r-shut' ? 4 : -1);
      expect(b.label.bottom, `${where}: its text sits inside the block`).toBeLessThanOrEqual(b.block.bottom + 0.5);
    }
  }
  /* The name is the block's text — the start time rides on an attribute drawn by CSS. */
  await expect(page.locator('[data-tl-task="r-wake"] [data-tl-chip-time]').first()).toHaveAttribute('data-tl-chip-time', '7:00am');
});

test('a short block is a one-line chip whose text is visible and renders at ≥ 11px', async ({ page }) => {
  await bootToday(page, fixture());
  for (const id of ['s-mail', 's-call', 's-form', 'r-wake']) {
    const blk = page.locator(`[data-tl-block][data-tl-task="${id}"]`).first();
    await expect(blk, `${id} is drawn`).toBeVisible();
    await expect(blk).toHaveAttribute('data-tl-compact', '1');
    const m = await blk.evaluate((el) => {
      const span = el.querySelector('[data-tl-chip-time]');
      const b = span.getBoundingClientRect();
      /* Rendered size = computed CSS size × the effective zoom, measured rather than assumed. */
      const zoom = el.getBoundingClientRect().width / el.offsetWidth;
      const fs = parseFloat(getComputedStyle(span).fontSize) * zoom;
      /* Visible = the text's own pixels are not under a neighbour: hit-test three points along the line. */
      const ys = b.top + b.height / 2;
      const hits = [8, 24, 40].map((dx) => { const hit = document.elementFromPoint(b.left + dx, ys); return !!hit && el.contains(hit); });
      return { fs, zoom, hits, h: b.height, text: span.textContent.trim() };
    });
    expect(m.fs, `${id}: rendered font ${m.fs.toFixed(2)}px (zoom ${m.zoom.toFixed(2)})`).toBeGreaterThanOrEqual(11);
    expect(m.hits.every(Boolean), `${id}: its text is not covered by a neighbouring block (${m.hits})`).toBe(true);
    expect(m.text.length).toBeGreaterThan(0);
  }
  /* And a long block is still a regular block. */
  await expect(page.locator('[data-tl-block][data-tl-task="w-long"]').first()).not.toHaveAttribute('data-tl-compact', '1');
});

test('Month folds routines into one line, and "+N more" opens the day; Escape closes it', async ({ page }) => {
  await bootSurface(page, { dashMode: 'overview' }, Object.assign(fixture(), { prefs: { planView: 'month' } }));
  const today = await page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); });
  const cell = page.locator(`[data-pp-month-day="${today}"]`);
  await expect(cell).toBeVisible({ timeout: 15000 });
  await expect(cell.locator('[data-pp-month-routines]'), 'five routines, one line').toHaveAttribute('data-pp-month-routines', '5');
  /* Real work ranks first: the P1 tasks lead the cell. */
  const first = await cell.locator('div > span:nth-child(2)').first().textContent();
  expect(['Capstone', 'Write the methods section']).toContain(first.trim());
  const more = cell.locator('[data-pp-month-more]');
  await expect(more).toBeVisible();
  await more.click();
  const pop = page.locator(`[data-pp-month-pop="${today}"]`);
  await expect(pop).toBeVisible();
  await expect(pop.locator('[data-pp-month-more-item="r-shut"]')).toBeVisible();
  await expect(pop.locator('[data-pp-month-more-item="s-call"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  /* A row opens the task. */
  await more.click();
  await pop.locator('[data-pp-month-more-item="s-call"]').click();
  await expect(pop).toHaveCount(0);
  await expect(page.locator('[data-pp-dialog="detail"]')).toBeVisible();
});
