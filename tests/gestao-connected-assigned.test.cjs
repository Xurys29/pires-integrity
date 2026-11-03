'use strict';
// Adapter transport tests only. Authorization is tested separately in SQL/Edge.
const {test}=require('node:test'),assert=require('node:assert/strict');
const Cloud=require('../app/cloud.js'),Connected=require('../app/gestao-connected.js');
const id=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={tenant:id(1),otherTenant:id(2),owner:id(3),inspection:id(4),item:id(5),request:id(6),photo:id(7),execution:id(8)};
const config={mode:'connected',gestao:{backend:'supabase'},supabaseUrl:'https://fixtureproject.supabase.co',publishableKey:'sb_'+'publishable_'+'assigned_transport_fixture',appUrl:'https://app.fixture.invalid',privacyEmail:'privacy@fixture.invalid'};
const scope=()=>({ownerId:ids.owner,inspectionId:ids.inspection,lvtItemId:ids.item,executionVersion:3,requestId:ids.request});
const file=()=>({name:'FOTO SOMENTE FIXTURE.png',size:12,arrayBuffer(){throw Error('Adapter must send original unchanged, not read or replace bytes');}});
const linked=()=>({linked:true,inspectionId:ids.inspection,executionId:ids.execution,requestId:ids.request,photo:{id:ids.photo,lvtItemId:ids.item}});
function setup(respond){
 const requests=[],adapter=Connected.create(config,{cloudApi:Cloud,sdkFactory:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-user-jwt'}},error:null})}}),fetch:async(url,init)=>{requests.push({url:String(url),...init});return respond?respond(String(url),init):Response.json(linked());}});
 adapter.setTenant(ids.tenant);return {adapter,requests};
}
test('assigned transport exposes explicit context/report/source and manager catalogue selection paths without arbitrary route fallback',async()=>{
 const {adapter,requests}=setup(),base='companies/'+ids.owner;
 for(const suffix of ['execution-context','execution/'+ids.inspection+'/context','execution/'+ids.inspection+'/report','execution/'+ids.inspection+'/sources/'+'a'.repeat(64)])await adapter.request(base+'/'+suffix);
 await adapter.request(base+'/execution-catalog-select',{inspectionId:ids.inspection,catalogId:id(9),expectedCatalogHash:'b'.repeat(64),expectedVersion:2,requestId:ids.request});
 assert.deepEqual(requests.map(r=>r.method),['GET','GET','GET','GET','POST']);
 for(const route of [base+'/execution/'+ids.inspection+'/sources/../state',base+'/execution/'+ids.inspection+'/report/other'])await assert.rejects(adapter.request(route),e=>e.code==='unsupported_operation');
 assert.equal(requests.length,5);
});
test('assigned photo transport binds stable request, inspection, item and version and sends raw original with JWT/tenant',async()=>{
 const {adapter,requests}=setup(),original=file(),result=await adapter.uploadInspectionPhoto(original,scope());
 assert.equal(result.photo.id,ids.photo);assert.equal(requests.length,1);
 const r=requests[0],headers=new Headers(r.headers);
 assert.ok(r.url.endsWith('/companies/'+ids.owner+'/execution/'+ids.inspection+'/items/'+ids.item+'/photos/'+ids.request));
 assert.equal(r.body,original);assert.equal(r.method,'POST');assert.equal(headers.get('Content-Type'),'image/png');
 assert.equal(headers.get('X-Pires-Source-Name'),encodeURIComponent(original.name));assert.equal(headers.get('X-Pires-Execution-Version'),'3');assert.equal(headers.get('X-Pires-Tenant'),ids.tenant);assert.equal(headers.get('Authorization'),'Bearer fixture-user-jwt');
});
test('assigned photo transport rejects malformed scope or original before sending and refuses an unlinked or foreign response',async()=>{
 const {adapter,requests}=setup();
 for(const patch of [{inspectionId:'../state'},{lvtItemId:null},{requestId:'not-a-uuid'},{executionVersion:0},{executionVersion:'3'}])await assert.rejects(adapter.uploadInspectionPhoto(file(),{...scope(),...patch}),e=>e.code==='invalid_inspection_scope');
 await assert.rejects(adapter.uploadInspectionPhoto({...file(),name:'fake.svg'},scope()),e=>e.code==='unsupported_format');assert.equal(requests.length,0);
 for(const bad of [{...linked(),linked:false},{...linked(),inspectionId:id(99)},{...linked(),requestId:id(99)},{...linked(),photo:{id:ids.photo,lvtItemId:id(99)}}]){
  const f=setup(()=>Response.json(bad));await assert.rejects(f.adapter.uploadInspectionPhoto(file(),scope()),e=>e.code==='invalid_response');assert.equal(f.requests.length,1);
 }
});
test('assigned photo retry retains caller receipt after uncertain response and never falls back to generic upload',async()=>{
 let count=0;const {adapter,requests}=setup(()=>++count===1?Response.json({error:'Resultado não confirmado'},{status:503}):Response.json(linked()));
 await assert.rejects(adapter.uploadInspectionPhoto(file(),scope()),e=>e.status===503);await adapter.uploadInspectionPhoto(file(),scope());
 assert.equal(requests.length,2);assert.equal(requests[0].url,requests[1].url);assert.ok(requests.every(r=>!r.url.endsWith('/sources/photo')));
});
test('assigned photo response from previous tenant is rejected without replaying into new tenant',async()=>{
 let release;const promise=new Promise(resolve=>release=resolve),f=setup(async()=>{await promise;return Response.json(linked());});
 const upload=f.adapter.uploadInspectionPhoto(file(),scope());await new Promise(resolve=>setImmediate(resolve));f.adapter.setTenant(ids.otherTenant);release();
 await assert.rejects(upload,e=>e.code==='tenant_changed');assert.equal(f.requests.length,1);assert.equal(new Headers(f.requests[0].headers).get('X-Pires-Tenant'),ids.tenant);
});
test('assigned source download uses exact scoped path and preserves denial without generic-source fallback',async()=>{
 const base='companies/'+ids.owner+'/execution/'+ids.inspection+'/sources/'+'f'.repeat(64),f=setup(()=>new Response(Uint8Array.from([1,2,3]),{headers:{'Content-Type':'image/png','Content-Disposition':'attachment; filename="foto.png"'}}));
 const result=await f.adapter.download(base);assert.equal(result.name,'foto.png');assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())],[1,2,3]);assert.equal(f.requests.length,1);
 const denied=setup(()=>Response.json({error:'Atribuição revogada'},{status:403}));await assert.rejects(denied.adapter.download(base),e=>e.status===403);assert.equal(denied.requests.length,1);assert.ok(denied.requests[0].url.endsWith(base));
});
