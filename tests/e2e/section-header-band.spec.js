/* SECTION HEADER BAND (owner 2026-08-13b).
 *
 * Owner: the section header row does not read as a header. Two things were wrong and only one of them
 * was visible as a bug:
 *
 *   - The band painted `--top-bg`, which is FOUR units from `--sheet-bg` in the dark theme
 *     (#202124 vs #1c1c1d). So the band was not a surface; the whole distinction was carried by a
 *     1px hairline, and the eye reads a hairline as a divider between rows, not as a different kind
 *     of row.
 *   - Inside the header a flex-grown 1px rule ran from the task count to the ▲▼✕ controls. Once a real
 *     band exists behind it, that rule reads as a strikethrough across an empty header.
 *
 * The fix is per-theme `--sec-head-bg` / `--sec-head-border` tokens — per theme, NOT one shared rgba,
 * which is precisely the 2026-08-12 ghost-contrast defect. This file measures what is painted rather
 * than asserting the tokens exist, and it holds the two invariants a background change can quietly
 * break: the sheet↔Gantt row-top agreement (the band's height feeds `sectionGeometry`), and the fact
 * that clicking the header name still opens inline rename rather than being swallowed by the new
 * surface.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* A header must be UNMISTAKABLE, but it is still a quiet chrome surface, not a callout. This floor is
   set just under the measured values (dark 1.222:1, light 1.171:1) so it catches a regression to the
   old --top-bg (dark 1.06:1, light 1.00:1 — literally identical to the sheet in the light theme)
   without demanding a louder band than the owner asked for. */
const MIN_RATIO = 1.12;

const fixture = (theme) => ({
  theme,
  sections: [{ id: 's1', name: 'Research', order: 0 }, { id: 's2', name: 'Admin', order: 1 }],
  tasks: [
    task('h-a', 'Read the paper', { sectionId: 's1', start: '+0d', end: '+2d', planned: 60 }),
    task('h-b', 'Write the notes', { sectionId: 's1', start: '+1d', end: '+3d', planned: 30 }),
    task('h-c', 'File expenses', { sectionId: 's2', start: '+0d', end: '+1d', planned: 20 }),
  ],
});

/* WCAG relative luminance, computed in the page so it reads the tokens the browser actually resolved
   through the theme cascade — and off computed style, so it measures the PAINT, not the source text. */
const MEASURE = `(() => {
  const parse = (s) => { const n = (s.match(/[\\d.]+/g) || []).map(Number);
    return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  /* The sheet's header rows are in normal flow; the Gantt's bands are absolutely positioned overlays.
     Both carry data-section-id, and that is the only thing separating them. */
  const banded = [...document.querySelectorAll('div[data-section-id]')];
  const sheetHeads = banded.filter((e) => getComputedStyle(e).position !== 'absolute');
  const ganttBands = banded.filter((e) => getComputedStyle(e).position === 'absolute');
  const head = sheetHeads[0], band = ganttBands[0];
  const row = document.querySelector('div[data-task-id]');
  if (!head || !band || !row) return { missing: { head: !!head, band: !!band, row: !!row } };

  /* A row paints no background of its own — it sits on the sheet surface — so the honest comparison is
     the header against the sheet background it is embedded in. Walk up to the first painted ancestor
     rather than assuming which element that is. */
  const painted = (el) => { let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.a > 0.99) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 }; };

  const headBg = parse(getComputedStyle(head).backgroundColor);
  const rowBg = painted(row);
  const bandBg = parse(getComputedStyle(band).backgroundColor);
  const cs = getComputedStyle(document.documentElement);

  /* The deleted rule was a flex child with a painted 1px height. The SPACER that replaced it must still
     be there (it right-aligns ▲▼✕), so this asks about paint, not about the child's existence. */
  const paintedHairlines = [...head.children].filter((c) => {
    const s = getComputedStyle(c);
    const bg = parse(s.backgroundColor);
    return c.getBoundingClientRect().height <= 2 && bg.a > 0.02;
  }).length;
  const spacers = [...head.children].filter((c) => parseFloat(getComputedStyle(c).flexGrow) >= 1).length;

  return {
    token: cs.getPropertyValue('--sec-head-bg').trim(),
    border: cs.getPropertyValue('--sec-head-border').trim(),
    headBg: getComputedStyle(head).backgroundColor,
    rowBg: 'rgb(' + [rowBg.r, rowBg.g, rowBg.b].map(Math.round).join(',') + ')',
    bandBg: getComputedStyle(band).backgroundColor,
    headAlpha: headBg.a,
    bandAlpha: bandBg.a,
    /* Both panes must land on the SAME colour, or the band visibly changes across the split. */
    panesAgree: Math.abs(headBg.r - bandBg.r) + Math.abs(headBg.g - bandBg.g) + Math.abs(headBg.b - bandBg.b),
    ratio: ratio(headBg, rowBg),
    paintedHairlines,
    spacers,
  };
})()`;

/* Row-top agreement between the panes. Client rects are 0.8× CSS px inside the zoom:0.8 wrapper, but
   the DELTA between two rects measured the same way is scale-free, which is all this asserts. */
const ALIGN = `(() => {
  const sheet = [...document.querySelectorAll('div[data-task-id]')];
  const gantt = [...document.querySelectorAll('[data-gantt-task-id]')];
  const gById = {}; gantt.forEach((g) => { gById[g.getAttribute('data-gantt-task-id')] = g; });
  const deltas = [];
  for (const s of sheet) {
    const g = gById[s.getAttribute('data-task-id')];
    if (!g) continue;
    deltas.push(Math.abs(s.getBoundingClientRect().top - g.getBoundingClientRect().top));
  }
  /* Both panes scroll independently; compare against the smallest, which is the shared offset. */
  const base = Math.min(...deltas);
  return { n: deltas.length, worst: Math.max(...deltas.map((d) => Math.abs(d - base))) };
})()`;

async function boot(page, theme) {
  await bootSurface(page, { view: 'gantt' }, fixture(theme));
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.locator('div[data-section-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(150);
}

test.describe('the section header row reads as a header', () => {
  for (const theme of ['dark', 'light']) {
    test(`${theme}: the band is a distinct surface and carries no rule`, async ({ page }) => {
      await boot(page, theme);
      const m = await page.evaluate(MEASURE);
      expect(m.missing, `${theme}: header, band and row all rendered`).toBeUndefined();

      /* Premise: a mistyped custom property resolves to "" and would sail through as transparent. */
      console.log(`[section header] ${theme}: band ${m.headBg} vs row ${m.rowBg} = `
        + `${m.ratio.toFixed(3)}:1 (gantt ${m.bandBg}, rules ${m.paintedHairlines}, spacers ${m.spacers})`);

      expect(m.token, `${theme}: --sec-head-bg is defined`).toBeTruthy();
      expect(m.border, `${theme}: --sec-head-border is defined`).toBeTruthy();
      expect(m.headAlpha, `${theme}: the sheet band is opaque`).toBeGreaterThan(0.99);
      expect(m.bandAlpha, `${theme}: the Gantt band is opaque, not a color-mix over the grid`)
        .toBeGreaterThan(0.99);

      expect(m.ratio,
        `${theme}: header ${m.headBg} vs task row ${m.rowBg} = ${m.ratio.toFixed(3)}:1`)
        .toBeGreaterThanOrEqual(MIN_RATIO);
      expect(m.panesAgree, `${theme}: sheet ${m.headBg} and Gantt ${m.bandBg} paint the same colour`)
        .toBeLessThanOrEqual(1);

      expect(m.paintedHairlines, `${theme}: no painted 1px rule survives inside the header`).toBe(0);
      expect(m.spacers, `${theme}: a flex spacer still right-aligns the ▲▼✕ controls`)
        .toBeGreaterThanOrEqual(1);
    });
  }

  test('the two themes do NOT share one band value — the ghost-contrast defect, repeated', async ({ page }) => {
    await boot(page, 'dark');
    const d = await page.evaluate(MEASURE);
    await boot(page, 'light');
    const l = await page.evaluate(MEASURE);
    expect(d.token, 'dark and light resolve different --sec-head-bg').not.toBe(l.token);
    expect(Math.min(d.ratio, l.ratio),
      `worst theme: dark ${d.ratio.toFixed(3)}:1, light ${l.ratio.toFixed(3)}:1`)
      .toBeGreaterThanOrEqual(MIN_RATIO);
  });

  test('the band change does not disturb sheet↔Gantt row alignment', async ({ page }) => {
    await boot(page, 'dark');
    const a = await page.evaluate(ALIGN);
    console.log(`[section header] sheet↔Gantt worst row-top delta = ${a.worst.toFixed(4)}px over ${a.n} rows`);
    expect(a.n, 'rows were actually matched across the panes').toBeGreaterThan(0);
    /* Subpixel rounding at zoom 0.8 is the only slack allowed here. */
    expect(a.worst, `worst sheet↔Gantt row-top delta = ${a.worst.toFixed(3)}px`).toBeLessThan(0.5);
  });

  test('the new surface does not swallow inline rename', async ({ page }) => {
    await boot(page, 'dark');
    const name = page.locator('div[data-section-id="s1"] span', { hasText: 'Research' }).first();
    await name.click();
    await expect(page.locator('div[data-section-id="s1"] input')).toBeVisible();
  });
});
