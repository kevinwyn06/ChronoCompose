/* GHOST-BAR CONTRAST (owner 2026-08-12).
 *
 * Owner: "contrast too low for tasks like 'Heritage Day'. It's greyish and just hard on the eyes
 * whether in light or dark mode."
 *
 * "Heritage Day" is a due date with no start — a HALF-ghost. Three things stacked to make it vanish:
 *
 *   - GHOST_FLAT was one hardcoded rgba(148,163,184,0.16) used unchanged in BOTH themes. A grey at 16%
 *     alpha is faint on #191919 and fainter on #ffffff, which is exactly the "whether in light or dark"
 *     half of the report: a single literal cannot serve two opposite surfaces.
 *   - The fill ramp held task colour for only the first GHOST_FILL_HOLD = 12% of the bar, so ~88% of a
 *     half-ghost was a fade to transparent over the chart background.
 *   - And a not-in-today bar multiplied all of that by a further 0.55 opacity.
 *
 * This file measures what is actually PAINTED rather than asserting the constants changed: it composites
 * the resolved token over the chart's own background and computes the WCAG relative-luminance contrast
 * ratio, per theme. Measured after the fix: dark 2.02:1, light 1.88:1. The light theme is why this test
 * is worth having — the first attempt at the fix scored 1.46:1 there and looked fine to the eye against
 * the dark theme that had already been tuned.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

/* WCAG 1.4.11 asks 3:1 for meaningful non-text graphics. A ghost is deliberately recessive — it must
   still read as derived rather than committed — so it is not held to a solid bar's ratio. But
   "recessive" and "invisible" are different things, and this floor is what separates them. */
const MIN_RATIO = 1.6;

const fixture = (theme) => ({
  theme,
  tasks: [
    /* The owner's shape: a due date, no start. */
    task('g-due', 'Heritage Day (Alberta)', { end: '+3d', planned: 0 }),
    /* And the double ghost, which is the one painted with the flat token. */
    task('g-none', 'Someday reading', { planned: 60 }),
  ],
});

/* sRGB relative luminance + contrast ratio, per WCAG 2.x. Runs in the page so it reads the tokens the
   browser actually resolved, including the theme cascade. */
const MEASURE = `(() => {
  const parse = (s) => {
    const n = (s.match(/[\\d.]+/g) || []).map(Number);
    return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  const cs = getComputedStyle(document.documentElement);
  const flat = cs.getPropertyValue('--ghost-flat').trim();
  const dots = cs.getPropertyValue('--ghost-dots').trim();
  const ganttBg = cs.getPropertyValue('--gantt-bg').trim();

  /* Resolve each token to real rgb through a probe element, so hex, rgb() and rgba() all normalise. */
  const probeOf = (v) => {
    const el = document.createElement('div');
    el.style.background = v;
    document.body.appendChild(el);
    const out = parse(getComputedStyle(el).backgroundColor);
    el.remove();
    return out;
  };
  const bg = probeOf(ganttBg), fg = probeOf(flat), dg = probeOf(dots);

  return {
    flat, dots, ganttBg,
    flatAlpha: fg.a,
    flatRatio: ratio(over(fg, bg), bg),
    dotsRatio: ratio(over(dg, bg), bg),
  };
})()`;

async function boot(page, theme) {
  await bootSurface(page, { view: 'gantt' }, fixture(theme));
  await page.locator('[data-gantt-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(150);
}

test.describe('ghost bars are legible in both themes', () => {
  for (const theme of ['dark', 'light']) {
    test(`${theme}: the ghost fill and its dotted outline clear the contrast floor`, async ({ page }) => {
      await boot(page, theme);
      const m = await page.evaluate(MEASURE);

      /* Premise: the tokens exist at all. A mistyped custom property resolves to "" and would otherwise
         sail through this test as a fully transparent background. */
      expect(m.flat, `${theme}: --ghost-flat is defined`).toBeTruthy();
      expect(m.dots, `${theme}: --ghost-dots is defined`).toBeTruthy();
      expect(m.flatAlpha, `${theme}: the fill is translucent, not accidentally opaque`).toBeLessThan(1);

      expect(m.flatRatio,
        `${theme}: ghost fill vs chart bg (${m.flat} over ${m.ganttBg}) = ${m.flatRatio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(MIN_RATIO);
      expect(m.dotsRatio,
        `${theme}: dotted outline vs chart bg = ${m.dotsRatio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(MIN_RATIO);
    });
  }

  test('the two themes do NOT share one ghost value, which is the defect that caused this', async ({ page }) => {
    await boot(page, 'dark');
    const d = await page.evaluate(MEASURE);
    await boot(page, 'light');
    const l = await page.evaluate(MEASURE);

    expect(d.flat, 'dark and light resolve different --ghost-flat').not.toBe(l.flat);
    expect(d.dots, 'dark and light resolve different --ghost-dots').not.toBe(l.dots);
    /* Both must clear the floor independently — a value tuned against one theme only is the bug. */
    expect(Math.min(d.flatRatio, l.flatRatio),
      `worst of the two themes: dark ${d.flatRatio.toFixed(2)}:1, light ${l.flatRatio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(MIN_RATIO);
  });

  test('a not-in-today ghost is dimmed once, not compounded into nothing', async ({ page }) => {
    await boot(page, 'dark');
    /* The opted-out mute multiplies with the ghost fade. Both are deliberate; their product was not. */
    const opacity = await page.evaluate(() => {
      const wraps = [...document.querySelectorAll('div')]
        .filter((d) => d.style.position === 'absolute' && d.style.zIndex === '5' && d.style.opacity);
      return wraps.map((w) => parseFloat(w.style.opacity)).filter((n) => n < 1);
    });
    for (const o of opacity) {
      expect(o, 'an opted-out bar stays recessive but legible').toBeGreaterThanOrEqual(0.7);
    }
  });
});
