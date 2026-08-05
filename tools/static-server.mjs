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

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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
