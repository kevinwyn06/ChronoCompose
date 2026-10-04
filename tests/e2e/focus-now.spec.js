const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* UI revamp block 10a — Focus re-laid around a "Now" hero.
 *
 * The unit layer (tests/ui-revamp-focus.test.js) owns the hero's selection order, habit consistency, the
 * tabs model and the Music gate. Only what the mock DOM structurally cannot reach is here: real presses
 * on the hero's Start/Stop reaching the live timer (and the top-bar pill), a real `n` keystroke moving
 * the caret into the Scratchpad tab, and rendered hit boxes under the 0.8 shell zoom.
 */

const HERO = '[data-focus-hero]';
const TOGGLE = '[data-focus-hero-toggle]';
const pill = (page) => page.locator('[data-timer-pill]');

/* A clocked appointment spanning the whole day — the block under NOW whatever the wall clock says, so the
   hero's "current block" branch is deterministic. */
const allDay = {
  tasks: [task('deep', 'Deep work', {
    start: '0d', end: '0d+23h59m', startClock: true, endClock: true, uncompressable: true, planned: null,
  })],
  settings: { dayStart: '00:00', dayEnd: '23:59' },
};

test('the hero shows the block under now; its Start and Stop drive the real timer', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await bootSurface(page, { dashMode: 'focus' }, allDay);

  const hero = page.locator(HERO);
  await expect(hero).toHaveAttribute('data-focus-hero', 'current');
  await expect(hero.locator('[data-focus-hero-name]')).toHaveText('Deep work');
  await expect(pill(page)).toHaveCount(0);

  await hero.locator(TOGGLE).click();
  await expect(hero).toHaveAttribute('data-focus-hero', 'running');
  await expect(hero.locator(TOGGLE)).toHaveAttribute('data-focus-hero-toggle', 'stop');
  await expect(pill(page).locator('[data-timer-pill-name]')).toHaveText('Deep work');
  /* The Pomodoro is part of the hero, and with no session it mirrors the timer just started. */
  await expect(hero.locator('[data-pomo-mode="mirror"]')).toHaveCount(1);

  await hero.locator(TOGGLE).click();
  await expect(pill(page)).toHaveCount(0);
  await expect(hero).toHaveAttribute('data-focus-hero', 'current');
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-run') || '{}'));
  expect(Object.keys(run)).toEqual([]);
  expect(errors).toEqual([]);
});

/* Pomodoro pause on stop: the unit layer covers every stop path; this is the live mount — real clicks
   through React's own state updates — for the commonest one, the top-bar pill's Stop. */
test('stopping the task from the top-bar pill pauses its focus ring; Resume restarts both', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await bootSurface(page, { dashMode: 'focus' }, allDay);
  const hero = page.locator(HERO);
  await hero.locator(TOGGLE).click();
  await expect(pill(page)).toHaveCount(1);
  await hero.locator('[data-pomo-start]').click();
  const panel = hero.locator('[data-pomo-mode="session"]');
  await expect(panel).toHaveCount(1);

  await pill(page).locator('[data-timer-pill-stop]').click();
  await expect(pill(page)).toHaveCount(0);
  await expect(panel).toHaveAttribute('data-pomo-paused', '1');
  await expect(panel.locator('[data-pomo-ring-label]')).toHaveText('Paused');
  const frozen = await panel.locator('[data-pomo-ring-text]').textContent();
  await page.waitForTimeout(2200);
  await expect(panel.locator('[data-pomo-ring-text]')).toHaveText(frozen);

  await panel.locator('[data-pomo-resume]').click();
  await expect(pill(page)).toHaveCount(1);
  await expect(panel).not.toHaveAttribute('data-pomo-paused', '1');
  await expect(panel.locator('[data-pomo-ring-label]')).toHaveText('Focus');
  expect(errors).toEqual([]);
});

test('a running timer is the hero, whatever the timeline says', async ({ page }) => {
  await bootSurface(page, { dashMode: 'focus' }, { run: { 'e2e-2': 5 } });
  const hero = page.locator(HERO);
  await expect(hero).toHaveAttribute('data-focus-hero', 'running');
  await expect(hero.locator('[data-focus-hero-name]')).toHaveText('Beta task');
  await expect(hero.locator('[data-pomo-ring-text]')).toHaveText(/^5:\d\d$/);
});

test('"n" from another view opens Focus on the Scratchpad tab with the caret in it', async ({ page }) => {
  /* Last used tab was Note: "n" must still land in the scratchpad. */
  await bootSurface(page, { view: 'gantt' }, { prefs: { focusNoteTab: 'note' } });
  await page.locator('[data-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.keyboard.press('n');
  await expect(page.locator('[data-focus-note-tab="scratch"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#pp-scratch-editor')).toBeFocused();
  await expect(page.locator('#pp-journal-editor')).toHaveCount(0);
  /* and the Note tab is one real click away */
  await page.locator('[data-focus-note-tab="note"]').click();
  await expect(page.locator('#pp-journal-editor')).toBeVisible();
  await expect(page.locator('#pp-scratch-editor')).toHaveCount(0);
});

test('layout: work column beside the timeline, an empty habits strip is one line, controls render >= 24px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bootSurface(page, { dashMode: 'focus' });
  const work = await page.locator('[data-focus-work]').boundingBox();
  const tl = await page.locator('[data-focus-timeline]').boundingBox();
  expect(work.x + work.width).toBeLessThanOrEqual(tl.x + 1);

  const strip = page.locator('[data-focus-habits]');
  await expect(strip).toContainText('No habits scheduled today.');
  expect((await strip.boundingBox()).height).toBeLessThan(48);
  expect(await page.getByText('Not wired up yet').count()).toBe(0);

  for (const sel of ['[data-pomo-gear]', '[data-focus-note-tab="note"]', '[data-qa="focus-add-habit"]']) {
    const b = await page.locator(sel).boundingBox();
    expect(b.height, sel).toBeGreaterThanOrEqual(23.5);
  }
  const gear = await page.locator('[data-pomo-gear]').boundingBox();
  expect(gear.width).toBeGreaterThanOrEqual(23.5);
});
