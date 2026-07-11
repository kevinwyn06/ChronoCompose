// Quick-add natural-language parser (parseDateText) — recurrence phrase stripping.
const { test } = require('node:test');
const assert = require('node:assert');
const { make } = require('./_load');

test('parseDateText strips the single recurrence trigger phrase from the title', () => {
  const c = make();
  const r = c.parseDateText('Sim tuning tomorrow at 4pm p1 every week @sim', Date.now());
  assert.strictEqual(r.recur.kind, 'week');
  assert.ok(!/every\s+week/.test(r.rest));
});

test('parseDateText strips ALL occurrences of the matched recurrence phrase, not just the first', () => {
  // Regression: a title that coincidentally repeats the trigger word (e.g. "Weekly" earlier in the
  // title, "every week" as the actual quick-add trigger) used to only consume the first match,
  // leaving the other stuck in the resulting task title.
  const c = make();
  const r = c.parseDateText('Weekly sync every week @test', Date.now());
  assert.strictEqual(r.recur.kind, 'week');
  assert.ok(!/weekly/i.test(r.rest), `title should not retain "Weekly": ${JSON.stringify(r.rest)}`);
  assert.ok(!/every\s+week/i.test(r.rest), `title should not retain "every week": ${JSON.stringify(r.rest)}`);
});

test('parseDateText: daily trigger word repeated in title is fully stripped', () => {
  const c = make();
  const r = c.parseDateText('Daily standup daily @work', Date.now());
  assert.strictEqual(r.recur.kind, 'day');
  assert.ok(!/daily/i.test(r.rest));
});
