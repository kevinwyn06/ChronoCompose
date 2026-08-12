/* Zero-dependency static file server for e2e runs.
   Playwright's `webServer` owns this process on a port nothing else uses, which is what retires the
   stale-server trap (a server left running on an assumed port, serving a different worktree). Node is
   already a hard requirement for `npm test`; python is not, so this replaces `python -m http.server`
   for automated runs. Manual QA can keep using python. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8901);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* PP-EXT (31): local disk sink for the alpha usage tracker. The app POSTs newline-delimited JSON here
   and this appends it to `.telemetry/<session>.jsonl` at the repo root (git-ignored). Deliberately
   dumb: append-only, no parsing, no interpretation, and a sanitized session name so a crafted request
   cannot escape the directory. Only reachable over loopback, which is the only place it is useful —
   on the deployed site this route does not exist and the app falls back to its manual export. */
const TELEMETRY = path.join(ROOT, '.telemetry');
const USAGE_PATH = '/__usage';
function appendUsage(req, res) {
  const s = (new URL(req.url, 'http://localhost').searchParams.get('s') || 'session')
    .replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'session';
  let body = '';
  req.on('data', c => { body += c; if (body.length > 4e6) req.destroy(); });
  req.on('end', () => {
    try {
      fs.mkdirSync(TELEMETRY, { recursive: true });
      fs.appendFileSync(path.join(TELEMETRY, s + '.jsonl'), body.endsWith('\n') ? body : body + '\n');
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }).end();
    } catch (e) { res.writeHead(500).end('sink failed'); }
  });
}

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (rel === USAGE_PATH) {
    if (req.method === 'POST') { appendUsage(req, res); return; }
    res.writeHead(405, { 'Allow': 'POST' }).end('POST only'); return;
  }
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  /* Never serve outside the repo root. */
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(buf);
  });
}).listen(PORT, () => console.log(`static-server: http://localhost:${PORT}/ (root ${ROOT})`));
