'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
for(const name of ['prepared-documents','perenco-line-list']){
 const target=path.join(root,'supabase/functions/_shared',name+'.private.json');
 if(!fs.existsSync(target))fs.copyFileSync(path.join(root,'supabase/private-examples',name+'.example.json'),target);
}
fs.mkdirSync(path.join(root,'output'),{recursive:true});
console.log('Local empty catalogs prepared; no credentials or production access.');

