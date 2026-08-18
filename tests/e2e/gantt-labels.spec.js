/* GANTT BARS ARE ANONYMOUS (owner 2026-08-12) — the reversal of V5 block 27b.
 *
 * Block 27b gave every bar its task's name as rendered text, and this file used to assert it four ways.
 * The owner reversed it after the first session on a real workspace, verbatim: *"The task name in the
 * gantt chart doesn't work, especially for recurring tasks where the name completely overwhelms the
 * interface. Just get rid of it."*
 *
 * The old fixture is why the defect shipped, and it is worth being explicit about: it had four tasks,
 * one bar each. Under that shape a label reads as helpful. The failure mode is DENSITY — a recurring
 * task draws one bar per occurrence, so a single daily row emitted the same name across the entire
 * chart width, and a handful of such rows turned the surface into stacked text. Every assertion in the
 * old file passed the whole time, because nothing in it ever rendered a repeat.
 *
 * So this file now asserts the inverse contract, and the density case the old one lacked:
 *   • no `[data-ganttname]` node exists, and no bar renders its task's name as text;
 *   • identification is not lost — the name is still in each bar's `title`;
 *   • a daily recurring task, the exact shape that broke it, adds NO occurrences of its name to the
 *     rendered chart text when its consecutive occurrence days merge into one plain run.
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
  /* Wait on the ROW, not on a label — the labels are what this file asserts are gone. */
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

/** Every `title` string in the Gantt, so we can prove identification survived the removal. */
async function ganttTitles(page) {
  return page.$$eval('[title]', (els) => els.map((e) => e.getAttribute('title')));
}

test.describe('Gantt bars carry no name text', () => {
  test('no bar, diamond or strip renders its task name as text', async ({ page }) => {
    await bootGantt(page, 'dark');

    const labelNodes = await page.locator('[data-ganttname]').count();
    expect(labelNodes, 'the [data-ganttname] label node is gone entirely').toBe(0);

    const text = await ganttText(page);
    /* Premise, so a `not.toContain` sweep can never pass by reading an empty string: the scroller's
       innerText really does carry the chart's own text (the date header tiers). */
    expect(text.length, 'ganttText read real painted text, not nothing').toBeGreaterThan(20);
    expect(text, 'the date header is what it read').toMatch(/\d+\s+\w{3}/);

    for (const [key, want] of Object.entries(NAMES)) {
      expect(text, `"${want}" (${key}) is not painted on the Gantt`).not.toContain(want);
    }
  });

  test('identification survives: every bar still names its task in a tooltip', async ({ page }) => {
    await bootGantt(page, 'dark');
    const titles = (await ganttTitles(page)).join(' | ');
    for (const want of [NAMES.long, NAMES.short, NAMES.ms, NAMES.daily]) {
      expect(titles, `"${want}" is still reachable via a title tooltip`).toContain(want);
    }
    expect(titles, 'the fully dateless row has no bar or tooltip under Chain 6 day geometry')
      .not.toContain(NAMES.ghost);
  });

  test('a daily repeat adds no name text when its occurrence days merge', async ({ page }) => {
    /* The density case the old fixture lacked. `g-daily` repeats every day across the whole chart;
       Chain 6 block 44 now projects those consecutive days as one plain continuous bar. */
    await bootGantt(page, 'dark');

    const bars = await page.locator('[data-gantt-task-id]').count();
    expect(bars, 'the seeded rows rendered').toBeGreaterThan(0);

    const text = await ganttText(page);
    expect(text.length, 'ganttText read real painted text, not nothing').toBeGreaterThan(20);
    const occurrences = text.split(NAMES.daily).length - 1;
    expect(occurrences, 'the repeating task contributes zero name labels').toBe(0);

    /* The repeat is still IDENTIFIABLE, just not by painted text. */
    const titles = (await ganttTitles(page)).join(' | ');
    expect(titles, 'the repeating task is still named in a tooltip').toContain(NAMES.daily);

    const run = page.locator(`[title^="${NAMES.daily} · occ"]`);
    await expect(run, 'daily occurrences render as one continuous future run').toHaveCount(1);
    const background = await run.evaluate(el => getComputedStyle(el).backgroundImage);
    expect(background, 'the merged run has no recurrence hatch').toBe('none');

    expect(text, 'the retired recurrence-strip rule chip is absent').not.toContain('Daily ·');
  });

  test('the chart reads cleanly in both themes', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await bootGantt(page, theme);
      expect(await page.locator('[data-ganttname]').count(), `${theme}: no name labels`).toBe(0);
      await page.screenshot({ path: shot(`gantt-anonymous-${theme}`), fullPage: false });
    }
  });
});
