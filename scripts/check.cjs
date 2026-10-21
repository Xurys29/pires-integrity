'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const demo=fs.readFileSync(path.join(root,'app','runtime-config.js'),'utf8');
if(!/^window\.PIRES_CONFIG = Object\.freeze\(\{mode:'demo'\}\);\s*$/.test(demo)) throw Error('The portable handoff must keep its credential-free demo configuration.');
for(const folder of ['app','site','scripts','tests','lib']) for(const file of fs.readdirSync(path.join(root,folder),{recursive:true})) {
 const p=path.join(root,folder,file); if(!fs.statSync(p).isFile()) continue;
 if(/\.(?:js|cjs|html|css|txt|xml)$/.test(file) && /sb_(?:publishable|secret)_[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(fs.readFileSync(p,'utf8'))) throw Error(`Credential-shaped value found in ${folder}/${file}.`);
 if(/\.(?:js|cjs)$/.test(file)) {
  const result=cp.spawnSync(process.execPath,['--check',p],{encoding:'utf8'}); if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}
 }
}
console.log('JavaScript syntax checks passed.');
