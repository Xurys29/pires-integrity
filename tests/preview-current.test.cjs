'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {createPreviewServer,runtimeConfig}=require('../scripts/serve-current.cjs');
const config=()=>({PIRES_MODE:'connected',PIRES_GESTAO_BACKEND:'supabase',
 PIRES_SUPABASE_URL:'https://fixtureproject.supabase.co',
 PIRES_PUBLISHABLE_KEY:['sb','publishable','isolated_preview_fixture_value'].join('_'),
 PIRES_APP_URL:'https://preview.fixture.invalid',PIRES_PRIVACY_EMAIL:'privacy@fixture.invalid',
 SUPABASE_SERVICE_ROLE_KEY:'server_only_fixture_never_expose'});
test('preview: connected management requires explicit configuration and never returns server credentials',()=>{
 assert.deepEqual(runtimeConfig({}),{mode:'demo'});
 const env=config(),configured=runtimeConfig(env);
 assert.deepEqual(configured.gestao,{backend:'supabase'});
 assert.equal(JSON.stringify(configured).includes(env.SUPABASE_SERVICE_ROLE_KEY),false);
 delete env.PIRES_GESTAO_BACKEND;
 assert.equal(runtimeConfig(env).gestao,undefined);
 assert.throws(()=>runtimeConfig({PIRES_MODE:'connected',PIRES_GESTAO_BACKEND:'supabase'}));
});
test('preview: inspection assets and scoped page load while internal source/configuration remain private',async t=>{
 const server=createPreviewServer(config());server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 for(const route of ['/gestao','/gestao-inspection.js','/gestao-inspection.css']){
  const response=await fetch(base+route);assert.equal(response.status,200,route);assert.ok((await response.text()).length>0);
 }
 const runtime=await (await fetch(base+'/runtime-config.js')).text();
 assert.ok(runtime.includes('"gestao":{"backend":"supabase"}'));
 assert.equal(runtime.includes('server_only_fixture_never_expose'),false);
 for(const route of ['/.env','/supabase/inspection-execution.sql','/release/published-manifest.json','/scripts/serve-current.cjs'])
  assert.equal((await fetch(base+route)).status,404,route);
 assert.equal((await fetch(base+'/gestao-inspection.js',{method:'POST'})).status,405);
});
