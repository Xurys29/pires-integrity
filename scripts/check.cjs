'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),root=path.resolve(__dirname,'..');
const files=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
let checked=0;
for(const file of files){const p=path.join(root,file);if(!fs.existsSync(p)||!fs.statSync(p).isFile())continue;
 if(/\.(?:js|cjs|mjs|ts|html|css|txt|xml|json|sql|toml|md)$/.test(file)){
 const text=fs.readFileSync(p,'utf8');
 if(/sb_(?:publishable|secret)_[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text))throw Error('Credential-shaped value in '+file);
 }
 if(/\.(?:js|cjs|mjs)$/.test(file)){const r=cp.spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr);process.exit(r.status||1);}checked++;}
}
console.log('Syntax and credential-pattern checks passed: '+checked+' JavaScript files.');

