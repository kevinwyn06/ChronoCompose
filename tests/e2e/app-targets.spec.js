/* Targets pass 2 — every surface except the Plan sheet and Gantt (plan-targets.spec.js has those).
 *
 * HIT_MIN_PX is 24 RENDERED px: under the 0.8 shell a control needs a 30 CSS px hit box. The unit layer
 * (tests/app-targets.test.js) proves the controls are real buttons with the right Tab behaviour; this spec
 * measures the boxes a pointer actually hits (`elementFromPoint`, walked out from each control's centre and
 * bisected to the edge) on a representative control per surface, and drives the keyboard with real keys:
 * the top bar, the Settings tabs, the Focus hero, the Review and Journal arrows, and the Plan sheet's
 * section headers. Gestures use Playwright's real mouse.
 */
const { test, expect } = require('@playwright/test');
const { seed, task } = require('./_seed');

test.use({ viewport: { width: 1600, height: 900 } });

const sections = [{ id: 's1', name: 'Research', order: 0 }, { id: 's2', name: 'Admin', order: 1 }, { id: 's3', name: 'Errands', order: 2 }];
const tasks = () => [
  task('a', 'Read the spec', { sectionId: 's1', start: '0d', end: '+3d', planned: 120, priority: 1, labels: ['research'] }),
  task('b', 'Draft notes', { sectionId: 's1', start: '0d', end: '+4d', planned: 90, priority: 2 }),
  task('c', 'File expenses', { sectionId: 's2', start: '0d', end: '+5d', planned: 60, priority: 3 }),
  task('d', 'Buy stamps', { sectionId: 's3', start: '+1d', end: '+6d', planned: 30, priority: 4 }),
  task('u', 'Someday idea', { sectionId: 's3', start: '+2d', end: '+4d', planned: null, priority: 3 }),
  task('z', 'Old chore', { sectionId: 's3', start: '-9d', end: '-8d', planned: 30, completion: '-8d', pct: 100, archivedAt: '-7d' }),
];
const HABITS = () => {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const T = d0.getTime(); const DAY = 86400000;
  localStorage.setItem('pp-habits', JSON.stringify([
    { id: 'h1', name: 'Stretch', schedule: { kind: 'daily', days: [] }, taskIds: [], done: {}, createdAt: T - 20 * DAY },
    { id: 'h2', name: 'Run', schedule: { kind: 'weekdays', days: [1, 3, 5] }, taskIds: [], done: {}, createdAt: T - 20 * DAY },
  ]));
};

async function open(page, prefs, extra) {
  await seed(page, Object.assign({ tasks: tasks(), sections, settings: { dayStart: '00:00', dayEnd: '23:59', packFromNow: false },
    prefs: Object.assign({ mainView: 'dashboard', dashMode: 'overview', dashModeV: 2, planView: 'gantt' }, prefs) }, extra || {}));
  await page.addInitScript(HABITS);
  await page.goto('/index.html');
  await page.waitForTimeout(600);
  await page.mouse.move(2, 2);
}

/** The rendered hit box of the first element `sel` matches: from its centre, how far a pointer can travel
 *  each way and still land on it (or inside it). */
async function hitBox(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const own = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
    if (!own(cx, cy)) return { covered: true };
    const edge = (dx, dy) => {
      let a = 0; while (a < 60 && own(cx + dx * (a + 1), cy + dy * (a + 1))) a++;
      let lo = a, hi = a + 1;
      for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (own(cx + dx * m, cy + dy * m)) lo = m; else hi = m; }
      return lo;
    };
    return { w: edge(-1, 0) + edge(1, 0), h: edge(0, -1) + edge(0, 1), glyphW: r.width, glyphH: r.height };
  }, sel);
}
/* A box built at 30 CSS px renders at exactly 24; Chromium snaps element boxes to whole pixels when it
   hit-tests, so a box flush against a neighbour can measure up to ~0.6px short. */
const MIN = 23.4;
async function expectHit(page, sel, name) {
  const b = await hitBox(page, sel);
  expect(b, name + ' exists').toBeTruthy();
  expect(b.covered, name + ' is not covered at its centre').toBeFalsy();
  expect(b.w, name + ' hit width').toBeGreaterThanOrEqual(MIN);
  expect(b.h, name + ' hit height').toBeGreaterThanOrEqual(MIN);
  return b;
}

test.describe('rendered hit boxes are at least HIT_MIN_PX', () => {
  test('Focus: list circle, name and ▶, the editor toolbar, the hero', async ({ page }) => {
    await open(page, { dashMode: 'focus' });
    await page.locator('[data-focus-row="a"]').waitFor();
    const circle = await expectHit(page, '[data-focus-row="a"] [data-focus-done]', 'circle');
    expect(circle.glyphW, 'the circle still looks 24px').toBeLessThan(21);
    await expectHit(page, '[data-focus-row="a"] [data-focus-open]', 'name');
    await expectHit(page, '[data-focus-row="a"] [data-focus-timer]', '▶');
    await expectHit(page, '[data-rich-cmd="bold"]', 'Bold');
    await expectHit(page, '[data-rich-cmd="italic"]', 'Italic');
    await expectHit(page, '[data-pomo-start]', 'Start focus');
    // The row did not grow.
    expect(Math.round((await page.locator('[data-focus-row="a"]').boundingBox()).height)).toBe(Math.round(52 * 0.8));
  });

  test('Day view: a block\'s ▶, the zoom toggle', async ({ page }) => {
    await open(page, { planView: 'today' });
    // Block b: the first block of the day sits under the pane's zoom toggle, top right.
    const blk = page.locator('[data-tl-block][data-tl-task="b"]').first();
    await blk.waitFor();
    await blk.hover();
    await expectHit(page, '[data-tl-block][data-tl-task="b"] [data-tl-timer]', 'block ▶');
    await expectHit(page, '[data-tl-zoom]', 'zoom toggle');
  });

  test('Agenda ▶ and Month "+N more"', async ({ page }) => {
    await open(page, { planView: 'schedule' });
    await page.locator('[data-sched-timer]').first().waitFor();
    await expectHit(page, '[data-sched-timer]', 'agenda ▶');
  });

  test('Habits: a day cell, Daily / Weekdays, a weekday, Mark today', async ({ page }) => {
    await open(page, { mainView: 'habits' });
    await page.locator('[data-habit-day]').first().waitFor();
    const cell = await hitBox(page, '[data-habit-day="0"]');
    expect(cell.h, 'a day cell is 24 tall').toBeGreaterThanOrEqual(MIN);
    expect(cell.w, 'and as wide as its 18px pitch: 14 cells cannot each take 24').toBeGreaterThanOrEqual(14);
    await expectHit(page, '[data-habit-sched="daily"]', 'Daily');
    await expectHit(page, '[data-habit-today]', 'Mark today');
    await expectHit(page, 'button[aria-label="Monday"]', 'weekday toggle');
    await expectHit(page, '[data-habit-name="h1"]', 'habit name');
  });

  test('Journal, Archive, Settings, detail, quick add, the filter popover', async ({ page }) => {
    await open(page, { mainView: 'journal' });
    await page.locator('[data-journal-coll="planning"]').waitFor();
    await expectHit(page, '[data-journal-coll="planning"]', 'Needs planning disclosure');
    await expectHit(page, '[data-planning-open]', 'Needs planning row');
    await expectHit(page, '[data-mood-core]', 'mood chip');

    await open(page, { mainView: 'archive' });
    await page.locator('[data-archive-open="z"]').waitFor();
    await expectHit(page, '[data-archive-open="z"]', 'archive row');
    await expectHit(page, '[data-archive-unarchive="z"]', 'Unarchive');

    await open(page, {});
    await page.getByRole('button', { name: 'Settings' }).click();
    await expectHit(page, '[data-settings-tab="scheduling"]', 'settings tab');
    await expectHit(page, '[data-row-mode="compact"]', 'row density');
    await page.locator('[data-settings-tab="scheduling"]').click();
    await expectHit(page, 'input[aria-label="Free time / day (min)"]', 'number field');
    await page.keyboard.press('Escape');

    await page.locator('[data-pp-filterbtn]').click();
    await expectHit(page, '[data-pp-chip="incl"]', 'filter chip');
    await expectHit(page, '[data-pp-archived-link]', 'Archived tasks link');
    await page.keyboard.press('Escape');

    await page.mouse.click(1590, 890);
    await page.keyboard.press('q');
    await expectHit(page, '[data-qa="quick-highlight-mirror"] ~ input, input[placeholder^="Quick add"]', 'quick add field');
  });
});

test.describe('keyboard', () => {
  test('top bar: Tab reaches the page tabs and Enter switches page', async ({ page }) => {
    await open(page, {});
    await page.locator('[data-topnav-tab="focus"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-topnav-tab="focus"]')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-topnav-tab="review"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('Settings tabs: arrows move and select', async ({ page }) => {
    await open(page, {});
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('[data-settings-tab="general"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-settings-tab="scheduling"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-settings-tab="scheduling"]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('[data-settings-tab="data"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('Focus: the hero\'s Start and a list row\'s ▶ work from the keyboard', async ({ page }) => {
    // Packed from now, so a block spans the present and the hero has a task.
    await open(page, { dashMode: 'focus' }, { settings: { dayStart: '00:00', dayEnd: '23:59', packFromNow: true } });
    const start = page.locator('[data-focus-hero-toggle]');
    await start.waitFor();
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-focus-hero-toggle="stop"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-focus-hero-toggle="start"]')).toBeVisible();
    const play = page.locator('[data-focus-row="b"] [data-focus-timer]');
    await play.focus();
    await page.keyboard.press('Space');
    await expect(play).toHaveAttribute('title', 'Stop timer');
  });

  test('Review and Journal: the arrows work from the keyboard', async ({ page }) => {
    await open(page, { dashMode: 'review' });
    const head = page.locator('[data-review-head]');
    await head.waitFor();
    const before = await head.innerText();
    const prev = head.locator('button').first();
    await prev.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => head.innerText()).not.toBe(before);

    await open(page, { mainView: 'journal' });
    const jprev = page.locator('[data-journal-nav="prev"]');
    await jprev.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-journal-nav="today"]')).toBeVisible();
    await page.locator('[data-journal-nav="today"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-journal-nav="today"]')).toHaveCount(0);
  });

  const navInfo = (page) => page.evaluate(() => { const a = document.activeElement;
    return a && a.hasAttribute('data-tl-nav') ? { day: Number(a.getAttribute('data-tl-nav-day')), start: Number(a.getAttribute('data-tl-nav')), task: a.getAttribute('data-tl-task') || a.getAttribute('data-sched-task') } : null; });
  const stops = (page) => page.evaluate(() => document.querySelectorAll('[data-plan-pane] [data-tl-nav][tabindex="0"]').length);

  test('Day view: the timeline is ONE Tab stop; ↑/↓ walk it in time; Tab leaves in one press; Enter opens', async ({ page }) => {
    await open(page, { planView: 'today' });
    await page.locator('[data-tl-block][data-tl-task="a"]').first().waitFor();
    await expect.poll(() => stops(page), 'exactly one block is a Tab stop').toBe(1);
    await page.locator('[data-tl-zoom]').focus();
    await page.keyboard.press('Tab');
    const first = await navInfo(page);
    expect(first, 'Tab lands on a block').toBeTruthy();
    await page.keyboard.press('Home');
    const top = await navInfo(page);
    await page.keyboard.press('ArrowDown');
    const next = await navInfo(page);
    expect(next.start, '↓ moves later in the day').toBeGreaterThan(top.start);
    await page.keyboard.press('ArrowUp');
    expect((await navInfo(page)).start).toBe(top.start);
    await page.keyboard.press('ArrowDown');
    expect(await stops(page), 'the stop follows the cursor').toBe(1);
    await page.keyboard.press('Tab');
    expect(await navInfo(page), 'one Tab leaves the timeline').toBeNull();
    await page.keyboard.press('Shift+Tab');
    expect((await navInfo(page)).start, 'and Shift+Tab comes back to the remembered block').toBe(next.start);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-pp-dialog="detail"]')).toBeVisible();
  });

  test('Week view: one Tab stop for the whole grid; ←/→ jump to the adjacent day', async ({ page }) => {
    await open(page, { planView: 'week' });
    await page.locator('[data-tl-block]').first().waitFor();
    await expect.poll(() => stops(page)).toBe(1);
    const days = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-plan-pane] [data-tl-nav]')].map((e) => Number(e.getAttribute('data-tl-nav-day'))))].sort((a, b) => a - b));
    expect(days.length, 'blocks on several days').toBeGreaterThan(1);
    await page.locator('[data-plan-pane] [data-tl-nav][data-tl-nav-day="' + days[0] + '"]').first().focus();
    await page.keyboard.press('ArrowRight');
    expect((await navInfo(page)).day, '→ goes to the next day with blocks').toBe(days[1]);
    await page.keyboard.press('ArrowLeft');
    expect((await navInfo(page)).day).toBe(days[0]);
    expect(await stops(page)).toBe(1);
  });

  test('Agenda: the chips are one Tab stop, walked by arrows', async ({ page }) => {
    await open(page, { planView: 'schedule' });
    await page.locator('[data-sched-block][data-tl-nav]').first().waitFor();
    await expect.poll(() => stops(page)).toBe(1);
    await page.locator('[data-plan-pane] [data-tl-nav][tabindex="0"]').focus();
    await page.keyboard.press('Home');
    const a = await navInfo(page);
    await page.keyboard.press('ArrowDown');
    const b = await navInfo(page);
    expect(b.start).toBeGreaterThanOrEqual(a.start);
    expect(b.task === a.task && b.start === a.start).toBe(false);
    await page.keyboard.press('Tab');
    expect(await navInfo(page)).toBeNull();
  });

  test('Plan sheet section headers: ↑ lands on the header; Enter, Shift+F10, Alt+↓ and Delete work', async ({ page }) => {
    await open(page, {});
    const row = page.locator('[data-pp-row][data-task-id="c"]');
    await row.waitFor();
    await row.focus();
    await page.keyboard.press('ArrowUp');
    const head = page.locator('[data-pp-sechead="s2"]');
    await expect(head).toBeFocused();
    // Enter collapses (its row goes), Enter again expands.
    await page.keyboard.press('Enter');
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-pp-row][data-task-id="c"]')).toHaveCount(0);
    await expect(head).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-pp-row][data-task-id="c"]')).toHaveCount(1);
    // Alt+↓ moves the section below Errands.
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[data-pp-sechead]')].map((e) => e.getAttribute('data-pp-sechead'))))
      .toEqual(['s1', 's3', 's2']);
    await expect(head).toBeFocused();
    // Shift+F10 opens the section menu; Escape returns to the header.
    await page.keyboard.press('Shift+F10');
    const menu = page.locator('[data-pp-secmenu="s2"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Rename/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(head).toBeFocused();
    // ↓ walks into the section's row.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-pp-row][data-task-id="c"]')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(head).toBeFocused();
    // Delete removes it (undoable), and its task moves to No section.
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-pp-sechead="s2"]')).toHaveCount(0);
    await expect(page.locator('[data-pp-row][data-task-id="c"]')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-pp-sechead="s2"]')).toHaveCount(1);
  });
});

test.describe('gestures still work from the new hit areas', () => {
  test('a habit day cell toggles under the real mouse', async ({ page }) => {
    await open(page, { mainView: 'habits' });
    const cell = page.locator('[data-habit-day="0"]').first();
    await cell.waitFor();
    const b = await cell.boundingBox();
    // Press 5px above the drawn cell, inside its 30px box.
    await page.mouse.click(b.x + b.width / 2, b.y - 3);
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
  });

  test('a timeline block still drags from its body', async ({ page }) => {
    await open(page, { planView: 'today' });
    const blk = page.locator('[data-tl-block][data-tl-task="b"]').first();
    await blk.waitFor();
    const before = await blk.boundingBox();
    const x = before.x + 60, y = before.y + Math.min(before.height / 2, 12);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 80, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks')).find((t) => t.id === 'b').pin))
      .toBeTruthy();
  });
});
