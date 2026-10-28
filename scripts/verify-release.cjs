'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=require('../release/published-manifest.json');
const failures=[];let matched=0;
for(const f of manifest){if(f.path==='runtime-config.js')continue;const p=path.join(root,'app',f.path);
 if(!fs.existsSync(p)||crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==f.sha256)failures.push(f.path);else matched++;}
console.log(JSON.stringify({matched,expected:60,configurationExcluded:'runtime-config.js',failures}));
if(failures.length)process.exitCode=1;

