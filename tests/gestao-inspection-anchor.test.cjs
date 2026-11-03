'use strict';
// Synthetic PGlite fixtures only. No real client original, account, credential,
// license, deployment, technical signature or calculated deadline is involved.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const {catalogueMetadata,selectCatalogue}=require('./fixtures/gestao-explicit-catalogue.cjs');

async function fixture(t){
 const f=await setup();t.after(()=>f.close());
 await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');
 for(const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())
  await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/inspection-execution.sql'),'utf8'));
 f.professionalId=randomUUID();
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 await f.db.query('insert into pi_team_private.professionals(tenant_id,id,user_id,name,created_by,updated_by) values($1,$2,$3,$4,$3,$3)',[f.ids.tenantA,f.professionalId,f.ids.adminA,'EXECUTOR SINTÉTICO DO TESTE DE MARCO']);
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 const owner=await f.call(f.ids.tenantA,'owners.create',{name:'CLIENTE EXCLUSIVO FIXTURE MARCO',source:'Fixture isolada; não representa cliente real'});
 f.ownerId=owner.id;
 f.callOwner=(action,payload={})=>f.call(f.ids.tenantA,action,{ownerId:f.ownerId,...payload});
 f.date=async offset=>(await f.db.query('select (current_date+$1::integer)::text d',[offset])).rows[0].d;
 f.today=await f.date(0);f.observed=await f.date(-3);f.changedObserved=await f.date(-2);f.planned=await f.date(12);f.due=await f.date(45);
 const hierarchy=await f.callOwner('hierarchy.create',{unit:'U-MARCO-FIXTURE',system:'S-MARCO-FIXTURE'});
 f.asset=await f.callOwner('assets.create',{unitId:hierarchy.unit.id,systemId:hierarchy.system.id,type:'linha',tag:'TAG-EXCLUSIVA-FIXTURE-MARCO',source:'Cadastro sintético isolado'});
 f.contract=await f.callOwner('contracts.create',{requestId:randomUUID(),name:'CONTRATO SINTÉTICO DE MARCO',source:'Fixture sem efeito contratual',modules:['integridade'],assetIds:[f.asset.id]});
 f.campaign=await f.callOwner('campaigns.create',{requestId:randomUUID(),name:'CAMPANHA SINTÉTICA DE MARCO',source:'Fixture',contractId:f.contract.id,systemId:hierarchy.system.id,module:'integridade',assetIds:[f.asset.id],status:'rascunho'});
 f.state=()=>f.callOwner('state.get');
 f.records=async inspectionId=>{const s=await f.state();return {state:s,finding:s.finding.find(r=>r.inspectionId===inspectionId),rti:s.rti.find(r=>r.inspectionId===inspectionId)};};
 f.start=async(type='visual')=>{
  const i=await f.callOwner('inspections.create',{requestId:randomUUID(),assetId:f.asset.id,contractId:f.contract.id,campaignId:f.campaign.id,module:'integridade',type,status:'planejada',source:'Planejamento sintético deliberadamente distinto da data observada',plannedDate:f.planned});
  await f.callOwner('execution.assign',{inspectionId:i.id,professionalId:f.professionalId,expectedVersion:i.version,requestId:randomUUID()});
  if(type==='visual')await selectCatalogue(f,{ownerId:f.ownerId,inspectionId:i.id,catalogId:f.catalogId});
  return f.callOwner('execution.start',{inspectionId:i.id,requestId:randomUUID()});
 };
 return f;
}
async function original(f,format='document_pdf'){
 const sha=createHash('sha256').update(randomUUID()).digest('hex'),ext=format==='image_jpeg'?'jpg':'pdf';
 return f.register(f.ids.tenantA,f.ids.adminA,{sha,name:'FONTE-EXCLUSIVA-FIXTURE-MARCO.'+ext,size:100,objectKey:await f.putObject(f.ids.tenantA,sha,100,ext),workbook:{format,sheets:[],metadata:{extraction:'not_performed'}}});
}
async function catalog(f){
 const src=await original(f),source={sourceId:src.id,fileHash:src.id,fileName:src.name,locator:{page:1}},id=randomUUID();
 const items=[{id:'marco-item',itemKey:'1',component:'COMPONENTE SINTÉTICO DE MARCO',conditions:[{id:'condition-a',text:'CONDIÇÃO A SOMENTE FIXTURE',source},{id:'condition-b',text:'CONDIÇÃO B SOMENTE FIXTURE',source}],recommendations:[{id:'recommendation-a',text:'AÇÃO A SOMENTE FIXTURE',conditionIds:['condition-a','condition-b'],source},{id:'recommendation-b',text:'AÇÃO B SOMENTE FIXTURE',conditionIds:['condition-a','condition-b'],source}]}];
 await f.db.query('insert into pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id,source_id,source_locator,items,verified_by,verified_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now())',[f.ids.tenantA,f.ownerId,id,src.id,JSON.stringify({page:1}),JSON.stringify(items),f.ids.adminA]);
 await catalogueMetadata(f,{ownerId:f.ownerId,catalogId:id,contractIds:[f.contract.id],assetIds:[f.asset.id]});f.catalogId=id;
}
async function answerWithPhoto(f,d){
 const src=await original(f,'image_jpeg'),photo=await f.callOwner('photos.create',{assetId:f.asset.id,lvtItemId:d.execution.items[0].lvtItemId,sourceId:src.id,locator:{section:'ITEM SINTÉTICO 1'},caption:'FOTO SINTÉTICA DE MARCO'});
 return {catalogItemId:'marco-item',itemKey:'1',conditionId:'condition-a',recommendationId:'recommendation-a',notCovered:false,photoIds:[photo.id]};
}
function savePayload(d,observedOn,answers,extra={}){return {inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID(),observedOn,answers,...extra};}
const save=(f,d,observedOn,answers,extra={})=>f.callOwner('execution.save',savePayload(d,observedOn,answers,extra));
function assertAnchor(record,d,date,sourceVersion=d.execution.version){
 assert.deepEqual(record.deadlineAnchor,{event:'inspection_performed',date:date??null,status:date?'declared':'pending_observed_on',inspectionId:d.inspection.id,executionId:d.execution.id,executionVersion:sourceVersion});
}
async function manualDue(f,rti){
 return f.callOwner('rtis.update',{id:rti.id,expectedVersion:rti.version,requestId:randomUUID(),due:f.due,evidence:'Prazo MANUAL exclusivo de fixture; sem regra, matriz ou cálculo de prazo.'});
}

test('anchor: pending date is never planning/current date; missing-date gates and legacy metadata backfill',async t=>{
 const f=await fixture(t);await catalog(f);let d=await f.start();assert.equal(d.inspection.planned,f.planned);
 assertAnchor(d.execution,d,null);assert.equal(d.execution.observedOn,undefined);
 const a=await answerWithPhoto(f,d),beforeVersion=d.execution.version;
 await assert.rejects(save(f,d,null,[a]),{code:'22023'});
 assert.equal((await f.records(d.inspection.id)).rti,undefined);
 assert.equal((await f.callOwner('execution.get',{inspectionId:d.inspection.id})).execution.version,beforeVersion);
 d=await save(f,d,null,[{...a,recommendationId:null}]);assertAnchor(d.execution,d,null);assert.equal(d.execution.status,'rascunho');
 await assert.rejects(f.callOwner('execution.submit',{inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID()}),{code:'22023'});
 await assert.rejects(save(f,d,f.observed,[{...a,recommendationId:null}],{deadlineAnchor:{date:f.planned,status:'declared'}}),{code:'22023'});
 // Simulate a pre-feature draft in this isolated fixture; no backfill fabricates
 // an observation date or mutates any production record.
 await f.db.query("update pi_gestao_private.records set body=body-'deadlineAnchor' where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.ownerId,d.execution.id]);
 d=await save(f,d,f.observed,[{...a,recommendationId:null}]);assertAnchor(d.execution,d,f.observed);
 assert.notEqual(d.execution.deadlineAnchor.date,f.planned);assert.notEqual(d.execution.deadlineAnchor.date,f.today);
 assert.equal((await f.records(d.inspection.id)).finding,undefined);
});

test('anchor: execution/finding/RTI reference saved content version; replay and no-op do not invalidate manual due',async t=>{
 const f=await fixture(t);await catalog(f);let d=await f.start();const a=await answerWithPhoto(f,d),input=savePayload(d,f.observed,[a]);
 d=await f.callOwner('execution.save',input);let rec=await f.records(d.inspection.id);
 assertAnchor(d.execution,d,f.observed);assertAnchor(rec.finding,d,f.observed);assertAnchor(rec.rti,d,f.observed);
 assert.equal(rec.rti.due,undefined);assert.notEqual(rec.rti.deadlineReviewRequired,true);
 const ids={execution:d.execution.id,finding:rec.finding.id,rti:rec.rti.id};
 const replay=await f.callOwner('execution.save',input);assert.equal(replay.execution.version,d.execution.version);
 const due=await manualDue(f,rec.rti);assert.equal(due.due,f.due);assert.equal(due.deadlineAnchor.executionVersion,d.execution.version);
 d=await save(f,d,f.observed,[a]);rec=await f.records(d.inspection.id);
 assertAnchor(d.execution,d,f.observed);assertAnchor(rec.finding,d,f.observed);assertAnchor(rec.rti,d,f.observed);
 assert.equal(rec.rti.due,f.due);assert.notEqual(rec.rti.deadlineReviewRequired,true);
 assert.deepEqual({execution:d.execution.id,finding:rec.finding.id,rti:rec.rti.id},ids);
 assert.equal(rec.state.rti.filter(r=>r.inspectionId===d.inspection.id).length,1);
 assert.equal(rec.state.contract.length,1);
});

test('anchor: changing observed date flags manual due review, keeps old/new audit and survives database reopen',async t=>{
 const f=await fixture(t);await catalog(f);let d=await f.start();const a=await answerWithPhoto(f,d);
 d=await save(f,d,f.observed,[a]);const before=await f.records(d.inspection.id);await manualDue(f,before.rti);
 const oldExecutionVersion=d.execution.version;d=await save(f,d,f.changedObserved,[a]);let rec=await f.records(d.inspection.id);
 for(const r of [d.execution,rec.finding,rec.rti])assertAnchor(r,d,f.changedObserved);
 assert.equal(rec.rti.id,before.rti.id);assert.equal(rec.finding.id,before.finding.id);assert.equal(rec.rti.due,f.due);assert.equal(rec.rti.deadlineReviewRequired,true);
 const changes=(await f.db.query('select body from pi_gestao_private.audit where tenant_id=$1 and owner_id=$2 and record_id=$3 order by seq',[f.ids.tenantA,f.ownerId,rec.rti.id])).rows.map(r=>r.body);
 const change=changes.find(b=>b.previous?.deadlineAnchor?.date===f.observed&&b.record?.deadlineAnchor?.date===f.changedObserved);
 assert.ok(change,'audit preserves old/new declared anchor');assert.equal(change.previous.due,f.due);assert.equal(change.record.due,f.due);assert.equal(change.record.deadlineReviewRequired,true);
 assert.equal(change.previous.deadlineAnchor.executionVersion,oldExecutionVersion);assert.equal(change.record.deadlineAnchor.executionVersion,d.execution.version);
 const sameInput=savePayload(d,f.changedObserved,[a]);d=await f.callOwner('execution.save',sameInput);const replay=await f.callOwner('execution.save',sameInput);assert.equal(replay.execution.version,d.execution.version);
 rec=await f.records(d.inspection.id);assert.equal(rec.rti.deadlineReviewRequired,true);assert.equal(rec.rti.due,f.due);
 const reopened=await setup({loadDataDir:await f.db.dumpDataDir()});try{
  const restored=await reopened.call(f.ids.tenantA,'execution.get',{ownerId:f.ownerId,inspectionId:d.inspection.id}),state=await reopened.call(f.ids.tenantA,'state.get',{ownerId:f.ownerId}),rti=state.rti.find(r=>r.id===rec.rti.id);
  assertAnchor(restored.execution,restored,f.changedObserved);assertAnchor(rti,restored,f.changedObserved);assert.equal(rti.due,f.due);assert.equal(rti.deadlineReviewRequired,true);
 }finally{await reopened.close();}
});

test('anchor: condition-only and recommendation-only edits keep RTI IDs and flag existing deadline',async t=>{
 const f=await fixture(t);await catalog(f);
 for(const edit of [{conditionId:'condition-b'},{recommendationId:'recommendation-b'}]){
  let d=await f.start();const a=await answerWithPhoto(f,d);d=await save(f,d,f.observed,[a]);const before=await f.records(d.inspection.id);await manualDue(f,before.rti);
  d=await save(f,d,f.observed,[{...a,...edit}]);const rec=await f.records(d.inspection.id);
  assert.equal(rec.rti.id,before.rti.id);assert.equal(rec.finding.id,before.finding.id);assert.equal(rec.rti.due,f.due);assert.equal(rec.rti.deadlineReviewRequired,true);
  assertAnchor(rec.rti,d,f.observed);assertAnchor(rec.finding,d,f.observed);
  assert.equal(rec.state.rti.filter(r=>r.inspectionId===d.inspection.id).length,1);
 }
});

test('anchor: recommendation withdrawal preserves RTI/manual deadline and refreshes source anchor with sticky review',async t=>{
 const f=await fixture(t);await catalog(f);let d=await f.start();const a=await answerWithPhoto(f,d);
 d=await save(f,d,f.observed,[a]);const before=await f.records(d.inspection.id);await manualDue(f,before.rti);
 d=await save(f,d,f.changedObserved,[{...a,recommendationId:null}]);let rec=await f.records(d.inspection.id);
 assert.equal(rec.rti.id,before.rti.id);assert.equal(rec.finding.id,before.finding.id);assert.equal(rec.rti.due,f.due);assert.equal(rec.rti.recommendationWithdrawn,true);assert.equal(rec.rti.deadlineReviewRequired,true);
 assertAnchor(d.execution,d,f.changedObserved);assertAnchor(rec.finding,d,f.changedObserved);assertAnchor(rec.rti,d,f.changedObserved);
 d=await save(f,d,f.changedObserved,[{...a,recommendationId:null}]);rec=await f.records(d.inspection.id);assert.equal(rec.rti.deadlineReviewRequired,true);assert.equal(rec.rti.due,f.due);
 assert.equal(rec.state.rti.filter(r=>r.inspectionId===d.inspection.id).length,1);
});

test('anchor: withdrawn pending date stays pending after manual due and no-op; historical recommendation is not current input',async t=>{
 const f=await fixture(t);await catalog(f);let d=await f.start();const a=await answerWithPhoto(f,d);
 d=await save(f,d,f.observed,[a]);const initial=await f.records(d.inspection.id);
 const withdrawal={...a,recommendationId:null};
 d=await save(f,d,null,[withdrawal]);let rec=await f.records(d.inspection.id);
 assertAnchor(rec.rti,d,null);assertAnchor(rec.finding,d,null);assert.equal(rec.rti.recommendationWithdrawn,true);assert.notEqual(rec.rti.deadlineReviewRequired,true);
 assert.equal(rec.rti.sourceDate,f.observed,'historical source date remains distinct from a deliberately pending anchor');
 assert.equal(rec.rti.recommendationId,'recommendation-a','historical recommendation remains available for technical review');
 await manualDue(f,rec.rti);
 d=await save(f,d,null,[withdrawal]);rec=await f.records(d.inspection.id);
 assertAnchor(d.execution,d,null);assertAnchor(rec.rti,d,null);assertAnchor(rec.finding,d,null);
 assert.equal(rec.rti.due,f.due);assert.notEqual(rec.rti.deadlineReviewRequired,true,'same absent date and withdrawn selection must not create new deadline invalidation');
 d=await save(f,d,f.changedObserved,[withdrawal]);rec=await f.records(d.inspection.id);
 assertAnchor(rec.rti,d,f.changedObserved);assert.equal(rec.rti.deadlineReviewRequired,true);assert.equal(rec.rti.due,f.due);
 assert.equal(rec.rti.id,initial.rti.id);assert.equal(rec.finding.id,initial.finding.id);
});

test('anchor: RTI update failure rolls back every new anchor and retry keeps identities/manual deadline',async t=>{
 const f=await fixture(t);await catalog(f);let d=await f.start();const a=await answerWithPhoto(f,d);
 d=await save(f,d,f.observed,[a]);let rec=await f.records(d.inspection.id);await manualDue(f,rec.rti);const prior=await f.records(d.inspection.id);
 await f.db.exec("create function pi_gestao_private.fixture_anchor_update_failure() returns trigger language plpgsql as $$begin if new.kind='rti' and new.body->'deadlineAnchor'->>'date' is distinct from old.body->'deadlineAnchor'->>'date' then raise exception 'isolated_anchor_update_failure';end if;return new;end$$;create trigger fixture_anchor_update_failure before update on pi_gestao_private.records for each row execute function pi_gestao_private.fixture_anchor_update_failure();");
 const input=savePayload(d,f.changedObserved,[a]);await assert.rejects(f.callOwner('execution.save',input),/isolated_anchor_update_failure/);
 const unchanged=await f.callOwner('execution.get',{inspectionId:d.inspection.id});rec=await f.records(d.inspection.id);
 assert.equal(unchanged.execution.version,d.execution.version);assertAnchor(unchanged.execution,unchanged,f.observed);assertAnchor(rec.rti,unchanged,f.observed);assertAnchor(rec.finding,unchanged,f.observed);
 assert.equal(rec.rti.version,prior.rti.version);assert.equal(rec.rti.due,f.due);assert.notEqual(rec.rti.deadlineReviewRequired,true);
 await f.db.exec('drop trigger fixture_anchor_update_failure on pi_gestao_private.records;drop function pi_gestao_private.fixture_anchor_update_failure();');
 d=await f.callOwner('execution.save',input);rec=await f.records(d.inspection.id);assertAnchor(rec.rti,d,f.changedObserved);assert.equal(rec.rti.id,prior.rti.id);assert.equal(rec.finding.id,prior.finding.id);assert.equal(rec.rti.due,f.due);assert.equal(rec.rti.deadlineReviewRequired,true);
});

test('anchor: thickness preserves declared inspection event; submission does not turn issuance time into the anchor',async t=>{
 const f=await fixture(t);let d=await f.start('espessura');assertAnchor(d.execution,d,null);
 d=await save(f,d,f.observed,[],{instrument:'INSTRUMENTO SINTÉTICO DE MARCO',readings:[{point:'PONTO INFORMADO SOMENTE NA FIXTURE',value:'4.25',unit:'mm'}]});assertAnchor(d.execution,d,f.observed);assert.equal(d.execution.type,'espessura');
 const savedVersion=d.execution.version,input={inspectionId:d.inspection.id,expectedVersion:savedVersion,requestId:randomUUID()};d=await f.callOwner('execution.submit',input);
 assert.ok(d.execution.version>savedVersion);assertAnchor(d.execution,d,f.observed,savedVersion);assert.equal(d.execution.status,'em_revisao');assert.equal(d.execution.signatureStatus,'pendente');
 const replay=await f.callOwner('execution.submit',input);assert.equal(replay.execution.version,d.execution.version);assertAnchor(replay.execution,replay,f.observed,savedVersion);
 const rec=await f.records(d.inspection.id);assert.equal(rec.finding,undefined);assert.equal(rec.rti,undefined);assert.equal(rec.state.lvt.length,0);
 assert.notEqual(d.execution.deadlineAnchor.date,f.planned);assert.notEqual(d.execution.deadlineAnchor.date,f.today);
});
