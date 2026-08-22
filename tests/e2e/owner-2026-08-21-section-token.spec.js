const { test, expect } = require('@playwright/test');
const { bootPlan, task } = require('./_seed');

/* Owner ruling 2026-08-21 — `/` files a task into a section — proved end to end.
 *
 * The unit layer pins the tokenising rule, shortest-first matching and the completion helpers
 * (tests/owner-2026-08-21-section-token.test.js). This file exists for the three things the mock DOM
 * structurally cannot reach:
 *
 *   1. A real keystroke path through quick-add — the real popup, the real parser, the real commit —
 *      ending in a stored `sectionId` and a section chip the user saw before pressing Enter.
 *   2. The Tab cycle, which is the other half of the shortest-first ruling. It is a real keydown on a
 *      real input with real caret behaviour; a dispatched event proves nothing about whether Tab moved
 *      focus out of the field instead.
 *   3. The create OFFER, which exists precisely so the parser never writes to `pp-sections` itself.
 */

const SECTIONS = [
  { id: 'sec_work', name: 'Work',               order: 0 },
  { id: 'sec_deep', name: 'Deep work',          order: 1 },
  { id: 'sec_plan', name: 'Deep work planning', order: 2 },
];

const anchorTask = task('anchor', 'Anchor', { sectionId: 'sec_work', start: '+0d', end: '+1d' });

async function openQuickAdd(page, text){
  await page.keyboard.press('q');
  const input = page.locator('input[placeholder^="Quick add"]');
  await expect(input).toBeFocused({ timeout: 5000 });
  await page.keyboard.type(text, { delay: 5 });
  return input;
}

const stored = (page, name) => page.evaluate((n) => {
  const tasks = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
  return tasks.find(t => t.name === n) || null;
}, name);

const storedSections = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('pp-sections') || '[]'));

test('a quick-added `/Work` files the task into Work and leaves the title clean', async ({ page }) => {
  await bootPlan(page, 'select', { tasks: [anchorTask], sections: SECTIONS, seedOnce: true });
  const input = await openQuickAdd(page, 'ship the thing /work');

  /* The chip is the filing, wearing the section's own hue — so before committing, the app has already
     said which container the task is going into. */
  await expect(page.locator('[data-qa-section="sec_work"]')).toHaveText('/Work', { timeout: 5000 });

  await input.press('Enter');
  await expect.poll(async () => (await stored(page, 'ship the thing')) != null).toBe(true);
  const t = await stored(page, 'ship the thing');
  expect(t.sectionId).toBe('sec_work');
  /* Consumed, not left as litter: a `/Work` still sitting in the title would read as un-acted-on. */
  expect(t.name).toBe('ship the thing');

  /* The task exists as a real row on the surface — it was filed into a container, not into a field
     nothing renders. Where a section band puts its rows is `section-header-band.spec.js`'s subject and
     is not re-proved here; what this file owns is the parse -> file path. */
  await expect(page.locator(`[data-card-id="${t.id}"], [data-task-id="${t.id}"]`).first())
    .toBeVisible({ timeout: 15000 });
});

test('Tab reaches the longer section name shortest-first leaves behind', async ({ page }) => {
  await bootPlan(page, 'select', { tasks: [anchorTask], sections: SECTIONS, seedOnce: true });
  const input = await openQuickAdd(page, 'plan it /deep work friday');

  /* Shortest-first: the SHORTER `Deep work` is what the bare text resolves to, which is exactly what
     keeps `friday` available to the date parser one token later. */
  await expect(page.locator('[data-qa-section="sec_deep"]')).toHaveText('/Deep work', { timeout: 5000 });

  /* One real Tab. If Tab were not intercepted it would move focus out of the input, so asserting the
     field still holds the caret is part of the evidence, not decoration. */
  await input.press('Tab');
  await expect(page.locator('[data-qa-section="sec_plan"]')).toHaveText('/Deep work planning', { timeout: 5000 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('plan it /Deep work planning friday');

  /* And the cycle WRAPS rather than dead-ending at the longest name. */
  await input.press('Tab');
  await expect(page.locator('[data-qa-section="sec_deep"]')).toHaveText('/Deep work', { timeout: 5000 });

  await input.press('Tab');
  await input.press('Enter');
  await expect.poll(async () => (await stored(page, 'plan it')) != null).toBe(true);
  const t = await stored(page, 'plan it');
  expect(t.sectionId).toBe('sec_plan');
  /* The date survived the whole cycle: rewriting the token span never touched the words around it. */
  expect(t.start).not.toBeNull();
});

test('an unmatched name is offered, never created by the parse', async ({ page }) => {
  await bootPlan(page, 'select', { tasks: [anchorTask], sections: SECTIONS, seedOnce: true });
  const input = await openQuickAdd(page, 'draft the memo /marketing');

  const offer = page.locator('[data-qa-section-offer]');
  await expect(offer).toContainText('marketing', { timeout: 5000 });
  /* The load-bearing negative: typing the name did NOT write to pp-sections. Section ORDER drives
     timeline block hue, so a typo that auto-created a section would repaint real work. */
  expect((await storedSections(page)).length).toBe(SECTIONS.length);

  await offer.click();
  await expect.poll(async () => (await storedSections(page)).some(s => s.name === 'marketing'),
    { timeout: 5000 }).toBe(true);

  /* Now the name matches, so the same unchanged text files the task. */
  await expect(page.locator('[data-qa-section-offer]')).toHaveCount(0, { timeout: 5000 });
  await input.press('Enter');
  await expect.poll(async () => (await stored(page, 'draft the memo')) != null).toBe(true);
  const created = (await storedSections(page)).find(s => s.name === 'marketing');
  expect((await stored(page, 'draft the memo')).sectionId).toBe(created.id);
});

test('a title edit consumes the token and files the task, without eating the other words', async ({ page }) => {
  await bootPlan(page, 'select', { tasks: [task('r1', 'Rewrite the intro', {})], sections: SECTIONS, seedOnce: true });

  /* The title editor lives in the DETAIL PANEL, so the task has to be selected first. It is a
     contenteditable, not an input — which is why the text is set through a real focus + select-all +
     type rather than fill(), and committed with Enter (the editor blurs itself, and blur is what calls
     rename). */
  await page.locator('[data-task-id="r1"]').first().click();
  const editor = page.locator('[data-qa="title-editor"]');
  await expect(editor).toHaveText('Rewrite the intro', { timeout: 15000 });
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Rewrite the intro friday /work', { delay: 5 });
  await page.keyboard.press('Enter');

  await expect.poll(async () => {
    const t = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks') || '[]').find(x => x.id === 'r1'));
    return t && t.sectionId;
  }, { timeout: 10000 }).toBe('sec_work');

  const t = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks') || '[]').find(x => x.id === 'r1'));
  /* The section token is the ONE token a title edit consumes — its chip is not on the row, so leaving
     it would read as un-acted-on. `friday` STAYS, per Task 16: its highlight is the proof it was taken. */
  expect(t.name).toBe('Rewrite the intro friday');
  expect(t.start).not.toBeNull();
});
