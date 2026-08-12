/* Block 26 — F13 (the motto is clipped off-screen by default) and F15 (a control labelled
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
const { boot } = require('./_seed');

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
    test(`${view} view at ${w}x${h}: the motto column and the row actions are inside the sheet`, async ({ page }) => {
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

      /* …and no horizontal scrollbar, i.e. nothing is merely reachable by scrolling. */
      const g = await sheetGeometry(page, 'actions');
      expect(g.scrollWidth, `sheet does not scroll horizontally at ${w}px`).toBeLessThanOrEqual(g.clientWidth + 1);

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
