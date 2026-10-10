// UI revamp block 11a — the design-system and accessibility sweep.
// 1. Text tokens clear WCAG AA (4.5:1) against every resting surface token, in BOTH themes; the primary
//    button's ink clears AA on its fill.
// 2. The type scale has a raised floor: under the 0.8 shell zoom nothing renders below 10px (captions)
//    and the scale's label/body step renders at 11px or more.
// 3. Every icon-only control in the key rendered trees carries an aria-label (the title stays the tooltip).
// 4. A 2px focus ring with a 2px gap is the global :focus-visible rule, and the old outline:none paths
//    that hid it are gone or replaced by a ring of their own.
// 5. The document declares a language and the shell exposes banner / navigation / main landmarks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { make, activeTask, withNow, FIXED_NOW } = require('./_load.js');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));

const textOf = (n) => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children);
const find = (n, pred, out = []) => {
  if (n == null || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => find(c, pred, out)); return out; }
  if (n.props && pred(n.props, n)) out.push(n);
  find(n.children, pred, out);
  return out;
};

// ---------------------------------------------------------------------------
// 1. Contrast, computed from the token hex in both themes
// ---------------------------------------------------------------------------

/** Every `selector{…}` rule's custom properties (the palette, timeline and scale blocks), merged in order. */
function tokens(selector) {
  const out = {};
  const starts = [];
  for (let i = STYLE.indexOf('\n' + selector + '{'); i >= 0; i = STYLE.indexOf('\n' + selector + '{', i + 1)) starts.push(i + 1);
  assert.ok(starts.length, 'token block ' + selector);
  for (const i of starts) {
    const body = STYLE.slice(i + selector.length + 1, STYLE.indexOf('\n}', i));
    body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi, (_, k, v) => { out[k] = v.trim(); return ''; });
  }
  return out;
}
const DARK = tokens(':root,:root[data-theme="dark"]');
const LIGHT = tokens(':root[data-theme="light"]');
const rgb = (hex) => { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Text roles that carry words or numerals at body/label size.
const TEXT = ['text', 'text-strong', 'text-2', 'text-num', 'text-mut', 'text-mut2', 'text-faint', 'text-faint2',
  'btn-text', 'tag-text', 'link', 'danger', 'danger-strong', 'warn', 'success', 'due-week', 'due-tomorrow', 'due-later',
  'gantt-label', 'tl-win-fg'];
// The surfaces that text rests on (hover/active washes are transient and excluded).
const SURFACES = ['bg', 'top-bg', 'quickbar-bg', 'sheet-bg', 'sheet-alt', 'gantt-bg', 'side-bg', 'card-bg', 'menu-bg',
  'chip-bg', 'btn-bg', 'input-bg', 'field-bg', 'tag-bg', 'sec-head-bg', 'weekend'];

for (const [name, T] of [['dark', DARK], ['light', LIGHT]]) {
  test(name + ' theme: every text token clears AA (4.5:1) on every resting surface', () => {
    const fails = [];
    for (const t of TEXT) {
      const fg = T[t] || DARK[t];
      assert.match(fg, /^#[0-9a-f]{6}$/i, name + ' --' + t + ' is a hex token');
      for (const s of SURFACES) {
        const bg = T[s] || DARK[s];
        if (!/^#[0-9a-f]{6}$/i.test(bg)) continue;
        const r = ratio(fg, bg);
        if (r < 4.5) fails.push('--' + t + ' ' + fg + ' on --' + s + ' ' + bg + ' = ' + r.toFixed(2));
      }
    }
    assert.deepEqual(fails, [], name + ' AA failures');
  });

  test(name + ' theme: the primary button and badge ink clear AA on the accent fill', () => {
    const acc = T.accent, ink = T['on-accent'] === '#fff' ? '#ffffff' : T['on-accent'];
    assert.ok(ratio(acc, ink) >= 4.5, name + ' on-accent on accent: ' + ratio(acc, ink).toFixed(2));
  });

  test(name + ' theme: the focus ring is a 3:1 non-text indicator on the page and the cards', () => {
    for (const s of ['bg', 'sheet-bg', 'card-bg', 'top-bg']) {
      assert.ok(ratio(T['focus-ring'], T[s]) >= 3, name + ' focus ring on --' + s + ': ' + ratio(T['focus-ring'], T[s]).toFixed(2));
    }
  });
}

test('owner ruling 2026-08-13b still holds: the section-header band reads against the task row', () => {
  // dark band vs the painted row; light band vs white. The ruling measured 1.222 / 1.171; never below 1.12.
  assert.ok(ratio(DARK['sec-head-bg'], DARK['sheet-bg']) >= 1.12, 'dark band ratio');
  assert.ok(ratio(LIGHT['sec-head-bg'], LIGHT['sheet-bg']) >= 1.12, 'light band ratio');
});

// ---------------------------------------------------------------------------
// 2. The type scale and its floor
// ---------------------------------------------------------------------------

test('the type scale is 13/14/14/15/18/22 and renders at or above the floor under the shell zoom', () => {
  const c = make();
  const root = tokens(':root');
  const px = (k) => parseFloat(root[k]);
  assert.deepEqual(['fs-1', 'fs-2', 'fs-3', 'fs-4', 'fs-5', 'fs-6'].map(px), [13, 14, 14, 15, 18, 22]);
  assert.ok(px('fs-1') * c.SHELL_ZOOM >= 10, 'caption renders >= 10px');
  assert.ok(px('fs-2') * c.SHELL_ZOOM >= 11, 'label renders >= 11px');
  assert.ok(px('fs-3') * c.SHELL_ZOOM >= 11, 'body renders >= 11px');
});

test('no literal font size in the app is set below the caption step, and none is fractional', () => {
  const sizes = new Set();
  HTML.replace(/fontSize\s*:\s*([^,}\n]*)/g, (_, expr) => { expr.replace(/'([0-9.]+)px'/g, (__, v) => { sizes.add(+v); return ''; }); return ''; });
  HTML.replace(/font-size\s*:\s*([0-9.]+)px/g, (_, v) => { sizes.add(+v); return ''; });
  const bad = [...sizes].filter((v) => v < 13 || v !== Math.round(v));
  assert.deepEqual(bad, [], 'sizes below 13px or fractional');
  const off = [...sizes].filter((v) => v < 24 && ![13, 14, 15, 18, 22].includes(v));
  assert.deepEqual(off, [], 'every size under the display range sits on the scale');
});

// ---------------------------------------------------------------------------
// 3. Icon-only controls are named
// ---------------------------------------------------------------------------

const INTERACTIVE_ROLES = /^(button|switch|tab|menuitem|menuitemcheckbox|menuitemradio|checkbox|radio|option|link)$/;
// A control: a native one, a role'd one, or anything with a click handler (the sheet's ▲▼✕ are spans with
// onClick; the keyboard block turns them into buttons, this block makes sure they are named meanwhile).
const isControl = (n) => typeof n.type === 'string' && (/^(button|a|select|textarea)$/.test(n.type)
  || (n.type === 'input' && n.props.type !== 'hidden' && n.props.type !== 'file')
  || INTERACTIVE_ROLES.test(n.props.role || '') || typeof n.props.onClick === 'function');
// No letters or digits in its visible text: a glyph (‹ › ✕ ▲ ▼ ▶ ■ ⋯ ⚙ ☰ …) or nothing at all.
const iconOnly = (n) => !/[\p{L}\p{N}]/u.test(textOf(n.children)) && textOf(n.children).trim() !== '';
const isField = (n) => n.type === 'input' || n.type === 'select' || n.type === 'textarea';
function unnamed(tree) {
  return find(tree, (p, n) => isControl(n) && (isField(n) || iconOnly(n))
    && !p['aria-label'] && !p['aria-labelledby'] && p['aria-hidden'] !== 'true')
    .map((n) => n.type + (n.props.role ? '[' + n.props.role + ']' : '') + ' "' + textOf(n.children) + '" title=' + n.props.title);
}

function sheetSetup() {
  const c = make();
  c.state.settings.usageTracking = false;
  c.state.firstRunSeen = true;
  c.state.sections = [{ id: 'sStudy', name: 'Study' }, { id: 'sWork', name: 'Work' }];
  c.state.tasks = [activeTask(c, { id: 'a', name: 'Answer emails', sectionId: 'sWork' }),
    activeTask(c, { id: 'b', name: 'Read chapter', sectionId: 'sStudy' })];
  c.savePrefs = () => {};
  c.renderVals();
  return c;
}

test('the sheet: every icon-only control (section ▲▼✕, timer ▶, snooze, description toggle) has an aria-label', () => withNow(FIXED_NOW, () => {
  const c = sheetSetup();
  assert.deepEqual(unnamed(c.renderSheet(c._visTasks)), []);
}));

test('the plan pane header (‹ › − +) and the top nav are named', () => withNow(FIXED_NOW, () => {
  const c = sheetSetup();
  for (const v of ['gantt', 'today', 'week', 'month']) assert.deepEqual(unnamed(c.renderPlanPaneHeader(v, () => {})), [], v);
  assert.deepEqual(unnamed(c.renderTopNav()), []);
}));

test('settings: every switch and every field has an accessible name', () => withNow(FIXED_NOW, () => {
  const c = sheetSetup();
  for (const tab of ['general', 'scheduling', 'notifications', 'integrations', 'data']) {
    c.setState({ settingsOpen: true, settingsTab: tab });
    const tree = c.renderSettings();
    assert.deepEqual(unnamed(tree), [], tab);
    for (const sw of find(tree, (p) => p.role === 'switch')) assert.ok(sw.props['aria-label'], tab + ': switch named');
  }
}));

test('the detail dialog header (⋯ ▲ ▼ ✕) and the Focus hero are named', () => withNow(FIXED_NOW, () => {
  const c = sheetSetup();
  c.setState({ detailId: 'a' });
  assert.deepEqual(unnamed(c.renderDetail()), []);
  assert.deepEqual(unnamed(c.renderFocusNow()), []);
}));

test('the automatic name never overrides visible words (label-in-name), and an explicit label wins', () => {
  const c = make();
  const R = require('./_load.js').loadComponent.lastSandbox.React;
  const glyph = R.createElement('button', { title: 'Close', onClick() {} }, '✕');
  assert.equal(glyph.props['aria-label'], 'Close', 'a glyph button is named by its title');
  const words = R.createElement('button', { title: 'Start the timer on this task', onClick() {} }, '▶ Start');
  assert.equal(words.props['aria-label'], undefined, 'a button with words is named by them');
  const own = R.createElement('button', { title: 'Close', 'aria-label': 'Close settings' }, '✕');
  assert.equal(own.props['aria-label'], 'Close settings', 'an explicit aria-label wins');
  const field = R.createElement('input', { placeholder: 'Search' });
  assert.equal(field.props['aria-label'], 'Search', 'a bare field is named by its placeholder');
  const deco = R.createElement('span', { title: 'Just a tooltip' }, '·');
  assert.equal(deco.props['aria-label'], undefined, 'non-interactive text is left alone');
  void c;
});

// ---------------------------------------------------------------------------
// 4. Focus ring
// ---------------------------------------------------------------------------

test('the global :focus-visible rule is a 2px ring with a 2px gap', () => {
  // !important: an inline `outline:'none'` must not be able to hide it.
  assert.match(STYLE, /\n:focus-visible\{outline:var\(--focus-w\) solid var\(--focus-ring\)!important;outline-offset:var\(--focus-gap\)\}/);
  // …and the width RENDERS at 2px under the shell zoom (Chromium snaps outlines to whole device pixels).
  const root = tokens(':root');
  assert.ok(parseFloat(root['focus-w']) * make().SHELL_ZOOM >= 2, 'ring renders >= 2px');
  assert.ok(parseFloat(root['focus-gap']) * make().SHELL_ZOOM >= 2, 'gap renders >= 2px');
});

test('no stylesheet rule hides the focus indicator without drawing its own', () => {
  // The only focus rules allowed to switch the ring off: the dialog card (it hosts the focus trap; its fields
  // carry the ring) and the search input (its box, .pp-search, draws the ring through :focus-within).
  const off = STYLE.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
    .filter((r) => /:focus[^{]*\{[^}]*outline:none/.test(r)).map((r) => r.trim().split('{')[0]);
  // (.pp-row:focus is the pointer case; .pp-row:focus-visible draws the ring inside the row.)
  assert.deepEqual(off.sort(), ['.pp-dialog:focus,.pp-dialog:focus-visible', '.pp-row:focus', '.pp-search input:focus-visible']);
  assert.match(STYLE, /\.pp-row:focus-visible\{outline:var\(--focus-w\) solid var\(--focus-ring\)/);
  assert.match(STYLE, /\.pp-search:focus-within\{[^}]*outline:var\(--focus-w\) solid var\(--focus-ring\)/, 'the search box draws the ring');
  for (const sel of ['.pp-num', '.pp-sel', '.pp-edit']) {
    assert.ok(STYLE.includes(sel + ':focus-visible{outline:var(--focus-w) solid var(--focus-ring)'), sel + ' draws the 2px ring');
  }
});

// ---------------------------------------------------------------------------
// 5. Language and landmarks
// ---------------------------------------------------------------------------

test('the document declares lang="en"', () => {
  assert.match(HTML, /<html lang="en">/);
});

test('the shell exposes banner, navigation and main landmarks', () => {
  // The shell is built in the app bootstrap with React.createElement, so the role is a prop, not an attribute.
  assert.match(HTML, /role:'banner'/, 'the top bar is the banner');
  assert.match(HTML, /role:'main'/, 'the board is main');
  const c = make();
  const nav = c.renderTopNav();
  assert.equal(nav.type, 'nav', 'the page tabs sit in a <nav>');
  assert.ok(nav.props['aria-label'], 'the nav is named');
});
