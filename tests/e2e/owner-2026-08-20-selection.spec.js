const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* Chain A, Task 9 — the two-column Selection layout (spec A5, owner-approved mockup.

   `selectionLayout` is unit-tested for order and collapse. What CANNOT be proven without a browser is
   the part the owner actually objected to: the geometry. Equal column widths, sections that size to
   their content, one scroll container per column, and headers that stick to the top of it are all
   resolved-layout facts — a mock DOM has no box model to measure, so every assertion here reads
   `boundingBox()` or a computed style off a real Chromium mount. */

const col = (page, i) => page.locator(`[data-selcol="${i}"]`);
const bucket = (page, k) => page.locator(`[data-selbucket="${k}"]`);
const head = (page, k) => page.locator(`[data-selhead="${k}"]`);

/* One task in every bucket, and enough of them in Continued to force a scroll.
   `pct` stays 0 everywhere: `dueChipClass` only calls a past due date overdue while the task is
   incomplete, and a completed task leaves the surface entirely. */
const populated = () => [
  task('s-od', 'Late task', { start: '-3d', end: '-2d', included: true }),
  task('s-up', 'Future task', { start: '+4d', end: '+5d', included: null }),
  task('s-sn', 'Snoozed task', { start: '0d', end: '+1d', included: true, snoozeUntil: '+2d' }),
  ...Array.from({ length: 12 }, (_, i) =>
    task('s-c' + i, 'Carried ' + i, { start: '-2d', end: '+3d', included: true })),
];

test.describe('Selection: the two-column layout', () => {
  test('renders exactly two columns, of equal width, in the approved bucket order', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: populated() });

    await expect(page.locator('[data-selcol]')).toHaveCount(2);

    const a = await col(page, 0).boundingBox();
    const b = await col(page, 1).boundingBox();
    /* EQUAL, not merely similar. The slack is the divider border plus sub-pixel rounding, nothing more —
       the rule being pinned is "no width weighting by count", and column 1 here holds far more cards
       than column 2. Any real weighting would show up as tens of pixels, not two. */
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(2);

    const order = await page.locator('[data-selhead]').evaluateAll(
      els => els.map(e => e.getAttribute('data-selhead')));
    expect(order).toEqual(['overdue', 'new', 'continued', 'upcoming', 'snoozed']);

    for (const k of ['overdue', 'new', 'continued']) {
      await expect(col(page, 0).locator(`[data-selbucket="${k}"]`)).toHaveCount(1);
    }
    for (const k of ['upcoming', 'snoozed']) {
      await expect(col(page, 1).locator(`[data-selbucket="${k}"]`)).toHaveCount(1);
    }
  });

  test('a heavier column is not a wider one', async ({ page }) => {
    /* The same surface with the load moved to the OTHER column. If anything weighted width by count,
       these two runs would disagree about which column is wider; both must stay equal. */
    await bootPlan(page, 'select', {
      tasks: Array.from({ length: 14 }, (_, i) =>
        task('u' + i, 'Waiting ' + i, { start: '+4d', end: '+5d', included: null })),
    });
    const a = await col(page, 0).boundingBox();
    const b = await col(page, 1).boundingBox();
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(2);
  });

  test('only Overdue collapses when empty — the column and every other bucket stay', async ({ page }) => {
    await bootPlan(page, 'select', {
      tasks: [task('s-ok', 'Fine task', { start: '0d', end: '+2d', included: true })],
    });

    await expect(bucket(page, 'overdue')).toHaveCount(0);
    await expect(page.locator('[data-selcol]')).toHaveCount(2);
    for (const k of ['new', 'continued', 'upcoming', 'snoozed']) {
      await expect(bucket(page, k)).toHaveCount(1);
    }
    /* An empty bucket says WHAT is empty, because that is the information it exists to carry. The one
       seeded task arrived today, so New is the bucket holding it and the other three are empty. */
    await expect(col(page, 0).getByText('Nothing carried over.')).toHaveCount(1);
    await expect(col(page, 1).getByText('Nothing waiting.')).toHaveCount(1);
    await expect(col(page, 1).getByText('Nothing snoozed.')).toHaveCount(1);
  });

  test('the COLUMN scrolls, sections size to content, and headers stick', async ({ page }) => {
    await bootPlan(page, 'select', { tasks: populated() });

    /* One scroll container per column, and it is the column itself. A bucket that scrolled on its own
       would give every section a fixed share of the height — the equal-vertical-bands shape Task 9
       explicitly rejects, because it starves a busy Continued to give an empty New the same room. */
    const scrollers = await col(page, 0).evaluate(el => {
      const inner = [...el.querySelectorAll('*')]
        .filter(n => /auto|scroll/.test(getComputedStyle(n).overflowY)).length;
      return { self: getComputedStyle(el).overflowY, inner };
    });
    expect(scrollers.self).toMatch(/auto|scroll/);
    expect(scrollers.inner).toBe(0);

    /* Sections size to CONTENT: the tall bucket is taller than the short one, rather than both being
       handed an equal band. */
    const cont = await bucket(page, 'continued').boundingBox();
    const nu = await bucket(page, 'new').boundingBox();
    expect(cont.height).toBeGreaterThan(nu.height);

    /* And the header sticks: scroll the column past the Continued header and it stays pinned to the
       column's top edge instead of travelling off with its cards. */
    await expect(head(page, 'continued')).toHaveCSS('position', 'sticky');
    const colBox = await col(page, 0).boundingBox();
    await col(page, 0).evaluate(el => { el.scrollTop = el.scrollHeight; });
    const headBox = await head(page, 'continued').boundingBox();
    expect(headBox.y).toBeGreaterThanOrEqual(colBox.y - 1);
    expect(headBox.y).toBeLessThan(colBox.y + colBox.height / 2);
  });
});
