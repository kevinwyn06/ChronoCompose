// @ts-check
/* #109 — nothing is highlighted on a fresh load, and Escape clears a selection the user made.
   Owner: *"the default should be nothing is highlighted, and clear selection with Esc."*

   This belongs in the e2e layer and not beside `tests/selection-escape.test.js`, which pins the state
   machine: the claim HERE is about the live mount — that a real key event, delivered by the browser to
   whatever actually has focus, reaches `onKey`'s Escape ladder, and that the row the user clicked stops
   LOOKING selected afterwards. The mock DOM has neither a focus model nor computed styles, so neither
   half is reachable there. Selection is read off the RENDERED row, never out of component state —
   reading state through a back door would only prove the back door works. */
const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

/* Sheet rows only. The same `data-task-id` hook is on Selection cards, which is why
   `activate-dblclick.spec.js` excludes `[data-card-id]` too. */
const rows = (page) => page.locator('[data-task-id]:not([data-card-id])');

/** The rendered background of every sheet row, in DOM order. */
async function rowBackgrounds(page) {
  return page.$$eval('[data-task-id]:not([data-card-id])', (els) => els.map((el) => ({
    id: el.getAttribute('data-task-id'),
    bg: getComputedStyle(el).backgroundColor,
  })));
}

/**
 * The rows the app PAINTS as selected: `sheetRow` fills a selected row with `var(--sel)` and every
 * other row with a hover/zebra token. The token is resolved through a throwaway probe element rather
 * than hard-coded, so this reads whatever the theme currently means by "selected" and cannot go stale
 * against a palette change — and "differs from the row above" is deliberately NOT the test, because
 * zebra striping makes every other row differ from its neighbour.
 */
async function selectedRowIds(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--sel)';
    document.body.appendChild(probe);
    const selBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return Array.prototype.slice.call(document.querySelectorAll('[data-task-id]:not([data-card-id])'))
      .filter((el) => getComputedStyle(el).backgroundColor === selBg)
      .map((el) => el.getAttribute('data-task-id'));
  });
}

/* A single click both selects the row AND opens the detail panel (V2.4 — see
   `activate-dblclick.spec.js`), so the detail sheet is on screen for the first Escape. That is not an
   inconvenience for this spec, it is rung 3 of the ladder arriving for free: the first press must
   close the sheet and leave the row selected, and only the second may clear the row. */
const detailOpen = (page) => page.getByRole('button', { name: 'Previous task' });

test('a fresh load highlights nothing', async ({ page }) => {
  await boot(page);
  await expect(rows(page)).toHaveCount(3);
  expect(await selectedRowIds(page)).toEqual([]);
  await expect(detailOpen(page)).toHaveCount(0);
});

test('Escape closes the detail sheet, then clears the selection, and empty holds', async ({ page }) => {
  await boot(page);
  const clean = await rowBackgrounds(page);

  /* Real trusted input — a click the browser hit-tests, not a dispatched MouseEvent. */
  const row = rows(page).nth(1);
  const box = await row.boundingBox();
  if (!box) throw new Error('row 2 had no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(detailOpen(page)).toBeVisible();
  await expect.poll(() => selectedRowIds(page), { message: 'a click selects the row' }).toEqual(['e2e-2']);

  /* rung 3: the open sheet closes and the selection is untouched by that press */
  await page.keyboard.press('Escape');
  await expect(detailOpen(page)).toHaveCount(0);
  expect(await selectedRowIds(page), 'the row that opened the sheet stays selected').toEqual(['e2e-2']);

  /* rung 4: with nothing open, Escape clears — and the sheet repaints exactly as it loaded */
  await page.keyboard.press('Escape');
  await expect.poll(() => selectedRowIds(page)).toEqual([]);
  /* Park the pointer off the sheet first: `sheetRow` paints `var(--hover)` under the cursor, so the row
     just clicked would still differ from its fresh-load fill for a reason that is not selection. */
  await page.mouse.move(2, 2);
  await expect.poll(() => rowBackgrounds(page),
    { message: 'the sheet repaints exactly as it loaded' }).toEqual(clean);

  /* empty is HOLDABLE: nothing hands the highlight to the first row afterwards */
  await page.keyboard.press('Escape');
  expect(await selectedRowIds(page)).toEqual([]);
  await expect(detailOpen(page)).toHaveCount(0);
});
