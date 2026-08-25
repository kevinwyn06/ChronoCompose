/* Block 46 deliberately supersedes Block 26's all-columns-fit floor. The sheet now opens to its
 * content edge, may be compressed by dragging the divider, and may never expand into nuisance
 * whitespace beyond its last visible column. The divider behavior needs trusted pointer input.
 * F15 (a control labelled
 * `placeholder` ships on the moat surface).
 *
 * F13 is a LAYOUT defect, so it is only provable against a real box model: the mock DOM has no
 * geometry and cannot say whether `Planned → Allotted` is inside the pane or past its right edge.
 *
 * Deliberately asserted at THREE viewport widths. The columns are fixed-PIXEL (`colDefs()` totals
 * 634px) while the split is a PERCENTAGE, so any fix expressed only as a bigger percentage passes at
 * whatever width it was tuned against and fails at every other one. A single-width assertion would
 * have signed that off. The floor is `min(<column total>px, 55%)`, so the narrow end is the one that
 * can regress: 1280 is the tightest width in the list on purpose.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { boot, bootSurface } = require('./_seed');

const SHOTS = path.join(__dirname, '..', '..', '.orchestration', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

/* Narrow → wide. 1280x720 is Playwright's Desktop Chrome default and the tightest case. */
const WIDTHS = [
  { w: 1280, h: 720 },
  { w: 1600, h: 1000 },
  { w: 1920, h: 1200 },
];

/* The two things F13 says are off-screen: the motto column, and the row actions. */
const CLIPPABLE = ['planned', 'actions'];

/**
 * Measure a sheet header cell against the scroll container that would clip it.
 * The scroller is found by walking up from the cell to the first ancestor that is not
 * `overflow: visible` — addressing it by inline-style string would break on any restyle.
 */
async function sheetGeometry(page, colKey) {
  return page.$eval(`[data-colk="${colKey}"]`, (cell) => {
    let sc = cell.parentElement;
    while (sc && getComputedStyle(sc).overflowX === 'visible') sc = sc.parentElement;
    const c = cell.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    return {
      cellLeft: c.left, cellRight: c.right, cellWidth: c.width,
      paneLeft: s.left, paneRight: s.right,
      scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth,
    };
  });
}

for (const view of ['today', 'schedule']) {
  for (const { w, h } of WIDTHS) {
    test(`${view} view at ${w}x${h}: the first-run sheet opens exactly to its content edge`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      /* No `viewSplit` in prefs — this is the FIRST-RUN width, which is what F13 is about.
         A user who has dragged the splitter was never the broken case. */
      await boot(page, { prefs: { mainView: view } });
      await page.locator('[data-colk="planned"]').waitFor({ state: 'visible', timeout: 15000 });

      for (const k of CLIPPABLE) {
        const g = await sheetGeometry(page, k);
        expect(g.cellWidth, `${k} column has width at ${w}px`).toBeGreaterThan(0);
        expect(g.cellLeft, `${k} column starts inside the sheet at ${w}px`).toBeGreaterThanOrEqual(g.paneLeft - 1);
        /* The real F13 assertion: the right edge of the cell is not past the pane's right edge. */
        expect(g.cellRight, `${k} column ends inside the sheet at ${w}px`).toBeLessThanOrEqual(g.paneRight + 1);
      }

      /* First run is uncompressed: all columns fit, but the superseding rule is now the right-edge
         clamp rather than a permanent min-width floor. */
      const g = await sheetGeometry(page, 'actions');
      expect(g.scrollWidth, `sheet does not scroll horizontally at ${w}px`).toBeLessThanOrEqual(g.clientWidth + 1);
      expect(g.paneRight - g.cellRight, `no nuisance whitespace follows Actions at ${w}px`).toBeLessThanOrEqual(18);

      /* The right pane must survive the floor — a sheet that ate the whole board would pass
         every assertion above. */
      const mainW = await page.evaluate(() => {
        const cell = document.querySelector('[data-colk="actions"]');
        let sc = cell.parentElement;
        while (sc && getComputedStyle(sc).overflowX === 'visible') sc = sc.parentElement;
        /* the board row is the sheet pane's parent; the last child is the view pane */
        const pane = sc.closest('div[style*="flex"]').parentElement;
        const board = pane.parentElement;
        return board.lastElementChild.getBoundingClientRect().width;
      });
      expect(mainW, `the ${view} pane keeps usable width at ${w}px`).toBeGreaterThan(300);
    });
  }
}

/* H4 (chain H, recorded 2026-08-20; closed here 2026-08-25). H4 named the LEFT PANE opening wider than
 * its own content and leaving whitespace to the right of Actions, and it was recorded as still live.
 * It is not: Chain 6 block 46 made `sheetMinWidthPx()` the sum of the VISIBLE columns and used it as the
 * pane's maxWidth. The cases above prove that on Today and Schedule, which render the pane through
 * `leftPaneMaxWidth`. The Gantt/plan board is a SECOND, separately written pane (its maxWidth is spelled
 * inline rather than through that helper), and it is the surface H4 was reported against — so it gets its
 * own case rather than inheriting the claim. Hiding half the columns is the shape that used to fail:
 * a percentage split has no idea the content got narrower.
 */
for (const { w, h } of WIDTHS) {
  test(`gantt board at ${w}x${h}: the sheet pane never opens past its last visible column`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await bootSurface(page, { view: 'gantt' }, {});
    await page.locator('[data-colk="actions"]').waitFor({ state: 'visible', timeout: 15000 });

    const g = await sheetGeometry(page, 'actions');
    expect(g.paneRight - g.cellRight, `no whitespace right of Actions at ${w}px`).toBeLessThanOrEqual(18);

    /* Seeded through `_seed` rather than poked into `localStorage` and reloaded: `addInitScript` runs
       before page scripts, so one load is enough and there is no window in which the app reads prefs
       that are not yet written. */
    await bootSurface(page, { view: 'gantt' },
      { prefs: { colHidden: { start: true, end: true, labels: true, pct: true, exact: true } } });
    await page.locator('[data-colk="actions"]').waitFor({ state: 'visible', timeout: 15000 });
    const narrow = await sheetGeometry(page, 'actions');
    expect(narrow.paneRight - narrow.cellRight,
      `no whitespace right of Actions with five columns hidden at ${w}px`).toBeLessThanOrEqual(18);
    /* The cap must CONTRACT with the columns. The gantt split defaults to 78%, far past the content edge,
       so the pane's width is the cap; if the cap ignored hidden columns the pane would not move at all and
       the gap measured above would be the whitespace H4 reported. */
    expect(narrow.clientWidth, `the pane contracts with the hidden columns at ${w}px`)
      .toBeLessThan(g.clientWidth - 60);
  });
}

test('trusted divider drag compresses, persists, and clamps when dragged back past Actions', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await boot(page, { prefs: { mainView: 'today' }, seedOnce: true });
  const divider = page.locator('[data-pane-divider="sheet"]');
  await expect(divider).toBeVisible();

  const before = await sheetGeometry(page, 'actions');
  const d0 = await divider.boundingBox();
  await page.mouse.move(d0.x + d0.width / 2, d0.y + 40);
  await page.mouse.down();
  await page.mouse.move(d0.x - 180, d0.y + 40, { steps: 8 });
  await page.mouse.up();

  const compressed = await sheetGeometry(page, 'actions');
  expect(compressed.clientWidth).toBeLessThan(before.clientWidth - 100);
  expect(compressed.scrollWidth).toBeGreaterThan(compressed.clientWidth + 100);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-prefs')).viewSplit.agenda);
  expect(saved).toBeGreaterThan(0);

  const d1 = await divider.boundingBox();
  await page.mouse.move(d1.x + d1.width / 2, d1.y + 40);
  await page.mouse.down();
  await page.mouse.move(1500, d1.y + 40, { steps: 10 });
  await page.mouse.up();

  const clamped = await sheetGeometry(page, 'actions');
  expect(clamped.cellRight).toBeLessThanOrEqual(clamped.paneRight + 1);
  expect(clamped.paneRight - clamped.cellRight).toBeLessThanOrEqual(18);

  await page.reload();
  await page.locator('[data-colk="actions"]').waitFor({ state: 'visible', timeout: 15000 });
  const reloaded = await sheetGeometry(page, 'actions');
  expect(reloaded.clientWidth).toBeCloseTo(clamped.clientWidth, 0);
});

test('wide viewport with few columns still permits trusted-pointer compression below the content edge', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 1200 });
  await boot(page, { prefs: {
    mainView: 'today',
    colHidden: { start: true, end: true, labels: true, pct: true, exact: true },
  }});
  const divider = page.locator('[data-pane-divider="sheet"]');
  await expect(divider).toBeVisible();

  const before = await sheetGeometry(page, 'actions');
  const d = await divider.boundingBox();
  await page.mouse.move(d.x + d.width / 2, d.y + 40);
  await page.mouse.down();
  await page.mouse.move(d.x - 100, d.y + 40, { steps: 8 });
  await page.mouse.up();

  const compressed = await sheetGeometry(page, 'actions');
  expect(compressed.clientWidth).toBeLessThan(before.clientWidth - 60);
  expect(compressed.scrollWidth).toBeGreaterThan(compressed.clientWidth + 60);
  expect(compressed.clientWidth).toBeGreaterThan(150);
});

test('the last-column clamp follows real column resize, hide, and reorder interactions', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await boot(page, { prefs: { mainView: 'today' } });
  const pane = page.locator('[data-sheet-pane="1"]');
  const width0 = (await pane.boundingBox()).width;
  const clip0 = await sheetGeometry(page, 'actions');

  /* Resize Task through its real 8px header grip. The pane grows because the last visible edge moved. */
  const grip = page.locator('[data-colk="name"] .pp-rsz');
  const gb = await grip.boundingBox();
  const gx = gb.x + 1, gy = gb.y + gb.height / 2;
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).classList.contains('pp-rsz'), { x: gx, y:gy })).toBe(true);
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 80, gy, { steps: 6 });
  await page.mouse.up();
  const savedNameW = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-prefs')).colW.name);
  expect(savedNameW).toBeGreaterThan(180);
  const width1 = (await pane.boundingBox()).width;
  expect(width1).toBeGreaterThan(width0 + 40);
  const clip1 = await sheetGeometry(page, 'actions');
  expect(clip1.scrollWidth - clip1.clientWidth).toBeCloseTo(clip0.scrollWidth - clip0.clientWidth, 0);

  /* Hide Time needed through the header context menu. The cap contracts immediately. */
  await page.locator('[data-colk="exact"]').click({ button: 'right' });
  await page.getByText(/Hide.*Time needed/).click();
  await expect(page.locator('[data-colk="exact"]')).toHaveCount(0);
  const width2 = (await pane.boundingBox()).width;
  expect(width2).toBeLessThan(width1 - 60);
  const clip2 = await sheetGeometry(page, 'actions');
  expect(clip2.scrollWidth - clip2.clientWidth).toBeCloseTo(clip1.scrollWidth - clip1.clientWidth, 0);

  /* Reordering changes identity, not total width, so it must neither loosen nor shrink the clamp. */
  const start = page.locator('[data-colk="start"]');
  const end = page.locator('[data-colk="end"]');
  const sb = await start.boundingBox();
  const eb = await end.boundingBox();
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 6 });
  await page.mouse.up();
  const order = await page.locator('[data-colk]').evaluateAll((els) => els.map((e) => e.getAttribute('data-colk')));
  expect(order.indexOf('end')).toBeLessThan(order.indexOf('start'));
  expect((await pane.boundingBox()).width).toBeCloseTo(width2, 0);

  const g = await sheetGeometry(page, 'actions');
  expect(g.paneRight - g.cellRight).toBeLessThanOrEqual(18);
});

/* F15 — the literal word shipped in italics at the bottom-right of the Music bar, on the Today view,
   which is the app's declared moat surface. Asserted as "nowhere in the rendered text", not as
   "that one span is gone", so re-adding it anywhere else on this surface fails too. */
test('no visible text and no input hint renders the literal word "placeholder"', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page, { prefs: { mainView: 'today' } });
  await page.locator('[data-colk="planned"]').waitFor({ state: 'visible', timeout: 15000 });

  const hits = await page.evaluate(() => {
    const out = [];
    /* SCRIPT/STYLE are skipped deliberately: `index.html` carries the whole application inline, so a
       raw text walk otherwise matches the source code's own identifiers rather than anything a user
       can see. `offsetParent` then keeps this to text that is actually rendered. */
    const HIDDEN = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TITLE: 1 };
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const p = n.parentElement;
      if (!p || HIDDEN[p.tagName]) continue;
      if (!p.offsetParent && getComputedStyle(p).position !== 'fixed') continue;
      if (/\bplaceholder\b/i.test(n.nodeValue || '')) out.push('text: ' + n.nodeValue.trim().slice(0, 60));
    }
    document.querySelectorAll('[placeholder]').forEach((el) => {
      if (/\bplaceholder\b/i.test(el.getAttribute('placeholder') || '')) out.push('hint: ' + el.getAttribute('placeholder'));
    });
    return out;
  });
  expect(hits).toEqual([]);
});

/* Evidence for the human review — F13 was found by looking, and is signed off by looking. */
test('capture the default-width sheet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page, { prefs: { mainView: 'today' } });
  await page.locator('[data-colk="planned"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.screenshot({ path: path.join(SHOTS, '26-sheet-default-width.png') });
});
