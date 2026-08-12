/* Block 31 — alpha usage tracker, in a real browser.
 *
 * The unit layer owns the redaction RULES (tests/v5-usage-tracker.test.js). This layer exists for the
 * two things a mocked DOM structurally cannot reach:
 *   1. a real focused password field receiving real trusted keystrokes, and
 *   2. the round trip to disk — the app's POST, the static server's sink, and an actual `.jsonl` file
 *      appearing in `.telemetry/` at the repo root.
 * Both are asserted against the FILE, which is the artifact that would leak if the gate were wrong.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { boot, switchView } = require('./_seed');

const TELEMETRY = path.resolve(__dirname, '..', '..', '.telemetry');
const ON = { usageTracking: true };

function listSessions() {
  try { return new Set(fs.readdirSync(TELEMETRY).filter((f) => f.endsWith('.jsonl'))); }
  catch (e) { return new Set(); }
}

/* Flush by LEAVING. The app flushes on pagehide/beforeunload with a keepalive fetch, which is exactly
 * the "a closed tab does not lose the session" path the spec is here to prove — so the spec ends the
 * session the way a user does rather than reaching for a back door. */
async function endSessionAndReadLog(page, before) {
  await page.goto('about:blank');
  for (let i = 0; i < 60; i++) {
    const now = [...listSessions()].filter((f) => !before.has(f));
    if (now.length) {
      const body = fs.readFileSync(path.join(TELEMETRY, now[0]), 'utf8').trim();
      if (body) return { file: path.join(TELEMETRY, now[0]),
        events: body.split('\n').map((l) => JSON.parse(l)), raw: body };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no new .telemetry/*.jsonl appeared within 15s');
}

function bigrams(s) { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; }

test('block 31 — recording is visible, and a real session lands a .jsonl file on disk', async ({ page }) => {
  const before = listSessions();
  await boot(page, { settings: ON });

  /* Discoverable, not silent: the owner asked for the tracker to be on by default, so it has to say so. */
  const pill = page.locator('[data-usage-pill="on"]');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('REC');

  /* A handful of real actions across the subsystems the log is supposed to describe. */
  await switchView(page, 'Today');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');

  const { file, events } = await endSessionAndReadLog(page, before);
  console.log('block 31 usage log:', file);

  /* Every line is a complete, self-describing record. */
  for (const e of events) {
    expect(e.v).toBe(1);
    expect(typeof e.ts).toBe('number');
    expect(e.ts).toBeGreaterThan(1600000000000);
    expect(typeof e.rel).toBe('number');
    expect(typeof e.s).toBe('string');
  }
  expect(events.some((e) => e.t === 'session')).toBe(true);
  expect(events.some((e) => e.t === 'action' && e.a === 'view.switch' && e.to === 'today')).toBe(true);
  expect(events.filter((e) => e.t === 'key').map((e) => e.k)).toEqual(expect.arrayContaining(['Escape', 'ArrowDown']));
  /* One session per page load: every line shares the id. */
  expect(new Set(events.map((e) => e.s)).size).toBe(1);
  /* No account identity anywhere in a session's file. */
  expect(fs.readFileSync(file, 'utf8')).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
});

test('block 31 — a real password typed into a real password field never reaches the file', async ({ page }) => {
  const before = listSessions();
  await boot(page, { settings: ON });

  /* A genuine focused `input[type=password]`, receiving genuine trusted keystrokes through the CDP
     input pipeline — the one thing the mocked DOM cannot stand in for. The app's own auth surface is
     behind a Supabase sign-in flow that e2e must not drive, so the field is planted directly; the
     tracker listens on `window` keydown, so it sees these keystrokes exactly as it would that one. */
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'password'; i.id = 'pp-signin-password'; i.name = 'password';
    i.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999';
    document.body.appendChild(i); i.focus();
  });
  const secret = 'Correct-Horse-Battery-Staple-99';
  await page.keyboard.type(secret, { delay: 8 });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pp-signin-password')).toBeFocused();

  /* And a normal field, to prove the OTHER half of the rule in the same file: typing here is counted. */
  await page.evaluate(() => { document.getElementById('pp-signin-password').blur(); });
  await page.keyboard.press('q');
  /* The quick-add popup focuses its own input on mount (see renderQuickAddPopup's ref callback), so
     there is nothing to click — which is also why this is a fair test of "typing into a normal field". */
  const quick = page.locator('input[placeholder^="Quick add"]');
  await expect(quick).toBeFocused({ timeout: 5000 });
  const title = 'Draft the acquisition memo';
  await page.keyboard.type(title, { delay: 8 });
  await page.keyboard.press('Escape');

  const { file, raw, events } = await endSessionAndReadLog(page, before);
  console.log('block 31 redaction log:', file);

  /* THE assertion this block exists for. Two statements, and the second is the load-bearing one.

     A raw substring scan over the whole file is not usable on its own: the file legitimately contains
     a session header full of environment prose ("ChronoCompose", the user-agent), so a 2-gram like
     "Co" hits for reasons that have nothing to do with the password. So the scan runs over the only
     surface a typed character could ever land on — the `k` (key name) and `field` values of the
     non-header events. If the gate were removed, that is exactly where the password would appear. */
  expect(raw).not.toContain(secret);
  /* Named keys ("Escape", "ArrowDown") are a closed vocabulary, so they are checked by allowlist; the
     only place an arbitrary CHARACTER can appear is a single-character key name, so the transcript of
     those — in order — is the exact surface a leaked keystroke would show up on. */
  const NAMED = /^((Ctrl|Meta|Alt|Shift)\+)*(Escape|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|Shift|Control|Alt|Meta|CapsLock|F\d{1,2}|[^\s])$/;
  for (const e of events.filter((x) => x.t === 'key')) expect(String(e.k)).toMatch(NAMED);
  const surface = events.filter((e) => e.t === 'key' && String(e.k).length === 1).map((e) => e.k).join('');
  /* `field` and `a` are left out of that scan because they are CLOSED ENUMS, not free text — which is
     itself worth asserting, since it is what makes `k` the only free-form string in the whole file. */
  for (const e of events) {
    if ('field' in e) expect(e.field === null || e.field === 'text' || /^prose:/.test(e.field)).toBe(true);
    if (e.t === 'action') expect(e.a).toMatch(/^[a-z]+\.[a-z]+$/);
  }
  for (const g of bigrams(secret)) expect(surface).not.toContain(g);
  /* Nor a count of it: a password field produces no event at all, so nothing is attributed to one. */
  expect(events.some((e) => /pass|signin/i.test(JSON.stringify(e)))).toBe(false);
  /* And the structural invariant that makes the scan above sufficient: a SINGLE CHARACTER can only
     ever appear as a key name when nothing was focused — i.e. as a shortcut, never as typing. */
  for (const e of events) {
    if (e.t === 'key' && String(e.k).length === 1) expect(e.field).toBeNull();
  }

  /* The normal field DID register — as a count. */
  const typed = events.filter((e) => e.t === 'type');
  expect(typed.length).toBeGreaterThan(0);
  expect(typed.reduce((a, e) => a + e.n, 0)).toBe(title.length);
  for (const e of typed) {
    expect(typeof e.n).toBe('number');
    expect(JSON.stringify(e)).not.toContain('memo');
  }
  /* And the title itself is nowhere. */
  expect(raw).not.toContain(title);
  for (const g of bigrams(title)) expect(surface).not.toContain(g);
});
