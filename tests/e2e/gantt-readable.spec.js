/* UI revamp block 7 — a readable Gantt, and feedback DURING a gesture.
 *
 * The unit layer (tests/ui-revamp-gantt.test.js) owns the decisions: where a label goes, the tooltip and
 * chip strings, the hue, the ink, the hit-box arithmetic. What only a live mount can show is pinned here,
 * with real trusted pointer input (`page.mouse`) throughout:
 *   • a bar paints its name and wears its section's hue;
 *   • hovering a bar raises the drawn tooltip AND fills its sheet row; hovering the row rings the bar;
 *   • mid-drag, a chip near the pointer names the dates the release will write; the release toasts;
 *   • the grip's hit box really renders ≥ 24px and a press on its outside part really resizes;
 *   • a Week-view block drag shows its landing time;
 *   • Shift+F10 → "Dates and progress…" opens the bar menu from the keyboard.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, bootDays, cleanDaySettings, timelineBlocks, task } = require('./_seed');

const SECTIONS = [
  { id: 'sWork', name: 'Work', order: 0, color: '#3b82f6' },
  { id: 'sHome', name: 'Home', order: 1, color: '#f59e0b' },
];
const fixture = () => ({
  sections: SECTIONS,
  tasks: [
    task('a', 'Ship the release', { start: '+1d', end: '+5d', planned: 90, sectionId: 'sWork' }),
    task('b', 'Renew passport', { start: '+2d', end: '+2d', planned: 45, sectionId: 'sHome' }),
  ],
});

const bar = (page, id) => page.locator(`[data-gantt-bar-id="${id}"]`).first();
const barBody = (page, id) => bar(page, id).locator('[data-gantt-bar-body]');
const sheetRow = (page, id) => page.locator(`[data-pp-row][data-task-id="${id}"]`);
const chip = (page) => page.locator('[data-drag-chip]');
const toast = (page) => page.locator('[data-pp-toast]');

async function bootGantt(page) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootSurface(page, { view: 'gantt' }, fixture());
  await bar(page, 'a').waitFor({ state: 'visible', timeout: 15000 });
  await page.mouse.move(2, 2);
}
const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/* The app's own long date register ("Wed Oct 07"), evaluated in the page's zone. */
const fmtDay = (page, offsetDays) => page.evaluate((n) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return wd + ' ' + mo + ' ' + String(d.getDate()).padStart(2, '0');
}, offsetDays);

test('a bar paints its name and wears its section hue', async ({ page }) => {
  await bootGantt(page);
  const lab = page.locator('[data-gantt-label-task="a"]');
  await expect(lab).toBeVisible();
  await expect(lab).toHaveText('Ship the release');
  await expect(lab).toHaveAttribute('data-gantt-label', 'inside');
  /* UI revamp block 8: the body is the section hue TONED toward the pane — same hue, quieter. The hue itself
     rides on data-gantt-hue; the painted colour must keep that hue's direction and lose saturation. */
  await expect(barBody(page, 'a')).toHaveAttribute('data-gantt-hue', '#3b82f6');
  await expect(barBody(page, 'b')).toHaveAttribute('data-gantt-hue', '#f59e0b');
  for (const [id, hue] of [['a', [59, 130, 246]], ['b', [245, 158, 11]]]) {
    const rgb = (await barBody(page, id).evaluate((el) => getComputedStyle(el).backgroundColor)).match(/\d+/g).map(Number);
    const h = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };
    expect(rgb, `${id}: toned, not the raw hue`).not.toEqual(hue);
    expect(Math.abs(((h(rgb) - h(hue) + 540) % 360) - 180), `${id}: the same hue family`).toBeLessThan(12);
  }
  /* The one-day bar cannot hold its name inside; it is painted beside the bar instead. */
  await expect(page.locator('[data-gantt-label-task="b"]')).toHaveAttribute('data-gantt-label', 'outside');
  await expect(page.locator('[data-gantt-label-task="b"]')).toBeVisible();
});

test('hovering a bar shows the tooltip and fills its row; hovering the row rings the bar', async ({ page }) => {
  await bootGantt(page);
  const restBg = await sheetRow(page, 'a').evaluate((el) => getComputedStyle(el).backgroundColor);

  await page.mouse.move(...Object.values(centre(await barBody(page, 'a').boundingBox())));
  const tip = page.locator('[data-gantt-tooltip="a"]');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Ship the release');
  await expect(tip).toContainText(`${await fmtDay(page, 1)} → ${await fmtDay(page, 5)} · 1:30 planned`);
  await expect.poll(() => sheetRow(page, 'a').evaluate((el) => getComputedStyle(el).backgroundColor),
    { message: 'the bar hover fills its sheet row' }).not.toBe(restBg);

  await page.mouse.move(2, 2);
  await expect(tip).toHaveCount(0);
  await expect(barBody(page, 'a')).not.toHaveAttribute('data-gantt-hover', '1');

  const nameCell = await sheetRow(page, 'a').locator('[data-cellk="name"]').boundingBox();
  await page.mouse.move(nameCell.x + nameCell.width / 2, nameCell.y + nameCell.height / 2);
  await expect(barBody(page, 'a'), 'the row hover rings its bar').toHaveAttribute('data-gantt-hover', '1');
  const ring = await barBody(page, 'a').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring, 'a real ring, not the resting shadow').toMatch(/0px 0px 0px 2px/);
});

test('mid-drag a chip names the new dates; the release toasts', async ({ page }) => {
  await bootGantt(page);
  const b = await barBody(page, 'a').boundingBox();
  const cols = Number(await bar(page, 'a').getAttribute('data-gantt-columns'));
  const perDay = b.width / cols;
  const p = centre(b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2 * perDay, p.y, { steps: 12 });
  await expect(chip(page)).toBeVisible();
  await expect(chip(page)).toHaveAttribute('data-drag-chip', 'gantt');
  await expect(chip(page)).toHaveText(`${await fmtDay(page, 3)} → ${await fmtDay(page, 7)} (+2d)`);
  /* It sits beside the pointer, in viewport px — the uiPt conversion under the 0.8 shell. */
  const cb = await chip(page).boundingBox();
  expect(Math.abs(cb.x - (p.x + 2 * perDay)), 'the chip is anchored at the pointer, not 0.8× away').toBeLessThan(40);
  expect(cb.y).toBeGreaterThan(p.y);
  await page.mouse.up();
  await expect(chip(page)).toHaveCount(0);
  await expect(toast(page)).toContainText('Moved “Ship the release”');
});

test('a grip renders a ≥24px hit box, and a press on its outside part resizes the bar', async ({ page }) => {
  await bootGantt(page);
  const b = await barBody(page, 'a').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); /* the extension is live while the bar is hovered */
  const inner = await page.locator('[data-gantt-edge="end"][data-gantt-edge-task="a"]').boundingBox();
  const ext = page.locator('[data-gantt-edge-ext="end"][data-gantt-edge-ext-task="a"]');
  const outer = await ext.boundingBox();
  const hitW = (outer.x + outer.width) - inner.x;
  expect(hitW, 'inside + outside grip renders at HIT_MIN_PX').toBeGreaterThanOrEqual(23.5);
  expect(outer.height, 'and is as tall').toBeGreaterThanOrEqual(23.5);
  const dot = await page.locator('[data-dep-dot-out="a"]').boundingBox();
  expect(dot.width, 'the link dot box renders at HIT_MIN_PX').toBeGreaterThanOrEqual(23.5);
  expect(dot.x, 'the dot starts past the grip extension').toBeGreaterThanOrEqual(outer.x + outer.width - 0.5);

  /* A press 12px right of the bar's end — outside the bar — is hit-tested to the grip, not the lane. */
  const px = b.x + b.width + 12, py = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width - 3, py);
  await page.mouse.move(px, py, { steps: 3 });
  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y); return el && el.getAttribute('data-gantt-edge-ext');
  }, [px, py]);
  expect(hit, 'elementFromPoint lands on the extension').toBe('end');
  const cols = Number(await bar(page, 'a').getAttribute('data-gantt-columns'));
  await page.mouse.down();
  await page.mouse.move(px + b.width / cols, py, { steps: 8 });
  await expect(chip(page)).toHaveText(`End ${await fmtDay(page, 6)} (+1d)`);
  await page.mouse.up();
  await expect(bar(page, 'a')).toHaveAttribute('data-gantt-columns', String(cols + 1));
});

test('a Week-view block drag shows where the block will land', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootDays(page, 'week', {
    settings: cleanDaySettings('10:00'),
    tasks: [task('w', 'Write report', { start: '0d', end: '+2d', planned: 60, sectionId: 'sWork' })],
    sections: SECTIONS,
  });
  const blocks = (await timelineBlocks(page)).filter((x) => x.taskId === 'w' && x.kind === 'auto');
  expect(blocks.length, 'the task draws a draggable block').toBeGreaterThan(0);
  const g = blocks[0];
  const cx = g.x + g.w / 2, cy = g.y + Math.min(8, g.h / 2);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 40, { steps: 8 });
  await page.mouse.move(cx, cy + 80, { steps: 8 });
  await expect(chip(page)).toHaveAttribute('data-drag-chip', 'block');
  await expect(chip(page)).toHaveText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}(am|pm) – \d{1,2}:\d{2}(am|pm)/);
  const cb = await chip(page).boundingBox();
  expect(Math.abs(cb.y - (cy + 80)), 'the chip follows the pointer').toBeLessThan(40);
  await page.mouse.up();
  await expect(chip(page)).toHaveCount(0);
});

test('Shift+F10 → "Dates and progress…" opens the bar menu from the keyboard; Esc returns to the row', async ({ page }) => {
  await bootGantt(page);
  await page.keyboard.down('Control');
  await sheetRow(page, 'a').locator('[data-task-name]').click();
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-task-id'))).toBe('a');
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('[data-pp-menu="row"]')).toBeVisible();
  const focused = () => page.evaluate(() => (document.activeElement && document.activeElement.textContent) || '');
  for (let i = 0; i < 6 && !(await focused()).includes('Dates and progress'); i++) await page.keyboard.press('ArrowDown');
  expect(await focused()).toContain('Dates and progress');
  await page.keyboard.press('Enter');
  const menu = page.locator('[data-pp-menu="bar"]');
  await expect(menu).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(document.activeElement && document.activeElement.closest('[data-pp-menu="bar"]'))),
    { message: 'focus moved into the bar menu' }).toBe(true);
  /* Anchored under the bar it edits, not at the corner of the screen. */
  const mb = await menu.boundingBox(), bb = await barBody(page, 'a').boundingBox();
  expect(mb.y).toBeGreaterThan(bb.y);
  expect(Math.abs(mb.x - bb.x)).toBeLessThan(60);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-task-id')),
    { message: 'focus is back on the row' }).toBe('a');
});
