// Confirms the vendored/injected chrono engine is reachable and functional in the test sandbox,
// so parser tests can rely on window.chrono. Uses the spike's pinned reference date.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const chrono = require('chrono-node');
const { loadComponent } = require('./_load');

const BASE = new Date(2026, 6, 15, 10, 0, 0, 0); // Wed 2026-07-15 10:00

test('chrono-node parses a basic forward date', () => {
  const d = chrono.parseDate('tomorrow', BASE, { forwardDate: true });
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 6);
  assert.strictEqual(d.getDate(), 16);
});

test('chrono-node exposes the parse() API used by the parser', () => {
  const rs = chrono.parse('lunch at noon', BASE, { forwardDate: true });
  assert.ok(rs.length >= 1);
  assert.strictEqual(rs[0].start.get('hour'), 12);
});

test('the component sandbox can reach chrono the way the browser does', () => {
  // loadComponent() runs index.html's component in a vm context whose window shim carries chrono,
  // mirroring the vendored chrono.min.js <script> in the raw <head>.
  loadComponent();
  const sb = loadComponent.lastSandbox;
  assert.strictEqual(typeof sb.chrono.parse, 'function', 'top-level chrono in sandbox');
  assert.strictEqual(typeof sb.window.chrono.parse, 'function', 'window.chrono in sandbox');
  // and it actually works from inside that context
  const inside = vm.runInContext(
    "window.chrono.parseDate('tomorrow', new Date(2026,6,15,10,0,0,0), {forwardDate:true}).getDate()", sb);
  assert.strictEqual(inside, 16);
});
