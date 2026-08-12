// Every LOCAL asset index.html loads must be copied into the Vercel build output.
//
// Why this exists: `chrono.min.js` was absent from vercel.json's buildCommand for the whole of
// v0.2.0. Production 404'd on it, `window.chrono` was undefined, and the quick-add parser silently
// lost all date/time extraction — while every unit test, every e2e spec and every local mount passed,
// because locally the file is right there on disk. Nothing in the suite looked at the deploy config,
// so the only detector was the owner typing "test today 9am" into the live app.
//
// This asserts the two lists agree, so adding a vendored file without shipping it fails here.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Local script/link refs only — CDN hosts (React, Supabase, GIS) are not ours to deploy.
function localAssets(html) {
  const out = new Set();
  const re = /<(?:script[^>]*\ssrc|link[^>]*\shref)=["'](\.\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) out.add(m[1].replace(/^\.\//, ''));
  return [...out];
}

// The buildCommand is a shell line; treat it as whitespace-separated words so a filename is matched
// whole (never as a substring of a longer one) regardless of where it sits in the command.
function copiesAsset(buildCommand, asset) {
  return buildCommand.split(/\s+/).includes(asset);
}

test('vercel.json ships every local asset index.html loads', () => {
  const assets = localAssets(read('index.html'));
  assert.ok(assets.length > 0, 'expected to find local <script>/<link> refs in index.html');

  const build = JSON.parse(read('vercel.json')).buildCommand;
  assert.ok(build, 'vercel.json has no buildCommand');

  const missing = assets.filter(a => !copiesAsset(build, a));
  assert.deepStrictEqual(missing, [],
    'index.html loads these local files but vercel.json never copies them into dist/: ' + missing.join(', '));
});

test('every local asset index.html loads actually exists on disk', () => {
  for (const a of localAssets(read('index.html'))) {
    assert.ok(fs.existsSync(path.join(ROOT, a)), a + ' is referenced by index.html but missing from the repo');
  }
});
