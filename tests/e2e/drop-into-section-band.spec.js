/* DROP INDICATOR: "into this section" vs "between these two tasks" (owner 2026-08-14).
 *
 * Owner: dragging a task over a section only tinted that section's HEADER, and that was not clear
 * enough — the two possible outcomes have to be unmistakable at a glance while dragging.
 *
 * The old tint was `--menu-hover`, which is also the ordinary hover colour, so it said "the cursor is
 * over this header". Against a 2px insertion rule it was a different SHADE of the same idea. The fix is
 * a different SHAPE: the into-section case draws an accent OUTLINE plus a wash around the section's
 * whole band — header and every row it holds — while between-two-rows stays a thin horizontal rule.
 *
 * This spec exists in the browser layer because it is about a live drag: the indicator only exists past
 * the 4px promotion threshold, and a dispatched MouseEvent would skip hit-testing and pointer capture
 * and prove nothing. `page.mouse` issues trusted CDP input.
 *
 * It measures COMPUTED geometry and style mid-drag, in both themes, rather than trusting that the two
 * code paths differ: the point of the report is that two different code paths already existed and still
 * looked the same.
 */
const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

const SECTIONS = [
  { id: 's1', name: 'Research', order: 0 },
  { id: 's2', name: 'Admin', order: 1 },
];

const fixture = (theme) => ({
  theme,
  sections: SECTIONS,
  tasks: [
    task('r1', 'Read the spec', { sectionId: 's1', start: '0d', end: '+2d' }),
    task('r2', 'Draft notes', { sectionId: 's1', start: '0d', end: '+1d' }),
    task('r3', 'Summarise', { sectionId: 's1', start: '0d', end: '+1d' }),
    task('a1', 'File expenses', { sectionId: 's2', start: '0d', end: '+1d' }),
  ],
});

const grip = (page, id) => page.locator(`[data-task-id="${id}"] [title="Drag to reorder row"]`);

/** Everything the two indicators paint, read while the button is still down. */
async function readIndicators(page) {
  return page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const styles = (el) => { const cs = getComputedStyle(el); return {
      borderTopWidth: parseFloat(cs.borderTopWidth) || 0,
      borderBottomWidth: parseFloat(cs.borderBottomWidth) || 0,
      borderLeftWidth: parseFloat(cs.borderLeftWidth) || 0,
      borderRightWidth: parseFloat(cs.borderRightWidth) || 0,
      borderTopColor: cs.borderTopColor,
      backgroundColor: cs.backgroundColor,
      boxShadow: cs.boxShadow,
      borderRadius: cs.borderTopLeftRadius,
    }; };
    const bandEl = document.querySelector('[data-drop-band]');
    const ruleEl = document.querySelector('[data-drop-rule]');
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const norm = (col) => { probe.style.backgroundColor = ''; probe.style.backgroundColor = String(col).trim();
      return getComputedStyle(probe).backgroundColor; };
    const out = {
      band: bandEl ? Object.assign({ id: bandEl.getAttribute('data-drop-band') }, box(bandEl), styles(bandEl)) : null,
      rule: ruleEl ? Object.assign({}, box(ruleEl), styles(ruleEl)) : null,
      tokens: {
        bg: root.getPropertyValue('--drop-band-bg').trim(),
        halo: root.getPropertyValue('--drop-band-halo').trim(),
      },
      /* The header the OLD treatment tinted — proof the tint is gone, not merely joined by an outline.
         Read MID-DRAG, over the very header the drop targets: if any tint override survived, this is
         where it would show. #118 gave the header a real surface (`--sec-head-bg`), so the assertion is
         now an equality against that token rather than a vague "not menu-hover". */
      headerBg: (() => { const el = document.querySelector('[data-section-id="s2"]');
        return el ? getComputedStyle(el).backgroundColor : null; })(),
      /* Normalised through a probe element: the tokens are authored as hex and `backgroundColor` reads
         back as `rgb(...)`, so comparing the raw strings would fail on notation while the colours agree.
         Let the browser do the conversion rather than reimplementing it here. */
      secHeadBg: norm(root.getPropertyValue('--sec-head-bg')),
      menuHover: norm(root.getPropertyValue('--menu-hover')),
      /* #118 means the outline is now drawn over a SHADED header, not a near-sheet-coloured one. So
         measure the outline against the surface it actually sits on, per WCAG relative luminance. */
      outlineVsHeader: (() => {
        const hex = (s) => { const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
          return m ? { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 } : null; };
        const parse = (s) => hex(s) || (() => { const n = (String(s).match(/[\d.]+/g) || []).map(Number);
          return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 }; })();
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        if (!bandEl) return null;
        const outline = parse(getComputedStyle(bandEl).borderTopColor);
        const head = parse(root.getPropertyValue('--sec-head-bg'));
        const l1 = lum(outline), l2 = lum(head);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      })(),
    };
    probe.remove();
    return out;
  });
}

/** Press the grip of `id`, drag straight DOWN to `y`, read the indicators mid-drag, then release.
 *
 * Vertical only, and that is not fussiness: horizontal travel past ROW_NEST_DEADZONE is the drag-to-nest
 * channel, so aiming at the CENTRE of a full-width section header moves ~300px sideways and the drop
 * resolves as "nest under the row above" — which correctly paints no section band at all. Measured, the
 * first time this spec was written. Hold x at the grip. */
async function dragAndRead(page, id, y) {
  const g = await grip(page, id).boundingBox();
  if (!g) throw new Error('no grip box for ' + id);
  const x = g.x + g.width / 2;
  await page.mouse.move(x, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 14 });
  await page.waitForTimeout(60);
  const read = await readIndicators(page);
  await page.mouse.up();
  return read;
}

for (const theme of ['dark', 'light']) {
  test(`[${theme}] dropping INTO a section paints a full-band outline; between two rows paints only a rule`, async ({ page }) => {
    await boot(page, fixture(theme));

    /* --- Mode B: into a DIFFERENT section. Aim at the Admin header band. ------------------------- */
    const adminHead = await page.locator('[data-section-id="s2"]').boundingBox();
    expect(adminHead, 'the Admin section header must be on screen').toBeTruthy();
    const into = await dragAndRead(page, 'r1', adminHead.y + adminHead.height / 2);

    expect(into.band, 'dropping into a section must paint a band outline').toBeTruthy();
    expect(into.band.id).toBe('s2');
    /* An ENCLOSURE: a border on all four sides. A rule has none. */
    for (const side of ['borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth']) {
      expect(into.band[side], `band ${side}`).toBeGreaterThan(1);
    }
    expect(into.band.h, 'the band spans the header AND its rows, not a 2px line').toBeGreaterThan(20);
    expect(into.band.boxShadow, 'the halo ring lifts the outline off the sheet').not.toBe('none');
    expect(into.band.backgroundColor, 'the interior carries the --drop-band-bg wash').not.toBe('rgba(0, 0, 0, 0)');
    expect(into.tokens.bg, '--drop-band-bg must resolve in this theme').not.toBe('');
    expect(into.tokens.halo, '--drop-band-halo must resolve in this theme').not.toBe('');

    /* The header tint the owner called insufficient is GONE. Mid-drag, over the targeted header, the
       header still paints exactly #118's `--sec-head-bg` and nothing else. */
    expect(into.headerBg, 'the targeted header must keep its own band surface mid-drag').toBe(into.secHeadBg);
    expect(into.headerBg, 'the --menu-hover tint must not come back').not.toBe(into.menuHover);

    /* #118 made the header a shaded surface, so the outline is no longer drawn over a near-sheet colour.
       WCAG 1.4.11 asks 3:1 for a meaningful non-text graphic, and unlike a ghost bar this indicator is
       deliberately assertive — it is held to the full bar. */
    expect(into.outlineVsHeader, 'the accent outline against #118\'s --sec-head-bg').toBeGreaterThan(3);

    /* --- Mode A: between two rows of the row's OWN section. ------------------------------------- */
    await page.reload();
    await page.locator('[data-task-id]').first().waitFor({ state: 'attached' });
    const r3 = await page.locator('[data-task-id="r3"]').boundingBox();
    const between = await dragAndRead(page, 'r1', r3.y);

    expect(between.rule, 'a within-section move must paint the insertion rule').toBeTruthy();
    expect(between.band, 'a within-section move must NOT claim the whole band').toBeNull();
    expect(between.rule.h, 'the insertion rule is a thin line').toBeLessThan(6);
    expect(between.rule.borderTopWidth, 'a rule has no border — it IS the mark').toBe(0);

    /* --- The two modes are measurably different, which is the whole report. --------------------- */
    expect(into.band.h).toBeGreaterThan(between.rule.h * 4);

    /* Print the measurement, per the repo's visual-evidence convention: a passing boolean says the two
       shapes differ, and the numbers say by how much — which is the part the owner can judge. */
    console.log(`[drop indicator] ${theme}: INTO-SECTION band ${into.band.w.toFixed(1)}×${into.band.h.toFixed(1)}px, `
      + `border ${into.band.borderTopWidth}px ${into.band.borderTopColor}, wash ${into.band.backgroundColor}, `
      + `halo ${into.tokens.halo} | BETWEEN-ROWS rule ${between.rule.w.toFixed(1)}×${between.rule.h.toFixed(1)}px, `
      + `no border | height ratio ${(into.band.h / between.rule.h).toFixed(1)}× `
      + `| outline vs --sec-head-bg (${into.secHeadBg}) ${into.outlineVsHeader.toFixed(2)}:1`);
  });
}

/* The joint case with the drop-resolution lane (#114). `resolveRowInsert` reports `bandEmpty` for a
   declared-but-empty (or collapsed) section, and `rowDropDeco` deliberately draws NO insertion rule
   there — there is no row for a rule to sit on. So for that band the outline is not the clearer of two
   signals, it is the ONLY one. If the band ever stopped painting, an empty section would go back to
   giving no drop feedback at all, which is the V2.6b gap that started this whole area. */
test('a declared-but-EMPTY section gets the band outline and no insertion rule at all', async ({ page }) => {
  await boot(page, {
    theme: 'dark',
    sections: SECTIONS.concat([{ id: 's3', name: 'Someday', order: 2 }]),
    tasks: [
      task('r1', 'Read the spec', { sectionId: 's1', start: '0d', end: '+2d' }),
      task('r2', 'Draft notes', { sectionId: 's1', start: '0d', end: '+1d' }),
    ],
  });
  const empty = await page.locator('[data-section-id="s3"]').boundingBox();
  expect(empty, 'the empty section still renders its header band').toBeTruthy();
  const read = await dragAndRead(page, 'r1', empty.y + empty.height / 2);

  expect(read.band, 'the empty band must be claimed by the outline').toBeTruthy();
  expect(read.band.id).toBe('s3');
  expect(read.rule, 'an empty band has no row for an insertion rule — the outline is the only feedback').toBeNull();
  console.log(`[drop indicator] empty section: band ${read.band.w.toFixed(1)}×${read.band.h.toFixed(1)}px, rule ${read.rule ? 'present' : 'none'}`);
});

test('the two themes tune the drop-band tokens separately', async ({ page }) => {
  const read = async (theme) => {
    await boot(page, fixture(theme));
    return page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { theme: document.documentElement.getAttribute('data-theme'),
        bg: cs.getPropertyValue('--drop-band-bg').trim(),
        halo: cs.getPropertyValue('--drop-band-halo').trim() };
    });
  };
  const dark = await read('dark');
  await page.reload();
  const light = await read('light');
  expect(dark.theme).toBe('dark');
  expect(light.theme).toBe('light');
  /* One rgba used in both themes is the 2026-08-12 ghost-contrast defect, repeated. */
  expect(light.bg, '--drop-band-bg must be tuned per theme').not.toBe(dark.bg);
  expect(light.halo, '--drop-band-halo must be tuned per theme').not.toBe(dark.halo);
});

/* ============================================================================================
   D2 DIAGNOSIS (owner, 2026-08-19)
   "Dragging into section only works when I drag to the left little bit of the section, not for
   the whole section row."

   Hypothesis going in: section filing requires `drop.parentId == null` (index.html:5989), and nest
   intent is decided purely by HORIZONTAL OFFSET — ROW_NEST_DEADZONE 14px, then ROW_NEST_STEP 24px per
   level (index.html:504-505). A drag that drifts right past 14px becomes a NEST and stops being a
   section drop.

   The sweep below records, at five horizontal offsets across the band, whether the row was FILED into
   the section or NESTED under the row above. `page.mouse` only: per AGENTS.md a dispatched MouseEvent
   skips hit-testing and pointer capture, and this test is precisely about a drag threshold.

   FINDING (measured 2026-08-19, both sweeps below).

   The target decides everything, and the hypothesis was only half right.

   Over a section HEADER, every offset FILES — dx from -33px to +492px, all `parentId: null`,
   all `sectionId: 's1'`. There is no preceding row to nest under, so `projectRowDrop` returns a null
   parentId whatever `steps` says and the gate at index.html:5989 stays open.

   Over a ROW INSIDE THE BAND, the cutoff is sharp:

       dx  -33px  ->  FILED   (sectionId s1, parentId null)
       dx  +98px  ->  NESTED  (sectionId UNCHANGED at s2, parentId 'r2')
       dx +229px  ->  NESTED
       dx +360px  ->  NESTED
       dx +492px  ->  NESTED

   RESPONSIBLE GATE: `index.html:5983` computes nest intent from `dx = e.clientX - rd.startX` — the
   horizontal distance from the GRAB POINT, not from any absolute position. Past ROW_NEST_DEADZONE
   (14px) rightward, `steps` goes positive, `projectRowDrop` gives the row a parent, and the section
   gate at `index.html:5989` (`drop.parentId==null && res.sectionPos!=null`) closes — so `sectionId`
   is never written and the row silently stays in its old section.

   Leftward travel produces NEGATIVE steps, which only outdent an already-root row: parentId stays
   null and the drop files. That is precisely the owner's "only works when I drag to the left little
   bit" — the working case is not a narrow zone on the left of the section, it is any drag whose
   horizontal delta from the grab point is not more than 14px to the RIGHT.

   NO FIX IS ATTEMPTED HERE. Per the plan, D2's remedy is a behaviour change to a gesture the owner
   uses constantly (either widening the section gate to accept a nest-intent drop when the resolved
   target is a section band, or making nest intent depend on the drop target's kind rather than on
   horizontal offset alone), and it is chosen with the owner, not from a hypothesis. The second sweep
   therefore FAILS by design: it asserts the behaviour the owner asked for, which does not exist yet.
   ============================================================================================ */

const dropRow = (page, id) => page.locator(`[data-task-id="${id}"]:not([data-card-id])`);
const sectionHeader = (page, id) => page.locator(`[data-section-id="${id}"]`);

/** What actually PERSISTED — a paint that never committed would otherwise read as a pass. */
async function storedOf(page, id) {
  return page.evaluate((tid) => {
    const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((x) => x.id === tid);
    return t ? { sectionId: t.sectionId === undefined ? null : t.sectionId,
                 parentId: t.parentId === undefined ? null : t.parentId } : null;
  }, id);
}

test('section drop: which horizontal offsets file, and which nest', async ({ page }) => {
  const outcomes = [];

  for (const frac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    await boot(page, {
      sections: SECTIONS,
      tasks: [
        task('r1', 'Read the spec', { sectionId: 's1', start: '0d', end: '+2d' }),
        task('r2', 'Draft notes', { sectionId: 's1', start: '0d', end: '+1d' }),
        /* `loose` starts in Admin, so a successful drop is a real change of section. */
        task('loose', 'Unfiled row', { sectionId: 's2', start: '0d', end: '+1d' }),
      ],
    });

    const a = await dropRow(page, 'loose').locator('[data-task-name]').boundingBox();
    const band = await sectionHeader(page, 's1').boundingBox();

    /* Grab at the row's name cell, then release at `frac` across the SECTION band. The horizontal
       distance travelled is what the nest gate reads — it is measured from the grab point, not from
       any absolute position on screen. */
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(band.x + band.width * frac, band.y + band.height / 2, { steps: 12 });
    await page.mouse.up();

    const stored = await storedOf(page, 'loose');
    outcomes.push({
      frac,
      dx: Math.round(band.x + band.width * frac - (a.x + a.width / 2)),
      sectionId: stored.sectionId,
      parentId: stored.parentId,
      outcome: stored.parentId != null ? 'NESTED' : (stored.sectionId === 's1' ? 'FILED' : 'neither'),
    });
  }

  console.log('D2 section-drop sweep:\n' + JSON.stringify(outcomes, null, 2));

  /* Every offset across the band must file into the section; none may nest. */
  expect(outcomes.every((o) => o.sectionId === 's1' && o.parentId == null),
    `sweep: ${JSON.stringify(outcomes)}`).toBe(true);
});

/* The header sweep above files at EVERY offset, which refutes the going-in hypothesis for that target:
   over a section HEADER there is no preceding row to nest under, so `projectRowDrop` returns
   parentId null whatever `steps` says, and the section gate at index.html:5989 stays open.

   The owner drags onto the section BAND, though — the rows, not just the header strip. That is where a
   preceding row exists and nesting becomes possible. This second sweep is the same gesture aimed at the
   last ROW of the section, which is the case the report is actually about. */
/* `test.fail()`, not a skip and not a softened assertion: the assertion below states the behaviour the
   owner asked for, and it is EXPECTED to fail until D2 is fixed. Playwright runs it either way, so the
   sweep keeps printing its evidence, the shared suite stays green, and the day someone fixes the gate
   this reports an unexpected PASS instead of quietly continuing to agree with itself. */
test('section drop: the same sweep aimed at a ROW inside the section', async ({ page }) => {
  test.fail();   /* scoped to THIS test — at file scope it marks every test in the file */
  const outcomes = [];

  for (const frac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    await boot(page, {
      sections: SECTIONS,
      tasks: [
        task('r1', 'Read the spec', { sectionId: 's1', start: '0d', end: '+2d' }),
        task('r2', 'Draft notes', { sectionId: 's1', start: '0d', end: '+1d' }),
        task('loose', 'Unfiled row', { sectionId: 's2', start: '0d', end: '+1d' }),
      ],
    });

    const a = await dropRow(page, 'loose').locator('[data-task-name]').boundingBox();
    const target = await dropRow(page, 'r2').boundingBox();

    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    /* Release in the LOWER half of r2 — "put it below this row", inside section s1's band. */
    await page.mouse.move(target.x + target.width * frac, target.y + target.height - 3, { steps: 12 });
    await page.mouse.up();

    const stored = await storedOf(page, 'loose');
    outcomes.push({
      frac,
      dx: Math.round(target.x + target.width * frac - (a.x + a.width / 2)),
      sectionId: stored.sectionId,
      parentId: stored.parentId,
      outcome: stored.parentId != null ? 'NESTED' : (stored.sectionId === 's1' ? 'FILED' : 'neither'),
    });
  }

  console.log('D2 in-band sweep:\n' + JSON.stringify(outcomes, null, 2));

  expect(outcomes.every((o) => o.sectionId === 's1' && o.parentId == null),
    `sweep: ${JSON.stringify(outcomes)}`).toBe(true);
});
