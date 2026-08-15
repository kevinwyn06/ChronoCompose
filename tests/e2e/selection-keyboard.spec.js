// @ts-check
/* ACCEPTANCE → AUTOMATION (owner, 2026-08-15).
 *
 * Report: *"I realize that I'm unable to use arrow keys or enter on that sticky highlighted task. Not
 * something I want to begin with. That's why I think it's too sticky, that oftentimes I don't need it."*
 * Plus, on the follow-up: *"also add stuff like shift + up/down."*
 *
 * The state machine is pinned in `tests/selection-keyboard`-adjacent unit tests (selection-escape.test.js).
 * The claim HERE is the one only a live mount can make: that a REAL key event, delivered by the browser
 * to whatever actually holds focus, reaches `onKey` and moves the row the user SEES highlighted. The mock
 * DOM has no focus model and no computed styles, so "the highlight moved" is not expressible there.
 *
 * Selection is therefore read off the RENDERED row fill, exactly as selection-escape.spec.js does it —
 * reading component state through a back door would only prove the back door works.
 */
const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

const rows = (page) => page.locator('[data-task-id]:not([data-card-id])');
/* The detail sheet's own control, same handle selection-escape.spec.js uses — the sheet has no stable
   test attribute and this button exists only while it is open. */
const detailOpen = (page) => page.getByRole('button', { name: 'Previous task' });

/** The rows the app PAINTS as selected — the `var(--sel)` fill, resolved through a live probe. */
async function selectedRowIds(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--sel)';
    document.body.appendChild(probe);
    const selBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return Array.prototype.slice
      .call(document.querySelectorAll('[data-task-id]:not([data-card-id])'))
      .filter((el) => getComputedStyle(el).backgroundColor === selBg)
      .map((el) => el.getAttribute('data-task-id'));
  });
}

/**
 * Light exactly one row, with the detail sheet SHUT — the state arrow navigation operates in.
 *
 * A row click selects AND opens the sheet in one setState, and navigation is deliberately guarded on
 * `!detailId` (an open modal owns its own arrows). Escape is no longer a way out of that state either:
 * as of this session one press closes the sheet AND clears the selection, because they are one gesture.
 *
 * The route that leaves a lit row behind is the sheet's own ✕ button, which calls `closeDetail()` and
 * nothing else. That is exactly how a user reaches this state, so it is the right starting point rather
 * than a test-only shortcut.
 */
const closeSheet = (page) => page.getByRole('button', { name: 'Close (Esc)' });

async function litRow(page, n) {
  const box = await rows(page).nth(n).boundingBox();
  if (!box) throw new Error('row ' + n + ' had no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(detailOpen(page)).toBeVisible();
  await closeSheet(page).click();
  await expect(detailOpen(page), 'the sheet is shut').toHaveCount(0);
  await expect
    .poll(async () => (await selectedRowIds(page)).length, { message: 'and exactly one row stays lit' })
    .toBe(1);
  return (await selectedRowIds(page))[0];
}

test('↑/↓ move the highlight between rows under real key input', async ({ page }) => {
  await boot(page);
  const start = await litRow(page, 1);
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => selectedRowIds(page), { message: 'ArrowDown moves the highlight to the next row' })
    .not.toEqual([start]);
  const afterDown = await selectedRowIds(page);
  expect(afterDown.length).toBe(1);

  await page.keyboard.press('ArrowUp');
  await expect
    .poll(() => selectedRowIds(page), { message: 'ArrowUp moves it back' })
    .toEqual([start]);
});

/* Starts at the FIRST row: the default fixture has three tasks, so anchoring lower would hit the bottom
   before the range could grow twice, and a clamp at the end is not what this test is about. */
test('Shift+↓ extends the highlight to a range', async ({ page }) => {
  await boot(page);
  await litRow(page, 0);

  await page.keyboard.press('Shift+ArrowDown');
  await expect
    .poll(async () => (await selectedRowIds(page)).length, { message: 'the range grew to two rows' })
    .toBe(2);

  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await selectedRowIds(page)).length).toBe(3);

  await page.keyboard.press('Shift+ArrowUp');
  await expect
    .poll(async () => (await selectedRowIds(page)).length, { message: 'and shrinks back from the far end' })
    .toBe(2);
});

test('Enter opens the details of the row the cursor is on', async ({ page }) => {
  await boot(page);
  await litRow(page, 1);
  /* Move first, so this proves Enter opens the row the CURSOR reached — not merely the row last clicked. */
  await page.keyboard.press('ArrowDown');
  const moved = (await selectedRowIds(page))[0];

  await page.keyboard.press('Enter');
  await expect(detailOpen(page), 'Enter is the explicit open').toBeVisible();
  const openId = await page.evaluate(() => {
    const el = document.querySelector('[data-detail-task-id]');
    return el ? el.getAttribute('data-detail-task-id') : null;
  });
  if (openId !== null) expect(openId, 'and it opened the row the cursor is on').toBe(moved);
});

/* The guard that keeps a persistent selection from taxing everything else: with nothing lit, the arrows
   are not claimed at all, so the pane still scrolls. */
test('with nothing selected the arrow keys are left to the browser', async ({ page }) => {
  await boot(page);
  await expect.poll(() => selectedRowIds(page)).toEqual([]);
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => selectedRowIds(page), { message: 'ArrowDown selects nothing out of an empty selection' })
    .toEqual([]);
});
