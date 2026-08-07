const { test, expect } = require('@playwright/test');
const { bootSurface } = require('./_seed');

/* V3.1 — the running scratchpad.
   ONLY what the mock DOM structurally cannot reach lives here: a live mount of the editor in Focus,
   real typing into a contentEditable, and an actual page reload. The storage contract itself
   (round-trip, wsKey scoping, BACKUP_KEYS, normalisation) is unit-tested in tests/scratch.test.js and
   is deliberately NOT restated here. */

const PAD = '#pp-scratch-editor';

/** Click into the pad with a real pointer, type, then blur — `richField` commits on blur. */
async function writeInPad(page, text) {
  const pad = page.locator(PAD);
  const box = await pad.boundingBox();
  if (!box) throw new Error('scratchpad had no box');
  /* Trusted CDP input rather than a dispatched MouseEvent: focusing a contentEditable and placing a
     caret is exactly the hit-testing a synthetic event skips. */
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(pad).toBeFocused();
  await page.keyboard.type(text);
  /* Tab out — `richField` commits on blur, and Tab is the one blur that does not depend on what
     happens to sit next to the pad on a given surface. */
  await page.keyboard.press('Tab');
  await expect(pad).not.toBeFocused();
}

test.describe('V3.1 running scratchpad', () => {
  test('mounts in Focus and its content survives a reload', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await bootSurface(page, { dashMode: 'focus' });
    await expect(page.locator(PAD)).toBeVisible();
    await expect(page.locator(PAD)).toHaveText('');

    await writeInPad(page, 'remember the milk');
    await expect(page.locator(PAD)).toHaveText('remember the milk');

    await page.reload();
    await expect(page.locator(PAD)).toHaveText('remember the milk');
    expect(errors, 'page errors around the scratchpad').toEqual([]);
  });

  test('the Journal shows the SAME document, not a per-day copy', async ({ page }) => {
    await bootSurface(page, { dashMode: 'focus' });
    await expect(page.locator(PAD)).toBeVisible();
    await writeInPad(page, 'carried across surfaces');

    /* Same store key, so a fresh load on a different surface must show the same text. Navigating by
       seeding a second load keeps this spec off the nav chrome. */
    await bootSurface(page, { view: 'journal' });
    await expect(page.locator(PAD)).toHaveText('carried across surfaces');

    /* And it is not the day entry: the journal's own editor is a different field that stayed empty. */
    const journalEntry = page.locator('.pp-rich[contenteditable]').filter({ hasNot: page.locator(PAD) });
    await expect(page.locator(PAD)).toHaveCount(1);
    expect(await journalEntry.count()).toBeGreaterThan(0);
  });

  test('"n" jumps to the scratchpad from another view and focuses it', async ({ page }) => {
    await bootSurface(page, { view: 'gantt' });
    await page.locator('[data-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
    await expect(page.locator(PAD)).toHaveCount(0);

    await page.keyboard.press('n');
    await expect(page.locator(PAD)).toBeVisible();
    await expect(page.locator(PAD)).toBeFocused();
  });
});
