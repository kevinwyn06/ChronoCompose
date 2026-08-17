// The one-time data migrations behind the 2026-08-16 allotment fix. Each is pure, each is run
// TWICE here, and the second run must be a no-op — a migration that is not idempotent is a migration
// that corrupts data the day someone clears a flag.
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./_load.js');

test('migratePlannedNull rewrites a deliberate-looking zero as unset, once', () => {
  const c = make();
  const tasks = [
    { id: 'a', planned: 0 },
    { id: 'b', planned: 60 },
    { id: 'c', planned: null },
  ];
  assert.equal(c.migratePlannedNull(tasks), 1, 'only the stored 0 changes');
  assert.equal(tasks[0].planned, null,
    'reading a stored 0 as "never chosen" is sound EXACTLY once — no other meaning for 0 existed before');
  assert.equal(tasks[1].planned, 60, 'a real estimate is untouched');
  assert.equal(tasks[2].planned, null, 'an already-null figure is untouched');
  assert.equal(c.migratePlannedNull(tasks), 0, 'idempotent: the second run changes nothing');
});

test('runOnceMigrations guards migratePlannedNull behind the planned-null-unset flag', () => {
  const c = make();
  c.lsSet('pp-migrations', JSON.stringify({}));
  const tasks = [{ id: 'a', planned: 0 }];
  c.runOnceMigrations(tasks);
  assert.equal(tasks[0].planned, null, 'the first boot after the release converts the legacy zero');
  assert.equal(JSON.parse(c.lsGet('pp-migrations'))['planned-null-unset'], 1,
    'the flag is recorded unconditionally — unlike no-calendar-tags this needs no data the constructor lacks');
  const later = [{ id: 'b', planned: 0 }];
  c.runOnceMigrations(later);
  assert.equal(later[0].planned, 0,
    'once the flag is set a typed 0 is a decision and every later boot leaves it alone');
});

test('breakMin defaults to 3', () => {
  const c = make();
  assert.equal(c.DEFAULT_SETTINGS().breakMin, 3,
    'the feature was fully built and switched off; only the default was wrong');
});

test('break-min-default migration lifts a legacy zero to 3, exactly once', () => {
  const c = make();
  c.lsSet('pp-migrations', JSON.stringify({}));
  assert.equal(c.migrateSettings({ breakMin: 0 }).breakMin, 3,
    'a default change alone reaches nobody who has ever saved settings');
  assert.equal(c.migrateSettings({ breakMin: 0 }).breakMin, 0,
    'the flag is now recorded, so a user who deliberately types 0 keeps it forever');
  assert.equal(JSON.parse(c.lsGet('pp-migrations'))['break-min-default'], 1,
    'the guard lives in pp-migrations beside the task-side once-flags');
});

test('break-min-default migration never touches a chosen value', () => {
  const c = make();
  c.lsSet('pp-migrations', JSON.stringify({}));
  assert.equal(c.migrateSettings({ breakMin: 10 }).breakMin, 10,
    'only a stored 0 is read as "never chosen"');
});

test('migrateSettings returns a NEW object and leaves its input alone', () => {
  const c = make();
  c.lsSet('pp-migrations', JSON.stringify({}));
  const src = { breakMin: 0, dayStart: '07:00' };
  const out = c.migrateSettings(src);
  assert.equal(src.breakMin, 0, 'the caller\'s object is not mutated');
  assert.notEqual(out, src, 'a fresh object comes back');
  assert.equal(out.dayStart, '07:00', 'every other key rides through untouched');
});

// Owner, 2026-08-16: "uncompressable should rederive". The earlier shape stamped the derived boolean onto
// every row at first boot, which froze it — a task that gained clock times later stayed Flexible forever.
// The field is now tri-state (null = never decided → derive on every read), and this migration RELEASES
// the rows the earlier stamp froze.
test('uncompressable-rederive releases every row whose value only restates the derivation', () => {
  const c = make();
  const day = c.startOfToday();
  const HOUR = 3600000;
  const tasks = [
    { id: 'a', start: day + HOUR, end: day + 2 * HOUR, startClock: true, endClock: true,
      uncompressable: true },   // stamped true by the old backfill, and true is what the clocks say
    { id: 'b', start: day, end: day + 2 * HOUR, startClock: false, endClock: false,
      uncompressable: false },  // stamped false, and false is what the clocks say
    { id: 'c', uncompressable: false },
    { id: 'd', start: day + HOUR, end: day + 2 * HOUR, startClock: true, endClock: true,
      uncompressable: false },  // CONTRADICTS its clocks: the user really did untick this one
    { id: 'e' },                // never stamped at all
  ];
  assert.equal(c.migrateUncompressable(tasks), 3, 'the three derivation-restating rows are released');
  assert.equal(tasks[0].uncompressable, null, 'released → derives true from its clocks on every read');
  assert.equal(tasks[1].uncompressable, null, 'released → derives false');
  assert.equal(tasks[2].uncompressable, null, 'released → derives false');
  assert.equal(tasks[3].uncompressable, false,
    'a value that CONTRADICTS the clocks is the only evidence of a real decision, so it is left alone');
  assert.equal(tasks[4].uncompressable, undefined, 'an absent field is already in the derive state');
  assert.equal(c.migrateUncompressable(tasks), 0, 'idempotent');
});

test('uncompressable-rederive keeps an explicit tick on a multi-day span with incidental clocks', () => {
  const c = make();
  const day = c.startOfToday();
  const HOUR = 3600000, DAY = 24 * HOUR;
  // Real user rows hold this shape: a plain multi-day window whose endpoints happen to carry a time.
  // hasStartTime/hasEndTime DERIVE a clock from the timestamp, so a naive "both clocks" test reads it as
  // an appointment — and an uncompressable row that is never isFixedOn (its span exceeds a day) reserves
  // its full ask off the top of EVERY day's pool. Same root cause as the clockSpanMinutes day-fit guard,
  // and the migration shares that predicate rather than restating it.
  const tasks = [
    { id: 'w', start: day + 9 * HOUR, end: day + 2 * DAY + 9 * HOUR, startClock: true, endClock: true,
      uncompressable: false },
    { id: 'k', start: day + 9 * HOUR, end: day + 2 * DAY + 9 * HOUR, startClock: true, endClock: true,
      uncompressable: true },
  ];
  assert.equal(c.migrateUncompressable(tasks), 1, 'only the derivation-restating row changes');
  assert.equal(tasks[0].uncompressable, null,
    'a 2-day window derives false, so a stored false carried no decision and is released');
  assert.equal(tasks[1].uncompressable, true,
    'an explicit true on a multi-day span survives — it contradicts the day-fit derivation, ' +
    'so it is a user decision and the migration must not erase it');
  assert.equal(c.migrateUncompressable(tasks), 0, 'idempotent');
});
