/* Chain 4 / block 27a — Selection and the Eisenhower matrix rehomed into Overview's LEFT pane.
 *
 * Owner, verbatim: "the selection grid and eisenhower grid should be merged into the overview tab, but
 * not to replace the right panel, but the left one."
 *
 * What belongs HERE rather than in the unit layer. The migration arithmetic (`migrateLeftSurface`), the
 * width floor (`leftPaneMinWidth`) and the remembered split (`leftSplitKey`) are pure and are pinned in
 * `tests/v2-plan-tab.test.js`. What only a browser can answer is whether the rehoming is REAL:
 *   • that both panes are on screen AT ONCE — the whole point of the move, and the one thing the mock
 *     DOM cannot see, since it has no layout and would "pass" with the right pane collapsed to zero;
 *   • that the surface toggle is reachable by trusted pointer input at the owner's 24px hit floor;
 *   • that the triage grid's px floor actually holds at a narrow window, which is a CSS `min()` the
 *     unit layer can only assert as a string.
 *
 * Existing Selection/Matrix behaviour is NOT re-tested here. It is re-pointed at the source: `bootPlan`
 * in `_seed.js` now seeds the new home, so `selection-swap`, `card-drag`, `incl-popover` and
 * `overdue-reschedule` run their original assertions verbatim against the rehomed surface. Rewriting
 * them here would have been the quiet coverage loss this block was told to avoid.
 *
 * Everything gestural is driven with `page.mouse`.
 */
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { boot, bootPlan, task, switchLeftSurface } = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
const shot = (name) => path.join(SHOTS, name);

/* Enough work to fill several origin columns, so the pane is judged at a realistic density rather
   than on an empty board. Relative offsets, per the fixture rule. */
const busy = () => [
  task('ov-1', 'Ship the release notes', { start: '-1d', end: '+1d', priority: 1, included: true }),
  task('ov-2', 'Review the migration', { start: '0d', end: '+2d', priority: 2, included: true }),
  task('ov-3', 'Answer the backlog mail', { start: '0d', end: '+1d', priority: 3, included: true }),
  task('ov-4', 'Draft the quarterly plan', { start: '+2d', end: '+5d', priority: 2 }),
  task('ov-5', 'Learn the new tool', { start: '+3d', end: '+9d', priority: 4 }),
  task('ov-6', 'Fix the flaky check', { start: '-2d', end: '0d', priority: 1, included: true }),
];

const paneBox = (page) => page.locator('[data-left-surface]').boundingBox();

test.describe('Overview left pane: the rehoming', () => {
  test('the triage grid and the scheduling pane are on screen at the same time', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await bootPlan(page, 'select', { tasks: busy() });

    /* The left pane really holds Selection... */
    await expect(page.locator('[data-left-surface="select"]')).toHaveCount(1);
    /* Task 8 retired the Selection drop zones with the card drag; a bucket list is what proves the
       surface is rendered now. */
    await expect(page.locator('[data-selbucket]').first()).toBeVisible();

    /* ...and the right pane is still a scheduling view with real width. "Merged into the left one,
       NOT replacing the right panel" is precisely this assertion: a rehoming that swallowed the whole
       board would satisfy every other check in this file. */
    const left = await paneBox(page);
    const gantt = await page.locator('[data-pp-viewswitch] [data-view-key="gantt"]').boundingBox();
    expect(gantt, 'the scheduling view toggle is still offered').toBeTruthy();
    const viewport = page.viewportSize();
    expect(left.width, 'the left pane does not eat the board')
      .toBeLessThan(viewport.width * 0.8);
    expect(viewport.width - (left.x + left.width), 'the right pane keeps real width')
      .toBeGreaterThan(200);
  });

  /* UI revamp block 1: the retired Dashboard "Plan" tab (Selection/Matrix) stays retired, but the NAME
     Plan now belongs to the one top nav, where it presents dashMode 'overview'. So the guard moves from
     "no Plan tab" to "the top nav is exactly Plan · Focus · Review · Journal, no Overview, and Plan is
     the board that hosts both surfaces". */
  test('the old Plan tab is gone and its two surfaces are reachable from Plan (Overview)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page, { tasks: busy() });

    const nav = page.locator('[data-topnav] [role="tab"]');
    await expect(nav, 'one top nav, four pages').toHaveText(['Plan', 'Focus', 'Review', 'Journal']);
    await expect(page.getByRole('tab', { name: 'Overview', exact: true }),
      'Overview is presented as Plan').toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Plan', exact: true }),
      'the board is the Plan tab').toHaveAttribute('aria-selected', 'true');

    /* Real pointer input on each surface button, and the pane content changes to match. */
    /* V5 block 32: 'matrix' dropped from this sweep — the surface is retired and its button is gone. */
    for (const [key, marker] of [['select', '[data-selbucket]'], ['list', '[data-task-id]']]) {
      const btn = page.locator(`[data-surface-btn="${key}"]`);
      const b = await btn.boundingBox();
      /* Owner tenet: clickboxes are generous, and the glyph is not the hit box. 24 CSS px inside the
         app's zoom:0.8 wrapper renders smaller on the page, so measure against the rendered floor
         rather than re-asserting the constant — a zero-size control is what this is guarding. */
      expect(b.height, `${key} is a real hit target`).toBeGreaterThan(16);
      expect(b.width, `${key} is a real hit target`).toBeGreaterThan(16);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await expect(page.locator(`[data-left-surface] ${marker}`).first()).toBeVisible();
    }
  });

  test('a triage surface holds its own width floor, and does not overwrite the sheet width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await boot(page, { tasks: busy() });

    const listW = (await paneBox(page)).width;
    await switchLeftSurface(page, 'select');
    const selW = (await paneBox(page)).width;
    expect(selW, 'card columns claim more of the board than the sheet does').toBeGreaterThan(listW);

    /* Every rendered column stays readable — the floor block 26 refused to have deleted, re-derived.
       Measured, because the floor is a CSS min() that only the engine resolves. */
    const cols = await page.locator('[data-selbucket]').evaluateAll(
      (els) => els.map((e) => e.getBoundingClientRect().width));
    expect(cols.length, 'several origin columns are on screen').toBeGreaterThan(1);
    cols.forEach((w) => expect(w, 'no column is crushed').toBeGreaterThan(90));

    await switchLeftSurface(page, 'list');
    expect((await paneBox(page)).width, 'the sheet width came back untouched').toBeCloseTo(listW, 0);
  });

  test('the grid survives a narrow window without collapsing the right pane', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await bootPlan(page, 'select', { tasks: busy() });
    const left = await paneBox(page);
    const viewport = page.viewportSize();
    expect(left.width, 'the floor is capped, not unbounded')
      .toBeLessThan(viewport.width * 0.85);
    /* Block 30a removed the quick swap this used to assert on, and task 8 removed the per-column
       Included/Excluded halves that replaced it. The surviving proof that the SURFACE (not just the
       pane) came across is a bucket list, which only Selection renders. */
    await expect(page.locator('[data-selbucket]').first(),
      'the five-bucket partition came across with the surface').toBeVisible();
  });
});

/* --- shots: the owner judges a navigation change by looking ------------------------------------ */

for (const theme of ['light', 'dark']) {
  test(`SHOT: Overview with Selection in the left pane (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await bootPlan(page, 'select', { theme, tasks: busy() });
    await expect(page.locator('[data-selbucket]').first()).toBeVisible();
    await page.screenshot({ path: shot(`27-overview-select-${theme}.png`) });
  });

  /* V5 block 32: the Matrix shot is replaced by its retirement proof — the toggle itself, cropped, so the
     owner can read that it says List · Selection and that nothing is left where Matrix used to sit. */
  test(`SHOT: the left-surface toggle reads List · Selection only (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await bootPlan(page, 'select', { theme, tasks: busy() });
    const toggle = page.locator('[data-left-surface-toggle]');
    await expect(toggle).toBeVisible();
    await expect(toggle.locator('[data-surface-btn]')).toHaveCount(2);
    await expect(toggle.locator('[data-surface-btn="matrix"]')).toHaveCount(0);
    await expect(toggle).toHaveText(/^ListSelection$/);
    await toggle.screenshot({ path: shot(`32-left-surface-toggle-${theme}.png`) });
    await page.screenshot({ path: shot(`32-overview-toggle-context-${theme}.png`) });
  });
}
