// Serves the fictional Summit Outfitters store over HTTPS.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCert } from '../mock-testmo/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function shopHandler(req, res) {
  const p = new URL(req.url, 'https://shop').pathname;
  const file = path.join(here, p === '/' || !path.extname(p) ? 'index.html' : p);
  if (!file.startsWith(here) || !fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

export function startShop({ port = 8444, host = '127.0.0.1', plain = false, certDir = path.join(here, '..', 'mock-testmo', '.cert') } = {}) {
  const server = plain ? http.createServer(shopHandler) : https.createServer(ensureCert(certDir), shopHandler);
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, port: server.address().port, url: `${plain ? 'http' : 'https'}://${host}:${server.address().port}` })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--port');
  const { url } = await startShop({ port: i === -1 ? 8444 : Number(args[i + 1]), plain: args.includes('--http') });
  console.log(`Summit Outfitters listening on ${url}`);
}
