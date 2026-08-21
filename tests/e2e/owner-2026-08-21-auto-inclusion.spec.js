const { test, expect } = require('@playwright/test');
const { bootToday, bootPlan, task, timelineBlocks } = require('./_seed');

/* Owner reports 2026-08-21 — the auto-inclusion inversion, proved end to end.
 *
 * The unit layer pins the predicates (tests/owner-2026-08-21-auto-inclusion.test.js). This file exists
 * for the one thing the mock DOM structurally cannot reach: the whole path the owner actually walked —
 * a real keystroke opening the real quick-add popup, the real parser consuming the typed phrase, the
 * real commit, and the task turning up on a real rendered day surface. The bug was reported as "I typed
 * it and it wasn't there", and only a live mount can say "it is there".
 *
 * Diagnosis: docs/superpowers/findings/2026-08-21-parser-inclusion-defects.md
 * Owner ruling 2026-08-21, verbatim: "test today at 4pm should be given the default duration and auto
 * included today."
 */

/* An existing block so `bootToday`'s wait has something to settle on — the surface under test is what
   quick-add ADDS to it, not this. */
const anchorTask = task('anchor', 'Anchor', { start: '0d+9h', end: '0d+10h', startClock: true, endClock: true });

/* Quick-add is opened by the global `q` shortcut and focuses its own input on mount. Typed with a real
   keyboard so the parser sees the same input events the owner's does. */
async function quickAdd(page, text) {
  await page.keyboard.press('q');
  const input = page.locator('input[placeholder^="Quick add"]');
  await expect(input).toBeFocused({ timeout: 5000 });
  await page.keyboard.type(text, { delay: 5 });
  await input.press('Enter');
  /* The popup stays MOUNTED after a commit — it is built for adding several in a row — so the evidence
     that the add landed is the stored task, never the popup closing. It is a floating panel, so the
     day surface underneath keeps rendering and stays readable. */
}

const stored = (page, name) => page.evaluate((n) => {
  const tasks = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
  return tasks.find(t => t.name === n) || null;
}, name);

test('a quick-added "today at 4pm" is on today\'s timeline, at 4pm, with the default duration', async ({ page }) => {
  await bootToday(page, { tasks: [anchorTask] });
  await quickAdd(page, 'inclusion probe today at 4pm');

  /* The DATA half of the ruling: a typed start clock with no stated end is a default-duration block. */
  await expect.poll(async () => (await stored(page, 'inclusion probe'))?.start != null).toBe(true);
  const t = await stored(page, 'inclusion probe');
  expect(t).not.toBeNull();
  expect(new Date(t.start).getHours()).toBe(16);
  expect(t.end).not.toBeNull();
  expect(t.endClock).toBe(true);
  const mins = (t.end - t.start) / 60000;
  expect(mins).toBeGreaterThan(0);
  expect(new Date(t.end).getHours()).toBe(16);

  /* The VISIBLE half, and the whole reason this is an e2e: it is on the day surface. Before the fix
     this task appeared on NO day at all. */
  await expect.poll(async () => (await timelineBlocks(page)).some(b => b.taskId === t.id), {
    timeout: 10000,
    message: 'the quick-added 4pm task must render as a block on today\'s timeline',
  }).toBe(true);

  const midnight = await page.evaluate(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); });
  const block = (await timelineBlocks(page)).find(b => b.taskId === t.id);
  expect(block.day).toBe(midnight);
});

test("a quick-added bare 'today' reads as ON TODAY, in the app's own words", async ({ page }) => {
  await bootPlan(page, 'select', { tasks: [anchorTask] });
  await quickAdd(page, 'bare day probe today');

  await expect.poll(async () => (await stored(page, 'bare day probe'))?.start != null).toBe(true);
  const t = await stored(page, 'bare day probe');
  /* A bare day names no time, so no duration is invented — ONE edge. That is exactly the shape that
     used to fall through the today predicates, and the reason `test today` was absent today and present
     tomorrow. Nothing here presses the button: `included` is untouched. */
  expect(t.end).toBeNull();
  expect(t.included == null).toBe(true);

  /* The glyph's tooltip is the app SAYING which it is, in the same words the owner used. */
  const glyph = page.locator(`[data-incl-glyph="${t.id}"]`);
  await expect(glyph).toHaveAttribute('title', /^On today/, { timeout: 10000 });
  await expect(glyph).toHaveText('☑');
});

test('and it is filed under New, not Upcoming — Included and triage agree', async ({ page }) => {
  /* `seedOnce` so the reload below does NOT re-stamp the fixture over what quick-add just added.
     The reload is deliberate and not a workaround for flake: `onListSince` is stamped by
     `maintainOnListSince`, whose only call sites are the load path and a 30s idle tick (it must never
     run from a render). Reloading runs the load path, which is the honest way to observe the field a
     bucket is derived from without sleeping out the tick. */
  await bootPlan(page, 'select', { tasks: [anchorTask], seedOnce: true });
  await quickAdd(page, 'triage probe today');
  await expect.poll(async () => (await stored(page, 'triage probe')) != null).toBe(true);

  await page.reload();
  await page.locator('[data-card-id]').first().waitFor({ state: 'attached', timeout: 15000 });

  const card = page.locator('[data-selbucket="new"] [data-card-id]').filter({ hasText: 'triage probe' });
  await expect(card).toHaveCount(1, { timeout: 10000 });
  /* The specific mis-filing the old `isScheduled` guard in `onListNow` caused: it landed here instead. */
  await expect(page.locator('[data-selbucket="upcoming"] [data-card-id]')
    .filter({ hasText: 'triage probe' })).toHaveCount(0);
});
