'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const kind = process.argv[2] === 'site' ? 'site' : 'app';
const root = path.join(__dirname, '..', kind);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || (kind === 'site' ? 3001 : 3000));
const allowed = new Set(fs.readdirSync(root, {recursive:true}).filter(file => fs.statSync(path.join(root,file)).isFile()).map(file => file.replaceAll('\\','/')));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
const policyHeaders = Object.fromEntries(fs.readFileSync(path.join(root,'_headers'),'utf8').split(/\r?\n/).filter(line => /^\s+[A-Za-z-]+:/.test(line)).map(line => { const colon=line.indexOf(':'); return [line.slice(0,colon).trim(),line.slice(colon+1).trim()]; }));
http.createServer((req,res) => {
 for(const [name,value] of Object.entries(policyHeaders)) res.setHeader(name,value);
 if (!['GET','HEAD'].includes(req.method)) return res.writeHead(405).end();
 let route; try { route = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { return res.writeHead(400).end(); }
 const file = route === '/' ? 'index.html' : route === '/aplicativo' && kind === 'site' ? 'aplicativo.html' : route.slice(1);
 if (!allowed.has(file) || file === '_headers') return res.writeHead(404).end();
 res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 if (req.method === 'HEAD') return res.end();
 fs.createReadStream(path.join(root,file)).pipe(res);
}).listen(port,host,()=>console.log(`${kind} demo: http://${host}:${port}/`));
