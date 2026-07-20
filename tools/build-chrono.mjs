// Regenerates the vendored browser bundle for chrono-node. Run: `npm run build-chrono`.
// Output is an IIFE that assigns the chrono-node module to window.chrono, loaded via a plain
// <script> in index.html's raw <head> — OUTSIDE the Claude-Design-synced text/x-dc document,
// so it never enters the synced region (CLAUDE.md rules 1-3) and works offline like support.js.
import { build } from 'esbuild';

await build({
  stdin: {
    contents: "module.exports = require('chrono-node');",
    resolveDir: process.cwd(),
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  globalName: 'chrono',
  minify: true,
  platform: 'browser',
  target: ['es2019'],
  outfile: 'chrono.min.js',
});
console.log('wrote chrono.min.js');
