'use strict';
// Actual candidate SQL in isolated PGlite. Auth, licensing, transport, originals
// and Storage are synthetic fixtures; these are not remote integration tests.
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{deflateSync}=require('node:zlib');
const {createScopedEdgeFixture}=require('./fixtures/gestao-scoped-edge.cjs');
const {selectCatalogue}=require('./fixtures/gestao-explicit-catalogue.cjs');

function alternateImage(){
 const crc32=b=>{let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]),crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([size,body,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,40,90,170,255]))),chunk('IEND',Buffer.alloc(0))]));
}
const snapshot=async(f,tables=['records','record_origins','record_relations','audit','operation_receipts'])=>{
 const result={};for(const table of tables)result[table]=(await f.db.query('select to_jsonb(t) row from pi_gestao_private.'+table+' t order by to_jsonb(t)::text')).rows.map(x=>x.row);return result;
};
const frozenSnapshot=async f=>{
 const ids=[f.closed.id,f.closed.findingId,f.detail.execution.items[0].lvtItemId,...(f.closed.pointId?[f.closed.pointId]:[])];
 const records=(await f.db.query('select to_jsonb(r) row from pi_gestao_private.records r where id=any($1::uuid[]) order by id',[ids])).rows.map(x=>x.row);
 const audit=(await f.db.query('select to_jsonb(a) row from pi_gestao_private.audit a where record_id=any($1::uuid[]) order by seq',[ids])).rows.map(x=>x.row);
 return {records,audit};
};

async function fixture(t,{withdrawBeforeClose=false,legacy=false}={}){
 const f=await createScopedEdgeFixture(t,{start:false,bindCatalog:false}),item=f.catalogItems[0],source=item.conditions[1].source;
 item.conditions.push({...item.conditions[1],id:'action-second',text:'OUTRA CONDIÇÃO EXCLUSIVAMENTE SINTÉTICA',source:{...source,locator:{page:2}}});
 item.recommendations[1].conditionIds.push('action-second');
 item.recommendations.push({...item.recommendations[1],id:'treat-second',text:'OUTRA RECOMENDAÇÃO EXCLUSIVAMENTE SINTÉTICA',source:{...source,locator:{page:3}}});
 if(legacy)delete item.recommendations[1].requiresTreatment;
 f.catalogItems.push({id:'second-item',itemKey:'SEGUNDO-ITEM-SINTÉTICO',component:'SEGUNDO COMPONENTE SINTÉTICO',conditions:[{id:'second-good',text:'BOA CONDIÇÃO SOMENTE FIXTURE',supportsGoodCondition:true,source},{id:'second-action',text:'TRATATIVA SOMENTE FIXTURE',supportsGoodCondition:false,source}],recommendations:[{id:'second-treatment',text:'RECOMENDAÇÃO SOMENTE FIXTURE',requiresTreatment:true,conditionIds:['second-action'],source}]});
 await f.db.query('update pi_gestao_private.inspection_catalogs set items=$1::jsonb where id=$2',[JSON.stringify(f.catalogItems),f.catalogId]);
 await selectCatalogue(f,{ownerId:f.ownerId,inspectionId:f.inspection.id,catalogId:f.catalogId});
 f.detail=await f.op('execution.start',{inspectionId:f.inspection.id,requestId:randomUUID()},f.ids.inspector);
 const photo=await f.photo(f.detail),other=await f.photo(f.detail,{bytes:alternateImage()});
 assert.equal(photo.status,200);assert.equal(other.status,200);assert.notEqual(photo.data.photo.id,other.data.photo.id);
 f.photoId=photo.data.photo.id;f.otherPhotoId=other.data.photo.id;
 const dates=(await f.db.query('select current_date::text today,(current_date-4)::text observed,(current_date-3)::text changed,(current_date+45)::text due')).rows[0];Object.assign(f,dates);
 f.answer={catalogItemId:item.id,itemKey:item.itemKey,conditionId:'action-scoped',recommendationId:'treat-scoped',notCovered:false,photoIds:[f.photoId],...(legacy?{}:{pointLabel:'PONTO SINTÉTICO ORIGINAL'})};
 f.payload=(d=f.detail,answers=[f.answer],extra={})=>({inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID(),observedOn:f.observed,answers,outcome:legacy?'pending':'treatment_required',...extra});
 f.save=(d=f.detail,answers=[f.answer],extra={})=>f.op('execution.save',f.payload(d,answers,extra),f.ids.inspector);
 f.detail=await f.save();
 if(withdrawBeforeClose){
  f.answer={...f.answer,conditionId:'good-scoped',recommendationId:'none-scoped'};
  f.detail=await f.save(f.detail,[f.answer],{outcome:'technical_review'});
 }
 const rti=(await f.op('state.get')).rti[0];
 const doc=await f.op('documents.create',{assetId:f.asset.id,contractId:f.contract.id,module:'rtis',documentType:'rti',reference:'EVIDÊNCIA DE FECHAMENTO EXCLUSIVAMENTE SINTÉTICA',sourceId:f.catalogOriginal.id,locator:{page:1}});
 f.closed=await f.op('rtis.update',{id:rti.id,expectedVersion:rti.version,requestId:randomUUID(),due:f.due,confirmedOn:f.today,status:'encerrada',evidenceDocumentId:doc.id,evidence:'EVIDÊNCIA E PRAZO MANUAL SOMENTE SINTÉTICOS',reinspection:'REINSPEÇÃO SOMENTE SINTÉTICA'});
 assert.equal(f.closed.status,'encerrada');
 return f;
}

test('closed RTI: inspector cannot change performed date, condition, recommendation, photos, point or withdraw; every failure rolls back',async t=>{
 const f=await fixture(t),before=await snapshot(f);
 for(const [name,answers,extra] of [
  ['performed date',[f.answer],{observedOn:f.changed}],
  ['same recommendation, different condition',[{...f.answer,conditionId:'action-second'}],{}],
  ['recommendation text/source',[{...f.answer,recommendationId:'treat-second'}],{}],
  ['photos',[{...f.answer,photoIds:[f.otherPhotoId]}],{}],
  ['point',[{...f.answer,pointLabel:'PONTO SINTÉTICO ALTERADO'}],{}],
  ['withdraw recommendation',[{...f.answer,recommendationId:null}],{outcome:'technical_review'}],
  ['withdraw to non-action statement',[{...f.answer,conditionId:'good-scoped',recommendationId:'none-scoped'}],{outcome:'technical_review'}],
  ['condition not covered',[{...f.answer,conditionId:null,recommendationId:null,notCovered:true}],{outcome:'technical_review'}]
 ]){
  await assert.rejects(f.save(f.detail,answers,extra),{code:'22023'},name);
  assert.deepEqual(await snapshot(f),before,name+' leaves all records/relations/origins/audit/receipts intact');
 }
});

test('closed RTI: identical inspector save and response replay preserve closed records, audit, deadline and closure byte for byte',async t=>{
 const f=await fixture(t),before=await frozenSnapshot(f),input=f.payload();
 const saved=await f.op('execution.save',input,f.ids.inspector),after=await frozenSnapshot(f);
 assert.deepEqual(after,before);assert.equal(saved.execution.id,f.detail.execution.id);assert.ok(saved.execution.version>f.detail.execution.version);
 assert.equal(saved.points[0].version,f.detail.points[0].version);
 const replay=await f.op('execution.save',input,f.ids.inspector);assert.equal(replay.execution.version,saved.execution.version);assert.deepEqual(await frozenSnapshot(f),before);
 const current=(await f.op('state.get')).rti[0];assert.equal(current.id,f.closed.id);assert.equal(current.status,'encerrada');assert.equal(current.due,f.due);assert.equal(current.deadlineReviewRequired,f.closed.deadlineReviewRequired);assert.equal(current.closureEvidence,f.closed.closureEvidence);assert.deepEqual(current.history,f.closed.history);
});

test('closed RTI: a later invalid closed item rolls back new point/finding/RTI writes for another item in the same request',async t=>{
 const f=await fixture(t),otherItem=f.detail.execution.items[1],otherPhoto=await f.photo({...f.detail,execution:{...f.detail.execution,items:[otherItem]}});
 assert.equal(otherPhoto.status,200);
 const otherAnswer={catalogItemId:'second-item',itemKey:'SEGUNDO-ITEM-SINTÉTICO',conditionId:'second-action',recommendationId:'second-treatment',notCovered:false,photoIds:[otherPhoto.data.photo.id],pointLabel:'NOVO PONTO SOMENTE FIXTURE'};
 const before=await snapshot(f);
 await assert.rejects(f.save(f.detail,[otherAnswer,{...f.answer,pointLabel:'TENTATIVA DE ALTERAR PONTO ENCERRADO'}]),{code:'22023'});
 assert.deepEqual(await snapshot(f),before);
});

test('closed RTI: another checklist item remains editable while the closed evidence is preserved',async t=>{
 const f=await fixture(t),before=await frozenSnapshot(f);
 const otherAnswer={catalogItemId:'second-item',itemKey:'SEGUNDO-ITEM-SINTÉTICO',conditionId:'second-good',recommendationId:null,notCovered:false,photoIds:[]};
 const saved=await f.save(f.detail,[f.answer,otherAnswer]);assert.equal(saved.execution.answers.length,2);assert.equal(saved.execution.progress.answered,2);assert.deepEqual(await frozenSnapshot(f),before);
 assert.equal((await f.op('state.get')).rti.length,1);
});

test('closed RTI: a historical withdrawal already closed by management is preserved on identical save without clearing technical review',async t=>{
 const f=await fixture(t,{withdrawBeforeClose:true}),before=await frozenSnapshot(f);
 assert.equal(f.closed.recommendationWithdrawn,true);
 const saved=await f.save(f.detail,[f.answer],{outcome:'pending'});assert.equal(saved.execution.technicalReviewRequired,true);assert.deepEqual(await frozenSnapshot(f),before);
});

test('closed RTI: legacy unclassified no-point evidence is not rewritten by identical save',async t=>{
 const f=await fixture(t,{legacy:true}),before=await frozenSnapshot(f);
 assert.equal(f.closed.pointId,null);assert.equal(f.closed.actionabilityStatus,'legacy_unclassified');
 const saved=await f.save();assert.equal(saved.execution.technicalReviewRequired,true);assert.deepEqual(await frozenSnapshot(f),before);
});

test('closed RTI: changed canonical source or wording requires review instead of silently repairing the closed evidence',async t=>{
 const f=await fixture(t);
 const original=(await f.db.query('select body from pi_gestao_private.records where id=$1',[f.closed.id])).rows[0].body;
 for(const patch of [{recommendation:'TEXTO ALTERADO FORA DA FICHA SOMENTE FIXTURE'},{recommendationSource:{...original.recommendationSource,locator:{page:999}}}]){
  await f.db.query('update pi_gestao_private.records set body=$1::jsonb where id=$2',[JSON.stringify({...original,...patch}),f.closed.id]);
  const before=await snapshot(f);await assert.rejects(f.save(),{code:'22023'});assert.deepEqual(await snapshot(f),before);
 }
});
