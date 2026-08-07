const { test, expect } = require('@playwright/test');
const { bootSurface } = require('./_seed');

/* V3.2 — the guided journal's editable prompt set.
   ONLY what the mock DOM structurally cannot reach lives here: a live mount of the panel in the
   Journal view, real typing into the prompt inputs (with the blur that commits them), a real page
   reload, and the fact that a single-letter global hotkey does not fire while a prompt input has
   focus. The store contract itself — CRUD, normalisation, the pp-prefs day mark, wsKey scoping,
   BACKUP_KEYS, the not-synced tripwire — is unit-tested in tests/journal.test.js and is deliberately
   NOT restated here. */

const PANEL = '[data-journal-prompts]';
const PAD = '#pp-scratch-editor';

/** Put the panel into edit mode (the Edit/Done toggle is the only way in). */
async function enterEditMode(page) {
  await page.locator('[data-prompts-edit]').click();
  await expect(page.locator('[data-prompt-new]')).toBeVisible();
}

test.describe('V3.2 guided journal prompts', () => {
  test('the panel mounts in the Journal with one row per default prompt', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await bootSurface(page, { view: 'journal' });
    await expect(page.locator(PANEL)).toBeVisible();

    /* The default set ships six prompts; asserting the count rather than the wording keeps this spec
       off the copy, which the owner is free to reword. */
    await expect(page.locator('[data-prompt-id]')).toHaveCount(6);
    /* View mode is read-only: prompts lead the entry, they never become a form. */
    await expect(page.locator('[data-prompt-input]')).toHaveCount(0);
    await expect(page.locator('[data-prompt-new]')).toHaveCount(0);

    /* And the day's own editor is still there, below the panel — the panel never displaces it. */
    const editors = page.locator('.pp-rich[contenteditable]');
    expect(await editors.count()).toBeGreaterThan(0);
    expect(errors, 'page errors around the prompt panel').toEqual([]);
  });

  test('a reworded prompt commits on blur and survives a reload', async ({ page }) => {
    await bootSurface(page, { view: 'journal' });
    await expect(page.locator(PANEL)).toBeVisible();
    await enterEditMode(page);

    const first = page.locator('[data-prompt-input]').first();
    await first.click();
    /* Real selection + typing: the input commits through `setJournalPromptText` on blur, and a
       dispatched `input` event would prove nothing about that path. */
    await first.press('Control+a');
    await page.keyboard.type('What did I avoid today?');
    await page.keyboard.press('Tab');

    await page.reload();
    /* Back in view mode after the reload — `journalPromptsEdit` is deliberately not persisted. */
    await expect(page.locator('[data-prompt-input]')).toHaveCount(0);
    await expect(page.locator(PANEL)).toContainText('What did I avoid today?');
  });

  test('add and delete reshape the set with real clicks, and Restore defaults undoes it', async ({ page }) => {
    await bootSurface(page, { view: 'journal' });
    await expect(page.locator(PANEL)).toBeVisible();
    await enterEditMode(page);

    await page.locator('[data-prompt-new]').fill('Who did I not thank?');
    await page.locator('[data-prompt-add]').click();
    await expect(page.locator('[data-prompt-id]')).toHaveCount(7);
    /* In edit mode a prompt IS an input, so its wording lives in `value`, not in the text content. */
    await expect(page.locator('[data-prompt-input]').last()).toHaveValue('Who did I not thank?');
    await expect(page.locator('[data-prompt-new]')).toHaveValue(''); // the adder clears itself

    /* ✕ on a default. The hit target is HIT_MIN_PX square, so a real click must land on it. */
    await page.locator('[data-prompt-id="wins"] button[title="Delete this prompt"]').click();
    await expect(page.locator('[data-prompt-id="wins"]')).toHaveCount(0);
    await expect(page.locator('[data-prompt-id]')).toHaveCount(6);

    await page.locator('[data-prompts-reset]').click();
    await expect(page.locator('[data-prompt-id="wins"]')).toHaveCount(1);
    await expect(page.locator('[data-prompt-id]')).toHaveCount(6);
    /* The added prompt is gone with it — "restore defaults" is a return to unconfigured, not a merge. */
    const values = await page.locator('[data-prompt-input]').evaluateAll((els) => els.map((e) => e.value));
    expect(values).not.toContain('Who did I not thank?');
  });

  test('the scratchpad prompt renders todays lines highlighted, and never as a second editor', async ({ page }) => {
    /* One page load, start to finish. The day mark lives in `pp-prefs`, and `_seed.js` rewrites
       `pp-prefs` wholesale on every boot — so a second `bootSurface` would wipe the mark and the
       highlight would (correctly, per the design) fall back to "nothing was typed today". The Journal
       carries the pad in its right rail, so nothing needs a second load anyway. */
    await bootSurface(page, { view: 'journal' });
    await expect(page.locator('[data-scratch-review]')).toHaveCount(0); // empty pad: no review yet

    const pad = page.locator(PAD);
    await expect(pad).toBeVisible();
    const box = await pad.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(pad).toBeFocused();
    await page.keyboard.type('called the dentist');
    await page.keyboard.press('Tab'); // richField commits on blur; the mark was stamped on that write

    await expect(page.locator('[data-scratch-review]')).toBeVisible();
    const today = page.locator('[data-scratch-line="today"]');
    await expect(today).toHaveCount(1);
    await expect(today).toContainText('called the dentist');
    /* The scroll target is the FIRST of today's lines. */
    await expect(page.locator('#pp-scratch-today')).toHaveCount(1);
    /* Read-only: the review is a view of the pad, not a third editable mount of the same fieldKey. */
    await expect(page.locator(`[data-scratch-review] [contenteditable="true"]`)).toHaveCount(0);
    await expect(page.locator(`${PANEL} ${PAD}`)).toHaveCount(0);
  });

  test('typing into a prompt input does not fire the global single-letter hotkeys', async ({ page }) => {
    await bootSurface(page, { view: 'journal' });
    await expect(page.locator(PANEL)).toBeVisible();
    await enterEditMode(page);

    const first = page.locator('[data-prompt-input]').first();
    await first.click();
    /* "n" is V3.1's jump-to-scratchpad hotkey and "j"/"k" navigate. A prompt input is a text field, so
       none of them may fire — this is exactly the hit-testing/focus path a dispatched KeyboardEvent
       would skip, which is why it is here and not in the unit layer. */
    await first.press('Control+a');
    await page.keyboard.type('njk notes');
    await expect(first).toBeFocused();
    await expect(first).toHaveValue('njk notes');
    await expect(page.locator(PANEL)).toBeVisible();
  });
});
