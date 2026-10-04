/* GANTT BARS CARRY THEIR NAMES (UI revamp block 7, 2026-10-04) — the second reversal.
 *
 * History, kept because it is the reason for the density assertions below. V5 block 27b gave every bar
 * its task's name; the owner removed it on 2026-08-12: *"The task name in the gantt chart doesn't work,
 * especially for recurring tasks where the name completely overwhelms the interface."* The failure was
 * DENSITY — a daily repeat drew one label per occurrence, so one row printed the same name across the
 * whole chart — and the old fixture (one bar per row) could never see it.
 *
 * Both causes are gone now: Chain 6 block 44 merges consecutive occurrence days into ONE run, and a
 * repeat names only its FIRST painted run however many it draws. The audit (finding 11, "bars are
 * anonymous and linked to nothing") brought labels back on that basis. This file asserts:
 *   • each shape paints its name — a wide bar inside, a one-day bar and a milestone beside themselves;
 *   • the daily repeat — the exact shape that broke V5.27b — paints its name ONCE;
 *   • identification is also machine-readable (`data-gantt-tip`), and the native `title` is gone from
 *     the bar so the browser tooltip no longer doubles the drawn one.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, `${name}.png`);

/* One of each labelling path block 27b had: a wide solid bar, a narrow one, a milestone, and a
   now-empty fully dateless row — plus the DAILY repeat that the old fixture never contained. */
const NAMES = {
  long: 'Ship the release',
  short: 'Renew passport',
  ms: 'Launch day',
  ghost: 'Someday reading',
  daily: 'Morning standup',
};
const fixture = (theme) => ({
  theme,
  tasks: [
    task('g-long', NAMES.long, { start: '-2d', end: '+6d', priority: 1, planned: 300 }),
    task('g-short', NAMES.short, { start: '+1d', end: '+1d', priority: 3, planned: 45 }),
    task('g-ms', NAMES.ms, { start: '+3d', end: '+3d', type: 'Milestone', planned: 0 }),
    task('g-ghost', NAMES.ghost, { priority: 4, planned: 60 }),
    task('g-daily', NAMES.daily, {
      start: '-2d', end: '-2d', planned: 15,
      recur: { kind: 'day', n: 1, label: 'Daily' },
    }),
  ],
});

/** Park the pointer far from every bar, so no tooltip or hover-gated control is open. */
async function unhover(page) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(60);
}

async function bootGantt(page, theme) {
  await bootSurface(page, { view: 'gantt' }, fixture(theme));
  /* Wait on the ROW, which every fixture shape has, then on the painted labels. */
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(150);
  await unhover(page);
}

/** All text actually painted inside the Gantt scroller. */
async function ganttText(page) {
  return page.$eval('[data-gantt-task-id]', (el) => {
    let n = el.parentElement;
    while (n && !(n.scrollWidth > n.clientWidth || /auto|scroll/.test(getComputedStyle(n).overflow))) {
      n = n.parentElement;
    }
    return ((n || el.parentElement).innerText || '').replace(/\s+/g, ' ');
  });
}

/** Every `data-gantt-tip` string in the Gantt — the tooltip's machine-readable twin. */
async function ganttTips(page) {
  return page.$$eval('[data-gantt-tip]', (els) => els.map((e) => e.getAttribute('data-gantt-tip')));
}
const labelOf = (page, id) => page.locator(`[data-gantt-label-task="${id}"]`);

test.describe('Gantt bars carry their names', () => {
  test('each shape paints its name: inside a wide bar, beside a one-day bar and a milestone', async ({ page }) => {
    await bootGantt(page, 'dark');
    expect(await page.locator('[data-ganttname]').count(), 'the V5.27b label node stays retired').toBe(0);

    await expect(labelOf(page, 'g-long')).toHaveAttribute('data-gantt-label', 'inside');
    await expect(labelOf(page, 'g-short')).toHaveAttribute('data-gantt-label', 'outside');
    await expect(labelOf(page, 'g-ms')).toHaveAttribute('data-gantt-label', 'outside');
    for (const id of ['g-long', 'g-short', 'g-ms']) await expect(labelOf(page, id)).toBeVisible();

    const text = await ganttText(page);
    for (const key of ['long', 'short', 'ms', 'daily']) {
      expect(text, `"${NAMES[key]}" is painted on the Gantt`).toContain(NAMES[key]);
    }
    expect(text, 'the fully dateless row has no bar and so no label').not.toContain(NAMES.ghost);
  });

  test('identification is machine-readable too, and the bar has no native title', async ({ page }) => {
    await bootGantt(page, 'dark');
    const tips = (await ganttTips(page)).join(' | ');
    for (const want of [NAMES.long, NAMES.short, NAMES.ms, NAMES.daily]) {
      expect(tips, `"${want}" is in a data-gantt-tip`).toContain(want);
    }
    expect(tips).not.toContain(NAMES.ghost);
    const titled = await page.locator('[data-gantt-bar-body][title], [data-gantt-milestone-id][title]').count();
    expect(titled, 'no native title on a bar body or diamond').toBe(0);
  });

  test('a daily repeat paints its name ONCE — the density case that removed labels in 2026-08', async ({ page }) => {
    await bootGantt(page, 'dark');
    const run = page.locator(`[data-gantt-tip^="${NAMES.daily} · occ"]`);
    await expect(run, 'daily occurrences render as one continuous future run').toHaveCount(1);
    const background = await run.evaluate(el => getComputedStyle(el).backgroundImage);
    expect(background, 'the merged run has no recurrence hatch').toBe('none');

    await expect(labelOf(page, 'g-daily')).toHaveCount(1);
    const text = await ganttText(page);
    /* An inside label paints twice when it straddles a progress fill (two inks); the repeat here is 0%,
       so its name appears exactly once in the painted text. */
    expect(text.split(NAMES.daily).length - 1, 'the repeating task contributes one name').toBe(1);
    expect(text, 'the retired recurrence-strip rule chip is absent').not.toContain('Daily ·');
  });

  test('the chart reads in both themes', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await bootGantt(page, theme);
      await expect(labelOf(page, 'g-long'), `${theme}: labels paint`).toBeVisible();
      await page.screenshot({ path: shot(`gantt-labels-${theme}`), fullPage: false });
    }
  });
});
