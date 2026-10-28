'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../app'),manifest=require('../release/published-manifest.json');
// Keep the published manifest as immutable release evidence; include only these
// explicit inspection assets added by the development branch.
const allowed=new Set([...manifest.map(x=>x.path),'gestao-inspection.js','gestao-inspection.css']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function runtimeConfig(env=process.env){
 const settings=env.PIRES_MODE==='connected'?require('../app/cloud.js').validateConfig({
  mode:'connected',supabaseUrl:env.PIRES_SUPABASE_URL,publishableKey:env.PIRES_PUBLISHABLE_KEY,
  appUrl:env.PIRES_APP_URL,privacyEmail:env.PIRES_PRIVACY_EMAIL,
  selfRegistrationEnabled:env.PIRES_SELF_REGISTRATION==='true'
 }):{mode:'demo'};
 return settings.mode==='connected'&&env.PIRES_GESTAO_BACKEND==='supabase'
  ? {...settings,gestao:{backend:'supabase'}}:settings;
}
function createPreviewServer(env=process.env){
 const config=runtimeConfig(env);
 return http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
 let p;try{p=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);}catch{return res.writeHead(400).end();}
 if(!p)p='index.html';if(!allowed.has(p)&&allowed.has(p+'.html'))p+='.html';
 if(!allowed.has(p)||p==='_headers')return res.writeHead(404).end();
 res.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');
 if(req.method==='HEAD')return res.end();
 if(p==='runtime-config.js')return res.end('window.PIRES_CONFIG = Object.freeze('+JSON.stringify(config)+');\n');
 fs.createReadStream(path.join(root,p)).pipe(res);
 });
}
if(require.main===module)createPreviewServer().listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Pires preview ready. Configuration mode: '+(process.env.PIRES_MODE==='connected'?'connected':'demo')));
module.exports={createPreviewServer,runtimeConfig};

