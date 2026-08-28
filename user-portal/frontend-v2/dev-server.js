#!/usr/bin/env node
// dev-server.js — serve frontend-v2 with SPA fallback and proxy the API + every server-rendered
// path to a backend. No dependencies.
//
//   BACKEND=http://localhost:3941 PORT=8890 node dev-server.js
//
// Local backend (from user-portal/backend, copy the seed first — never edit the original):
//   DATABASE_PATH=/path/to/copy-of-seed.db PORT=3941 NODE_ENV=staging JWT_SECRET=x node server.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '8890', 10);
const BACKEND = new URL(process.env.BACKEND || 'http://localhost:3941');
const SERVER_PREFIXES = ['/api', '/plexus', '/forum', '/apply', '/evaluate', '/pay', '/pass', '/invite', '/invite-success', '/invite-cancelled',
  '/reset-password', '/qr', '/calendar', '/verify-certificate', '/verify', '/r', '/unsubscribe', '/email-prefs', '/donate', '/uploads', '/f',
  '/speaker', '/building-bridges', '/donor-night', '/terms', '/privacy', '/health', '/__staging', '/__admin'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.ics': 'text/calendar' };
const isServerPath = p => SERVER_PREFIXES.some(x => p === x || p.startsWith(x + '/'));

function proxy(req, res) {
  const headers = Object.assign({}, req.headers, { host: BACKEND.host, 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': 'http' });
  const up = http.request({ hostname: BACKEND.hostname, port: BACKEND.port || 80, path: req.url, method: req.method, headers }, r => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', e => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'backend unreachable at ' + BACKEND.origin + ' (' + e.message + ')' })); });
  req.pipe(up);
}
function send(res, file, status = 200) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(status, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = decodeURIComponent(url.pathname);
  if (isServerPath(p)) return proxy(req, res);
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, file);
  if (path.extname(p)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found: ' + p); }
  return send(res, path.join(ROOT, 'index.html'));
}).listen(PORT, () => console.log(`frontend-v2 dev server → http://localhost:${PORT}  (API + server pages → ${BACKEND.origin})`));
