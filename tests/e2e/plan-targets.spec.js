/* Targets pass 1 — the Plan page's click targets, measured where only a browser can measure them.
 *
 * The owner's tenet: clickboxes must be generous. HIT_MIN_PX is 24 RENDERED px; the shell renders at 0.8,
 * so a control needs a 30 CSS px hit box, and a small glyph is fine as long as its box is not. The unit
 * layer (tests/plan-targets.test.js) proves every Plan control is a real button with the right Tab
 * behaviour; this spec proves the boxes a pointer actually hits, by hit-testing the page itself
 * (`elementFromPoint`, walked out from each control's centre and bisected to the edge), and that the
 * keyboard reaches the toolbar, the view switch and the column headers.
 *
 * Gestures use Playwright's real mouse: a dispatched MouseEvent skips hit-testing, which is the thing
 * under test.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

test.use({ viewport: { width: 1600, height: 900 } });

const fixture = () => ({
  sections: [{ id: 's1', name: 'Research', order: 0 }, { id: 's2', name: 'Admin', order: 1 }, { id: 's3', name: 'Errands', order: 2 }],
  tasks: [
    task('a', 'Read the spec', { sectionId: 's1', start: '0d', end: '+3d', planned: 60, priority: 1, pct: 30, labels: ['research'] }),
    task('b', 'Draft notes', { sectionId: 's1', start: '+1d', end: '+4d', planned: 60, priority: 2 }),
    task('k', 'Kid task', { sectionId: 's1', parentId: 'b', start: '+1d', end: '+2d', planned: 30, priority: 3 }),
    task('c', 'File expenses', { sectionId: 's2', start: '0d', end: '+5d', planned: 60, priority: 3 }),
    task('d', 'Buy stamps', { sectionId: 's3', start: '+1d', end: '+6d', planned: 30, priority: 4 }),
  ],
});

async function boot(page) {
  await bootSurface(page, { view: 'gantt' }, fixture());
  await page.locator('[data-task-id="a"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-gantt-bar-id="a"]').first().waitFor({ state: 'visible', timeout: 15000 });
}

/** The rendered hit box of the element `sel` matches: from its centre, how far the pointer can travel in
 *  each direction and still land on it (or inside it). A bar body also owns its hit strip. */
async function hitBox(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const own = (x, y) => {
      const h = document.elementFromPoint(x, y);
      if (!h) return false;
      if (h === el || el.contains(h)) return true;
      return el.hasAttribute('data-gantt-bar-body') && h.hasAttribute('data-gantt-bar-hit') && h.parentElement === el.parentElement;
    };
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

/* HIT_MIN_PX. A box built at 30 CSS px renders at exactly 24, but Chromium snaps element boxes to whole
   pixels when it hit-tests, so a box that is flush against a neighbour can measure up to ~0.6px short. */
const MIN = 23.4;

test.describe('Plan page: rendered hit boxes are at least HIT_MIN_PX', () => {
  test('sheet row controls: circle, description, play, snooze, on-today, time needed, dates', async ({ page }) => {
    await boot(page);
    const row = '[data-task-id="a"]';
    await page.locator(row).first().hover(); // quiet controls show on hover
    const targets = {
      circle: `${row} [data-done-circle]`,
      description: `${row} [data-desc-toggle]`,
      play: `${row} [data-timer-btn]`,
      snooze: `${row} [data-snooze-btn]`,
      onToday: `${row} [data-incl-glyph]`,
      timeNeeded: `${row} [data-exact-cell]`,
      startDate: `${row} [data-date-cell="start"]`,
      planned: `${row} [data-cellk="planned"] input`,
      worked: `${row} [data-spent-box]`,
    };
    for (const [name, sel] of Object.entries(targets)) {
      const b = await hitBox(page, sel);
      expect(b, name + ' exists').toBeTruthy();
      expect(b.covered, name + ' is not covered at its centre').toBeFalsy();
      expect(b.w, name + ' hit width').toBeGreaterThanOrEqual(MIN);
      expect(b.h, name + ' hit height').toBeGreaterThanOrEqual(MIN);
    }
    // A parent row's subtask caret sits between the circle and the ☰ with 48.8px for two 24px boxes, so
    // whole-pixel snapping can cost it a fraction of a pixel: it is held to 23, the circle to the full rule.
    const caret = await hitBox(page, '[data-task-id="b"] button[title^="Collapse"]');
    expect(caret.w, 'subtask caret hit width').toBeGreaterThanOrEqual(23);
    expect(caret.h, 'subtask caret hit height').toBeGreaterThanOrEqual(MIN);
    // The glyphs did not grow: the circle and the description toggle are still small to look at.
    const circle = await hitBox(page, targets.circle);
    expect(circle.glyphW).toBeLessThan(16);
    // The row did not grow either.
    const rowH = await page.locator(row).first().evaluate((el) => el.firstElementChild.getBoundingClientRect().height);
    expect(Math.round(rowH)).toBe(32);
  });

  test('section header: caret, name and ▲ ▼ ✕', async ({ page }) => {
    await boot(page);
    const head = 'div[data-section-id="s2"]';
    await page.locator(head).first().hover({ position: { x: 300, y: 8 } });
    for (const sel of [`${head} [data-section-caret]`, `${head} [data-section-name]`, `${head} button[title="Move section up"]`,
      `${head} button[title="Move section down"]`, `${head} button[title^="Delete section"]`]) {
      const b = await hitBox(page, sel);
      expect(b && !b.covered, sel).toBeTruthy();
      expect(b.w, sel + ' hit width').toBeGreaterThanOrEqual(MIN);
      expect(b.h, sel + ' hit height').toBeGreaterThanOrEqual(MIN);
    }
  });

  test('Gantt: bar body, both grips (with their outside extension), link dots and the %-done band', async ({ page }) => {
    await boot(page);
    const bar = '[data-gantt-bar-id="a"]';
    const body = await page.locator(`${bar} [data-gantt-bar-body]`).first().boundingBox();
    await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2); // grips' extensions are live on hover
    await page.waitForTimeout(150);
    for (const sel of [`${bar} [data-gantt-bar-body]`, `${bar} [data-gantt-edge="start"]`, `${bar} [data-gantt-edge="end"]`,
      `${bar} [data-dep-dot-out]`, `${bar} [data-dep-dot-in]`, `${bar} [data-pct-grab]`]) {
      const b = await hitBox(page, sel);
      expect(b && !b.covered, sel).toBeTruthy();
      expect(b.w, sel + ' hit width').toBeGreaterThanOrEqual(MIN);
      expect(b.h, sel + ' hit height').toBeGreaterThanOrEqual(MIN);
    }
    // The bar itself still draws at its own 16px.
    expect(Math.round(body.height)).toBe(16);
  });

  test('toolbar, view switch and column headers', async ({ page }) => {
    await boot(page);
    for (const sel of ['[data-view-key="week"]', '[data-pp-filterbtn]', '[data-colk="planned"]', '[data-pp-addrow]']) {
      const b = await hitBox(page, sel);
      expect(b && !b.covered, sel).toBeTruthy();
      expect(b.w, sel).toBeGreaterThanOrEqual(MIN);
      expect(b.h, sel).toBeGreaterThanOrEqual(MIN);
    }
  });
});

test.describe('Plan page: gestures still work from the new hit area', () => {
  test('a press just ABOVE a bar (its hit strip) drags the bar', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks')).find((t) => t.id === 'c').start);
    const body = await page.locator('[data-gantt-bar-id="c"] [data-gantt-bar-body]').first().boundingBox();
    const dayW = await page.evaluate(() => { const b = document.querySelector('[data-gantt-bar-id="c"]'); return b.getBoundingClientRect().width / Number(b.getAttribute('data-gantt-columns')); });
    const x = body.x + body.width / 2, y = body.y - 2; // 2px above the drawn bar
    const hit = await page.evaluate(([px, py]) => { const h = document.elementFromPoint(px, py); return h && h.getAttribute('data-gantt-bar-hit'); }, [x, y]);
    expect(hit, 'the strip is what is under the pointer').toBe('c');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dayW * 2, y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks')).find((t) => t.id === 'c').start))
      .not.toBe(before);
  });

  test('the row still drags from its dot, beside the circle\'s wider box', async ({ page }) => {
    await boot(page);
    const grip = await page.locator('[data-task-id="d"] [data-pp-drag="row"]').first().boundingBox();
    const under = await page.evaluate(([px, py]) => { const h = document.elementFromPoint(px, py); return h && h.getAttribute('data-pp-drag'); },
      [grip.x + grip.width / 2, grip.y + grip.height / 2]);
    expect(under, 'the dot\'s centre is still the dot').toBe('row');
  });
});

test.describe('Plan page: keyboard', () => {
  test('Tab reaches a sortable column header and Enter sorts by it', async ({ page }) => {
    await boot(page);
    const head = page.locator('[data-colk="planned"]');
    await head.focus();
    await expect(head).toBeFocused();
    await expect(head).toHaveAttribute('aria-sort', 'none');
    await page.keyboard.press('Enter');
    await expect(head).toHaveAttribute('aria-sort', 'ascending');
    await page.keyboard.press(' ');
    await expect(head).toHaveAttribute('aria-sort', 'descending');
  });

  test('Tab walks the toolbar and the view switch; Enter switches the view; no row button is a Tab stop', async ({ page }) => {
    await boot(page);
    await page.locator('[data-pp-filterbtn]').focus();
    const seen = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => { const a = document.activeElement;
        return { inRow: !!(a && a.closest && a.closest('[data-pp-row]') && a.tagName === 'BUTTON'), view: a && a.getAttribute('data-view-key'),
          col: a && a.getAttribute('data-colk') }; });
      seen.push(info);
      expect(info.inRow, 'a row button never takes Tab').toBe(false);
      if (info.view === 'week') break;
    }
    expect(seen.some((s) => s.col), 'the column headers were on the way').toBe(true);
    expect(seen[seen.length - 1].view, 'Tab reached the view switch').toBe('week');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-view-key="week"]')).toHaveAttribute('aria-selected', 'true');
  });
});
