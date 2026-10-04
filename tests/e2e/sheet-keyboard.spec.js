// @ts-check
/* UI revamp block 6 — the sheet and selection model, under REAL input.
 *
 * The unit layer (tests/ui-revamp-sheet.test.js) pins the state machine: screen-order ranges, the bulk bar,
 * the row keys, the menu roles. What only a live mount can prove is the part that depends on the browser:
 *   - that a trusted double-click on a title reaches the inline editor even though the FIRST click opens
 *     the detail modal over the row (the reason detailDblFollowUp exists), and that it starts no timer;
 *   - that shift-click reads the rows the user SEES, across a section boundary;
 *   - that rows actually take focus, that the arrows and Shift+F10 reach onKey from a focused row, and that
 *     Escape hands focus back to the row the menu came from;
 *   - that a click on the Gantt's empty lane does not open a dialog.
 * Selection is read off `aria-selected`, which the row now carries for assistive tech; the row fill is the
 * same `isSel` fact (selection-keyboard.spec.js reads the paint).
 */
const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

/* Storage order t1, t2, t3, t4 — but Alpha (t2, t4) is drawn above Beta (t1, t3), so the screen reads
   t2, t4, t1, t3. A range that followed storage order would pick different rows. */
const SECTIONS = [{ id: 'sA', name: 'Alpha' }, { id: 'sB', name: 'Beta' }];
const TASKS = [
  task('t1', 'One in Beta', { sectionId: 'sB', start: '0d', end: '+1d' }),
  task('t2', 'Two in Alpha', { sectionId: 'sA', start: '0d', end: '+1d' }),
  task('t3', 'Three in Beta', { sectionId: 'sB', start: '0d', end: '+1d' }),
  task('t4', 'Four in Alpha', { sectionId: 'sA', start: '0d', end: '+1d' }),
];
const PREFS = { mainView: 'gantt' };

const row = (page, id) => page.locator(`[data-pp-row][data-task-id="${id}"]`);
const selectedIds = (page) => page.$$eval('[data-pp-row][aria-selected="true"]', (els) => els.map((e) => e.getAttribute('data-task-id')));
const running = (page) => page.evaluate(() => {
  try { return Object.keys(JSON.parse(localStorage.getItem('pp-run') || '{}')); } catch (e) { return ['UNPARSEABLE']; }
});
const detail = (page) => page.locator('[data-pp-dialog="detail"]');
const activeTaskId = (page) => page.evaluate(() => {
  const a = document.activeElement; return a ? a.getAttribute('data-task-id') : null;
});

async function bootSheet(page) {
  await boot(page, { tasks: TASKS, sections: SECTIONS, prefs: PREFS });
  await row(page, 't1').waitFor({ state: 'visible' });
}

/* Ctrl-click selects WITHOUT opening the detail modal, which is what lets a second click reach the sheet. */
async function ctrlClick(page, id) {
  await page.keyboard.down('Control');
  await row(page, id).locator('[data-task-name]').click();
  await page.keyboard.up('Control');
}

test('a trusted double-click on a title edits it inline; Enter saves; no timer starts and no dialog stays', async ({ page }) => {
  await bootSheet(page);
  await row(page, 't2').locator('[data-task-name]').dblclick();
  const input = page.locator('[data-pp-inline-title="t2"]');
  await expect(input, 'the title becomes an editor in the row').toBeVisible();
  await expect(input).toBeFocused();
  await expect(detail(page), 'the detail the first click opened is gone').toHaveCount(0);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Renamed in place');
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(row(page, 't2').locator('[data-task-name]')).toHaveText('Renamed in place');
  expect(await running(page), 'double-click no longer starts a timer').toEqual([]);
  await expect(detail(page)).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks')).find((t) => t.id === 't2').name);
  expect(stored).toBe('Renamed in place');
});

test('Escape abandons an inline edit', async ({ page }) => {
  await bootSheet(page);
  await row(page, 't4').locator('[data-task-name]').dblclick();
  await expect(page.locator('[data-pp-inline-title="t4"]')).toBeFocused();
  await page.keyboard.type('never saved');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-pp-inline-title="t4"]')).toHaveCount(0);
  await expect(row(page, 't4').locator('[data-task-name]')).toHaveText('Four in Alpha');
});

test('shift-click selects across a section boundary in SCREEN order and raises the bulk bar', async ({ page }) => {
  await bootSheet(page);
  await ctrlClick(page, 't2');
  await expect(detail(page)).toHaveCount(0);
  await page.keyboard.down('Shift');
  await row(page, 't1').locator('[data-task-name]').click();
  await page.keyboard.up('Shift');
  /* Screen order t2 → t4 → t1 crosses Alpha → Beta. Storage order would have given t1, t2 and skipped t4. */
  expect((await selectedIds(page)).sort()).toEqual(['t1', 't2', 't4']);
  const bar = page.locator('[data-pp-bulkbar]');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[data-pp-bulk-count]')).toHaveText('3 selected');
  /* Same strip height as the filter bar it replaces, so the sheet's rows stay level with the Gantt's. */
  const sheetTop = await row(page, 't2').boundingBox();
  const laneTop = await page.locator('[data-gantt-task-id="t2"]').boundingBox();
  expect(Math.abs(sheetTop.y - laneTop.y)).toBeLessThanOrEqual(1.5);
  await bar.locator('[data-pp-bulk="clear"]').click();
  expect(await selectedIds(page)).toEqual([]);
  await expect(page.locator('[data-pp-filterbar]')).toBeVisible();
});

test('a click on empty sheet space deselects', async ({ page }) => {
  await bootSheet(page);
  await ctrlClick(page, 't3');
  expect(await selectedIds(page)).toEqual(['t3']);
  const pane = await page.locator('[data-sheet-pane]').boundingBox();
  await page.mouse.click(pane.x + 60, pane.y + pane.height - 20); /* below the last row */
  await expect.poll(() => selectedIds(page)).toEqual([]);
});

test('arrow keys move a focused row in screen order; Shift+F10 opens the row menu; Esc returns focus', async ({ page }) => {
  await bootSheet(page);
  await ctrlClick(page, 't2');
  await expect.poll(() => activeTaskId(page), { message: 'a clicked row takes focus' }).toBe('t2');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedIds(page)).toEqual(['t4']);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedIds(page), { message: '↓ crosses into the next section' }).toEqual(['t1']);
  expect(await activeTaskId(page)).toBe('t1');

  await page.keyboard.press('Shift+F10');
  const menu = page.locator('[data-pp-menu="row"]');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('role', 'menu');
  const focusedItem = () => page.evaluate(() => {
    const a = document.activeElement; return a ? [a.getAttribute('role'), a.textContent] : null;
  });
  await expect.poll(focusedItem).toEqual(['menuitem', expect.stringContaining('Open details')]);
  await page.keyboard.press('ArrowDown');
  await expect.poll(focusedItem).toEqual(['menuitem', expect.stringContaining('Rename')]);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => activeTaskId(page), { message: 'focus is back on the row' }).toBe('t1');

  /* Enter on a menu item activates it: Rename opens the inline editor. */
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-pp-inline-title="t1"]')).toBeFocused();
  await page.keyboard.press('Escape');

  /* F2 renames, Enter opens details. */
  await row(page, 't1').focus();
  await page.keyboard.press('Enter');
  await expect(detail(page)).toBeVisible();
});

test('a click (or double-click) on the Gantt empty lane never opens a dialog or a timer', async ({ page }) => {
  await bootSheet(page);
  const lane = page.locator('[data-gantt-task-id="t3"]');
  const plan = await page.locator('[data-plan-pane]').boundingBox();
  const lb = await lane.boundingBox();
  /* Far right of the visible pane, on t3's lane — blank timeline, nowhere near its one-day bar. */
  const x = plan.x + plan.width - 40, y = lb.y + lb.height / 2;
  const hit = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py); return el ? el.getAttribute('data-gantt-task-id') : null;
  }, [x, y]);
  expect(hit, 'the probe point really is the lane stripe').toBe('t3');
  await page.mouse.click(x, y);
  await expect(detail(page)).toHaveCount(0);
  await expect.poll(() => selectedIds(page), { message: 'the lane still selects its row' }).toEqual(['t3']);
  await page.mouse.dblclick(x, y);
  await expect(detail(page)).toHaveCount(0);
  expect(await running(page)).toEqual([]);
});

test('? opens the shortcut sheet as a dialog, and Esc closes it', async ({ page }) => {
  await bootSheet(page);
  await page.keyboard.press('?');
  const sheet = page.locator('[data-pp-dialog="keys"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await expect(sheet.locator('[data-qa="keys-close"]')).toBeFocused();
  await expect(sheet).toContainText('Rename in place');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});
