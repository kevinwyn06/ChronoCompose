// Owner ask 2026-09-09: *"link tasks to browser tab (group) and apps."*
//
// A task carries the pages and apps you open to do it, so starting the work is one gesture instead of
// hunting for six tabs. An app is not a second kind of thing: a deep link (`obsidian://`, `slack://`) is
// a URL with another scheme, and treating it as one keeps this a list rather than two features.
//
// The scheme rule is a SAFETY rule and is tested as one. These strings become an href, so a
// `javascript:` URL stored by a bad import or a hand-edited backup would be a script that runs when the
// user clicks their own task. It is filtered on the way into memory AND at read time.
const test = require('node:test');
const assert = require('node:assert');
const { make, loadComponent, withNow, FIXED_NOW } = require('./_load.js');

// The component runs in a vm realm with its own `window`, so a stub on the test process's global would
// never be seen. `loadComponent.lastSandbox` is that realm's globals — the same hook the chrono probe
// in tests/quickadd.test.js uses.
function captureOpens(c) {
  const w = loadComponent.lastSandbox.window;
  const opened = [];
  w.open = (u) => { opened.push(u); };
  void c;
  return opened;
}

// ---------------------------------------------------------------------------
// The scheme rule.
// ---------------------------------------------------------------------------
['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>x</script>',
 'vbscript:msgbox', 'blob:https://x/y'].forEach(bad => {
  test('a dangerous scheme is refused: ' + bad.slice(0, 24), () => {
    const c = make();
    assert.strictEqual(c.normalizeLink(bad), null);
    // And it cannot arrive through stored data either — normalizeTask is the funnel.
    const t = c.normalizeTask({ id: 'a', name: 'a', links: [bad] });
    assert.strictEqual(t.links.length, 0);
    assert.strictEqual(c.taskLinks(t).length, 0, 'and it is filtered again at read time');
  });
});

test('ordinary web and app links are kept as typed', () => {
  const c = make();
  assert.strictEqual(c.normalizeLink('https://example.com/a?b=1').url, 'https://example.com/a?b=1');
  assert.strictEqual(c.normalizeLink('obsidian://open?vault=w&file=n').url, 'obsidian://open?vault=w&file=n');
  assert.strictEqual(c.normalizeLink('slack://channel?id=C1').url, 'slack://channel?id=C1');
  assert.strictEqual(c.normalizeLink('mailto:someone@example.com').url, 'mailto:someone@example.com');
});

test('a bare host is a link; a bare word is not', () => {
  const c = make();
  assert.strictEqual(c.normalizeLink('example.com/deck').url, 'https://example.com/deck',
    'what people actually paste');
  assert.strictEqual(c.normalizeLink('groceries'), null, 'an ordinary word stays an ordinary word');
  assert.strictEqual(c.normalizeLink('  '), null);
  assert.strictEqual(c.normalizeLink(null), null);
});

test('the label is the host for a page and the scheme for an app', () => {
  const c = make();
  assert.strictEqual(c.linkLabel('https://www.notion.so/x/y'), 'notion.so', 'www is noise');
  assert.strictEqual(c.linkLabel('https://docs.google.com/d/1'), 'docs.google.com');
  assert.strictEqual(c.linkLabel('zoom://join?id=9'), 'zoom');
});

// ---------------------------------------------------------------------------
// The mutators.
// ---------------------------------------------------------------------------
test('links are added in order, deduplicated, and removed by url', () => {
  const c = make();
  c.state.tasks = [c.normalizeTask({ id: 'a', name: 'a' })];
  assert.strictEqual(c.addTaskLink('a', 'https://one.example'), true);
  assert.strictEqual(c.addTaskLink('a', 'two.example'), true);
  assert.strictEqual(c.addTaskLink('a', 'https://one.example'), true, 'the call succeeds…');
  assert.strictEqual(c.taskLinks(c.state.tasks[0]).length, 2, '…but files no second copy');
  assert.strictEqual(c.taskLinks(c.state.tasks[0])[0].url, 'https://one.example', 'order is the order added');

  c.removeTaskLink('a', 'https://one.example');
  assert.strictEqual(c.taskLinks(c.state.tasks[0]).map(l => l.url).join(','), 'https://two.example');
});

test('adding an unusable link changes nothing and says so', () => {
  const c = make();
  c.state.tasks = [c.normalizeTask({ id: 'a', name: 'a' })];
  const hist = c.history.length;
  assert.strictEqual(c.addTaskLink('a', 'javascript:alert(1)'), false);
  assert.strictEqual(c.addTaskLink('a', 'nonsense'), false);
  assert.strictEqual(c.taskLinks(c.state.tasks[0]).length, 0);
  assert.strictEqual(c.history.length, hist, 'and leaves no undo entry for a no-op');
});

test('a link change is one commit, so one undo puts it back', () => {
  const c = make();
  c.state.tasks = [c.normalizeTask({ id: 'a', name: 'a', links: ['https://one.example'] })];
  c.addTaskLink('a', 'https://two.example');
  assert.strictEqual(c.taskLinks(c.state.tasks[0]).length, 2);
  c.undo();
  assert.strictEqual(c.taskLinks(c.state.tasks[0]).length, 1);
});

// ---------------------------------------------------------------------------
// The parser. Claiming URLs first removes a whole class of misparse as well as filing the link.
// ---------------------------------------------------------------------------
test('a URL in a quick-add is filed as a link and leaves the title', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = c.parseDateText('review the deck https://docs.example.com/d/123 tomorrow');
    assert.strictEqual(p.links.length, 1);
    assert.strictEqual(p.links[0].url, 'https://docs.example.com/d/123');
    const shaped = c.shapeParsedTask(p, 'anchor');
    assert.strictEqual(shaped.name, 'review the deck', 'the link is not left sitting in the name');
    assert.strictEqual(shaped.links.length, 1);
  });
});

// The load-bearing reason the URL pass runs FIRST: a link is full of digits, colons and slashes, and
// chrono reads them as dates and clocks. This used to invent a schedule out of a pasted link.
test('a dated-looking URL does not invent a schedule', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = c.parseDateText('read https://blog.example.com/2019/03/07/a-post');
    assert.strictEqual(p.start, null, 'no start was invented from the path');
    assert.strictEqual(p.end, null);
    assert.strictEqual(p.links.length, 1);
  });
});

test('a real date beside a URL still parses', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    const p = c.parseDateText('read https://blog.example.com/2019/03/07/a-post tomorrow');
    assert.ok(p.start != null, 'the word tomorrow still means tomorrow');
    assert.strictEqual(p.links.length, 1);
  });
});

test('renaming ADDS a pasted link rather than replacing the set', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.tasks = [c.normalizeTask({ id: 'a', name: 'a', links: ['https://one.example'], deps: [], pct: 0 })];
    c.rename('a', 'a https://two.example');
    const urls = c.taskLinks(c.state.tasks[0]).map(l => l.url);
    assert.strictEqual(urls.join(','), 'https://one.example,https://two.example');
  });
});

test('a title that mentions no link is not an instruction to unfile one', () => {
  withNow(FIXED_NOW, () => {
    const c = make();
    c.state.tasks = [c.normalizeTask({ id: 'a', name: 'a', links: ['https://one.example'], deps: [], pct: 0 })];
    c.rename('a', 'a better name');
    assert.strictEqual(c.taskLinks(c.state.tasks[0]).length, 1);
  });
});

// ---------------------------------------------------------------------------
// Opening. "Open all" is the tab-group gesture the ask is really about.
// ---------------------------------------------------------------------------
test('opening a task opens every link it holds, and nothing it does not', () => {
  const c = make();
  c.state.tasks = [c.normalizeTask({ id: 'a', name: 'a',
    links: ['https://one.example', 'obsidian://open?vault=w'] })];
  const opened = captureOpens(c);
  assert.strictEqual(c.openTaskLinks('a'), 2);
  assert.strictEqual(opened.join(','), 'https://one.example,obsidian://open?vault=w');
  opened.length = 0;
  assert.strictEqual(c.openTaskLink('javascript:alert(1)'), false, 'refused at the last gate too');
  assert.strictEqual(opened.length, 0);
});

test('opening a task with no links is a harmless no-op', () => {
  const c = make();
  c.state.tasks = [c.normalizeTask({ id: 'a', name: 'a' })];
  assert.strictEqual(c.openTaskLinks('a'), 0);
  assert.strictEqual(c.openTaskLinks('nope'), 0);
});

test('the row chip appears only when there is something to open', () => {
  const c = make();
  const none = c.normalizeTask({ id: 'a', name: 'a' });
  const some = c.normalizeTask({ id: 'b', name: 'b', links: ['https://one.example'] });
  assert.strictEqual(c.taskLinkChip(none), null);
  assert.ok(c.taskLinkChip(some), 'a task with links gets a chip');
});
