const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

test.use({ timezoneId: 'America/Vancouver' });

const stamp = (y, mo, d, h = 9, mi = 15) => new Date(y, mo, d, h, mi, 0, 0).getTime();

async function stored(page, id) {
  return page.evaluate((tid) => {
    const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((x) => x.id === tid);
    return t && { start: t.start, end: t.end };
  }, id);
}

async function dragBodyOneColumn(page, id) {
  const bar = page.locator(`[data-gantt-bar-id="${id}"]`).first();
  await expect(bar).toBeVisible();
  const before = await bar.boundingBox();
  const body = bar.locator(':scope > [data-gantt-bar-body]').first();
  const b = await body.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const columns = Number(await bar.getAttribute('data-gantt-columns'));
  const renderedDay = before.width / columns;
  await page.mouse.move(b.x + b.width / 2 + renderedDay, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  const after = await bar.boundingBox();
  expect(after.x - before.x, 'paint advances exactly one rendered date column').toBeCloseTo(renderedDay, 0);
}

for (const c of [
  { label: 'spring-forward', start: stamp(2026, 2, 7), next: stamp(2026, 2, 8) },
  { label: 'fall-back', start: stamp(2026, 9, 31), next: stamp(2026, 10, 1) },
]) {
  test(`trusted body drag preserves clock time across ${c.label}`, async ({ page }) => {
    const end = new Date(c.start); end.setDate(end.getDate() + 2);
    const early = new Date(c.start); early.setDate(early.getDate() - 10);
    const late = new Date(c.start); late.setDate(late.getDate() + 10);
    await bootSurface(page, { view: 'gantt' }, { tasks: [
      task('dst', 'DST task', { start: c.start, end: end.getTime(), startClock: true, endClock: true }),
      task('anchor-a', 'Earlier anchor', { start: early.getTime(), end: early.getTime() }),
      task('anchor-b', 'Later anchor', { start: late.getTime(), end: late.getTime() }),
    ] });
    await dragBodyOneColumn(page, 'dst');
    const got = await stored(page, 'dst');
    expect(got.start).toBe(c.next);
    const expectedEnd = new Date(end); expectedEnd.setDate(expectedEnd.getDate() + 1);
    expect(got.end).toBe(expectedEnd.getTime());
  });
}

test('start-only right edge moves one visible column left and stores that inclusive date', async ({ page }) => {
  const start = stamp(2026, 7, 18);
  await bootSurface(page, { view: 'gantt' }, { tasks: [
    task('open', 'Open end', { start, end: null }),
    task('anchor', 'Range anchor', { start: stamp(2026, 7, 1, 0, 0), end: stamp(2026, 11, 1, 0, 0) }),
  ] });
  const bar = page.locator('[data-gantt-bar-id="open"]').first();
  const edge = page.locator('[data-gantt-edge="end"][data-gantt-edge-task="open"]').first();
  await expect(edge).toBeAttached();
  await page.locator('[data-gantt-scroll]').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(100);
  const before = await bar.boundingBox();
  const e = await edge.boundingBox();
  const columns = Number(await bar.getAttribute('data-gantt-columns'));
  const renderedDay = before.width / columns;
  const origin = Number(await bar.getAttribute('data-gantt-last-day'));
  const expectedEnd = await page.evaluate((ms) => { const d = new Date(ms); d.setDate(d.getDate() - 1); return d.getTime(); }, origin);
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2 - renderedDay, e.y + e.height / 2, { steps: 10 });
  await page.mouse.up();
  const after = await bar.boundingBox();
  expect((after.x + after.width) - (before.x + before.width),
    'one-column left drag moves the painted right edge left by one date column').toBeCloseTo(-renderedDay, 0);
  const got = await stored(page, 'open');
  expect(got.end, 'the stored end is the inclusive date one column left of the painted edge').toBe(expectedEnd);
});

for (const direction of [-1, 1]) {
  test(`all-day start-only right edge moves ${direction < 0 ? 'left' : 'right'} one column and stores an exclusive boundary`, async ({ page }) => {
    const start = stamp(2026, 7, 18, 0, 0);
    await bootSurface(page, { view: 'gantt' }, { tasks: [
      task('open-all-day', 'Open all-day end', { start, end: null, allDay: true }),
      task('anchor', 'Range anchor', { start: stamp(2026, 7, 1, 0, 0), end: stamp(2026, 11, 1, 0, 0) }),
    ] });
    const bar = page.locator('[data-gantt-bar-id="open-all-day"]').first();
    const edge = page.locator('[data-gantt-edge="end"][data-gantt-edge-task="open-all-day"]').first();
    await expect(edge).toBeAttached();
    await page.locator('[data-gantt-scroll]').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(100);
    const before = await bar.boundingBox();
    const e = await edge.boundingBox();
    const columns = Number(await bar.getAttribute('data-gantt-columns'));
    const renderedDay = before.width / columns;
    const lastInclusiveDay = Number(await bar.getAttribute('data-gantt-last-day'));
    const expectedEnd = await page.evaluate(({ ms, days }) => {
      const d = new Date(ms); d.setDate(d.getDate() + days); return d.getTime();
    }, { ms: lastInclusiveDay, days: direction < 0 ? 0 : 2 });
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await page.mouse.down();
    await page.mouse.move(e.x + e.width / 2 + direction * renderedDay, e.y + e.height / 2, { steps: 10 });
    await page.mouse.up();
    const after = await bar.boundingBox();
    expect((after.x + after.width) - (before.x + before.width),
      'the painted right edge follows the trusted pointer by one date column').toBeCloseTo(direction * renderedDay, 0);
    const got = await stored(page, 'open-all-day');
    expect(got.end, 'all-day storage keeps the day after the last included date').toBe(expectedEnd);
  });
}
