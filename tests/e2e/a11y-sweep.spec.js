// @ts-check
/* UI revamp block 11a — the design-system and accessibility sweep, on a live mount.
 *
 * The unit layer (tests/ui-revamp-a11y.test.js) computes token contrast, pins the type scale and checks
 * that icon-only controls in the rendered trees are named. What only a browser can show:
 *   1. the RENDERED text size — computed font-size × the 0.8 shell zoom — never drops under the caption
 *      floor (10px) on the main surfaces, sampled the way the cross-cutting audit sampled them;
 *   2. real Tab presses land on elements that draw a visible 2px focus ring;
 *   3. at a 1024px window, and at 800px (a 1600px window at 200% browser zoom), the sheet's Actions column
 *      and the plan pane header's Today / ‹ › controls are not clipped away.
 */
const { test, expect } = require('@playwright/test');
const { seed, task } = require('./_seed');

const sections = [{ id: 'sec_s', name: 'Study', order: 0 }, { id: 'sec_w', name: 'Work', order: 1 }];
const tasks = () => [
  task('a', 'Linear algebra problem set', { sectionId: 'sec_s', start: '0d', end: '+2d', planned: 120, priority: 1 }),
  task('b', 'Read chapter seven', { sectionId: 'sec_s', start: '0d', end: '+4d', planned: 90, priority: 2, pct: 40 }),
  task('c', 'Office hours', { sectionId: 'sec_w', start: '+1d+15h', end: '+1d+16h', startClock: true, endClock: true, planned: 60 }),
  task('d', 'Reply to emails', { sectionId: 'sec_w', start: '0d', end: '0d', planned: 20, priority: 3 }),
];

async function open(page, prefs, theme) {
  await seed(page, { tasks: tasks(), sections, theme: theme || 'dark', settings: { dayStart: '07:30', dayEnd: '23:30' },
    prefs: Object.assign({ mainView: 'dashboard', dashMode: 'overview', dashModeV: 2, firstRunSeen: true }, prefs) });
  await page.goto('/index.html');
  await page.waitForTimeout(700);
}

/** Every visible element that paints its own text: [{t, px}] with px the RENDERED size. */
const sampleText = (page) => page.evaluate(() => {
  const zoomOf = (el) => { let z = 1; for (let p = el; p && p.nodeType === 1; p = p.parentElement) { const v = parseFloat(getComputedStyle(p).zoom); if (v && v !== 1) z *= v; } return z; };
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.namespaceURI === 'http://www.w3.org/2000/svg' || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
    const direct = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!direct) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    out.push({ t: direct.slice(0, 30), px: Math.round(parseFloat(cs.fontSize) * zoomOf(el) * 100) / 100 });
  }
  return out;
});

const SURFACES = [
  ['Plan (Gantt)', { planView: 'gantt' }], ['Week', { planView: 'week' }], ['Month', { planView: 'month' }],
  ['Agenda', { planView: 'schedule' }], ['Focus', { dashMode: 'focus' }], ['Review', { dashMode: 'review' }],
  ['Journal', { mainView: 'journal' }],
];

test.describe('rendered type never falls under the caption floor', () => {
  test.use({ viewport: { width: 1600, height: 900 } });
  for (const [name, prefs] of SURFACES) {
    test(name, async ({ page }) => {
      await open(page, prefs);
      const s = await sampleText(page);
      expect(s.length, name + ': sampled some text').toBeGreaterThan(10);
      const under = s.filter((x) => x.px < 10 - 0.01);
      expect(under, name + ': text rendering under 10px').toEqual([]);
    });
  }

  test('detail dialog, quick add and settings', async ({ page }) => {
    await open(page, { planView: 'gantt' });
    const nm = page.locator('[data-task-id="a"] [data-task-name]').first();
    const bb = await nm.boundingBox();
    await page.mouse.click(bb.x + 10, bb.y + bb.height / 2);
    await expect(page.locator('[data-pp-dialog="detail"]')).toBeVisible();
    expect((await sampleText(page)).filter((x) => x.px < 10 - 0.01), 'detail').toEqual([]);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.mouse.click(1590, 890);
    await page.keyboard.press('q');
    await page.keyboard.type('Call dentist tomorrow 3pm');
    expect((await sampleText(page)).filter((x) => x.px < 10 - 0.01), 'quick add').toEqual([]);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    expect((await sampleText(page)).filter((x) => x.px < 10 - 0.01), 'settings').toEqual([]);
  });
});

test.describe('focus is visible', () => {
  test.use({ viewport: { width: 1600, height: 900 } });
  for (const theme of ['dark', 'light']) {
    test('Tab through the shell and the sheet: every stop draws a 2px ring (' + theme + ')', async ({ page }) => {
      await open(page, { planView: 'gantt' }, theme);
      await page.mouse.click(800, 5); // the top bar's empty middle: nothing focused, no selection
      const misses = [];
      let stops = 0;
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          // RENDERED width: the computed outline is in the element's own (zoomed) px, and Chromium snaps it to
          // whole device pixels — a 2px outline under the 0.8 shell used to draw a single pixel.
          const zoomOf = (e) => { let z = 1; for (let p = e; p && p.nodeType === 1; p = p.parentElement) { const v = parseFloat(getComputedStyle(p).zoom); if (v && v !== 1) z *= v; } return z; };
          const ring = (x) => { if (!x) return false; const cs = getComputedStyle(x);
            return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) * zoomOf(x) >= 1.99; };
          return { tag: el.tagName, name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
            ok: ring(el) || (el.tagName === 'INPUT' && ring(el.parentElement)) };
        });
        if (!r) continue;
        stops++;
        if (!r.ok) misses.push(r.tag + ' "' + r.name + '"');
      }
      expect(stops, 'Tab reached real stops').toBeGreaterThan(8);
      expect(misses, 'focused elements with no visible 2px ring').toEqual([]);
    });
  }
});

/** Is el's box fully visible: inside the viewport and inside every clipping ancestor? */
const notClipped = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return 'zero size';
  if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) return 'outside the viewport';
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const q = p.getBoundingClientRect();
    if (r.left < q.left - 0.5 || r.right > q.right + 0.5 || r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) return 'clipped by ' + p.tagName + '.' + p.className;
  }
  return 'ok';
});

for (const w of [1024, 800]) {
  test.describe('narrow window ' + w + 'px: nothing essential clips', () => {
    test.use({ viewport: { width: w, height: 800 } });

    test('the sheet keeps its Actions column (timer) in view', async ({ page }) => {
      await open(page, { planView: 'gantt' });
      await expect(page.locator('[data-colk="actions"]')).toBeVisible();
      expect(await notClipped(page.locator('[data-colk="actions"]'))).toBe('ok');
      const timer = page.locator('[data-task-id="a"] [data-cellk="actions"]').first();
      expect(await notClipped(timer)).toBe('ok');
    });

    for (const view of ['gantt', 'week']) {
      test(view + ': the plan header keeps Today and ‹ › on screen', async ({ page }) => {
        await open(page, { planView: view });
        for (const sel of ['[data-pp-today]', '[data-pp-step="-1"]', '[data-pp-step="1"]']) {
          expect(await notClipped(page.locator('[data-pp-planhead] ' + sel)), view + ' ' + sel).toBe('ok');
        }
      });
    }
  });
}
