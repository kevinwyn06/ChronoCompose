const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

/* Owner report: "a task cannot be dragged to become the bottom-most task in a section — it is currently
   impossible entirely."
   A gap index is SHARED by the band that ends there and the band that starts there, so while the index and
   the section were resolved in two independent passes, "after the last row of S" had no representation of
   its own: the insertion rule was painted at the top of the NEXT section's first row, i.e. under that
   section's header. `resolveRowInsert` now resolves index + section + `atEnd` in one pass and `rowDropDeco`
   draws on the last row's BOTTOM edge when `atEnd`.

   This belongs in the browser layer for one reason: it is a real trusted pointer drag whose outcome depends
   on hit-testing and the 4px promotion threshold, and the paint position it proves is a live layout fact.
   A dispatched MouseEvent would prove neither. */

const SECTIONS = [
  { id: 's1', name: 'Research', order: 0 },
  { id: 's2', name: 'Admin', order: 1 },
];

const rowOf = (page, id) => page.locator(`[data-task-id="${id}"]:not([data-card-id])`);
const header = (page, id) => page.locator(`[data-section-id="${id}"]`);

/** The sheet, in document order, as an interleaved list of section headers and task rows. */
async function sheetOrder(page) {
  return page.$$eval('[data-section-id], [data-task-id]:not([data-card-id])', (els) => els.map((el) => (
    el.hasAttribute('data-section-id')
      ? { kind: 'section', id: el.getAttribute('data-section-id') || '(none)' }
      : { kind: 'row', id: el.getAttribute('data-task-id') }
  )));
}

/** Which section each task is PERSISTED into — the DOM order alone could be a paint that never committed. */
async function storedSections(page) {
  return page.evaluate(() => {
    const out = {};
    JSON.parse(localStorage.getItem('pp-tasks') || '[]').forEach((t) => { out[t.id] = t.sectionId === undefined ? null : t.sectionId; });
    return out;
  });
}

async function storedOrderInSection(page, sectionId) {
  return page.evaluate((sid) => JSON.parse(localStorage.getItem('pp-tasks') || '[]')
    .filter((t) => (t.sectionId === undefined ? null : t.sectionId) === sid)
    .map((t) => t.id), sectionId);
}

/**
 * A real drag that releases in the LOWER half of `toId`'s row — the gesture that means "put it below this
 * row". Stepped, so the app promotes the pending drag and re-resolves the drop on every move exactly as it
 * does under a human hand.
 */
async function dragBelowRow(page, fromId, toId, midDrag) {
  /* Anchored on the NAME cell rather than the row's geometric centre: every other data column in
     the sheet is an interactive control (the Planned input, the %-done drag track, the Time-needed
     chip), so a row's midpoint is whichever column the current widths happen to put there — adding
     one column moved it onto the Planned input and turned this into a false failure. The name cell
     is the row's neutral surface, and where a user actually presses to open or drag a task. */
  const a = await rowOf(page, fromId).locator('[data-cellk="name"]').boundingBox();
  const b = await rowOf(page, toId).boundingBox();
  const targetY = b.y + b.height - 3; /* unambiguously the lower half, and still inside the row */
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, targetY, { steps: 12 });
  await page.mouse.move(a.x + a.width / 2 + 1, targetY, { steps: 3 });
  if (midDrag) await midDrag();
  await page.mouse.up();
}

async function dragIntoBand(page, fromId, sectionId) {
  const a = await rowOf(page, fromId).locator('[data-cellk="name"]').boundingBox();
  const band = await header(page, sectionId).boundingBox();
  const x = a.x + a.width / 2;
  const y = band.y + band.height / 2;
  await page.mouse.move(x, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.move(x + 1, y, { steps: 3 });
  await page.mouse.up();
}

test('bottom drop stays last when persisted task order is interleaved across sections', async ({ page }) => {
  await boot(page, {
    sections: SECTIONS.concat([{ id: 's3', name: 'Later', order: 2 }]),
    /* Deliberately NOT section-contiguous. The sheet projection groups these as a1, a2 | b1 | c1,
       but real workspaces retain one global manual order and can therefore store this interleaving. */
    tasks: [
      task('b1', 'Beta one', { sectionId: 's2', start: '0d', end: '+1d' }),
      task('c1', 'Charlie one', { sectionId: 's3', start: '0d', end: '+1d' }),
      task('a1', 'Alpha one', { sectionId: 's1', start: '0d', end: '+1d' }),
      task('a2', 'Alpha two', { sectionId: 's1', start: '0d', end: '+1d' }),
    ],
  });

  let indicator = null;
  await dragBelowRow(page, 'b1', 'a2', async () => {
    indicator = {
      rule: await page.locator('[data-drop-rule]').boundingBox(),
      last: await rowOf(page, 'a2').boundingBox(),
    };
  });

  expect(Math.abs(indicator.rule.y - (indicator.last.y + indicator.last.height)),
    'pre-drop paint identifies the bottom gap correctly').toBeLessThan(4);
  expect(await sheetOrder(page)).toEqual([
    { kind: 'section', id: 's1' }, { kind: 'row', id: 'a1' }, { kind: 'row', id: 'a2' }, { kind: 'row', id: 'b1' },
    { kind: 'section', id: 's2' },
    { kind: 'section', id: 's3' }, { kind: 'row', id: 'c1' },
  ]);
  expect(await storedSections(page)).toMatchObject({ a1: 's1', a2: 's1', b1: 's1', c1: 's3' });
});

test('dropping into a collapsed populated band appends after its hidden rows', async ({ page }) => {
  await boot(page, {
    sections: SECTIONS.concat([{ id: 's3', name: 'Later', order: 2 }]),
    prefs: { collapsedSections: { s1: 1 } },
    tasks: [
      task('b1', 'Beta one', { sectionId: 's2', start: '0d', end: '+1d' }),
      task('c1', 'Charlie one', { sectionId: 's3', start: '0d', end: '+1d' }),
      task('a1', 'Alpha one', { sectionId: 's1', start: '0d', end: '+1d' }),
      task('a2', 'Alpha two', { sectionId: 's1', start: '0d', end: '+1d' }),
    ],
  });

  await dragIntoBand(page, 'b1', 's1');

  expect(await storedSections(page)).toMatchObject({ a1: 's1', a2: 's1', b1: 's1', c1: 's3' });
  expect(await storedOrderInSection(page, 's1')).toEqual(['a1', 'a2', 'b1']);
});

test('dropping into an empty band commits it as that band\'s only row', async ({ page }) => {
  await boot(page, {
    sections: SECTIONS.concat([{ id: 's3', name: 'Later', order: 2 }]),
    tasks: [
      task('b1', 'Beta one', { sectionId: 's2', start: '0d', end: '+1d' }),
      task('c1', 'Charlie one', { sectionId: 's3', start: '0d', end: '+1d' }),
    ],
  });

  await dragIntoBand(page, 'b1', 's1');

  expect(await storedSections(page)).toMatchObject({ b1: 's1', c1: 's3' });
  expect(await sheetOrder(page)).toEqual([
    { kind: 'section', id: 's1' }, { kind: 'row', id: 'b1' },
    { kind: 'section', id: 's2' },
    { kind: 'section', id: 's3' }, { kind: 'row', id: 'c1' },
  ]);
});

test('a task can be dropped as the BOTTOM-most row of a middle section, and stays there', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page, {
    sections: SECTIONS,
    tasks: [
      task('a1', 'Alpha one', { sectionId: 's1', start: '0d', end: '+1d' }),
      task('a2', 'Alpha two', { sectionId: 's1', start: '0d', end: '+1d' }),
      task('b1', 'Beta one', { sectionId: 's2', start: '0d', end: '+1d' }),
    ],
  });

  expect(await sheetOrder(page)).toEqual([
    { kind: 'section', id: 's1' }, { kind: 'row', id: 'a1' }, { kind: 'row', id: 'a2' },
    { kind: 'section', id: 's2' }, { kind: 'row', id: 'b1' },
  ]);

  let rule = null;
  await dragBelowRow(page, 'b1', 'a2', async () => {
    /* The visible half of the defect: the rule must sit on a2's BOTTOM edge, above the s2 header — not
       at the top of s2's first row, which is the same insertion index on the wrong side of a header. */
    const el = page.locator('[data-drop-rule]');
    await expect(el).toHaveCount(1);
    rule = { bar: await el.boundingBox(), a2: await rowOf(page, 'a2').boundingBox(), s2: await header(page, 's2').boundingBox() };
  });

  expect(Math.abs(rule.bar.y - (rule.a2.y + rule.a2.height)), 'the rule is on the last row\'s bottom edge').toBeLessThan(4);
  expect(rule.bar.y, 'and above the next section\'s header, not inside it').toBeLessThan(rule.s2.y + 1);

  expect(await sheetOrder(page)).toEqual([
    { kind: 'section', id: 's1' }, { kind: 'row', id: 'a1' }, { kind: 'row', id: 'a2' }, { kind: 'row', id: 'b1' },
    { kind: 'section', id: 's2' },
  ]);
  expect(await storedSections(page)).toMatchObject({ a1: 's1', a2: 's1', b1: 's1' });
  expect(errors, 'page errors during the drag').toEqual([]);
});

test('the same drop works at the bottom of the LAST section, where there is no next band at all', async ({ page }) => {
  await boot(page, {
    sections: SECTIONS,
    tasks: [
      task('a1', 'Alpha one', { sectionId: 's1', start: '0d', end: '+1d' }),
      task('b1', 'Beta one', { sectionId: 's2', start: '0d', end: '+1d' }),
      task('b2', 'Beta two', { sectionId: 's2', start: '0d', end: '+1d' }),
    ],
  });

  await dragBelowRow(page, 'a1', 'b2');

  expect(await sheetOrder(page)).toEqual([
    { kind: 'section', id: 's1' },
    { kind: 'section', id: 's2' }, { kind: 'row', id: 'b1' }, { kind: 'row', id: 'b2' }, { kind: 'row', id: 'a1' },
  ]);
  expect(await storedSections(page)).toMatchObject({ a1: 's2', b1: 's2', b2: 's2' });
});

test('dropping below the last row survives a reload — it is data, not a paint', async ({ page }) => {
  await boot(page, {
    seedOnce: true,
    sections: SECTIONS,
    tasks: [
      task('a1', 'Alpha one', { sectionId: 's1', start: '0d', end: '+1d' }),
      task('a2', 'Alpha two', { sectionId: 's1', start: '0d', end: '+1d' }),
      task('b1', 'Beta one', { sectionId: 's2', start: '0d', end: '+1d' }),
    ],
  });

  await dragBelowRow(page, 'b1', 'a2');
  await expect(rowOf(page, 'b1')).toBeVisible();

  await page.reload();
  await page.locator('[data-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });

  expect(await sheetOrder(page)).toEqual([
    { kind: 'section', id: 's1' }, { kind: 'row', id: 'a1' }, { kind: 'row', id: 'a2' }, { kind: 'row', id: 'b1' },
    { kind: 'section', id: 's2' },
  ]);
});
