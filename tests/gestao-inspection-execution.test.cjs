'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const candidate=fs.readFileSync(path.join(__dirname,'../supabase/inspection-execution.sql'),'utf8');
async function fixture(t){
 const f=await setup();t.after(()=>f.close());
 await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');
 for(const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await f.db.exec(candidate);
 // Synthetic existing staff, isolated from Auth/production; no credentials.
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 f.persons={};
 for(const [key,user] of [['executor',f.ids.adminA],['readonly',f.ids.inspector],['other',f.ids.assistant]]){
  const id=randomUUID();f.persons[key]=id;
  await f.db.query('insert into pi_team_private.professionals(tenant_id,id,user_id,name,created_by,updated_by) values($1,$2,$3,$4,$5,$5)',[f.ids.tenantA,id,user,'EXCLUSIVAMENTE FIXTURE '+key,f.ids.adminA]);
 }
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 const owner=await f.call(f.ids.tenantA,'owners.create',{name:'Cliente exclusivo fixture execução',source:'Fixture isolada'});f.ownerId=owner.id;
 f.exec=(action,payload={},user=f.ids.adminA)=>f.call(f.ids.tenantA,action,{ownerId:f.ownerId,...payload},user);
 const h=await f.exec('hierarchy.create',{unit:'U-FIXTURE',system:'S-FIXTURE'});f.system=h.system;
 f.asset=await f.exec('assets.create',{unitId:h.unit.id,systemId:h.system.id,type:'linha',tag:'TAG-FIXTURE-01',source:'Fixture isolada'});
 f.contract=await f.exec('contracts.create',{requestId:randomUUID(),name:'Contrato fixture',source:'Fixture',modules:['integridade'],assetIds:[f.asset.id]});
 f.campaign=await f.exec('campaigns.create',{requestId:randomUUID(),name:'Campanha fixture',source:'Fixture',contractId:f.contract.id,systemId:h.system.id,module:'integridade',assetIds:[f.asset.id],status:'rascunho'});
 f.inspection=async(type='visual')=>f.exec('inspections.create',{requestId:randomUUID(),assetId:f.asset.id,contractId:f.contract.id,campaignId:f.campaign.id,module:'integridade',type,status:'planejada',source:'Planejamento fixture'});
 f.assign=(i,professionalId=f.persons.executor)=>f.exec('execution.assign',{inspectionId:i.id,professionalId,expectedVersion:i.version,requestId:randomUUID()});
 f.today=(await f.db.query('select current_date::text d')).rows[0].d;
 return f;
}
async function original(f,format='document_pdf'){
 const sha=createHash('sha256').update(randomUUID()).digest('hex'),ext=format==='image_jpeg'?'jpg':'pdf';
 return f.register(f.ids.tenantA,f.ids.adminA,{sha,name:'EXCLUSIVAMENTE-FIXTURE.'+ext,size:100,objectKey:await f.putObject(f.ids.tenantA,sha,100,ext),workbook:{format,sheets:[],metadata:{extraction:'not_performed'}}});
}
async function catalog(f){
 const src=await original(f),source={sourceId:src.id,fileHash:src.id,fileName:src.name,locator:{page:1}},id=randomUUID();
 const items=[1,2].map(n=>({id:'item-'+n,itemKey:String(n),component:'COMPONENTE EXCLUSIVO FIXTURE '+n,conditions:[{id:'c'+n,text:'CONDIÇÃO EXCLUSIVA FIXTURE '+n,source},{id:'c'+n+'b',text:'OUTRA CONDIÇÃO EXCLUSIVA FIXTURE '+n,source}],recommendations:[{id:'r'+n,text:'RECOMENDAÇÃO EXCLUSIVA FIXTURE '+n,conditionIds:['c'+n],source},{id:'r'+n+'b',text:'OUTRA RECOMENDAÇÃO EXCLUSIVA FIXTURE '+n,conditionIds:['c'+n+'b'],source}]}));
 await f.db.query('insert into pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id,source_id,source_locator,items,verified_by,verified_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now())',[f.ids.tenantA,f.ownerId,id,src.id,JSON.stringify({page:1}),JSON.stringify(items),f.ids.adminA]);
 return {id,items};
}
const save=(f,d,answers,extra={})=>f.exec('execution.save',{inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID(),observedOn:f.today,answers,...extra});

test('execution: current permission gates, own assignments and no account or permission grants',async t=>{
 const f=await fixture(t),i=await f.inspection();
 const counts=()=>f.db.query('select (select count(*)::int from auth.users) users,(select count(*)::int from pi_gestao_private.pilot_access) grants,(select count(*)::int from pi_team_private.professionals) professionals');
 const before=(await counts()).rows[0];
 let d=await f.exec('execution.get',{inspectionId:i.id});assert.equal(d.canExecute,false);assert.equal(d.inspection.assigneeProfessionalId,undefined);assert.equal(d.professionals.length,3);
 await assert.rejects(f.exec('execution.start',{inspectionId:i.id,requestId:randomUUID()}),{code:'42501'});
 d=await f.assign(i,f.persons.readonly);assert.equal(d.inspection.assigneeName,'EXCLUSIVAMENTE FIXTURE readonly');
 const queue=await f.exec('execution.list',{},f.ids.inspector);assert.equal(queue.inspections.length,1);assert.equal(queue.professionalId,f.persons.readonly);assert.equal(queue.professionals.length,0);
 const read=await f.exec('execution.get',{inspectionId:i.id},f.ids.inspector);assert.equal(read.writeAllowed,false);assert.equal(read.canExecute,false);assert.match(read.executionBlockReason,/permissão/i);
 await assert.rejects(f.exec('execution.start',{inspectionId:i.id,requestId:randomUUID()}),{code:'42501'});
 await assert.rejects(f.exec('execution.start',{inspectionId:i.id,requestId:randomUUID()},f.ids.inspector),{code:'42501'});
 await assert.rejects(f.exec('execution.get',{inspectionId:i.id},f.ids.assistant),{code:'42501'});
 await assert.rejects(f.exec('execution.assign',{inspectionId:i.id,expectedVersion:d.inspection.version,professionalId:f.persons.other,requestId:randomUUID()},f.ids.inspector),{code:'42501'});
 await f.db.query('update pi_gestao_private.pilot_access set revoked_at=now() where user_id=$1',[f.ids.inspector]);
 await assert.rejects(f.exec('execution.list',{},f.ids.inspector),{code:'42501'});
 await assert.rejects(f.call(f.ids.tenantB,'execution.get',{ownerId:f.ownerId,inspectionId:i.id},f.ids.adminB),{code:'22023'});
 for(const role of ['anon','service_role'])await assert.rejects(f.asRole(role,null,db=>db.query("select public.pi_gestao_api($1,'execution.list',$2::jsonb)",[f.ids.tenantA,JSON.stringify({ownerId:f.ownerId})])),{code:'42501'});
 for(const name of ['ga_api','ga_api_operational','ga_api_prepared','ga_api_projects'])await assert.rejects(f.asRole('authenticated',f.ids.adminA,db=>db.query(`select pi_gestao_private.${name}($1,'state.get',$2::jsonb)`,[f.ids.tenantA,JSON.stringify({ownerId:f.ownerId})])),{code:'42501'});
 for(const table of ['inspection_executions','inspection_catalogs'])await assert.rejects(f.asRole('authenticated',f.ids.adminA,db=>db.query('select * from pi_gestao_private.'+table)),{code:'42501'});
 const after=(await counts()).rows[0];assert.deepEqual({...after,grants:before.grants},before);assert.equal(after.grants,before.grants);
});

test('execution: no catalogue/default answer, stable draft and saved thickness stays thickness',async t=>{
 const f=await fixture(t),i=await f.inspection();let d=await f.assign(i);
 const input={inspectionId:i.id,requestId:randomUUID()};d=await f.exec('execution.start',input);
 assert.equal(d.catalog.status,'unavailable');assert.equal(d.execution.answers.length,0);assert.equal(d.execution.items.length,0);
 const id=d.execution.id;assert.equal((await f.exec('execution.start',input)).execution.id,id);assert.equal((await f.exec('execution.start',{...input,requestId:randomUUID()})).execution.id,id);
 d=await save(f,d,[]);await assert.rejects(f.exec('execution.submit',{inspectionId:i.id,expectedVersion:d.execution.version,requestId:randomUUID()}),{code:'22023'});
 await catalog(f);const stillEmpty=await f.exec('execution.get',{inspectionId:i.id});assert.equal(stillEmpty.catalog.status,'unavailable');assert.equal(stillEmpty.execution.items.length,0);
 await assert.rejects(save(f,d,[{catalogItemId:'item-1',itemKey:'1',conditionId:'c1',notCovered:false,photoIds:[]}]),{code:'22023'});
 const thick=await f.inspection('espessura');await f.assign(thick);let m=await f.exec('execution.start',{inspectionId:thick.id,requestId:randomUUID()});assert.equal(m.execution.type,'espessura');assert.equal(m.execution.recordClass,'measurement_draft');
 m=await save(f,m,[],{instrument:'INSTRUMENTO EXCLUSIVO FIXTURE',readings:[{point:'P-A INFORMADO NA FIXTURE',value:'3.25',unit:'mm'}]});assert.equal(m.execution.type,'espessura');assert.equal(m.inspection.type,'espessura');assert.equal(m.execution.readings.length,1);
 await assert.rejects(save(f,m,[{catalogItemId:'item-1'}]),{code:'22023'});
 await assert.rejects(f.exec('field_lvts.create',{inspectionId:thick.id,requestId:randomUUID(),observedOn:f.today,inspector:'Não criar LVT visual'}),{code:'42501'});
 const persisted=await f.db.dumpDataDir(),r=await setup({loadDataDir:persisted});try{const restored=await r.call(f.ids.tenantA,'execution.get',{ownerId:f.ownerId,inspectionId:thick.id});assert.equal(restored.execution.id,m.execution.id);assert.equal(restored.execution.readings[0].point,'P-A INFORMADO NA FIXTURE');}finally{await r.close();}
});

test('execution: verified choices, item photographs, same RTI on edit/reload, technical queue and review lock',async t=>{
 const f=await fixture(t);await catalog(f);const i=await f.inspection();await f.assign(i);let d=await f.exec('execution.start',{inspectionId:i.id,requestId:randomUUID()});
 assert.equal(d.execution.items.length,2);assert.equal(d.execution.answers.length,0);assert.equal(d.execution.progress.answered,0);
 const shell=d.execution.items[0],src=await original(f,'image_jpeg');
 const photo=await f.exec('photos.create',{assetId:f.asset.id,lvtItemId:shell.lvtItemId,sourceId:src.id,locator:{section:'Item 1'},caption:'FOTO EXCLUSIVA FIXTURE'});
 const answer={catalogItemId:'item-1',itemKey:'1',conditionId:'c1',recommendationId:'r1',notCovered:false,photoIds:[photo.id]};
 await assert.rejects(save(f,d,[{...answer,conditionId:'invented'}]),{code:'22023'});
 await assert.rejects(save(f,d,[{...answer,photoIds:[]}]),{code:'22023'});
 await assert.rejects(save(f,d,[{...answer,description:'Livre'}]),{code:'22023'});
 await assert.rejects(save(f,d,[{...answer,recommendationId:'r1b'}]),{code:'22023'});
 d=await save(f,d,[answer]);let state=await f.exec('state.get');assert.equal(state.rti.length,1);assert.equal(state.finding.length,1);const rtiId=state.rti[0].id;
 await assert.rejects(save(f,d,[]),/desaparecer implicitamente/);
 assert.equal(state.rti[0].contractId,f.contract.id);assert.equal(state.rti[0].lvtItemId,shell.lvtItemId);assert.deepEqual(state.rti[0].photoIds,[photo.id]);
 const stale=d;d=await save(f,d,[{...answer,conditionId:'c1b',recommendationId:'r1b'}]);assert.equal((await f.exec('state.get')).rti[0].id,rtiId);
 const replay={inspectionId:i.id,expectedVersion:d.execution.version,requestId:randomUUID(),observedOn:f.today,answers:[{...answer,conditionId:'c1b',recommendationId:'r1b'}]};d=await f.exec('execution.save',replay);const replayed=await f.exec('execution.save',replay);assert.equal(replayed.execution.version,d.execution.version);assert.equal((await f.exec('state.get')).rti.length,1);
 await assert.rejects(save(f,stale,[answer]),{code:'40001'});
 // Parent item/photo identity is authoritative; another item photo is rejected.
 const wrong=await f.exec('photos.create',{assetId:f.asset.id,lvtItemId:d.execution.items[1].lvtItemId,sourceId:src.id,locator:{section:'Item 2'},caption:'FOTO FIXTURE OUTRO ITEM'});
 await assert.rejects(save(f,d,[{...answer,photoIds:[wrong.id]}]),{code:'42501'});
 const unknown={catalogItemId:'item-2',itemKey:'2',conditionId:null,recommendationId:null,notCovered:true,photoIds:[]};
 d=await save(f,d,[{...answer,conditionId:'c1b',recommendationId:'r1b'},unknown]);assert.equal(d.execution.technicalReviewRequired,true);
 const queue=await f.exec('execution.list');assert.equal(queue.inspections[0].technicalReviewRequired,true);assert.equal(queue.inspections[0].progress.answered,2);
 // Legacy write paths cannot add arbitrary text, conclude, or duplicate this draft.
 for(const [action,payload] of [['field_items.create',{lvtId:d.execution.id,itemKey:'X',component:'X',condition:'Livre'}],['lvt_items.create',{lvtId:d.execution.id,assetId:f.asset.id,itemKey:'X',description:'Livre'}],['findings.create',{lvtItemId:shell.lvtItemId,assetId:f.asset.id,description:'Livre'}],['inspections.update',{id:i.id,expectedVersion:d.inspection.version,status:'concluida',done:f.today,evidence:'Não concluir'}],['lvts.create',{inspectionId:i.id,assetId:f.asset.id}],['measurements.create',{inspectionId:i.id,assetId:f.asset.id}]])await assert.rejects(f.exec(action,{...payload,requestId:randomUUID()}),{code:'42501'});
 const submit={inspectionId:i.id,expectedVersion:d.execution.version,requestId:randomUUID()};d=await f.exec('execution.submit',submit);assert.equal(d.execution.status,'em_revisao');assert.equal(d.execution.signatureStatus,'pendente');assert.equal((await f.exec('execution.submit',submit)).execution.id,d.execution.id);
 assert.equal((await f.exec('state.get')).rti[0].id,rtiId);assert.equal((await f.exec('state.get')).rti[0].status,'aberta');
 await assert.rejects(save(f,d,[answer,unknown]),{code:'22023'});
 await assert.rejects(f.exec('photos.create',{assetId:f.asset.id,lvtItemId:shell.lvtItemId,sourceId:src.id,locator:{section:'Depois da revisão'}}),{code:'42501'});
 assert.equal((await f.exec('state.get')).contract.length,1);
});

test('execution: old field draft is not duplicated and failed RTI transaction rolls back answers',async t=>{
 const f=await fixture(t),i=await f.inspection();const legacy=await f.exec('field_lvts.create',{inspectionId:i.id,requestId:randomUUID(),observedOn:f.today,inspector:'LEGADO EXCLUSIVO FIXTURE'});await f.assign(i);
 await assert.rejects(f.exec('execution.start',{inspectionId:i.id,requestId:randomUUID()}),/sem duplicação/);assert.equal((await f.exec('state.get')).lvt[0].id,legacy.id);
 await catalog(f);const j=await f.inspection();await f.assign(j);let d=await f.exec('execution.start',{inspectionId:j.id,requestId:randomUUID()}),src=await original(f,'image_jpeg');
 const photo=await f.exec('photos.create',{assetId:f.asset.id,lvtItemId:d.execution.items[0].lvtItemId,sourceId:src.id,locator:{section:'Item'},caption:'Fixture'});
 await f.db.exec("create function pi_gestao_private.fixture_execution_rti_failure() returns trigger language plpgsql as $$begin if new.kind='rti' then raise exception 'isolated RTI failure';end if;return new;end$$;create trigger fixture_execution_rti_failure before insert on pi_gestao_private.records for each row execute function pi_gestao_private.fixture_execution_rti_failure();");
 await assert.rejects(save(f,d,[{catalogItemId:'item-1',itemKey:'1',conditionId:'c1',recommendationId:'r1',notCovered:false,photoIds:[photo.id]}]),/isolated RTI failure/);
 const after=await f.exec('execution.get',{inspectionId:j.id});assert.equal(after.execution.version,d.execution.version);assert.equal(after.execution.answers.length,0);assert.equal((await f.exec('state.get')).finding.length,0);
});

test('execution: current scope, staff revocation and catalogue provenance are rechecked',async t=>{
 const f=await fixture(t);const i=await f.inspection();await f.assign(i);let d=await f.exec('execution.start',{inspectionId:i.id,requestId:randomUUID()});
 await assert.rejects(f.exec('execution.assign',{inspectionId:i.id,requestId:randomUUID(),professionalId:f.persons.other,expectedVersion:d.inspection.version}),/trocar o responsável/);
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(jsonb_set(body,'{assetIds}','[]'),'{moduleAssetIds,integridade}','[]') where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.ownerId,f.contract.id]);
 await assert.rejects(f.exec('execution.get',{inspectionId:i.id}),{code:'42501'});assert.equal((await f.exec('execution.list')).inspections.length,0);
 await assert.rejects(save(f,d,[]),{code:'42501'});
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(jsonb_set(body,'{assetIds}',$4::jsonb),'{moduleAssetIds,integridade}',$4::jsonb) where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.ownerId,f.contract.id,JSON.stringify([f.asset.id])]);
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 await f.db.query('update pi_team_private.professionals set access_revoked_at=now() where tenant_id=$1 and id=$2',[f.ids.tenantA,f.persons.executor]);
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 assert.equal((await f.exec('execution.get',{inspectionId:i.id})).canExecute,false);await assert.rejects(save(f,d,[]),{code:'42501'});
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);await f.db.query('update pi_team_private.professionals set access_revoked_at=null where tenant_id=$1 and id=$2',[f.ids.tenantA,f.persons.executor]);await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 const c=await catalog(f);const j=await f.inspection();await f.assign(j);
 await f.db.query("update pi_gestao_private.inspection_catalogs set items=jsonb_set(items,'{0,conditions,0,source,sourceId}','\"UNVERIFIED\"') where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.ownerId,c.id]);
 await assert.rejects(f.exec('execution.start',{inspectionId:j.id,requestId:randomUUID()}),/proveniência/);assert.equal((await f.db.query('select count(*)::int n from pi_gestao_private.inspection_executions')).rows[0].n,1);
});

test('execution: removing recommendation preserves same open RTI and closed scope requires technical review',async t=>{
 const f=await fixture(t);await catalog(f);const i=await f.inspection();await f.assign(i);let d=await f.exec('execution.start',{inspectionId:i.id,requestId:randomUUID()}),src=await original(f,'image_jpeg');
 const photo=await f.exec('photos.create',{assetId:f.asset.id,lvtItemId:d.execution.items[0].lvtItemId,sourceId:src.id,locator:{section:'Item1'},caption:'FIXTURE'}),a={catalogItemId:'item-1',itemKey:'1',conditionId:'c1',recommendationId:'r1',notCovered:false,photoIds:[photo.id]};
 d=await save(f,d,[a]);const rti=(await f.exec('state.get')).rti[0];
 d=await save(f,d,[{...a,recommendationId:null}]);let after=(await f.exec('state.get')).rti[0];assert.equal(after.id,rti.id);assert.equal(after.status,'aberta');assert.equal(after.recommendationWithdrawn,true);assert.equal(d.execution.technicalReviewRequired,true);
 d=await save(f,d,[a]);after=(await f.exec('state.get')).rti[0];assert.equal(after.id,rti.id);assert.equal(after.recommendationWithdrawn,false);
 await f.db.query("update pi_gestao_private.records set body=body||'{\"status\":\"encerrada\",\"closureEvidence\":\"FIXTURE ONLY\"}'::jsonb where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.ownerId,rti.id]);
 await assert.rejects(save(f,d,[{...a,conditionId:'c1b',recommendationId:'r1b'}]),/RTI encerrada/);
 after=(await f.exec('state.get')).rti[0];assert.equal(after.id,rti.id);assert.equal(after.status,'encerrada');assert.equal(after.recommendationId,'r1');assert.equal(after.closureEvidence,'FIXTURE ONLY');
 assert.equal((await f.exec('execution.get',{inspectionId:i.id})).execution.version,d.execution.version);
});
