'use strict';
// Validation only. Every identity, original, catalogue and document is synthetic
// and lives in a disposable PGlite instance. Auth/Storage/licensing are stubs.
// Nothing here connects to a Supabase project or emits a technical document.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const ProjectModel=require('../app/gestao-project-model.js');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/inspection-execution.sql'),'utf8');
async function fixture(t){
 const f=await setup();t.after(()=>f.close());
 await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');
 for(const filename of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',filename),'utf8'));
 await f.db.exec(sql);
 f.people={};await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 for(const [label,user,role] of [['manager',f.ids.adminA,'inspector'],['inspector',f.ids.inspector,'inspector'],['plh_fixture',f.ids.assistant,'engineer_reviewer'],['planner',f.ids.planner,'inspector']]){
  const id=randomUUID();f.people[label]=id;
  await f.db.query('insert into pi_team_private.professionals(tenant_id,id,user_id,name,functional_role,exercise,relationship,created_by,updated_by) values($1,$2,$3,$4,$5,true,\'exercise\',$6,$6)',[f.ids.tenantA,id,user,'SOMENTE FIXTURE '+label,role,f.ids.adminA]);
 }
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 f.owner=(await f.call(f.ids.tenantA,'owners.create',{name:'Cliente somente validação 29/10',source:'Fixture local'})).id;
 f.call=(action,payload={},user=f.ids.adminA)=>f.originalCall(f.ids.tenantA,action,{ownerId:f.owner,...payload},user);
 // Keep the fixture's original public RPC interface for restored databases.
 f.originalCall=async(tenant,action,payload,user=f.ids.adminA)=>f.asRole('authenticated',user,async()=> (await f.db.query('select public.pi_gestao_api($1,$2,$3::jsonb) value',[tenant,action,JSON.stringify(payload)])).rows[0].value);
 const h=await f.call('hierarchy.create',{unit:'UNIDADE FIXTURE',system:'SISTEMA FIXTURE'});f.system=h.system;f.unit=h.unit;
 f.newAsset=tag=>f.call('assets.create',{unitId:f.unit.id,systemId:f.system.id,type:'linha',tag,source:'Fixture local sintética'});
 f.asset=await f.newAsset('TAG-VALIDACAO-1');
 f.newContract=async(asset,name)=>{
  const linkedAssets=Array.isArray(asset)?asset:[asset];
  const contract=await f.call('contracts.create',{requestId:randomUUID(),name,source:'Somente fixture',modules:['integridade'],assetIds:linkedAssets.map(x=>x.id)});
  const campaign=await f.call('campaigns.create',{requestId:randomUUID(),name:'Campanha '+name,source:'Somente fixture',contractId:contract.id,systemId:linkedAssets[0].systemId,module:'integridade',assetIds:linkedAssets.map(x=>x.id),status:'rascunho'});
  return {contract,campaign,asset:linkedAssets[0],assets:linkedAssets};
 };
 f.scope=await f.newContract(f.asset,'CONTRATO FIXTURE C1');
 f.inspect=(type='visual',scope=f.scope)=>f.call('inspections.create',{requestId:randomUUID(),assetId:scope.asset.id,contractId:scope.contract.id,campaignId:scope.campaign.id,module:'integridade',type,status:'planejada',source:'Planejamento somente fixture'});
 f.assign=(inspection,professionalId=f.people.manager)=>f.call('execution.assign',{inspectionId:inspection.id,professionalId,expectedVersion:inspection.version,requestId:randomUUID()});
 f.today=(await f.db.query('select current_date::text d')).rows[0].d;
 return f;
}
async function original(f,format='document_pdf'){
 const sha=createHash('sha256').update(randomUUID()).digest('hex'),ext=format==='image_jpeg'?'jpg':'pdf';
 return f.register(f.ids.tenantA,f.ids.adminA,{sha,name:'SOMENTE-VALIDACAO-SINTETICA.'+ext,size:16,objectKey:await f.putObject(f.ids.tenantA,sha,16,ext),workbook:{format,sheets:[],metadata:{extraction:'not_performed'}}});
}
async function catalogue(f){
 const s=await original(f),source={sourceId:s.id,fileHash:s.id,fileName:s.name,locator:{page:1}},id=randomUUID();
 const items=[1,2].map(n=>({id:'i'+n,itemKey:String(n),component:'COMPONENTE EXCLUSIVO FIXTURE '+n,conditions:[{id:'c'+n,text:'CONDIÇÃO EXCLUSIVA FIXTURE '+n,source},{id:'c'+n+'b',text:'CONDIÇÃO ALTERNATIVA FIXTURE '+n,source}],recommendations:[{id:'r'+n,text:'RECOMENDAÇÃO EXCLUSIVA FIXTURE '+n,source},{id:'r'+n+'b',text:'RECOMENDAÇÃO ALTERNATIVA FIXTURE '+n,source}]}));
 await f.db.query('insert into pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id,source_id,source_locator,items,verified_by,verified_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now())',[f.ids.tenantA,f.owner,id,s.id,JSON.stringify({page:1}),JSON.stringify(items),f.ids.adminA]);
 return {id,items};
}
const saveInput=(f,d,answers,extra={})=>({inspectionId:d.inspection.id,requestId:randomUUID(),expectedVersion:d.execution.version,observedOn:f.today,answers,...extra});
async function photo(f,d,index=0){const s=await original(f,'image_jpeg');return f.call('photos.create',{assetId:d.inspection.assetId,lvtItemId:d.execution.items[index].lvtItemId,sourceId:s.id,locator:{section:'ITEM FIXTURE '+index},caption:'FOTO SINTÉTICA SOMENTE FIXTURE'});}
async function reportTree(f,scope,label){
 const inspection=await f.inspect('visual',scope),lvt=await f.call('field_lvts.create',{inspectionId:inspection.id,requestId:randomUUID(),observedOn:f.today,inspector:'INSPETOR EXCLUSIVO FIXTURE '+label});
 const item=await f.call('field_items.create',{lvtId:lvt.id,requestId:randomUUID(),itemKey:'ITEM '+label,component:'COMPONENTE EXCLUSIVO FIXTURE '+label,condition:'CONDIÇÃO EXCLUSIVA FIXTURE '+label,recommendation:'RECOMENDAÇÃO EXCLUSIVA FIXTURE '+label});
 const image=await original(f,'image_jpeg'),picture=await f.call('photos.create',{assetId:scope.asset.id,lvtItemId:item.id,sourceId:image.id,locator:{section:'FOTO FIXTURE '+label},caption:'FOTO EXCLUSIVA FIXTURE '+label});
 const pdf=await original(f),document=await f.call('documents.create',{assetId:scope.asset.id,contractId:scope.contract.id,campaignId:scope.campaign.id,module:'integridade',documentType:'outro',reference:'DOCUMENTO SOMENTE FIXTURE '+label,sourceId:pdf.id,locator:{page:1}});
 return {inspection,lvt,item,picture,document,rti:item.rti,finding:item.finding,sourceIds:[image.id,pdf.id]};
}

test('validation: current manager/inspector/assistant-PLH/planner rights, pilot, licence and tenant boundaries',async t=>{
 const f=await fixture(t),ids=f.ids,inspections={};
 for(const [label,actor] of [['inspector',ids.inspector],['plh_fixture',ids.assistant],['planner',ids.planner]]){
  const i=await f.inspect();inspections[label]=i;await f.assign(i,f.people[label]);
  const list=await f.call('execution.list',{},actor);assert.equal(list.inspections.length,1,label);assert.equal(list.inspections[0].id,i.id);assert.equal(list.professionals.length,0);
  const own=await f.call('execution.get',{inspectionId:i.id},actor);assert.equal(own.canExecute,false);assert.equal(own.writeAllowed,false);assert.equal(own.canAssign,false);
  await assert.rejects(f.call('execution.start',{inspectionId:i.id,requestId:randomUUID()},actor),{code:'42501'});
  await assert.rejects(f.call('execution.assign',{inspectionId:i.id,professionalId:f.people.manager,expectedVersion:own.inspection.version,requestId:randomUUID()},actor),{code:'42501'});
 }
 assert.equal((await f.call('execution.list')).inspections.length,3);assert.equal((await f.call('execution.list')).canAssign,true);
 assert.equal((await f.call('execution.list',{},ids.master)).canAssign,true);
 await assert.rejects(f.call('execution.get',{inspectionId:inspections.inspector.id},ids.assistant),{code:'42501'});
 for(const action of ['execution.approve','execution.sign','execution.issue','execution.deliver'])await assert.rejects(f.call(action,{inspectionId:inspections.plh_fixture.id},ids.assistant),{code:'0A000'});
 await assert.rejects(f.call('execution.list',{},ids.client),{code:'42501'});
 await assert.rejects(f.call('execution.list',{},ids.stranger),{code:'42501'});
 await f.db.query('update pi_gestao_private.pilot_access set revoked_at=now() where user_id=$1',[ids.inspector]);
 await assert.rejects(f.call('execution.list',{},ids.inspector),{code:'42501'});
 await f.db.query('update pi_access_private.fixture_licenses set active=false where company_id=$1',[ids.tenantA]);
 await assert.rejects(f.call('execution.list'),{code:'42501'});await assert.rejects(f.call('execution.list',{},ids.assistant),{code:'42501'});
 await f.db.query('update pi_access_private.fixture_licenses set active=true where company_id=$1',[ids.tenantA]);
 await assert.rejects(f.originalCall(ids.tenantB,'execution.get',{ownerId:f.owner,inspectionId:inspections.inspector.id},ids.adminB),{code:'22023'});
 const otherOwner=await f.call('owners.create',{name:'Outro cliente exclusivamente fixture',source:'Fixture'});
 await assert.rejects(f.call('execution.get',{ownerId:otherOwner.id,inspectionId:inspections.inspector.id}),{code:'22023'});
 t.diagnostic('SQL/PGlite only: inspector/assistant/planner are read-only; PLH label is a synthetic functional_role, not a technical qualification or signature.');
});

test('validation: queued double start, response-loss save replay, double submit and restored identity',async t=>{
 const f=await fixture(t);await catalogue(f);const i=await f.inspect();await f.assign(i);
 const start={ownerId:f.owner,inspectionId:i.id,requestId:randomUUID()};
 // A single PGlite backend queues these requests; this is not two independent
 // PostgreSQL sessions and does not prove a transaction-lock race in Supabase.
 const pair=await f.asRole('authenticated',f.ids.adminA,async db=>Promise.all([1,2].map(()=>db.query('select public.pi_gestao_api($1,$2,$3::jsonb) d',[f.ids.tenantA,'execution.start',JSON.stringify(start)]))));
 let d=pair[0].rows[0].d;assert.equal(pair[1].rows[0].d.execution.id,d.execution.id);
 const count=()=>f.db.query('select (select count(*)::int from pi_gestao_private.inspection_executions) executions,(select count(*)::int from pi_gestao_private.records where kind=\'lvt_item\') items');
 assert.deepEqual((await count()).rows[0],{executions:1,items:2});
 const answers=[{catalogItemId:'i1',itemKey:'1',conditionId:'c1',recommendationId:null,notCovered:false,photoIds:[]},{catalogItemId:'i2',itemKey:'2',conditionId:null,recommendationId:null,notCovered:true,photoIds:[]}];
 const save=saveInput(f,d,answers);const committed=await f.call('execution.save',save);
 // Simulate a lost client response AFTER the SQL transaction committed.
 const replayed=await f.call('execution.save',save);assert.equal(replayed.execution.id,d.execution.id);assert.equal(replayed.execution.version,committed.execution.version);
 await assert.rejects(f.call('execution.save',{...save,requestId:randomUUID()}),{code:'40001'});
 await assert.rejects(f.call('execution.save',{...save,answers:[]}),{code:'23505'});
 const submit={inspectionId:i.id,expectedVersion:replayed.execution.version,requestId:randomUUID()};
 const sent=await f.call('execution.submit',submit),same=await f.call('execution.submit',submit);assert.equal(sent.execution.version,same.execution.version);assert.equal(sent.execution.status,'em_revisao');assert.equal(sent.execution.signatureStatus,'pendente');
 await assert.rejects(f.call('execution.submit',{...submit,requestId:randomUUID()}),{code:'22023'});
 assert.equal(sent.execution.technicalReviewRequired,true);assert.equal((await f.call('execution.list')).inspections[0].technicalReviewRequired,true);
 const disk=await f.db.dumpDataDir(),restored=await setup({loadDataDir:disk});try{const x=await restored.call(f.ids.tenantA,'execution.get',{ownerId:f.owner,inspectionId:i.id});assert.equal(x.execution.id,sent.execution.id);assert.equal(x.execution.status,'em_revisao');assert.equal(x.execution.answers.length,2);}finally{await restored.close();}
 assert.deepEqual((await count()).rows[0],{executions:1,items:2});
 t.diagnostic('Queued double requests and post-commit replay passed. Independent multi-session transaction race remains untested.');
});

test('validation: RTI identity survives duplicate/new-request saves, editing, withdrawal, rollback and reload',async t=>{
 const f=await fixture(t);await catalogue(f);const i=await f.inspect();await f.assign(i);let d=await f.call('execution.start',{inspectionId:i.id,requestId:randomUUID()}),p=await photo(f,d);
 const a={catalogItemId:'i1',itemKey:'1',conditionId:'c1',recommendationId:'r1',notCovered:false,photoIds:[p.id]},input=saveInput(f,d,[a]);
 d=await f.call('execution.save',input);const first=(await f.call('state.get')).rti[0];assert.ok(first.id);assert.equal(first.contractId,f.scope.contract.id);assert.equal(first.assetId,f.asset.id);assert.equal(first.lvtItemId,d.execution.items[0].lvtItemId);assert.deepEqual(first.photoIds,[p.id]);
 // A verified two-item catalogue still requires an explicit second answer;
 // saving one valid recommendation must not make an incomplete LVT submittable.
 await assert.rejects(f.call('execution.submit',{inspectionId:i.id,expectedVersion:d.execution.version,requestId:randomUUID()}),{code:'22023'});
 assert.equal((await f.call('execution.get',{inspectionId:i.id})).execution.status,'rascunho');
 assert.equal((await f.call('execution.save',input)).execution.version,d.execution.version);
 d=await f.call('execution.save',saveInput(f,d,[a]));d=await f.call('execution.save',saveInput(f,d,[{...a,recommendationId:'r1b'}]));
 let state=await f.call('state.get');assert.equal(state.rti.length,1);assert.equal(state.finding.length,1);assert.equal(state.rti[0].id,first.id);assert.equal(state.rti[0].recommendationId,'r1b');
 d=await f.call('execution.save',saveInput(f,d,[{...a,recommendationId:null}]));state=await f.call('state.get');assert.equal(state.rti[0].id,first.id);assert.equal(state.rti[0].status,'aberta');assert.equal(state.rti[0].recommendationWithdrawn,true);assert.equal(d.execution.technicalReviewRequired,true);
 const another=await f.inspect();await f.assign(another);const other=await f.call('execution.start',{inspectionId:another.id,requestId:randomUUID()}),otherPhoto=await photo(f,other);
 await assert.rejects(f.call('execution.save',saveInput(f,d,[{...a,photoIds:[otherPhoto.id]}])),{code:'42501'});
 await f.db.exec("create function pi_gestao_private.validation_rti_failure() returns trigger language plpgsql as $$begin if new.kind='rti' then raise exception 'VALIDATION_ONLY_FAILURE';end if;return new;end$$;create trigger validation_rti_failure before insert on pi_gestao_private.records for each row execute function pi_gestao_private.validation_rti_failure();");
 await assert.rejects(f.call('execution.save',saveInput(f,other,[{...a,photoIds:[otherPhoto.id]}])),/VALIDATION_ONLY_FAILURE/);
 const unchanged=await f.call('execution.get',{inspectionId:another.id});assert.equal(unchanged.execution.version,other.execution.version);assert.equal(unchanged.execution.answers.length,0);assert.equal((await f.call('state.get')).rti.length,1);assert.equal((await f.call('state.get')).contract.length,1);
 const report=await f.call('reports.system',{systemId:f.system.id});assert.equal(report.canIssue,false);assert.equal((await f.call('state.get')).rti[0].status,'aberta');
});

test('validation: missing catalogue and incomplete answers remain pending; supplied type cannot change thickness',async t=>{
 const f=await fixture(t),v=await f.inspect();await f.assign(v);let d=await f.call('execution.start',{inspectionId:v.id,requestId:randomUUID()});assert.equal(d.catalog.status,'unavailable');assert.equal(d.execution.answers.length,0);assert.equal(d.execution.items.length,0);
 d=await f.call('execution.save',saveInput(f,d,[]));await assert.rejects(f.call('execution.submit',{inspectionId:v.id,expectedVersion:d.execution.version,requestId:randomUUID()}),{code:'22023'});
 const m=await f.inspect('espessura');await f.assign(m);d=await f.call('execution.start',{inspectionId:m.id,type:'visual',requestId:randomUUID()});assert.equal(d.inspection.type,'espessura');assert.equal(d.execution.type,'espessura');assert.equal(d.execution.recordClass,'measurement_draft');assert.equal(d.execution.items.length,0);
 await assert.rejects(f.call('execution.save',saveInput(f,d,[],{type:'visual'})),{code:'22023'});
 await assert.rejects(f.call('execution.submit',{inspectionId:m.id,expectedVersion:d.execution.version,requestId:randomUUID()}),{code:'22023'});
 d=await f.call('execution.save',saveInput(f,d,[],{instrument:'INSTRUMENTO SOMENTE FIXTURE',readings:[{point:'REFERÊNCIA INFORMADA NA FIXTURE',value:'2.80',unit:'mm'}]}));
 assert.deepEqual(d.execution.readings,[{point:'REFERÊNCIA INFORMADA NA FIXTURE',value:'2.80',unit:'mm'}]);assert.equal(d.execution.type,'espessura');assert.equal((await f.call('state.get')).measurement.length,0,'A measurement draft is not an issued/finished measurement report.');
 const submitted=await f.call('execution.submit',{inspectionId:m.id,expectedVersion:d.execution.version,requestId:randomUUID()});assert.equal(submitted.execution.status,'em_revisao');assert.equal(submitted.inspection.type,'espessura');assert.notEqual(submitted.inspection.status,'concluida');
 assert.equal(submitted.execution.signatureStatus,'pendente');
});

test('validation requirement: queue excludes inspection removed from current campaign scope',async t=>{
 const f=await fixture(t),i=await f.inspect();await f.assign(i,f.people.inspector);
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{assetIds}','[]') where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.owner,f.scope.campaign.id]);
 await assert.rejects(f.call('execution.get',{inspectionId:i.id},f.ids.inspector),{code:'42501'});
 const list=await f.call('execution.list',{},f.ids.inspector);
 t.diagnostic(JSON.stringify({expected:'current campaign scope excludes removed activity',get:'42501',listedInspectionIds:list.inspections.map(x=>x.id),removedInspection:i.id}));
 assert.equal(list.inspections.some(x=>x.id===i.id),false,'Direct get denies removed campaign scope but queue still includes the activity.');
});

test('validation requirement: system report selected under C1 does not include TAG from C2',async t=>{
 const f=await fixture(t),asset2=await f.newAsset('TAG-VALIDACAO-2-C2'),scope2=await f.newContract(asset2,'CONTRATO FIXTURE C2');
 await f.inspect();await f.inspect('visual',scope2);
 const viaSystem=await f.call('reports.system',{systemId:f.system.id,contractId:f.scope.contract.id}),control=await f.call('reports.system',{campaignId:f.scope.campaign.id});
 assert.deepEqual(control.assets.map(x=>x.id),[f.asset.id]);
 t.diagnostic(JSON.stringify({selectedContract:f.scope.contract.id,otherContract:scope2.contract.id,systemReportAssets:viaSystem.assets.map(x=>({id:x.id,tag:x.tag})),campaignControlAssets:control.assets.map(x=>x.id),technicalIssueAllowed:viaSystem.canIssue}));
 assert.deepEqual(viaSystem.assets.map(x=>x.id),[f.asset.id],'System endpoint ignores selected contract and includes another contract TAG; campaign-scoped control filters correctly.');
});

test('fix: contract report isolates every collection, versions and provenance on a shared TAG and same-name systems',async t=>{
 const f=await fixture(t),asset2=await f.newAsset('TAG-C2-ONLY'),c2=await f.newContract([f.asset,asset2],'CONTRATO FIXTURE C2 COMPARTILHADO');
 const own=await reportTree(f,f.scope,'C1'),sharedOther=await reportTree(f,c2,'C2-SHARED'),other=await reportTree(f,{...c2,asset:asset2},'C2-ONLY');
 const h=await f.call('hierarchy.create',{unit:'OUTRA UNIDADE FIXTURE',system:f.system.name});assert.notEqual(h.system.id,f.system.id);assert.equal(h.system.name,f.system.name);
 const sameNameAsset=await f.call('assets.create',{unitId:h.unit.id,systemId:h.system.id,type:'linha',tag:'TAG-C1-OUTRO-SISTEMA-MESMO-NOME',source:'Fixture local'});
 const assetIds=[f.asset.id,sameNameAsset.id];
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(jsonb_set(body,'{assetIds}',$4::jsonb),'{moduleAssetIds,integridade}',$4::jsonb) where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.owner,f.scope.contract.id,JSON.stringify(assetIds)]);
 const sameNameCampaign=await f.call('campaigns.create',{requestId:randomUUID(),name:'CAMPANHA C1 SISTEMA HOMÔNIMO',source:'Fixture',contractId:f.scope.contract.id,systemId:h.system.id,module:'integridade',assetIds:[sameNameAsset.id],status:'rascunho'});
 const sameName=await reportTree(f,{contract:f.scope.contract,campaign:sameNameCampaign,asset:sameNameAsset},'C1-OTHER-SYSTEM');
 const addUnresolved=contract=>f.db.query('insert into pi_gestao_private.records(tenant_id,owner_id,id,kind,body) values($1,$2,$3,\'rti\',$4::jsonb)',[f.ids.tenantA,f.owner,randomUUID(),JSON.stringify({contractId:contract.id,assetId:null,title:'RTI NÃO VINCULADA EXCLUSIVAMENTE FIXTURE'})]);
 await addUnresolved(f.scope.contract);await addUnresolved(c2.contract);
 const report=await f.call('reports.system',{systemId:f.system.id,contractId:f.scope.contract.id});
 assert.equal(report.contract.id,f.scope.contract.id);assert.equal(report.system.id,f.system.id);assert.equal(report.reportScope.mode,'contract_system');assert.equal(report.canIssue,false);assert.equal(report.draft,true);
 const expected={assets:[f.asset.id],contracts:[f.scope.contract.id],campaigns:[f.scope.campaign.id],inspections:[own.inspection.id],lvts:[own.lvt.id],lvtItems:[own.item.id],photos:[own.picture.id],findings:[own.finding.id],rtis:[own.rti.id],documents:[own.document.id]};
 for(const [key,ids] of Object.entries(expected))assert.deepEqual(report[key].map(x=>x.id).sort(),ids.sort(),key);
 assert.deepEqual(report.recordVersions.map(x=>x.id).sort(),Object.values(expected).flat().sort());assert.deepEqual(report.sourceProvenance.map(x=>x.sourceId).sort(),own.sourceIds.sort());assert.equal(report.unresolvedOwnerRTICount,1,'C2 unresolved RTI count must not leak into the C1 report.');
 const serialized=JSON.stringify(report);for(const tree of [sharedOther,other,sameName])for(const id of [tree.inspection.id,tree.lvt.id,tree.item.id,tree.picture.id,tree.finding.id,tree.rti.id,tree.document.id,...tree.sourceIds])assert.equal(serialized.includes(id),false,id);
 const campaignReport=await f.call('reports.system',{contractId:f.scope.contract.id,campaignId:f.scope.campaign.id});assert.deepEqual(campaignReport.assets.map(x=>x.id),[f.asset.id]);assert.equal(campaignReport.campaign.systemId,f.system.id);assert.equal(campaignReport.reportScope.mode,'contract_campaign');
 const otherSystem=await f.call('reports.system',{contractId:f.scope.contract.id,systemId:h.system.id});assert.deepEqual(otherSystem.assets.map(x=>x.id),[sameNameAsset.id]);assert.deepEqual(otherSystem.inspections.map(x=>x.id),[sameName.inspection.id]);assert.equal(otherSystem.system.name,f.system.name);assert.notEqual(otherSystem.system.id,report.system.id);
 await assert.rejects(f.call('reports.system',{contractId:f.scope.contract.id,campaignId:c2.campaign.id}),{code:'42501'});await assert.rejects(f.call('reports.system',{contractId:f.scope.contract.id,systemId:h.system.id,campaignId:f.scope.campaign.id}),{code:'42501'});
 await assert.rejects(f.call('reports.system',{contractId:'',systemId:f.system.id}),{code:'22023'});
 const legacy=await f.call('reports.system',{systemId:f.system.id});assert.equal(legacy.reportScope.mode,'system_all_contracts');assert.deepEqual(legacy.assets.map(x=>x.id).sort(),[f.asset.id,asset2.id].sort());assert.ok(legacy.inspections.some(x=>x.id===sharedOther.inspection.id));assert.equal(legacy.unresolvedOwnerRTICount,2);
});

test('fix: report excludes restored contradictory descendants and only admits unbound originals via a consistent parent',async t=>{
 const f=await fixture(t),c2=await f.newContract(f.asset,'C2 FIXTURE MESMA TAG'),own=await reportTree(f,f.scope,'C1'),foreign=await reportTree(f,c2,'C2');
 const report=()=>f.call('reports.system',{contractId:f.scope.contract.id,systemId:f.system.id});
 async function replaceBody(id,body){await f.db.query('update pi_gestao_private.records set body=$4::jsonb where tenant_id=$1 and owner_id=$2 and id=$3',[f.ids.tenantA,f.owner,id,JSON.stringify(body)]);}
 const corrupt=[['lvt',own.lvt.id,'lvts'],['item',own.item.id,'lvtItems'],['photo',own.picture.id,'photos'],['finding',own.finding.id,'findings'],['rti',own.rti.id,'rtis']];
 for(const [name,id,collection] of corrupt){
  const prior=(await f.db.query('select body from pi_gestao_private.records where tenant_id=$1 and owner_id=$2 and id=$3',[f.ids.tenantA,f.owner,id])).rows[0].body;
  await replaceBody(id,{...prior,campaignId:c2.campaign.id});let snapshot=await report();assert.equal(snapshot[collection].some(x=>x.id===id),false,name+' with contradictory campaign');assert.equal(snapshot.recordVersions.some(x=>x.id===id),false,name+' version');
  await replaceBody(id,prior);snapshot=await report();assert.equal(snapshot[collection].some(x=>x.id===id),true,name+' restored original identity');
 }
 const lvtBody=(await f.db.query('select body from pi_gestao_private.records where tenant_id=$1 and owner_id=$2 and id=$3',[f.ids.tenantA,f.owner,own.lvt.id])).rows[0].body;
 await replaceBody(own.lvt.id,{...lvtBody,documentId:foreign.document.id});let snapshot=await report();assert.equal(snapshot.lvts.some(x=>x.id===own.lvt.id),false);assert.equal(snapshot.documents.some(x=>x.id===foreign.document.id),false);for(const sha of foreign.sourceIds)assert.equal(snapshot.sourceProvenance.some(x=>x.sourceId===sha),false);
 const source=await original(f),linked=await f.call('documents.create',{module:'integridade',documentType:'lvt',reference:'ORIGINAL SEMCONTRATO SOMENTE FIXTURE',sourceId:source.id,locator:{page:1}}),unusedSource=await original(f),unused=await f.call('documents.create',{module:'integridade',documentType:'lvt',reference:'ORIGINAL NÃO VINCULADO SOMENTE FIXTURE',sourceId:unusedSource.id,locator:{page:1}});
 await replaceBody(own.lvt.id,{...lvtBody,documentId:linked.id});snapshot=await report();assert.ok(snapshot.documents.some(x=>x.id===linked.id));assert.ok(snapshot.sourceProvenance.some(x=>x.sourceId===source.id));assert.equal(snapshot.documents.some(x=>x.id===unused.id),false);assert.equal(snapshot.sourceProvenance.some(x=>x.sourceId===unusedSource.id),false);
 // A source document from another campaign of C1 is a valid direct C1 document,
 // but is not a valid original for this LVT's different campaign/inspection.
 const second=await f.call('campaigns.create',{requestId:randomUUID(),name:'OUTRA CAMPANHA C1',source:'Fixture',contractId:f.scope.contract.id,systemId:f.system.id,module:'integridade',assetIds:[f.asset.id],status:'rascunho'});
 const secondSource=await original(f),secondDocument=await f.call('documents.create',{contractId:f.scope.contract.id,campaignId:second.id,assetId:f.asset.id,module:'integridade',documentType:'lvt',reference:'ORIGINAL OUTRA CAMPANHA C1 FIXTURE',sourceId:secondSource.id,locator:{page:1}});
 await replaceBody(own.lvt.id,{...lvtBody,documentId:secondDocument.id});snapshot=await report();assert.equal(snapshot.lvts.some(x=>x.id===own.lvt.id),false);assert.ok(snapshot.documents.some(x=>x.id===secondDocument.id));
});

test('fix: scope removal hides an existing draft and reintroduction resumes the same saved record',async t=>{
 const f=await fixture(t);await catalogue(f);const inspection=await f.inspect();await f.assign(inspection);let d=await f.call('execution.start',{inspectionId:inspection.id,requestId:randomUUID()});
 const answers=[{catalogItemId:'i1',itemKey:'1',conditionId:'c1',recommendationId:null,notCovered:false,photoIds:[]}];d=await f.call('execution.save',saveInput(f,d,answers));const originalId=d.execution.id,originalVersion=d.execution.version;
 const campaignBody=(await f.db.query('select body from pi_gestao_private.records where tenant_id=$1 and owner_id=$2 and id=$3',[f.ids.tenantA,f.owner,f.scope.campaign.id])).rows[0].body;
 const contractBody=(await f.db.query('select body from pi_gestao_private.records where tenant_id=$1 and owner_id=$2 and id=$3',[f.ids.tenantA,f.owner,f.scope.contract.id])).rows[0].body;
 const updates=[{id:f.scope.campaign.id,prior:campaignBody,patch:{assetIds:[]}},{id:f.scope.campaign.id,prior:campaignBody,patch:{module:'nr13'}},{id:f.scope.campaign.id,prior:campaignBody,patch:{contractId:randomUUID()}},{id:f.scope.contract.id,prior:contractBody,patch:{assetIds:[],moduleAssetIds:{integridade:[]}}}];
 for(const change of updates){
  await f.db.query('update pi_gestao_private.records set body=$4::jsonb where tenant_id=$1 and owner_id=$2 and id=$3',[f.ids.tenantA,f.owner,change.id,JSON.stringify({...change.prior,...change.patch})]);
  assert.equal((await f.call('execution.list')).inspections.some(x=>x.id===inspection.id),false);
  await assert.rejects(f.call('execution.get',{inspectionId:inspection.id}),{code:'42501'});await assert.rejects(f.call('execution.save',saveInput(f,d,answers)),{code:'42501'});
  await f.db.query('update pi_gestao_private.records set body=$4::jsonb where tenant_id=$1 and owner_id=$2 and id=$3',[f.ids.tenantA,f.owner,change.id,JSON.stringify(change.prior)]);
  const restored=await f.call('execution.get',{inspectionId:inspection.id});assert.equal(restored.execution.id,originalId);assert.equal(restored.execution.version,originalVersion);assert.deepEqual(restored.execution.answers,answers);assert.equal((await f.call('execution.list')).inspections[0].executionId,originalId);
 }
 const disk=await f.db.dumpDataDir(),reopened=await setup({loadDataDir:disk});try{const restored=await reopened.call(f.ids.tenantA,'execution.get',{ownerId:f.owner,inspectionId:inspection.id});assert.equal(restored.execution.id,originalId);assert.deepEqual(restored.execution.answers,answers);}finally{await reopened.close();}
 assert.equal((await f.db.query('select count(*)::int n from pi_gestao_private.inspection_executions')).rows[0].n,1);
});

test('fix: documented historical RTI without finding/systemId retains its canonical asset, original and provenance',async t=>{
 const f=await fixture(t),c2=await f.newContract(f.asset,'C2 FIXTURE MESMA TAG'),s=await original(f);
 const doc=await f.call('documents.create',{contractId:f.scope.contract.id,assetId:f.asset.id,module:'rtis',documentType:'rti',reference:'RTI DOCUMENTAL SOMENTE FIXTURE',sourceId:s.id,locator:{page:1},sourceStatus:'ABERTA NA FONTE FIXTURE',sourceDate:f.today,openingEvidence:'Registro documental sintético de validação; não é emissão técnica real.'});
 const rti=await f.call('rtis.open',{documentId:doc.id,assetId:f.asset.id,title:'RTI HISTÓRICA EXCLUSIVA FIXTURE'});assert.equal(rti.findingId,null);assert.equal(rti.systemId,null);
 const report=await f.call('reports.system',{contractId:f.scope.contract.id,systemId:f.system.id});assert.deepEqual(report.rtis.map(x=>x.id),[rti.id]);assert.ok(report.documents.some(x=>x.id===doc.id));assert.ok(report.sourceProvenance.some(x=>x.sourceId===s.id));assert.ok(report.recordVersions.some(x=>x.id===rti.id));assert.ok(report.recordVersions.some(x=>x.id===doc.id));assert.equal(report.rtis[0].currentness,'unknown');
 const foreign=await f.call('reports.system',{contractId:c2.contract.id,systemId:f.system.id});assert.equal(foreign.rtis.length,0);assert.equal(foreign.documents.some(x=>x.id===doc.id),false);assert.equal(foreign.sourceProvenance.some(x=>x.sourceId===s.id),false);
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{systemId}',$4::jsonb) where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.owner,rti.id,JSON.stringify(randomUUID())]);
 assert.equal((await f.call('reports.system',{contractId:f.scope.contract.id,systemId:f.system.id})).rtis.length,0,'An explicit contradictory system is not treated as missing history.');
});

test('validation requirement: issuance KPI requires completed inspection, technical review and approved report',async t=>{
 const f=await fixture(t),contract=f.scope.contract;
 const project=(action,payload={})=>f.call('projects.'+action,{module:'integridade',contractId:contract.id,requestId:randomUUID(),...payload});
 const preview=await project('preview',{mode:'existing',ids:[f.asset.id]});
 await project('scope',{previewId:preview.id,scopeMode:'replace',confirm:true,decisions:preview.rows.map(r=>({row:r.row,action:'link'}))});
 const current=(await f.call('state.get')).contract.find(x=>x.id===contract.id),date=ProjectModel.today();
 const tasks=['execution','review','issuance','acceptance'].map(stage=>({id:randomUUID(),name:'SOMENTE FIXTURE '+stage,targetId:f.asset.id,targetKind:'asset',stage,modality:'visual',plannedDate:date,weight:1}));
 await project('plan',{expectedVersion:current.version,tasks,basis:'Planejamento exclusivo de fixture local'});
 const s=await original(f),doc=await f.call('documents.create',{contractId:contract.id,assetId:f.asset.id,module:'integridade',documentType:'outro',reference:'DOCUMENTO OUTRO EXCLUSIVAMENTE FIXTURE, NÃO É RELATÓRIO',sourceId:s.id,locator:{page:1}});
 const event=await project('event',{taskId:tasks[2].id,status:'done',on:date,responsible:'ATOR EXCLUSIVAMENTE FIXTURE',evidenceDocumentId:doc.id,evidence:'Evento sintético sem LVT, revisão, PLH ou relatório aprovado'});
 const state=await f.call('state.get'),model=ProjectModel.build(state,contract.id,'integridade'),issued=model.kpis.find(x=>x.key==='issuance');
 assert.equal(state.lvt.length,0);assert.equal(state.inspection.length,0);assert.equal(state.document.some(x=>x.documentType==='relatorio'),false);
 t.diagnostic(JSON.stringify({acceptedEventStage:event.stage,acceptedStatus:event.status,evidenceDocumentType:doc.documentType,lvts:state.lvt.length,inspections:state.inspection.length,issuedKpi:issued.value,lifecycle:model.lifecycle.map(x=>({stage:x.stage,done:x.done}))}));
 assert.equal(issued.value,null,'Technical issuance must remain unavailable while no issue/review/signature workflow exists.');
 assert.equal(issued.technicalAvailable,false);assert.equal(issued.administrativeCompleted,1,'The administrative event is preserved without presenting it as technical issuance.');assert.deepEqual(issued.rows,[]);
});
