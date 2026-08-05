/* Workspace seeding for e2e.
   The whole app boots from scoped `pp-*` keys, so `addInitScript` — which runs before page scripts on
   the FIRST load — is the entire fixture mechanism. No navigate/write/re-navigate dance.

   Keys are written unscoped on purpose: `wsKey` only appends `::<workspace>` when a workspace is signed
   in, and e2e runs anonymous. See `architecture/data-storage.md`. */

const DAY = 86400000;

/** Midnight today, in the browser's local zone at page-eval time. */
const MIDNIGHT_EXPR = `(()=>{const d=new Date();d.setHours(0,0,0,0);return d.getTime();})()`;

/** Minimal task; `normalizeTask` fills every other field on load. */
function task(id, name, extra) {
  return Object.assign({ id, name, type: 'Proportional', included: true, planned: 60 }, extra || {});
}

/**
 * Seed localStorage before the app boots.
 * @param {import('@playwright/test').Page} page
 * @param {{tasks?: any[], settings?: object, prefs?: object, sections?: any[]}} data
 */
async function seed(page, data = {}) {
  const payload = {
    tasks: data.tasks || defaultTasks(),
    settings: data.settings || {},
    /* firstRunSeen suppresses the one-time 3-step coach overlay, which otherwise sits over the
       surfaces under test. */
    prefs: Object.assign({ firstRunSeen: true }, data.prefs || {}),
    sections: data.sections || [],
  };
  await page.addInitScript(([d, midnightExpr]) => {
    const midnight = eval(midnightExpr);
    const DAYMS = 86400000;
    /* Relative day offsets in fixtures are resolved here so fixtures never go stale as the wall
       clock advances — the same fix the date-picker drag fixture needed. */
    const resolve = (t) => {
      const o = Object.assign({}, t);
      for (const k of ['start', 'end', 'due', 'snoozeUntil']) {
        if (typeof o[k] === 'string' && /^[+-]?\d+d$/.test(o[k])) o[k] = midnight + parseInt(o[k], 10) * DAYMS;
      }
      return o;
    };
    localStorage.setItem('pp-tasks', JSON.stringify(d.tasks.map(resolve)));
    localStorage.setItem('pp-settings', JSON.stringify(d.settings));
    localStorage.setItem('pp-prefs', JSON.stringify(d.prefs));
    localStorage.setItem('pp-sections', JSON.stringify(d.sections));
    /* Mark today's morning summary as already raised. It is a centred modal that would otherwise sit
       over every surface under test on the first tick of a new calendar day. */
    localStorage.setItem('pp-notify', JSON.stringify({ fired: {}, summaryDay: midnight }));
    /* Mark every one-time migration done so a fixture is never silently rewritten on boot. */
    localStorage.setItem('pp-migrations', JSON.stringify({
      'allday-planned-zero': 1, 'pin-collapse': 1, 'sections-from-primary-tag': 1,
    }));
  }, [payload, MIDNIGHT_EXPR]);
}

function defaultTasks() {
  return [
    task('e2e-1', 'Alpha task', { start: '0d', end: '+2d', priority: 1 }),
    task('e2e-2', 'Beta task', { start: '0d', end: '+1d', priority: 2 }),
    task('e2e-3', 'Gamma task', { start: '+1d', end: '+3d', priority: 3 }),
  ];
}

/** Load the app and wait for the React tree to mount. */
async function boot(page, data) {
  await seed(page, data);
  await page.goto('/index.html');
  await page.locator('[data-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
}

module.exports = { seed, boot, task, defaultTasks, DAY };
