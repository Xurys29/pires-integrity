'use strict';
// Separate, loopback-only prototype. No application runtime config, API,
// credentials, account, source upload, production storage or technical acts.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../prototypes/line-drawing');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/model.js', ['model.js', 'text/javascript; charset=utf-8']],
  ['/editor.js', ['editor.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
function createDrawingPrototypeServer() {
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { return res.writeHead(400).end(); }
    const asset = assets.get(pathname);
    if (!asset) return res.writeHead(404).end();
    res.setHeader('Content-Type', asset[1]);
    if (req.method === 'HEAD') return res.writeHead(200).end();
    const stream = fs.createReadStream(path.join(root, asset[0]));
    stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end(); });
    stream.pipe(res);
  });
}
if (require.main === module) {
  const port = Number(process.env.PIRES_DRAWING_PORT || 3011);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PIRES_DRAWING_PORT deve ser uma porta válida.');
  createDrawingPrototypeServer().listen(port, '127.0.0.1', () => {
    console.log('Protótipo local de desenho: http://127.0.0.1:' + port + ' — levantamento pendente de revisão, sem escala física.');
  });
}
module.exports = { createDrawingPrototypeServer };
