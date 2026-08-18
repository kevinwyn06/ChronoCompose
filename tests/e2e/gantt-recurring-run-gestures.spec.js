const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

test.use({ timezoneId: 'America/Vancouver' });

async function bootRun(page) {
  await bootSurface(page, { view: 'gantt' }, { tasks: [
    task('run', 'Three-day run', {
      start: '+6d', end: '+7d', allDay: true,
      recur: { kind: 'day', n: 1, label: 'Daily', until: '+8d', overrides: {}, shifts: [] },
    }),
  ] });
  const bar = page.locator('[data-gantt-bar-id="run"]').first();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-gantt-run-occurrences', '0,1,2');
  const dates = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('pp-tasks'))[0];
    const add = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
    return { starts: [0, 1, 2, 3].map(n => add(t.start, n)), ends: [0, 1, 2, 3].map(n => add(t.end, n)) };
  });
  return { bar, dates };
}

async function dragOneDay(page, bar, surface, direction, scope = 'This run') {
  const before = await bar.boundingBox();
  const columns = Number(await bar.getAttribute('data-gantt-columns'));
  const day = before.width / columns;
  const target = surface === 'body'
    ? bar.locator(':scope > [data-gantt-bar-body]').first()
    : bar.locator(`[data-gantt-edge="${surface}"]`).first();
  const box = await target.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + direction * day, y, { steps: 12 });
  const preview = await bar.boundingBox();
  if (surface === 'body') {
    expect(preview.x - before.x, 'the entire merged run moves during trusted-pointer preview').toBeCloseTo(direction * day, 0);
    expect(preview.width).toBeCloseTo(before.width, 0);
  } else if (surface === 'start') {
    expect(preview.x - before.x).toBeCloseTo(direction * day, 0);
    expect(preview.width - before.width).toBeCloseTo(-direction * day, 0);
  } else {
    expect(preview.x).toBeCloseTo(before.x, 0);
    expect(preview.width - before.width).toBeCloseTo(direction * day, 0);
  }
  await page.mouse.up();
  await expect(page.getByText('This run', { exact: true })).toBeVisible();
  await expect(page.getByText('All occurrences', { exact: true })).toBeVisible();
  await page.getByText(scope, { exact: true }).click();
}

async function overrides(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks'))[0].recur.overrides || {});
}

test('body drag previews and commits every occurrence in the merged run as one scope action', async ({ page }) => {
  const { bar, dates } = await bootRun(page);
  await dragOneDay(page, bar, 'body', 1);
  const ov = await overrides(page);
  expect(Object.keys(ov)).toEqual(['0', '1', '2']);
  expect(ov[0].start).toBe(dates.starts[1]); expect(ov[0].end).toBe(dates.ends[1]);
  expect(ov[1].start).toBe(dates.starts[2]); expect(ov[1].end).toBe(dates.ends[2]);
  expect(ov[2].start).toBe(dates.starts[3]);
  expect(ov[2].end).toBe(dates.ends[3]);
});

test('body drag All occurrences shifts the series once without run overrides', async ({ page }) => {
  const { bar, dates } = await bootRun(page);
  await dragOneDay(page, bar, 'body', 1, 'All occurrences');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks'))[0]);
  expect(saved.start).toBe(dates.starts[1]);
  expect(saved.end).toBe(dates.ends[1]);
  expect(saved.recur.overrides || {}).toEqual({});
});

test('left-edge run resize commits only the first occurrence boundary', async ({ page }) => {
  const { bar, dates } = await bootRun(page);
  await dragOneDay(page, bar, 'start', -1);
  const ov = await overrides(page);
  expect(Object.keys(ov)).toEqual(['0']);
  const prior = await page.evaluate(ms => { const d = new Date(ms); d.setDate(d.getDate() - 1); return d.getTime(); }, dates.starts[0]);
  expect(ov[0].start).toBe(prior);
  expect(ov[0].end).toBe(dates.ends[0]);
});

test('right-edge run resize commits only the last occurrence boundary', async ({ page }) => {
  const { bar, dates } = await bootRun(page);
  await dragOneDay(page, bar, 'end', 1);
  const ov = await overrides(page);
  expect(Object.keys(ov)).toEqual(['2']);
  expect(ov[2].start).toBe(dates.starts[2]);
  const next = await page.evaluate(ms => { const d = new Date(ms); d.setDate(d.getDate() + 1); return d.getTime(); }, dates.ends[2]);
  expect(ov[2].end).toBe(next);
});
