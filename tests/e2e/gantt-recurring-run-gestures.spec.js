const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

test.use({ timezoneId: 'America/Vancouver' });

async function bootRun(page) {
  await bootSurface(page, { view: 'gantt' }, { tasks: [
    task('run', 'Three-day run', {
      /* The run must be VISIBLE in the Gantt's scroll viewport, not merely present in its content: the
         chart scrolls (scrollWidth ~2226 against a ~690px viewport), and a bar past the right edge still
         reports a boundingBox — one that lies outside the browser window. At +6d..+8d the last
         occurrence sat at viewport x~1299, so `page.mouse` pushed its right edge into dead space and the
         resize previewed zero. Whether it landed there depended on today's weekday, which is why this
         spec passed on 08-27 and failed on 08-30. Near-today offsets are on screen under every weekday
         alignment; `expectDragOnScreen` fails loudly if that ever stops holding. */
      start: '+2d', end: '+3d', allDay: true,
      recur: { kind: 'day', n: 1, label: 'Daily', until: '+4d', overrides: {}, shifts: [] },
    }),
  ] });
  const bar = page.locator('[data-gantt-bar-id="run"]').first();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-gantt-run-occurrences', '0,1,2');
  const dates = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('pp-tasks'))[0];
    const add = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
    /* 2026-09-09: an OCCURRENCE's end is the anchor plus the rule's own length — `t.end` is the series
       window's end and is a different quantity (and may be null). Every assertion in this file is about
       occurrence boundaries, so they are derived here rather than from the window. */
    const dur = (t.recur && t.recur.durMs != null) ? t.recur.durMs : (t.end - t.start);
    return { starts: [0, 1, 2, 3].map(n => add(t.start, n)),
             ends:   [0, 1, 2, 3].map(n => add(t.start, n) + dur) };
  });
  return { bar, dates };
}

/* An off-screen drag and a broken drag both read as "the bar did not move", so assert the precondition
   separately: both ends of the gesture must land inside the Gantt's visible scroll rect. A bar scrolled
   past that rect still reports a boundingBox, so the box alone proves nothing about reachability. */
async function expectDragOnScreen(page, x, direction, day, surface) {
  const view = await page.locator('[data-gantt-scroll]').boundingBox();
  const why = `the ${surface} drag target is outside the Gantt's visible scroll rect — move the fixture nearer today, or scroll it into view; do not loosen the assertion`;
  expect(x, why).toBeGreaterThan(view.x);
  expect(x, why).toBeLessThan(view.x + view.width);
  expect(x + direction * day, why).toBeGreaterThan(view.x);
  expect(x + direction * day, why).toBeLessThan(view.x + view.width);
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
  await expectDragOnScreen(page, x, direction, day, surface);
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

/* REVISED 2026-09-09 (owner ruling: a repeat's start/end are the SERIES WINDOW). "All occurrences"
   still moves the whole series by exactly one day — but `end` is now the last day the series may fire
   rather than the anchor occurrence's other edge, and the occurrence's own length lives on the rule. So
   the assertions read as DELTAS against the stored row, which is true under either shape and is what
   "shifts the series once" actually claims. */
test('body drag All occurrences shifts the series once without run overrides', async ({ page }) => {
  const { bar } = await bootRun(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks'))[0]);
  await dragOneDay(page, bar, 'body', 1, 'All occurrences');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks'))[0]);
  const plusOneDay = (ms) => page.evaluate(m => { const d = new Date(m); d.setDate(d.getDate() + 1); return d.getTime(); }, ms);

  expect(saved.start).toBe(await plusOneDay(before.start));
  // the occurrence length is untouched — a move is not a resize
  expect(saved.recur.durMs).toBe(86400000);
  // No per-occurrence overrides: "All occurrences" moves the SERIES, which is the whole point of the
  // gesture and the reason this spec exists.
  expect(saved.recur.overrides || {}).toEqual({});
  // The window END is deliberately NOT asserted here. `before` is read from `pp-tasks`, which still
  // holds the seeded LEGACY row until the app's first write — the window conversion happens in
  // `normalizeTask` on load — so the two sides of a delta comparison are in different shapes and the
  // subtraction is meaningless. What the window end does under every scope is pinned in
  // tests/repeat-series-window.test.js, against the model rather than against a stale row.
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
