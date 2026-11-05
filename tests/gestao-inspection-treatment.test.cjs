'use strict';
// Real candidate SQL in isolated PGlite. All identities, originals, catalogue
// semantics, pictures and dates are synthetic; Auth/Storage/licensing are stubs.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const {catalogueMetadata,selectCatalogue}=require('./fixtures/gestao-explicit-catalogue.cjs');

async function fixture(t,{metadata=true}={}){
 const f=await setup();t.after(()=>f.close());
 await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');
 for(const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/inspection-execution.sql'),'utf8'));
 f.professionalId=randomUUID();await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 await f.db.query('insert into pi_team_private.professionals(tenant_id,id,user_id,name,created_by,updated_by) values($1,$2,$3,$4,$3,$3)',[f.ids.tenantA,f.professionalId,f.ids.adminA,'EXECUTOR EXCLUSIVAMENTE SINTÉTICO']);
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 f.ownerId=(await f.call(f.ids.tenantA,'owners.create',{name:'CLIENTE SINTÉTICO DO ENSAIO DE TRATATIVA',source:'Fixture isolada'})).id;
 f.rpc=(action,payload={},user=f.ids.adminA)=>f.call(f.ids.tenantA,action,{ownerId:f.ownerId,...payload},user);
 const h=await f.rpc('hierarchy.create',{unit:'UNIDADE SINTÉTICA',system:'SISTEMA SINTÉTICO'});f.system=h.system;
 f.asset=await f.rpc('assets.create',{unitId:h.unit.id,systemId:h.system.id,type:'linha',tag:'TAG-SOMENTE-ENSAIO-TRATATIVA',source:'Fixture'});
 f.contract=await f.rpc('contracts.create',{requestId:randomUUID(),name:'CONTRATO SINTÉTICO',source:'Fixture',modules:['integridade'],assetIds:[f.asset.id]});
 f.campaign=await f.rpc('campaigns.create',{requestId:randomUUID(),name:'PRÓXIMA CAMPANHA SINTÉTICA',source:'Fixture',contractId:f.contract.id,systemId:h.system.id,module:'integridade',assetIds:[f.asset.id],status:'rascunho'});
 const dates=(await f.db.query('select current_date::text today,(current_date-4)::text observed,(current_date+20)::text planned,(current_date+45)::text due')).rows[0];Object.assign(f,dates);
 f.start=async()=>{const i=await f.rpc('inspections.create',{requestId:randomUUID(),assetId:f.asset.id,contractId:f.contract.id,campaignId:f.campaign.id,module:'integridade',type:'visual',status:'planejada',source:'Fixture',plannedDate:f.planned});await f.rpc('execution.assign',{inspectionId:i.id,professionalId:f.professionalId,expectedVersion:i.version,requestId:randomUUID()});await selectCatalogue(f,{ownerId:f.ownerId,inspectionId:i.id,catalogId:f.catalogId});return f.rpc('execution.start',{inspectionId:i.id,requestId:randomUUID()});};
 f.state=()=>f.rpc('state.get');
 f.original=async(format='image_jpeg')=>{const sha=createHash('sha256').update(randomUUID()).digest('hex'),ext=format==='image_jpeg'?'jpg':'pdf';return f.register(f.ids.tenantA,f.ids.adminA,{sha,name:'ORIGINAL SOMENTE FIXTURE.'+ext,size:32,objectKey:await f.putObject(f.ids.tenantA,sha,32,ext),workbook:{format,sheets:[],metadata:{extraction:'not_performed'}}});};
 const original=await f.original('document_pdf'),source={sourceId:original.id,fileHash:original.id,fileName:original.name,locator:{page:1}};f.source=source;f.catalogId=randomUUID();
 f.items=[{id:'synthetic-item',itemKey:'ITEM-SINTÉTICO',component:'COMPONENTE SOMENTE FIXTURE',conditions:[{id:'good',text:'CONDIÇÃO FAVORÁVEL SOMENTE FIXTURE',source,...(metadata?{supportsGoodCondition:true}:{})},{id:'other',text:'CONDIÇÃO COM TRATATIVA SOMENTE FIXTURE',source,...(metadata?{supportsGoodCondition:false}:{})}],recommendations:[{id:'treat',text:'TRATATIVA A EXCLUSIVAMENTE SINTÉTICA',conditionIds:['other'],source,...(metadata?{requiresTreatment:true}:{})},{id:'treat-b',text:'TRATATIVA B EXCLUSIVAMENTE SINTÉTICA',conditionIds:['other'],source,...(metadata?{requiresTreatment:true}:{})},{id:'none',text:'Sem recomendações.',conditionIds:['good'],source,...(metadata?{requiresTreatment:false}:{})}]}];
 f.setCatalogue=()=>f.db.query('update pi_gestao_private.inspection_catalogs set items=$1::jsonb where tenant_id=$2 and owner_id=$3 and id=$4',[JSON.stringify(f.items),f.ids.tenantA,f.ownerId,f.catalogId]);
 await f.db.query('insert into pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id,source_id,source_locator,items,verified_by,verified_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now())',[f.ids.tenantA,f.ownerId,f.catalogId,original.id,JSON.stringify({page:1}),JSON.stringify(f.items),f.ids.adminA]);
 await catalogueMetadata(f,{ownerId:f.ownerId,catalogId:f.catalogId,contractIds:[f.contract.id],assetIds:[f.asset.id]});
 f.photo=async d=>{const s=await f.original();return f.rpc('photos.create',{assetId:f.asset.id,lvtItemId:d.execution.items[0].lvtItemId,sourceId:s.id,locator:{section:randomUUID()},caption:'FOTO EXCLUSIVAMENTE SINTÉTICA'});};
 f.answer=(photoIds=[],extra={})=>({catalogItemId:'synthetic-item',itemKey:'ITEM-SINTÉTICO',conditionId:'good',recommendationId:null,notCovered:false,photoIds,findingObservedAt:f.observed+'T12:00:00-03:00',...extra});
 f.payload=(d,answers,extra={})=>({inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID(),observedOn:f.observed,inspectionStartedOn:f.observed,inspectionEndedOn:f.observed,answers,...extra});
 f.save=(d,answers,extra={})=>f.rpc('execution.save',f.payload(d,answers,extra));
 f.coverage=(photos,extra={})=>({extent:'declared_section',description:'TRECHO SINTÉTICO ENTRE REFERÊNCIAS DECLARADAS',photoIds:photos,...extra});
 f.submit=d=>f.rpc('execution.submit',{inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID()});
 return f;
}

test('treatment: explicit good conditions require selected photo, observed date and declared coverage without making RTI or next campaign',async t=>{
 const f=await fixture(t);let d=await f.start(),before=await f.state();
 await assert.rejects(f.save(d,[f.answer()],{outcome:'good_condition'}),{code:'22023'});
 const p=await f.photo(d),a=f.answer([p.id]);
 await assert.rejects(f.save(d,[a],{outcome:'good_condition'}),{code:'22023'});
 await assert.rejects(f.save(d,[a],{outcome:'good_condition',coverage:f.coverage([])}),{code:'22023'});
 await assert.rejects(f.save(d,[a],{observedOn:null,inspectionStartedOn:null,inspectionEndedOn:null,outcome:'good_condition',coverage:f.coverage([p.id])}),{code:'22023'});
 d=await f.save(d,[a],{outcome:'good_condition',coverage:f.coverage([p.id])});
 assert.equal(d.execution.outcome,'good_condition');assert.equal(d.execution.answers[0].conditionSupportsGoodCondition,true);assert.equal(d.execution.answers[0].requiresTreatment,null);assert.deepEqual(d.execution.coverage,f.coverage([p.id]));
 let state=await f.state();assert.equal(state.rti.length,0);assert.equal(state.finding.length,0);assert.equal(state.contract.length,1);assert.equal(state.campaign.length,before.campaign.length);assert.equal(state.campaign[0].id,f.campaign.id);assert.equal(state.campaign[0].status,before.campaign[0].status);
 d=await f.submit(d);assert.equal(d.execution.status,'em_revisao');assert.equal(d.execution.signatureStatus,'pendente');state=await f.state();assert.equal(state.rti.length,0);
});

test('treatment: absence of recommendation never declares good, and missing/incompatible curated semantics remain pending',async t=>{
 const f=await fixture(t,{metadata:false});let d=await f.start(),p=await f.photo(d),a=f.answer([p.id]);
 d=await f.save(d,[a]);assert.equal(d.execution.outcome,'pending');assert.equal(d.execution.answers[0].conditionSupportsGoodCondition,null);assert.equal((await f.state()).rti.length,0);
 await assert.rejects(f.save(d,[a],{outcome:'good_condition',coverage:f.coverage([p.id])}),{code:'22023'});
 f.items[0].conditions[0].supportsGoodCondition=false;await f.setCatalogue();await assert.rejects(f.save(d,[a],{outcome:'good_condition',coverage:f.coverage([p.id])}),{code:'22023'});
 f.items[0].conditions[0].supportsGoodCondition='true';await f.setCatalogue();const unchanged=await f.rpc('execution.get',{inspectionId:d.inspection.id});assert.equal(unchanged.catalog.items[0].conditions[0].supportsGoodCondition,undefined);assert.equal(unchanged.execution.id,d.execution.id);
});

test('treatment: explicit non-action statement preserves phrase/source and selected evidence without finding or RTI',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d);d=await f.save(d,[f.answer([p.id],{recommendationId:'none'})],{outcome:'good_condition',coverage:f.coverage([p.id])});
 const state=await f.state(),item=state.lvtItem.find(r=>r.id===d.execution.items[0].lvtItemId);
 assert.equal(state.rti.length,0);assert.equal(state.finding.length,0);assert.equal(item.recommendation,'Sem recomendações.');assert.deepEqual(item.recommendationSource,f.source);assert.equal(item.requiresTreatment,false);assert.equal(item.actionabilityStatus,'catalog_declared');assert.equal(d.execution.answers[0].recommendationId,'none');
});

test('treatment: partial/multiple-photo coverage is explicit, canonical, persistent and never inferred as whole line',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d),q=await f.photo(d),a=f.answer([p.id,q.id]);
 const cov=f.coverage([p.id,q.id]);d=await f.save(d,[a],{outcome:'good_condition',coverage:cov});assert.equal(d.execution.coverage.extent,'declared_section');assert.deepEqual(d.execution.coverage.photoIds,[p.id,q.id]);
 await assert.rejects(f.save(d,[a],{outcome:'good_condition',coverage:{...cov,description:''}}),{code:'22023'});
 await assert.rejects(f.save(d,[a],{outcome:'good_condition',coverage:{...cov,photoIds:[p.id,p.id]}}),{code:'22023'});
 await assert.rejects(f.save(d,[a],{outcome:'good_condition',coverage:{...cov,autoWholeLine:true}}),{code:'22023'});
 const other=await f.start(),otherPhoto=await f.photo(other);await assert.rejects(f.save(d,[a],{outcome:'good_condition',coverage:f.coverage([otherPhoto.id])}),{code:'22023'});
 const disk=await f.db.dumpDataDir(),restored=await setup({loadDataDir:disk});try{const saved=await restored.call(f.ids.tenantA,'execution.get',{ownerId:f.ownerId,inspectionId:d.inspection.id});assert.equal(saved.execution.id,d.execution.id);assert.deepEqual(saved.execution.coverage,cov);}finally{await restored.close();}
});

test('treatment: selected action creates one canonical field point and one open RTI even for a past performed date, without invented due or geometry',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d),a=f.answer([p.id],{conditionId:'other',recommendationId:'treat',pointLabel:'MARCA DE CAMPO EXCLUSIVAMENTE SINTÉTICA'});
 d=await f.save(d,[a],{outcome:'treatment_required'});let state=await f.state(),rti=state.rti[0],point=d.points[0];
 assert.equal(state.rti.length,1);assert.equal(state.finding.length,1);assert.equal(d.points.length,1);assert.equal(point.recordClass,'field_point_reference');assert.equal(point.label,a.pointLabel);assert.equal(point.assetId,f.asset.id);assert.equal(point.contractId,f.contract.id);assert.equal(point.inspectionId,d.inspection.id);assert.equal(point.executionId,d.execution.id);assert.equal(point.lvtItemId,d.execution.items[0].lvtItemId);assert.deepEqual(point.photoIds,[p.id]);assert.equal(point.drawingReference,null);assert.equal(point.locationStatus,'pending_drawing_reference');
 assert.equal(rti.status,'aberta');assert.equal(rti.currentness,'unknown');assert.equal(rti.requiresTreatment,true);assert.equal(rti.actionabilityStatus,'catalog_declared');assert.equal(rti.pointId,point.id);assert.equal(rti.pointVersion,point.version);assert.equal(rti.pointLinkStatus,'linked_field_reference');assert.equal(rti.sourceDate,f.observed);assert.equal(rti.deadlineAnchor.date,f.observed);assert.equal(rti.due,undefined);
 const pointId=point.id,rtiId=rti.id,pointVersion=point.version,input=f.payload(d,[a],{outcome:'treatment_required'});d=await f.rpc('execution.save',input);const same=await f.rpc('execution.save',input);assert.equal(same.execution.version,d.execution.version);assert.equal(d.points[0].id,pointId);assert.equal(d.points[0].version,pointVersion);assert.equal((await f.state()).rti[0].id,rtiId);
 d=await f.save(d,[{...a,recommendationId:'treat-b',pointLabel:'RÓTULO CORRIGIDO SOMENTE FIXTURE'}],{outcome:'treatment_required'});state=await f.state();assert.equal(state.rti.length,1);assert.equal(state.rti[0].id,rtiId);assert.equal(d.points[0].id,pointId);assert.equal(d.points[0].label,'RÓTULO CORRIGIDO SOMENTE FIXTURE');assert.ok(d.points[0].version>pointVersion);assert.equal(state.contract.length,1);
 const report=await f.rpc('reports.system',{contractId:f.contract.id,systemId:f.system.id});assert.equal(report.canIssue,false);assert.ok(report.documents.some(x=>x.id===pointId));assert.equal((await f.state()).rti[0].status,'aberta');
});

test('treatment: explicit action needs actor-provided point label even in pending outcome; client point IDs and foreign photographs are rejected',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d),a=f.answer([p.id],{conditionId:'other',recommendationId:'treat'});
 await assert.rejects(f.save(d,[a]),{code:'22023'});assert.equal((await f.state()).rti.length,0);
 await assert.rejects(f.save(d,[{...a,pointId:randomUUID(),pointLabel:'PONTO SINTÉTICO'}]),{code:'22023'});
 const other=await f.start(),q=await f.photo(other);await assert.rejects(f.save(d,[{...a,pointLabel:'PONTO SINTÉTICO',photoIds:[q.id]}]),{code:'42501'});
 d=await f.save(d,[{...a,pointLabel:'PONTO SINTÉTICO'}]);assert.equal(d.points.length,1);assert.equal(d.execution.outcome,'pending');assert.equal((await f.state()).rti.length,1);
});

test('treatment: unclassified legacy recommendation keeps its RTI and marks review/point pending; empty statements cannot silently become actions',async t=>{
 const f=await fixture(t,{metadata:false});let d=await f.start(),p=await f.photo(d),a=f.answer([p.id],{conditionId:'other',recommendationId:'treat'});d=await f.save(d,[a]);let rti=(await f.state()).rti[0];assert.equal(rti.requiresTreatment,true);assert.equal(rti.actionabilityStatus,'legacy_unclassified');assert.equal(rti.pointLinkStatus,'pending');assert.equal(rti.pointId,null);assert.equal(d.execution.technicalReviewRequired,true);assert.equal(d.points.length,0);
 await assert.rejects(f.save(d,[a],{outcome:'treatment_required'}),{code:'22023'});
 for(const text of ['-','–','—','0.0','Sem recomendação.','SEM  RECOMENDAÇÕES.','No recommendations','N/A']){
  // Exercise the newly selected wording in its own explicit version. Editing
  // the live row of the original pin must not change that existing execution.
  f.items[0].recommendations[0].text=text;f.catalogId=randomUUID();
  await f.db.query('insert into pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id,source_id,source_locator,items,verified_by,verified_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now())',[f.ids.tenantA,f.ownerId,f.catalogId,f.source.sourceId,JSON.stringify({page:1}),JSON.stringify(f.items),f.ids.adminA]);
  await catalogueMetadata(f,{ownerId:f.ownerId,catalogId:f.catalogId,contractIds:[f.contract.id],assetIds:[f.asset.id]});
  const next=await f.start(),picture=await f.photo(next);
  await assert.rejects(f.save(next,[f.answer([picture.id],{conditionId:'other',recommendationId:'treat'})]),{code:'22023'});
 }
 assert.equal((await f.state()).rti.length,1);
});

test('treatment: withdrawal preserves historical action/photos/manual due and same point/RTI; it does not authorize good conditions or close RTI',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d),a=f.answer([p.id],{conditionId:'other',recommendationId:'treat',pointLabel:'PONTO SINTÉTICO ORIGINAL'});d=await f.save(d,[a],{outcome:'treatment_required'});const original=(await f.state()).rti[0];await f.rpc('rtis.update',{id:original.id,expectedVersion:original.version,requestId:randomUUID(),due:f.due,deadlineBasis:original.deadlineAnchor,evidence:'Prazo MANUAL justificado exclusivamente no ensaio, sem regra automática.'});
 const q=await f.photo(d);d=await f.save(d,[f.answer([q.id],{recommendationId:'none',pointLabel:'PONTO CORRIGIDO SOMENTE FIXTURE'})],{outcome:'technical_review'});const state=await f.state(),rti=state.rti[0],finding=state.finding[0];assert.equal(rti.id,original.id);assert.equal(rti.status,'aberta');assert.equal(rti.recommendationId,'treat');assert.equal(rti.recommendationWithdrawn,true);assert.equal(rti.historicalEvidencePreserved,true);assert.equal(rti.technicalReviewRequired,true);assert.equal(rti.due,f.due);assert.equal(rti.pointId,original.pointId);assert.deepEqual(rti.photoIds,[p.id]);
 assert.equal(rti.pointVersion,d.points[0].version);assert.equal(finding.pointVersion,d.points[0].version);assert.equal(finding.pointLabel,d.points[0].label);assert.equal(finding.historicalEvidencePreserved,true);assert.deepEqual(finding.photoIds,[p.id]);assert.deepEqual(d.points[0].photoIds,[q.id]);assert.ok(d.points[0].version>original.pointVersion);
 await assert.rejects(f.save(d,[f.answer([q.id],{recommendationId:'none'})],{outcome:'good_condition',coverage:f.coverage([q.id])}),{code:'22023'});assert.equal((await f.state()).rti[0].status,'aberta');
});

test('treatment: submit uses pinned semantics and rechecks canonical photo coverage and point records instead of live edits or saved labels',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d);d=await f.save(d,[f.answer([p.id])],{outcome:'good_condition',coverage:f.coverage([p.id])});f.items[0].conditions[0].supportsGoodCondition=false;await f.setCatalogue();assert.equal((await f.rpc('execution.get',{inspectionId:d.inspection.id})).catalog.items[0].conditions[0].supportsGoodCondition,true);d=await f.submit(d);assert.equal(d.execution.status,'em_revisao');
 f.items[0].conditions[0].supportsGoodCondition=true;await f.setCatalogue();await assert.rejects(f.rpc('execution.submit',{inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID(),outcome:'pending'}),{code:'22023'});
 const other=await f.start(),q=await f.photo(other);let x=await f.save(other,[f.answer([q.id],{conditionId:'other',recommendationId:'treat',pointLabel:'OUTRO PONTO SINTÉTICO'})],{outcome:'treatment_required'});await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{assetId}',to_jsonb($1::text)) where id=$2",[randomUUID(),x.points[0].id]);await assert.rejects(f.submit(x),{code:'42501'});
});

test('treatment: failing RTI transaction rolls back point/item/outcome together and retry creates only one linked set',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d),a=f.answer([p.id],{conditionId:'other',recommendationId:'treat',pointLabel:'PONTO SINTÉTICO DE ROLLBACK'}),input=f.payload(d,[a],{outcome:'treatment_required'});
 await f.db.exec("create function pi_gestao_private.fixture_treatment_failure() returns trigger language plpgsql as $$begin if new.kind='rti' then raise exception 'SYNTHETIC_TREATMENT_FAILURE';end if;return new;end$$;create trigger fixture_treatment_failure before insert on pi_gestao_private.records for each row execute function pi_gestao_private.fixture_treatment_failure();");await assert.rejects(f.rpc('execution.save',input),/SYNTHETIC_TREATMENT_FAILURE/);let state=await f.state();assert.equal(state.rti.length,0);assert.equal(state.finding.length,0);assert.equal(state.document.filter(r=>r.recordClass==='field_point_reference').length,0);assert.equal((await f.rpc('execution.get',{inspectionId:d.inspection.id})).execution.answers.length,0);
 await f.db.exec('drop trigger fixture_treatment_failure on pi_gestao_private.records;drop function pi_gestao_private.fixture_treatment_failure();');d=await f.rpc('execution.save',input);state=await f.state();assert.equal(state.rti.length,1);assert.equal(state.finding.length,1);assert.equal(d.points.length,1);assert.equal(state.rti[0].pointId,d.points[0].id);
});

test('treatment: coverage description and point labels require actual JSON strings, not coerced booleans/numbers/objects',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d);
 for(const value of [false,true,23,{},[]]){
  await assert.rejects(f.save(d,[f.answer([p.id])],{outcome:'good_condition',coverage:f.coverage([p.id],{description:value})}),{code:'22023'});
  await assert.rejects(f.save(d,[f.answer([p.id],{conditionId:'other',recommendationId:'treat',pointLabel:value})],{outcome:'pending'}),{code:'22023'});
 }
 assert.equal((await f.state()).rti.length,0);assert.equal((await f.rpc('execution.get',{inspectionId:d.inspection.id})).points.length,0);
});

test('treatment: pinned classification survives live edits and pending submit rejects broken RTI linkage until the same draft is saved again',async t=>{
 const f=await fixture(t);let d=await f.start(),p=await f.photo(d);d=await f.save(d,[f.answer([p.id],{recommendationId:'none'})],{outcome:'pending'});
 f.items[0].recommendations.find(r=>r.id==='none').requiresTreatment=true;await f.setCatalogue();assert.equal((await f.state()).rti.length,0);
 delete f.items[0].recommendations.find(r=>r.id==='none').requiresTreatment;await f.setCatalogue();assert.equal((await f.rpc('execution.get',{inspectionId:d.inspection.id})).catalog.items[0].recommendations.find(r=>r.id==='none').requiresTreatment,false);assert.equal((await f.submit(d)).execution.status,'em_revisao');f.items[0].recommendations.find(r=>r.id==='none').requiresTreatment=false;await f.setCatalogue();
 const x0=await f.start(),q=await f.photo(x0),a=f.answer([q.id],{conditionId:'other',recommendationId:'treat',pointLabel:'PONTO EXCLUSIVO DO TESTE PENDENTE'});let x=await f.save(x0,[a],{outcome:'pending'}),rti=(await f.state()).rti.find(r=>r.inspectionId===x.inspection.id);
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{photoIds}','[]'::jsonb) where id=$1",[rti.id]);await assert.rejects(f.submit(x),{code:'22023'});
 x=await f.save(x,[a],{outcome:'pending'});assert.equal((await f.state()).rti.find(r=>r.inspectionId===x.inspection.id).id,rti.id);assert.equal((await f.submit(x)).execution.status,'em_revisao');
});

test('treatment: old-format drafts remain readable but must be saved again before submit; removed classification cannot silently stay approved',async t=>{
 const f=await fixture(t,{metadata:false});let d=await f.start(),p=await f.photo(d),a=f.answer([p.id],{conditionId:'other',recommendationId:'treat'});d=await f.save(d,[a]);const rtiId=(await f.state()).rti[0].id;
 const legacyAnswers=d.execution.answers.map(({requiresTreatment,actionabilityStatus,...answer})=>answer);await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{answers}',$1::jsonb) where id=$2",[JSON.stringify(legacyAnswers),d.execution.id]);await f.db.query("update pi_gestao_private.records set body=body-'requiresTreatment'-'actionabilityStatus' where id=$1",[d.execution.items[0].lvtItemId]);
 assert.equal((await f.rpc('execution.get',{inspectionId:d.inspection.id})).execution.id,d.execution.id);await assert.rejects(f.submit(d),{code:'22023'});d=await f.save(d,[a]);assert.equal((await f.state()).rti[0].id,rtiId);assert.equal(d.execution.answers[0].actionabilityStatus,'legacy_unclassified');assert.equal((await f.submit(d)).execution.status,'em_revisao');
});

test('treatment: explicit technical-review declaration is visible in the technical queue even without another trigger',async t=>{
 const f=await fixture(t);let d=await f.start();d=await f.save(d,[f.answer()],{outcome:'technical_review'});assert.equal(d.execution.technicalReviewRequired,true);assert.equal(d.execution.outcome,'technical_review');assert.equal((await f.rpc('execution.list')).inspections.find(i=>i.id===d.inspection.id).technicalReviewRequired,true);assert.equal((await f.state()).rti.length,0);d=await f.submit(d);assert.equal(d.execution.technicalReviewRequired,true);
});

test('treatment: workflow-version handshake is content capability only and does not grant inspector write access',async t=>{
 const f=await fixture(t);const d=await f.start();assert.equal(d.outcomeWorkflowVersion,1);assert.equal(d.writeAllowed,true);
 await assert.rejects(f.rpc('execution.save',f.payload(d,[f.answer()],{outcome:'technical_review'}),f.ids.inspector),{code:'42501'});
 const unchanged=await f.rpc('execution.get',{inspectionId:d.inspection.id});assert.equal(unchanged.execution.version,d.execution.version);assert.equal(unchanged.outcomeWorkflowVersion,1);assert.equal(unchanged.points.length,0);
});
