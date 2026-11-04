'use strict';
// Actual Edge handler, validators and candidate SQL; synthetic Auth/licensing,
// transport and Storage only. Never a production integration or concurrency proof.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{deflateSync}=require('node:zlib');
const {createScopedEdgeFixture,IMAGE}=require('./fixtures/gestao-scoped-edge.cjs');

function alternateImage(){
 const crc32=b=>{let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const n=Buffer.alloc(4);n.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]),crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([n,body,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,150,60,25,255]))),chunk('IEND',Buffer.alloc(0))]));
}
const photoCount=async f=>(await f.db.query("select count(*)::int n from pi_gestao_private.records where kind='photo'")).rows[0].n;
const sourceCount=async f=>(await f.db.query('select count(*)::int n from pi_gestao_private.sources')).rows[0].n;
const setRevoked=async(f,revoked)=>f.serial(async()=>{
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 try{return await f.db.query('update pi_team_private.professionals set access_revoked_at='+ (revoked?'now()':'null')+' where tenant_id=$1 and id=$2',[f.ids.tenantA,f.professionals.inspector]);}
 finally{await f.db.query("select set_config('request.jwt.claim.sub','',false)");}
});
const revoke=f=>setRevoked(f,true),restore=f=>setRevoked(f,false);

test('scoped Edge/SQL: assigned inspector starts, uploads linked original, saves good coverage and reads only own context/report',async t=>{
 const f=await createScopedEdgeFixture(t,{start:false});
 const status=await f.send('status');assert.equal(status.status,200);assert.equal(status.data.role,'inspector');assert.equal(status.data.accessMode,'assigned_inspector');assert.equal(status.data.capabilities.inspectorWorkspaceVersion,1);assert.equal(status.data.capabilities.assignedExecutionWrite,true);assert.equal(status.data.capabilities.write,false);assert.deepEqual(status.data.preparedSources,[]);
 const started=await f.send('execution-start',{inspectionId:f.inspection.id,requestId:randomUUID()});assert.equal(started.status,200);let d=started.data;assert.equal(d.canExecute,true);
 const upload=await f.photo(d);assert.equal(upload.status,200);assert.equal(upload.data.linked,true);assert.equal(upload.data.photo.lvtItemId,d.execution.items[0].lvtItemId);assert.equal(await photoCount(f),1);
 const date=(await f.db.query('select current_date::text d')).rows[0].d,p=upload.data.photo;
 const saved=await f.send('execution-save',{inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID(),observedOn:date,inspectionStartedOn:date,inspectionEndedOn:date,outcome:'good_condition',coverage:{extent:'declared_section',description:'TRECHO EXCLUSIVAMENTE SINTÉTICO; RESTANTE NÃO DECLARADO',photoIds:[p.id]},answers:[{catalogItemId:'item-scoped-fixture',itemKey:'ITEM-SINTETICO',conditionId:'good-scoped',recommendationId:'none-scoped',notCovered:false,photoIds:[p.id]}]});
 assert.equal(saved.status,200);d=saved.data;assert.equal(d.execution.outcome,'good_condition');
 const other=await f.createActivity({assignee:'admin'});
 const context=await f.send('execution-context');assert.equal(context.status,200);assert.equal(context.data.inspection.length,1);assert.equal(context.data.inspection[0].id,d.inspection.id);assert.ok(!JSON.stringify(context.data).includes(other.inspection.id));
 const report=await f.send('execution/'+d.inspection.id+'/report');assert.equal(report.status,200);assert.equal(report.data.canIssue,false);assert.deepEqual(report.data.inspections.map(x=>x.id),[d.inspection.id]);assert.equal(report.data.rtis.length,0);
 const source=await f.send('execution/'+d.inspection.id+'/sources/'+upload.data.source.sha);assert.equal(source.status,200);assert.deepEqual(new Uint8Array(await source.response.arrayBuffer()),IMAGE);
 const submit=await f.send('execution-submit',{inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID()});assert.equal(submit.status,200);assert.equal(submit.data.execution.status,'em_revisao');
 assert.equal((await f.db.query("select count(*)::int n from pi_gestao_private.records where kind='rti'")).rows[0].n,0);
});

test('scoped Edge/SQL: generic owner reads and administrative POSTs never become inspector permissions',async t=>{
 const f=await createScopedEdgeFixture(t);f.events.length=0;
 for(const route of ['state','history/'+f.asset.id,'book/'+f.asset.id,'reports/system/'+f.system.id,'reports/contracts/'+f.contract.id+'/system/'+f.system.id,'sources/'+f.catalogOriginal.id]){
  const r=await f.send(route);assert.equal(r.status,403,route);assert.equal(r.data.code,'scoped_read_required');
 }
 for(const route of ['execution-assign','execution-catalog-select','photos','assets','project-create'])assert.equal((await f.send(route,{inspectionId:f.inspection.id,requestId:randomUUID()})).status,403,route);
 assert.equal((await f.send('sources/photo',undefined,{raw:IMAGE,headers:{'Content-Type':'image/png','X-Pires-Source-Name':'FOTO.png'}})).status,403);
 assert.equal(f.events.some(e=>e.kind==='serviceClient'),false);assert.equal(f.events.some(e=>['state.get','sources.get','reports.system','execution.assign'].includes(e.args?.p_action)),false);
 const other=await f.createActivity({assignee:'admin'});assert.equal((await f.send('execution/'+other.inspection.id+'/context')).status,403);assert.equal((await f.send('execution/'+other.inspection.id+'/report')).status,403);
 assert.equal((await f.send('execution/'+f.inspection.id,undefined,{tenant:f.ids.tenantB})).status,403);
});

test('scoped Edge/SQL: existing planner and assistant generic consultation stays read-only without inspector privileges',async t=>{
 const f=await createScopedEdgeFixture(t),photo=await f.photo(f.detail);assert.equal(photo.status,200);
 for(const actor of ['planner','assistant']){
  const status=await f.send('status',undefined,{actor});assert.equal(status.status,200);assert.equal(status.data.accessMode,'consultation');assert.equal(status.data.capabilities.write,false);assert.equal(status.data.capabilities.assignedExecutionWrite,false);
  for(const route of ['state','book/'+f.asset.id,'history/'+f.asset.id,'reports/contracts/'+f.contract.id+'/system/'+f.system.id])assert.equal((await f.send(route,undefined,{actor})).status,200,actor+': '+route);
  const bytes=await f.send('sources/'+photo.data.source.sha,undefined,{actor});assert.equal(bytes.status,200);assert.deepEqual(new Uint8Array(await bytes.response.arrayBuffer()),IMAGE);
  const before=f.events.length;for(const action of ['execution-start','execution-assign','photos','assets'])assert.equal((await f.send(action,{inspectionId:f.inspection.id,requestId:randomUUID()},{actor})).status,403);
  assert.equal(f.events.slice(before).some(e=>['execution.start','execution.assign','photos.create','assets.create'].includes(e.args?.p_action)),false);
 }
});

test('scoped Edge/SQL: nonadmin inspector treatment creates one point/finding/RTI and preserves its performed-date anchor on replay',async t=>{
 const f=await createScopedEdgeFixture(t),p=await f.photo(f.detail);assert.equal(p.status,200);
 const observed=(await f.db.query('select (current_date-4)::text d')).rows[0].d;
 const payload={inspectionId:f.inspection.id,expectedVersion:f.detail.execution.version,requestId:randomUUID(),observedOn:observed,outcome:'treatment_required',coverage:{extent:'declared_section',description:'TRECHO SOMENTE FIXTURE COM REFERÊNCIA DECLARADA',photoIds:[p.data.photo.id]},answers:[{catalogItemId:'item-scoped-fixture',itemKey:'ITEM-SINTETICO',conditionId:'action-scoped',recommendationId:'treat-scoped',notCovered:false,pointLabel:'PONTO DECLARADO EXCLUSIVAMENTE SINTÉTICO',photoIds:[p.data.photo.id]}]};
 const saved=await f.send('execution-save',payload);assert.equal(saved.status,200);const repeated=await f.send('execution-save',payload);assert.equal(repeated.status,200);assert.equal(repeated.data.execution.id,saved.data.execution.id);
 const report=await f.send('execution/'+f.inspection.id+'/report');assert.equal(report.status,200);assert.equal(report.data.rtis.length,1);assert.equal(report.data.findings.length,1);assert.equal(report.data.documents.filter(d=>d.recordClass==='field_point_reference').length,1);
 const rti=report.data.rtis[0];assert.equal(rti.inspectionId,f.inspection.id);assert.equal(rti.executionId,saved.data.execution.id);assert.equal(rti.status,'aberta');assert.equal(rti.currentness,'unknown');assert.equal(rti.deadlineAnchor.date,observed);assert.equal(rti.due,undefined);assert.deepEqual(rti.photoIds,[p.data.photo.id]);assert.equal(report.data.canIssue,false);
 const again=await f.send('execution-save',{...payload,requestId:randomUUID(),expectedVersion:saved.data.execution.version});assert.equal(again.status,200);const after=await f.send('execution/'+f.inspection.id+'/report');assert.equal(after.data.rtis.length,1);assert.equal(after.data.rtis[0].id,rti.id);assert.equal(after.data.findings[0].id,report.data.findings[0].id);
});

test('scoped Edge/SQL: unauthorized item is rejected before image body, validation or privileged Storage',async t=>{
 const f=await createScopedEdgeFixture(t),other=await f.createActivity({assignee:'admin',start:true});f.events.length=0;let pulls=0;
 const stream=new ReadableStream({pull(c){pulls++;c.enqueue(IMAGE);c.close();}},{highWaterMark:0});
 const r=await f.send('execution/'+f.inspection.id+'/items/'+other.execution.items[0].lvtItemId+'/photos/'+randomUUID(),undefined,{raw:stream,headers:{'Content-Type':'image/png','X-Pires-Source-Name':'FOTO.png','X-Pires-Execution-Version':String(f.detail.execution.version)}});
 assert.equal(r.status,403);assert.equal(pulls,0);assert.equal(f.events.some(e=>['validatePhoto','serviceClient','upload'].includes(e.kind)),false);assert.equal(await photoCount(f),0);
});

test('scoped Edge/SQL: assignment revocation during parsing blocks Storage and linking',async t=>{
 const f=await createScopedEdgeFixture(t);f.events.length=0;f.hooks.duringValidation=()=>revoke(f);
 const r=await f.photo(f.detail);assert.equal(r.status,403);assert.equal(f.events.some(e=>e.kind==='upload'),false);assert.equal(await photoCount(f),0);assert.equal(await sourceCount(f),1);
});

test('scoped Edge/SQL: revocation after upload leaves explicit unconfirmed bytes, never a linked photo; retry is stable',async t=>{
 const f=await createScopedEdgeFixture(t),requestId=randomUUID();f.hooks.afterUpload=()=>revoke(f);
 const denied=await f.photo(f.detail,{requestId});assert.equal(denied.status,403);assert.equal(denied.data.originalStored,true);assert.equal(denied.data.photoLinkConfirmed,false);assert.equal(denied.data.requestId,requestId);assert.equal(await photoCount(f),0);assert.equal(await sourceCount(f),1);assert.equal(f.files.size,2);
 f.hooks.afterUpload=null;await restore(f);const retry=await f.photo(f.detail,{requestId});assert.equal(retry.status,200);assert.equal(await photoCount(f),1);assert.equal(await sourceCount(f),2);
 const repeat=await f.photo(f.detail,{requestId});assert.equal(repeat.status,200);assert.equal(repeat.data.photo.id,retry.data.photo.id);assert.equal(await photoCount(f),1);assert.equal(f.files.size,2);assert.ok(f.events.filter(e=>e.kind==='upload').every(e=>e.settings.upsert===false));
});

test('scoped Edge/SQL: lost commit response replays one photo; same request with different bytes/item conflicts without deletion',async t=>{
 const f=await createScopedEdgeFixture(t),requestId=randomUUID();let lost=true;
 f.hooks.afterServiceRpc=()=>{if(lost){lost=false;throw Error('SYNTHETIC RESPONSE LOST AFTER COMMIT');}};
 const first=await f.photo(f.detail,{requestId});assert.equal(first.status,503);assert.equal(first.data.photoLinkConfirmed,false);assert.equal(first.data.originalStored,true);assert.equal(await photoCount(f),1);const sourceTotal=await sourceCount(f);
 const retry=await f.photo(f.detail,{requestId});assert.equal(retry.status,200);assert.equal(await photoCount(f),1);
 const changed=await f.send('execution-save',{inspectionId:f.inspection.id,expectedVersion:f.detail.execution.version,requestId:randomUUID(),observedOn:null,answers:[]});assert.equal(changed.status,200);assert.ok(changed.data.execution.version>f.detail.execution.version);
 const knownAfterSave=await f.photo(f.detail,{requestId});assert.equal(knownAfterSave.status,200);assert.equal(knownAfterSave.data.photo.id,retry.data.photo.id);assert.equal(await photoCount(f),1);
 const newStaleRequest=await f.photo(f.detail);assert.equal(newStaleRequest.status,409);assert.equal(await photoCount(f),1);
 const wrongBytes=await f.photo(f.detail,{requestId,bytes:alternateImage()});assert.equal(wrongBytes.status,409);assert.equal(wrongBytes.data.photoLinkConfirmed,false);assert.equal(await photoCount(f),1);assert.equal(await sourceCount(f),sourceTotal);assert.equal(f.files.size,3);
 const second=await f.createActivity({start:true});const wrongItem=await f.photo(second,{requestId});assert.equal(wrongItem.status,409);assert.equal(await photoCount(f),1);assert.equal(await sourceCount(f),sourceTotal);assert.equal(f.files.size,3);
});

test('scoped Edge/SQL: source download rechecks assignment after bytes arrive and does not return revoked bytes',async t=>{
 const f=await createScopedEdgeFixture(t),p=await f.photo(f.detail);assert.equal(p.status,200);f.hooks.duringDownload=()=>revoke(f);
 const r=await f.send('execution/'+f.inspection.id+'/sources/'+p.data.source.sha);assert.equal(r.status,403);assert.equal(r.response.headers.get('Content-Type').includes('application/json'),true);assert.equal(r.data.code,'access_denied');
 assert.equal(await photoCount(f),1);assert.equal(f.files.size,2);
});

test('scoped Edge/SQL: failure linking photo atomically rolls back source/photo, retains bytes and retry creates one linked record',async t=>{
 const f=await createScopedEdgeFixture(t),requestId=randomUUID();
 await f.db.exec("create function public.fixture_fail_photo() returns trigger language plpgsql as $$ begin if new.kind='photo' then raise exception 'SYNTHETIC PHOTO FAILURE' using errcode='XX000';end if;return new;end $$;create trigger fixture_fail_photo before insert on pi_gestao_private.records for each row execute function public.fixture_fail_photo();");
 const bad=await f.photo(f.detail,{requestId});assert.equal(bad.status,503);assert.equal(bad.data.originalStored,true);assert.equal(bad.data.photoLinkConfirmed,false);assert.equal(await sourceCount(f),1);assert.equal(await photoCount(f),0);assert.equal(f.files.size,2);
 await f.db.exec('drop trigger fixture_fail_photo on pi_gestao_private.records;drop function public.fixture_fail_photo();');const retry=await f.photo(f.detail,{requestId});assert.equal(retry.status,200);assert.equal(await photoCount(f),1);assert.equal(await sourceCount(f),2);
});

test('scoped Edge/SQL: upload version/CORS and narrow service-only RPC preserve administrative originals path',async t=>{
 const f=await createScopedEdgeFixture(t);f.events.length=0;
 const preflight=await f.handler(new Request('https://scoped-edge.fixture.invalid/functions/v1/gestao-api/companies/'+f.ownerId+'/execution/'+f.inspection.id+'/items/'+f.detail.execution.items[0].lvtItemId+'/photos/'+randomUUID(),{method:'OPTIONS',headers:{Origin:f.origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,x-pires-tenant,x-pires-source-name,x-pires-execution-version'}}));
 assert.equal(preflight.status,204);assert.ok(preflight.headers.get('Access-Control-Allow-Headers').includes('x-pires-execution-version'));
 const invalid=await f.photo(f.detail,{headers:{'X-Pires-Execution-Version':'0'}});assert.equal(invalid.status,400);assert.equal(f.events.some(e=>e.kind==='upload'),false);
 await assert.rejects(f.asRole('authenticated',f.ids.inspector,db=>db.query('select public.pi_gestao_execution_photo($1,$2,$3::jsonb)',[f.ids.tenantA,f.ids.inspector,'{}'])),{code:'42501'});
 const admin=await f.send('sources/photo',undefined,{actor:'admin',raw:IMAGE,headers:{'Content-Type':'image/png','X-Pires-Source-Name':'FOTO-ADMIN-SINTETICA.png'}});assert.equal(admin.status,200);assert.equal(admin.data.id,f.hash(IMAGE));
});
