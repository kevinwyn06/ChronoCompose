/* ACCEPTANCE → AUTOMATION.
 *
 * Owner report, 2026-08-15: *"The contrast is not high enough on the left and right of the percent
 * complete bar, especially for ghost bars which already have a gradient. Or at least visually it's not
 * clear enough. I think I would prefer to add percent complete back as a column which then updates the
 * gantt bars."*
 *
 * The claim under test is the SECOND half of that sentence — "which then updates the gantt bars". The
 * column's existence and its pointer-x maths are proved in the unit layer (`tests/pct-fill-and-column`);
 * what only a browser can show is that a real drag on a sheet cell moves the Gantt bar's green fill and
 * its in-bar readout, on the same commit, with no second write path.
 *
 * Real pointer input throughout: a dispatched MouseEvent skips hit-testing and pointer capture, which is
 * exactly what a drag threshold depends on. Values are read back out of `pp-tasks` — the persisted store,
 * not a render — so a fix that only paints a preview cannot pass.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const fixture = () => ({
  tasks: [
    task('p-long', 'Ship the release', { start: '-2d', end: '+6d', priority: 1, planned: 300, pct: 0 }),
    task('p-other', 'Renew passport', { start: '+1d', end: '+2d', priority: 3, planned: 45 }),
  ],
});

const CELL = '[data-pct-cell="p-long"]';
const FILL = '[data-pct-fill]';
const LABEL = '[data-pct-label]';

async function boot(page) {
  await bootSurface(page, { view: 'gantt' }, fixture());
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.locator(CELL).first().waitFor({ state: 'visible', timeout: 15000 });
}

async function stored(page, id) {
  return page.evaluate((tid) => {
    const raw = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
    return raw.find((t) => t.id === tid) || null;
  }, id);
}

async function cellBox(page) {
  const b = await page.locator(CELL).first().boundingBox();
  if (!b) throw new Error('the % Done cell has no box');
  return b;
}

test.describe('% Done column ⇄ Gantt bar', () => {
  /* The HIT_MIN_PX tenet: the cell is the target, not the numeral drawn on it. Local px, because the
     board sits in a `zoom:0.8` wrapper and a client rect is 0.8× the CSS px the constants are written in. */
  test('the cell is a full-row hit target, not a small control', async ({ page }) => {
    await boot(page);
    const local = await page.locator(CELL).first()
      .evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
    expect(local.h, 'full row height').toBeGreaterThanOrEqual(24);
    expect(local.w, 'and the whole cell width').toBeGreaterThanOrEqual(60);
  });

  test('dragging the cell moves the Gantt bar fill and its readout to the same value', async ({ page }) => {
    await boot(page);
    const before = await stored(page, 'p-long');
    expect(before.pct || 0, 'fixture starts at 0%').toBe(0);

    const c = await cellBox(page);
    const y = c.y + c.height / 2;
    await page.mouse.move(c.x + 2, y);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width * 0.6, y, { steps: 12 });
    await page.mouse.up();

    const after = await stored(page, 'p-long');
    expect(after.pct, 'the drag wrote a percentage').toBeGreaterThan(0);
    expect(after.pct).toBeLessThanOrEqual(100);
    expect(after.start, 'and re-dated nothing').toBe(before.start);
    expect(after.end).toBe(before.end);

    /* The bar reads the same state on the same commit — that is the "which then updates the gantt bars"
       half of the report, and it is asserted on both of the bar's own channels. */
    const fill = page.locator(FILL).first();
    await expect(fill).toHaveAttribute('data-pct-fill', String(after.pct));
    await expect(page.locator(LABEL).first()).toHaveText(after.pct + '%');

    const w = await fill.evaluate((el) => el.style.width);
    expect(w, 'the green fill is drawn at the stored percentage').toBe(after.pct + '%');
  });

  /* A click is the degenerate zero-distance case of the drag, so it must resolve to the value under the
     pointer rather than to the popover the Gantt band opens. Half-way across a 0–100 cell is 50%. */
  test('a single click sets the value at the pointer, snapped to PCT_STEP', async ({ page }) => {
    await boot(page);
    const c = await cellBox(page);
    const y = c.y + c.height / 2;
    await page.mouse.move(c.x + c.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2 + 1, y); /* under the 4px promotion threshold */
    await page.mouse.up();

    const after = await stored(page, 'p-long');
    expect(after.pct, 'a click half-way across is ~50%').toBeGreaterThanOrEqual(40);
    expect(after.pct, 'a click half-way across is ~50%').toBeLessThanOrEqual(60);
    expect(after.pct % 5, 'snapped to PCT_STEP').toBe(0);
  });

  /* A cell press must not also open the detail sheet: `startPctDrag` stops the mousedown, but the release
     still produces a click that would bubble to `rowClick` if the cell did not stop it too. */
  test('setting the value from the cell does not open the detail sheet', async ({ page }) => {
    await boot(page);
    const c = await cellBox(page);
    const y = c.y + c.height / 2;
    await page.mouse.move(c.x + c.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width * 0.8, y, { steps: 10 });
    await page.mouse.up();

    const after = await stored(page, 'p-long');
    expect(after.pct, 'the value was set').toBeGreaterThan(0);
    /* The detail panel has no test id; its "Previous task" control exists nowhere else, so it is the
       identity the rest of the e2e layer uses for "the sheet is open". */
    await expect(page.getByRole('button', { name: 'Previous task' }),
      'and no detail sheet opened').toHaveCount(0);
  });

  /* The numeral is the exact-value path, drawn inside the same hit box rather than beside it. */
  test('clicking the numeral opens the type-a-number popover', async ({ page }) => {
    await boot(page);
    await page.locator(CELL).first().locator('span').first().click();
    await expect(page.getByText('% DONE', { exact: true }), 'the exact-value popover').toBeVisible();
  });

  /* At 0% there is no fill node at all — the bar is wholly base colour, and the extreme needs no special
     case because the boundary coincides with a bar edge. */
  test('a 0% task draws no green fill on its bar', async ({ page }) => {
    await boot(page);
    const before = await stored(page, 'p-other');
    expect(before.pct || 0).toBe(0);
    const fills = await page.locator(FILL).count();
    expect(fills, 'nothing is partially done in the fixture').toBe(0);
  });
});
