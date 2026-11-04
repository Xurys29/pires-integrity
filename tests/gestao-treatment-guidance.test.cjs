'use strict';
// Real candidate SQL, entirely synthetic accounts, catalogue, photos and data.
// References are read from the versioned source module; no originals, policies,
// account access, technical approval, calendar or automatic due is fabricated.
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createScopedEdgeFixture}=require('./fixtures/gestao-scoped-edge.cjs');
const {selectCatalogue}=require('./fixtures/gestao-explicit-catalogue.cjs');
const Reference=require('../lib/rti-guidance-registry.cjs');
const Report=require('../app/gestao-tag-report.js'),{jsPDF}=require('jspdf');
const copy=value=>JSON.parse(JSON.stringify(value));
const binding=(item,entry)=>({conditionId:'action-scoped',recommendationId:'treat-scoped',mappingStatus:'verified_link',ruleRef:copy(entry.ruleRef),mappingEvidence:{conditionSource:copy(item.conditions[1].source),recommendationSource:copy(item.recommendations[1].source),reviewReference:'VÍNCULO DE IDs E FONTES EXCLUSIVAMENTE SINTÉTICO; SEM APROVAÇÃO TÉCNICA'}});

async function fixture(t,{mappings=[entry=>entry],legacy=false}={}){
 const f=await createScopedEdgeFixture(t,{start:false,bindCatalog:false}),registry=Reference.getRegistry(),template=copy(f.catalogItems[0]);
 f.registry=registry;f.items=mappings.map((change,index)=>{const item={...copy(template),id:'item-guidance-'+index,itemKey:'ITEM-GUIDANCE-'+index};item.guidanceBindings=[binding(item,registry.entries[index%4])];const result=change(item,index);return result===undefined?item:result;});
 if(legacy)for(const item of f.items)delete item.guidanceBindings;
 await f.db.query('update pi_gestao_private.inspection_catalogs set items=$1::jsonb where id=$2',[JSON.stringify(f.items),f.catalogId]);
 await selectCatalogue(f,{ownerId:f.ownerId,inspectionId:f.inspection.id,catalogId:f.catalogId});
 f.detail=await f.op('execution.start',{inspectionId:f.inspection.id,requestId:randomUUID()},f.ids.inspector);
 const dates=(await f.db.query('select current_date::text today,(current_date-3)::text started,(current_date-1)::text ended,(current_date-2)::text finding,(current_date+30)::text manual_due')).rows[0];Object.assign(f,dates);
 f.answers=[];
 for(let index=0;index<f.items.length;index++){
  const photo=await f.photo({...f.detail,execution:{...f.detail.execution,items:[f.detail.execution.items[index]]}});assert.equal(photo.status,200);
  f.answers.push({catalogItemId:f.items[index].id,itemKey:f.items[index].itemKey,conditionId:'action-scoped',recommendationId:'treat-scoped',notCovered:false,photoIds:[photo.data.photo.id],pointLabel:'PONTO EXCLUSIVAMENTE SINTÉTICO '+index,findingObservedAt:f.finding+'T11:22:33-03:00'});
 }
 f.payload=(detail=f.detail,answers=f.answers,extra={})=>({inspectionId:detail.inspection.id,expectedVersion:detail.execution.version,requestId:randomUUID(),observedOn:f.started,inspectionStartedOn:f.started,inspectionEndedOn:f.ended,outcome:'treatment_required',answers,...extra});
 f.save=(payload=f.payload())=>f.op('execution.save',payload,f.ids.inspector);
 f.state=()=>f.op('state.get');
 return f;
}
async function rows(f){return (await f.db.query('select to_jsonb(r) row from pi_gestao_private.records r order by r.id')).rows.map(x=>x.row);}
async function projection(f,detail,index=0){const state=await f.state(),answer=detail.execution.answers[index],item=state.lvtItem.find(x=>x.id===detail.execution.items[index].lvtItemId),finding=state.finding.find(x=>x.lvtItemId===item.id),rti=state.rti.find(x=>x.findingId===finding?.id);return{state,answer,item,finding,rti};}

test('guidance SQL: canonical registry matches Node, four exact curated links persist the same read-only reference without rewriting recommendations',async t=>{
 const f=await fixture(t,{mappings:[x=>x,x=>x,x=>x,x=>x]});
 assert.deepEqual((await f.db.query('select pi_gestao_private.ga_execution_guidance_registry() value')).rows[0].value,Reference.getRegistry());
 assert.equal((await f.op('access.get')).treatmentGuidanceVersion,1);assert.deepEqual(f.detail.catalog.guidanceRegistry,Reference.getRegistry());
 const payload=f.payload(),detail=await f.save(payload);assert.equal(detail.execution.answers.length,4);
 for(let index=0;index<4;index++){
  const p=await projection(f,detail,index),expected=Reference.resolveGuidance(f.items[index],'action-scoped','treat-scoped');
  assert.equal(expected.status,'verified_link');for(const record of [p.answer,p.item,p.finding,p.rti])assert.deepEqual(record.treatmentGuidance,expected);
  assert.deepEqual(p.rti.treatmentGuidance.ruleRef,f.registry.entries[index].ruleRef);assert.deepEqual(p.rti.treatmentGuidance.guidance,f.registry.entries[index].guidance);
  assert.equal(p.rti.recommendation,templateRecommendation(f.items[index]));assert.equal(p.rti.due,undefined);assert.equal(p.rti.treatmentGuidance.due,null);assert.equal(p.rti.treatmentGuidance.score,null);assert.equal(p.rti.treatmentGuidance.canCalculateDue,false);assert.equal(p.rti.treatmentGuidance.operationalActionAuthorized,false);
 }
 const before=await rows(f),replay=await f.save(payload);assert.equal(replay.execution.version,detail.execution.version);assert.deepEqual(await rows(f),before);assert.equal((await f.state()).rti.length,4);
 const snapshot=await f.op('execution.report',{inspectionId:f.inspection.id},f.ids.inspector);assert.equal(snapshot.rtis.length,4);assert.equal(snapshot.canIssue,false);
 const frozen=await Report.freeze({scope:{ownerId:f.ownerId,contractId:f.contract.id,systemId:f.system.id,assetId:f.asset.id,inspectionId:f.inspection.id,executionId:detail.execution.id},detail,snapshot});
 const text=[];function Capture(options){const doc=new jsPDF(options),write=doc.text;doc.text=function(value,...args){text.push(Array.isArray(value)?value.join('\n'):String(value));return write.call(this,value,...args);};return doc;}
 const images=Object.fromEntries(f.answers.flatMap(answer=>answer.photoIds.map(id=>[id,{bytes:f.image,mime:'image/png'}]))),pdf=await Report.createPdf(frozen,images,{generatedAt:'2026-11-04T12:00:00Z'},Capture);
 assert.equal(pdf.metadata.draft,true);assert.equal(pdf.metadata.canIssue,false);assert.deepEqual(pdf.metadata.signatures,[]);assert.equal(pdf.metadata.embeddedPhotoIds.length,4);assert.ok(Buffer.from(pdf.doc.output('arraybuffer')).length>1000);
 for(const entry of f.registry.entries)assert.ok(text.join('\n').includes(entry.guidance.actionReference));
});
const templateRecommendation=item=>item.recommendations.find(x=>x.id==='treat-scoped').text;

test('guidance SQL: missing, duplicate, unknown-reference and source-conflict mappings all keep their RTIs and technical review',async t=>{
 const f=await fixture(t,{mappings:[
  item=>{delete item.guidanceBindings;return item;},
  item=>{item.guidanceBindings.push(copy(item.guidanceBindings[0]));return item;},
  item=>{item.guidanceBindings[0].ruleRef.contentHash='0'.repeat(64);return item;},
  item=>{item.guidanceBindings[0].mappingEvidence.conditionSource.locator={page:999};return item;}
 ]}),detail=await f.save(),statuses=['pending_mapping','conflict','invalid_reference','invalid_reference'];
 for(let index=0;index<4;index++){
  const p=await projection(f,detail,index);for(const record of [p.answer,p.item,p.finding,p.rti])assert.equal(record.treatmentGuidance.status,statuses[index]);
  assert.equal(p.rti.status,'aberta');assert.equal(p.rti.recommendation,templateRecommendation(f.items[index]));assert.equal(p.rti.technicalReviewRequired,true);assert.equal(p.rti.treatmentGuidance.ruleRef,null);assert.equal(p.rti.treatmentGuidance.guidance,null);assert.equal(p.rti.due,undefined);
 }
 assert.equal((await f.state()).rti.length,4);assert.equal(detail.execution.technicalReviewRequired,true);
 const submitted=await f.op('execution.submit',{inspectionId:f.inspection.id,expectedVersion:detail.execution.version,requestId:randomUUID()},f.ids.inspector);
 assert.equal(submitted.execution.status,'em_revisao');assert.equal(submitted.execution.signatureStatus,'pendente');assert.equal(submitted.execution.technicalReviewRequired,true);assert.equal((await f.state()).rti.length,4);
});

test('guidance SQL/Node: selected pair, status, shape, source, review reference, version and hash fail closed identically',async t=>{
 const f=await fixture(t),original=f.items[0],variants=[];
 const add=(name,fn)=>{const item=copy(original);fn(item);variants.push({name,item});};
 add('absent',x=>delete x.guidanceBindings);add('null',x=>x.guidanceBindings=null);add('malformed',x=>x.guidanceBindings={});add('empty',x=>x.guidanceBindings=[]);
 add('duplicate',x=>x.guidanceBindings.push(copy(x.guidanceBindings[0])));add('explicit conflict',x=>x.guidanceBindings[0].mappingStatus='conflict');add('specific review',x=>x.guidanceBindings[0].mappingStatus='pending_specific_review');add('unknown status',x=>x.guidanceBindings[0].mappingStatus='approved');
 add('wrong pair',x=>x.guidanceBindings[0].conditionId='good-scoped');add('version string',x=>x.guidanceBindings[0].ruleRef.representationVersion='1');add('unknown version',x=>x.guidanceBindings[0].ruleRef.representationVersion=2);add('unknown entry',x=>x.guidanceBindings[0].ruleRef.entryId='SYNTHETIC-UNKNOWN');add('wrong hash',x=>x.guidanceBindings[0].ruleRef.contentHash='f'.repeat(64));add('reference extra property',x=>x.guidanceBindings[0].ruleRef.authorized=true);
 add('source locator mismatch',x=>x.guidanceBindings[0].mappingEvidence.recommendationSource.locator={page:66});add('empty review',x=>x.guidanceBindings[0].mappingEvidence.reviewReference=' ');add('oversized review',x=>x.guidanceBindings[0].mappingEvidence.reviewReference='a'.repeat(2001));add('object review',x=>x.guidanceBindings[0].mappingEvidence.reviewReference={value:'SYNTHETIC'});add('evidence extra property',x=>x.guidanceBindings[0].mappingEvidence.approved=true);add('binding extra property',x=>x.guidanceBindings[0].approved=true);
 add('unrelated scalar',x=>x.guidanceBindings.unshift('SYNTHETIC INVALID ENTRY'));add('unrelated empty object',x=>x.guidanceBindings.unshift({}));add('unrelated whitespace identity',x=>x.guidanceBindings.unshift({conditionId:'\u3000',recommendationId:'OTHER',mappingStatus:'verified_link'}));
 for(const [label,space] of [['TAB','\t'],['NBSP','\u00a0'],['ideographic','\u3000'],['BOM','\ufeff']])add(label+' blank review',x=>x.guidanceBindings[0].mappingEvidence.reviewReference=space);
 for(const {name,item} of variants){const sql=(await f.db.query('select pi_gestao_private.ga_execution_treatment_guidance($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value',[JSON.stringify(f.registry),JSON.stringify(item),JSON.stringify(item.conditions[1]),JSON.stringify(item.recommendations[1])])).rows[0].value;assert.deepEqual(sql,Reference.resolveGuidance(item,'action-scoped','treat-scoped'),name);assert.equal(sql.guidance,null,name);assert.equal(sql.ruleRef,null,name);}
 for(const registry of [null,{}, {...copy(f.registry),schemaVersion:2}]){
  const sql=(await f.db.query('select pi_gestao_private.ga_execution_treatment_guidance($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value',[JSON.stringify(registry),JSON.stringify(original),JSON.stringify(original.conditions[1]),JSON.stringify(original.recommendations[1])])).rows[0].value;
  assert.equal(sql.status,'invalid_reference');assert.equal(sql.guidance,null);
 }
 for(const reviewReference of ['\t\u00a0REFERÊNCIA SINTÉTICA\u3000\ufeff','🛠'.repeat(2000)]){
  const item=copy(original);item.guidanceBindings[0].mappingEvidence.reviewReference=reviewReference;
  const sql=(await f.db.query('select pi_gestao_private.ga_execution_treatment_guidance($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value',[JSON.stringify(f.registry),JSON.stringify(item),JSON.stringify(item.conditions[1]),JSON.stringify(item.recommendations[1])])).rows[0].value;
  assert.equal(sql.status,'verified_link');assert.deepEqual(sql,Reference.resolveGuidance(item,'action-scoped','treat-scoped'));assert.equal(sql.mappingEvidence.reviewReference,reviewReference);
 }
 for(const pair of [[null,null],['good-scoped','none-scoped']]){
  const condition=original.conditions.find(x=>x.id===pair[0])||null,recommendation=original.recommendations.find(x=>x.id===pair[1])||null;
  const sql=(await f.db.query('select pi_gestao_private.ga_execution_treatment_guidance($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value',[JSON.stringify(f.registry),JSON.stringify(original),JSON.stringify(condition),JSON.stringify(recommendation)])).rows[0].value;assert.deepEqual(sql,Reference.resolveGuidance(original,...pair));
 }
});

test('guidance SQL: inspector cannot post a guidance, rule, binding or score and cannot invoke private reference helpers',async t=>{
 const f=await fixture(t),before=await rows(f);
 for(const extra of [{treatmentGuidance:{status:'verified_link'}},{ruleRef:f.registry.entries[0].ruleRef},{guidanceBindings:[f.items[0].guidanceBindings[0]]},{score:25}])await assert.rejects(f.save(f.payload(f.detail,[{...f.answers[0],...extra}])),{code:'22023'});
 assert.deepEqual(await rows(f),before);
 for(const role of ['anon','authenticated','service_role']){
  await assert.rejects(f.asRole(role,role==='authenticated'?f.ids.inspector:null,db=>db.query('select pi_gestao_private.ga_execution_guidance_registry()')),{code:'42501'});
  await assert.rejects(f.asRole(role,role==='authenticated'?f.ids.inspector:null,db=>db.query('select pi_gestao_private.ga_execution_guidance_registry_v1()')),{code:'42501'});
  await assert.rejects(f.asRole(role,role==='authenticated'?f.ids.inspector:null,db=>db.query('select pi_gestao_private.ga_execution_treatment_guidance(null,null,null,null)')),{code:'42501'});
 }
 f.detail=await f.save();const p=await projection(f,f.detail);await assert.rejects(f.op('rtis.update',{id:p.rti.id,expectedVersion:p.rti.version,requestId:randomUUID(),evidence:'SEM ACESSO DE GESTOR, SOMENTE FIXTURE'},f.ids.inspector),{code:'42501'});
});

test('guidance SQL: consult/report/submit reject inconsistent guidance instead of presenting a forged verified reference',async t=>{
 const f=await fixture(t);f.detail=await f.save();const p=await projection(f,f.detail);
 for(const id of [f.detail.execution.id,p.item.id,p.finding.id,p.rti.id]){
  const body=(await f.db.query('select body from pi_gestao_private.records where id=$1',[id])).rows[0].body,forged=copy(body);
  const guidance=id===f.detail.execution.id?forged.answers[0].treatmentGuidance:forged.treatmentGuidance;guidance.guidance.actionReference='AÇÃO FORJADA EXCLUSIVAMENTE SINTÉTICA';
  await f.db.query('update pi_gestao_private.records set body=$1::jsonb where id=$2',[JSON.stringify(forged),id]);
  for(const action of ['execution.get','execution.report','execution.submit'])await assert.rejects(f.op(action,{inspectionId:f.inspection.id,expectedVersion:f.detail.execution.version,requestId:randomUUID()},f.ids.inspector),{code:'22023'});
  await f.db.query('update pi_gestao_private.records set body=$1::jsonb where id=$2',[JSON.stringify(body),id]);
 }
});

test('guidance SQL: withdrawal preserves the original RTI guidance and manual decision while current item follows its actual selection',async t=>{
 const f=await fixture(t);f.detail=await f.save();let p=await projection(f,f.detail),rti=p.rti;
 rti=await f.op('rtis.update',{id:rti.id,expectedVersion:rti.version,requestId:randomUUID(),due:f.manual_due,deadlineBasis:rti.deadlineAnchor,evidence:'PRAZO MANUAL SOMENTE FIXTURE; SEM CÁLCULO DA ORIENTAÇÃO'});
 const historical=copy(rti.treatmentGuidance),decision=copy(rti.deadlineDecision),answer={...f.answers[0],conditionId:'good-scoped',recommendationId:'none-scoped'};
 f.detail=await f.save(f.payload(f.detail,[answer],{outcome:'technical_review'}));p=await projection(f,f.detail);
 assert.equal(p.answer.treatmentGuidance.status,'not_applicable');assert.deepEqual(p.item.treatmentGuidance,p.answer.treatmentGuidance);assert.deepEqual(p.finding.treatmentGuidance,historical);assert.deepEqual(p.rti.treatmentGuidance,historical);assert.equal(p.rti.recommendationWithdrawn,true);assert.equal(p.rti.deadlineReviewRequired,true);assert.equal(p.rti.technicalReviewRequired,true);assert.equal(p.rti.due,f.manual_due);assert.deepEqual(p.rti.deadlineDecision,decision);assert.equal(p.rti.id,rti.id);
 f.detail=await f.save(f.payload(f.detail,f.answers));p=await projection(f,f.detail);assert.deepEqual(p.rti.treatmentGuidance,historical);assert.equal(p.rti.technicalReviewRequired,true);assert.equal(p.rti.deadlineReviewRequired,true);assert.equal((await f.state()).rti.length,1);
});

test('guidance SQL: immutable catalogue snapshot prevents live mapping changes or registry metadata from reclassifying the execution',async t=>{
 const f=await fixture(t);f.detail=await f.save();const original=copy(f.detail.catalog),p=await projection(f,f.detail),changed=copy(f.items);
 changed[0].guidanceBindings[0].ruleRef=copy(f.registry.entries[3].ruleRef);
 await f.db.query('update pi_gestao_private.inspection_catalogs set items=$1::jsonb where id=$2',[JSON.stringify(changed),f.catalogId]);
 f.detail=await f.save(f.payload(f.detail));assert.deepEqual(f.detail.catalog,original);assert.deepEqual((await projection(f,f.detail)).rti.treatmentGuidance,p.rti.treatmentGuidance);
 await assert.rejects(f.db.query("update pi_gestao_private.inspection_catalog_bindings set snapshot=jsonb_set(snapshot,'{guidanceRegistry}','{}'::jsonb) where id=$1",[f.detail.execution.catalogBindingId]),{code:'55000'});
});

test('guidance SQL: closed treatment and closed legacy without guidance remain byte-identical through registry upgrades and replay',async t=>{
 for(const legacy of [false,true]){
  const f=await fixture(t);f.detail=await f.save();let p=await projection(f,f.detail);
  const doc=await f.op('documents.create',{assetId:f.asset.id,contractId:f.contract.id,module:'rtis',documentType:'rti',reference:'EVIDÊNCIA DE ENCERRAMENTO SOMENTE FIXTURE',sourceId:f.catalogOriginal.id,locator:{page:1}});
  await f.op('rtis.update',{id:p.rti.id,expectedVersion:p.rti.version,requestId:randomUUID(),status:'encerrada',confirmedOn:f.today,evidenceDocumentId:doc.id,evidence:'EVIDÊNCIA DE ENCERRAMENTO SOMENTE FIXTURE',reinspection:'VERIFICAÇÃO SOMENTE FIXTURE'});
  if(legacy){
   for(const id of [p.item.id,p.finding.id,p.rti.id])await f.db.query("update pi_gestao_private.records set body=body-'treatmentGuidance' where id=$1",[id]);
   const answers=f.detail.execution.answers.map(({treatmentGuidance,...answer})=>answer);await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{answers}',$1::jsonb) where id=$2",[JSON.stringify(answers),f.detail.execution.id]);
  }
  const ids=[p.item.id,p.finding.id,p.rti.id,p.rti.pointId],snapshot=async()=>(await f.db.query('select to_jsonb(r) row from pi_gestao_private.records r where id=any($1::uuid[]) order by id',[ids])).rows.map(x=>x.row),before=await snapshot();
  await f.db.exec("create or replace function pi_gestao_private.ga_execution_guidance_registry() returns jsonb language sql immutable set search_path='' as $$select '{\"schemaVersion\":2,\"registryId\":\"SYNTHETIC-UNRECOGNIZED-UPGRADE\",\"entries\":[]}'::jsonb$$;");
  const input=f.payload(),saved=await f.save(input);assert.deepEqual(await snapshot(),before);assert.equal(saved.execution.answers[0].treatmentGuidance===undefined,legacy);
  const replay=await f.save(input);assert.equal(replay.execution.version,saved.execution.version);assert.deepEqual(await snapshot(),before);
 }
});

test('guidance SQL: failure creating the RTI rolls back projected item/finding guidance and retry creates one complete set',async t=>{
 const f=await fixture(t),input=f.payload(),before=await rows(f);
 await f.db.exec("create function pi_gestao_private.fixture_guidance_failure() returns trigger language plpgsql as $$begin if new.kind='rti' then raise exception 'SYNTHETIC_GUIDANCE_RTI_FAILURE';end if;return new;end$$;create trigger fixture_guidance_failure before insert on pi_gestao_private.records for each row execute function pi_gestao_private.fixture_guidance_failure();");
 await assert.rejects(f.save(input),/SYNTHETIC_GUIDANCE_RTI_FAILURE/);assert.deepEqual(await rows(f),before);
 await f.db.exec('drop trigger fixture_guidance_failure on pi_gestao_private.records;drop function pi_gestao_private.fixture_guidance_failure();');
 const saved=await f.save(input),p=await projection(f,saved);assert.equal(p.state.rti.length,1);assert.equal(p.state.finding.length,1);for(const record of [p.answer,p.item,p.finding,p.rti])assert.equal(record.treatmentGuidance.status,'verified_link');
 const retry=await f.save(input);assert.equal(retry.execution.id,saved.execution.id);assert.equal((await f.state()).rti.length,1);
});

test('guidance SQL: open v1 execution resumes, reports and submits unchanged when the current-registry pointer moves to an unknown version',async t=>{
 const f=await fixture(t);f.detail=await f.save();const original=await projection(f,f.detail),pinned=copy(f.detail.catalog);
 await f.db.exec("create or replace function pi_gestao_private.ga_execution_guidance_registry() returns jsonb language sql immutable set search_path='' as $$select '{\"schemaVersion\":2,\"registryId\":\"SYNTHETIC-UNRECOGNIZED-UPGRADE\",\"entries\":[]}'::jsonb$$;");
 assert.deepEqual((await f.db.query('select pi_gestao_private.ga_execution_guidance_registry_v1() value')).rows[0].value,Reference.getRegistry());
 const resumed=await f.op('execution.get',{inspectionId:f.inspection.id},f.ids.inspector);assert.deepEqual(resumed.catalog,pinned);assert.equal(resumed.execution.id,f.detail.execution.id);
 f.detail=await f.save(f.payload(resumed));const current=await projection(f,f.detail);for(const record of [current.answer,current.item,current.finding,current.rti])assert.deepEqual(record.treatmentGuidance,original.rti.treatmentGuidance);assert.equal(current.rti.id,original.rti.id);assert.equal(current.state.rti.length,1);
 const snapshot=await f.op('execution.report',{inspectionId:f.inspection.id},f.ids.inspector);assert.deepEqual(snapshot.rtis[0].treatmentGuidance,original.rti.treatmentGuidance);assert.equal(snapshot.canIssue,false);
 const submitted=await f.op('execution.submit',{inspectionId:f.inspection.id,expectedVersion:f.detail.execution.version,requestId:randomUUID()},f.ids.inspector);assert.equal(submitted.execution.status,'em_revisao');assert.equal(submitted.execution.signatureStatus,'pendente');
 const currentRegistry=(await f.db.query('select pi_gestao_private.ga_execution_guidance_registry() value')).rows[0].value;
 const unsupported=(await f.db.query('select pi_gestao_private.ga_execution_treatment_guidance($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value',[JSON.stringify(currentRegistry),JSON.stringify(f.items[0]),JSON.stringify(f.items[0].conditions[1]),JSON.stringify(f.items[0].recommendations[1])])).rows[0].value;assert.equal(unsupported.status,'invalid_reference');assert.equal(unsupported.guidance,null);
});
