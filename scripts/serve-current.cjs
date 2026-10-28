'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../app'),manifest=require('../release/published-manifest.json');
const allowed=new Set(manifest.map(x=>x.path));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const config=process.env.PIRES_MODE==='connected'?require('../app/cloud.js').validateConfig({
 mode:'connected',supabaseUrl:process.env.PIRES_SUPABASE_URL,publishableKey:process.env.PIRES_PUBLISHABLE_KEY,
 appUrl:process.env.PIRES_APP_URL,privacyEmail:process.env.PIRES_PRIVACY_EMAIL,
 selfRegistrationEnabled:process.env.PIRES_SELF_REGISTRATION==='true'
}):{mode:'demo'};
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
 let p;try{p=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);}catch{return res.writeHead(400).end();}
 if(!p)p='index.html';if(!allowed.has(p)&&allowed.has(p+'.html'))p+='.html';
 if(!allowed.has(p)||p==='_headers')return res.writeHead(404).end();
 res.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');
 if(req.method==='HEAD')return res.end();
 if(p==='runtime-config.js')return res.end('window.PIRES_CONFIG = Object.freeze('+JSON.stringify(config)+');\n');
 fs.createReadStream(path.join(root,p)).pipe(res);
}).listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Pires preview ready. Configuration mode: '+config.mode));

