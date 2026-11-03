'use strict';
// Actual candidate SQL -> tag helper -> in-memory Node PDF. Auth/Storage and all
// people, originals, choices and images are isolated synthetic fixtures only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {jsPDF}=require('jspdf'),{setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const Report=require('../app/gestao-tag-report.js');
const imageBytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));

async function fixture(t){
 const f=await setup();t.after(()=>f.close());
 await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');
 for(const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())
  await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/inspection-execution.sql'),'utf8'));
 f.professionalId=randomUUID();
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 await f.db.query('insert into pi_team_private.professionals(tenant_id,id,user_id,name,created_by,updated_by) values($1,$2,$3,$4,$3,$3)',[f.ids.tenantA,f.professionalId,f.ids.adminA,'ADMIN ATRIBUÍDO EXCLUSIVO FIXTURE TAG-SQL']);
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 const owner=await f.call(f.ids.tenantA,'owners.create',{name:'CLIENTE SINTÉTICO TAG-SQL SEM VALOR TÉCNICO',source:'Fixture isolada'});f.ownerId=owner.id;
 f.exec=(action,payload={})=>f.call(f.ids.tenantA,action,{ownerId:f.ownerId,...payload});
 const hierarchy=await f.exec('hierarchy.create',{unit:'UNIDADE SINTÉTICA TAG-SQL',system:'SISTEMA SINTÉTICO TAG-SQL'});f.system=hierarchy.system;
 f.asset=await f.exec('assets.create',{unitId:hierarchy.unit.id,systemId:f.system.id,type:'linha',tag:'TAG-EXCLUSIVA-FIXTURE-SQL',source:'Fixture isolada'});
 f.newContract=async name=>{
  const contract=await f.exec('contracts.create',{requestId:randomUUID(),name,source:'Fixture sem efeito contratual',modules:['integridade'],assetIds:[f.asset.id]});
  const campaign=await f.exec('campaigns.create',{requestId:randomUUID(),name:'CAMPANHA '+name,source:'Fixture',contractId:contract.id,systemId:f.system.id,module:'integridade',assetIds:[f.asset.id],status:'rascunho'});
  return {contract,campaign};
 };
 f.c1=await f.newContract('CONTRATO C1 EXCLUSIVO FIXTURE TAG-SQL');
 f.observed=(await f.db.query('select (current_date-4)::text d')).rows[0].d;
 f.changedObserved=(await f.db.query('select (current_date-3)::text d')).rows[0].d;
 const original=async(format,name,bytes)=>{
  const sha=createHash('sha256').update(bytes).digest('hex'),ext=format==='image_png'?'png':'pdf';
  return f.register(f.ids.tenantA,f.ids.adminA,{sha,name,size:bytes.length,objectKey:await f.putObject(f.ids.tenantA,sha,bytes.length,ext),workbook:{format,sheets:[],metadata:{extraction:'not_performed'}}});
 };
 const originalDoc=new jsPDF();originalDoc.text('SYNTHETIC CATALOG ONLY - NO TECHNICAL VALIDITY',10,10);
 f.catalogOriginal=await original('document_pdf','CATALOGO-EXCLUSIVO-FIXTURE-TAG-SQL.pdf',Buffer.from(originalDoc.output('arraybuffer')));
 f.photoOriginal=await original('image_png','IMAGEM-EXCLUSIVA-FIXTURE-TAG-SQL.png',imageBytes);
 f.source={sourceId:f.catalogOriginal.id,fileHash:f.catalogOriginal.id,fileName:f.catalogOriginal.name,format:'document_pdf',locator:{page:1}};
 f.catalogId=randomUUID();
 f.items=[{id:'catalog-item-tag-sql',itemKey:'1.1-FIXTURE',component:'COMPONENTE EXCLUSIVO FIXTURE TAG-SQL',conditions:[{id:'condition-tag-sql',text:'CONDIÇÃO EXCLUSIVA FIXTURE TAG-SQL',source:f.source}],recommendations:[{id:'recommendation-tag-sql',text:'RECOMENDAÇÃO EXCLUSIVA FIXTURE TAG-SQL',conditionIds:['condition-tag-sql'],source:f.source}]}];
 await f.db.query('insert into pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id,source_id,source_locator,items,verified_by,verified_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now())',[f.ids.tenantA,f.ownerId,f.catalogId,f.catalogOriginal.id,JSON.stringify({page:1}),JSON.stringify(f.items),f.ids.adminA]);
 f.start=async({contract,campaign}=f.c1,type='visual')=>{
  const inspection=await f.exec('inspections.create',{requestId:randomUUID(),assetId:f.asset.id,contractId:contract.id,campaignId:campaign.id,module:'integridade',type,status:'planejada',source:'Planejamento exclusivamente sintético'});
  await f.exec('execution.assign',{inspectionId:inspection.id,professionalId:f.professionalId,expectedVersion:inspection.version,requestId:randomUUID()});
  return f.exec('execution.start',{inspectionId:inspection.id,requestId:randomUUID()});
 };
 f.save=(detail,answers,observedOn=f.observed)=>f.exec('execution.save',{inspectionId:detail.inspection.id,expectedVersion:detail.execution.version,requestId:randomUUID(),observedOn,answers});
 f.visual=async(context=f.c1,label='SELECIONADA')=>{
  let detail=await f.start(context);
  const photo=await f.exec('photos.create',{assetId:f.asset.id,lvtItemId:detail.execution.items[0].lvtItemId,sourceId:f.photoOriginal.id,locator:{section:'FOTO SINTÉTICA '+label},caption:'FOTO EXCLUSIVA FIXTURE '+label});
  const answer={catalogItemId:f.items[0].id,itemKey:f.items[0].itemKey,conditionId:'condition-tag-sql',recommendationId:'recommendation-tag-sql',notCovered:false,photoIds:[photo.id]};
  detail=await f.save(detail,[answer]);return {detail,photo,answer};
 };
 f.report=(context=f.c1)=>f.exec('reports.system',{contractId:context.contract.id,systemId:f.system.id});
 f.input=(detail,snapshot)=>({scope:{ownerId:f.ownerId,contractId:detail.inspection.contractId,systemId:f.system.id,assetId:f.asset.id,inspectionId:detail.inspection.id,executionId:detail.execution.id},detail,snapshot});
 return f;
}

test('tag SQL integration: canonical saved choices/sources/anchor freeze explicit older execution and generate only in-memory draft',async t=>{
 const f=await fixture(t),chosen=await f.visual(f.c1,'SELECIONADA'),newer=await f.visual(f.c1,'MAIS NOVA NÃO SELECIONADA'),c2=await f.newContract('CONTRATO C2 EXCLUSIVO FIXTURE TAG-SQL'),foreign=await f.visual(c2,'C2 NÃO SELECIONADA');
 const detail=await f.exec('execution.get',{inspectionId:chosen.detail.inspection.id}),snapshot=await f.report();
 assert.equal(snapshot.lvts.length,2);assert.ok(snapshot.lvts.some(row=>row.id===newer.detail.execution.id));assert.ok(!snapshot.lvts.some(row=>row.id===foreign.detail.execution.id));
 const item=snapshot.lvtItems.find(row=>row.id===detail.execution.items[0].lvtItemId),finding=snapshot.findings.find(row=>row.lvtItemId===item.id),rti=snapshot.rtis.find(row=>row.findingId===finding.id);
 assert.deepEqual(item.conditionSource,detail.catalog.items[0].conditions[0].source);
 assert.deepEqual(item.recommendationSource,detail.catalog.items[0].recommendations[0].source);
 assert.deepEqual(finding.recommendationSource,item.recommendationSource);assert.deepEqual(rti.recommendationSource,item.recommendationSource);
 assert.equal(rti.deadlineAnchor.date,f.observed);assert.equal(rti.deadlineAnchor.executionVersion,detail.execution.version);assert.deepEqual(finding.deadlineAnchor,rti.deadlineAnchor);
 assert.equal(snapshot.photos.find(row=>row.id===chosen.photo.id).executionId,undefined,'actual legacy photo shape need not invent executionId');
 const before=JSON.stringify({detail,snapshot}),record=await Report.freeze(f.input(detail,snapshot));assert.equal(JSON.stringify({detail,snapshot}),before);
 assert.equal(record.content.execution.id,chosen.detail.execution.id);assert.equal(record.content.inspection.id,chosen.detail.inspection.id);
 assert.deepEqual(record.content.items.map(row=>row.id),[item.id]);assert.deepEqual(record.content.photos.map(row=>row.id),[chosen.photo.id]);
 assert.deepEqual(record.content.findings.map(row=>row.id),[finding.id]);assert.deepEqual(record.content.rtis.map(row=>row.id),[rti.id]);
 assert.ok(!record.content.recordVersions.some(row=>[newer.detail.execution.id,newer.photo.id,foreign.detail.execution.id,foreign.photo.id].includes(row.id)));
 assert.deepEqual(record.content.sourceProvenance.map(row=>row.sourceId).sort(),[f.catalogOriginal.id,f.photoOriginal.id].sort());
 assert.deepEqual(record.content.rtis[0].deadlineAnchor,rti.deadlineAnchor);assert.ok(Object.isFrozen(record.content));
 const text=[],saved=[];
 function Capture(options){const doc=new jsPDF(options),write=doc.text;doc.text=function(value,...args){text.push(Array.isArray(value)?value.join('\n'):String(value));return write.call(doc,value,...args);};doc.save=name=>saved.push(name);return doc;}
 const result=await Report.createPdf(record,{[chosen.photo.id]:{bytes:imageBytes,mime:'image/png'}},{generatedAt:'2026-11-03T12:00:00Z'},Capture);
 const pdf=Buffer.from(result.doc.output('arraybuffer'));assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.ok(pdf.length>1000);assert.deepEqual(saved,[]);
 assert.deepEqual(result.metadata.embeddedPhotoIds,[chosen.photo.id]);assert.equal(result.metadata.draft,true);assert.equal(result.metadata.canIssue,false);assert.deepEqual(result.metadata.signatures,[]);assert.equal(result.metadata.technicalNumber,null);
 const printed=text.join('\n');for(const expected of [detail.inspection.id,detail.execution.id,item.description,finding.recommendation,'Marco observado declarado: '+f.observed,'RASCUNHO DE CONFERÊNCIA'])assert.ok(printed.includes(expected),expected);
 for(const excluded of [newer.detail.inspection.id,newer.detail.execution.id,newer.photo.id,foreign.detail.inspection.id,foreign.detail.execution.id,foreign.photo.id])assert.ok(!printed.includes(excluded),excluded);
 t.diagnostic(JSON.stringify({localOnly:true,sqlCollections:{lvts:snapshot.lvts.length,items:snapshot.lvtItems.length,photos:snapshot.photos.length},explicitExecution:record.content.execution.id,selectedPhoto:chosen.photo.id,sourceCount:record.content.sourceProvenance.length,pdfBytes:pdf.length,canIssue:result.metadata.canIssue}));
});

test('tag SQL integration: actual stale SQL detail/snapshot are rejected and thickness never selects a visual execution automatically',async t=>{
 const f=await fixture(t),visual=await f.visual(),oldDetail=await f.exec('execution.get',{inspectionId:visual.detail.inspection.id}),oldSnapshot=await f.report();
 const current=await f.save(oldDetail,[visual.answer],f.changedObserved),snapshot=await f.report();
 await assert.rejects(Report.freeze(f.input(current,oldSnapshot)),/mudou durante a consulta/);
 await assert.rejects(Report.freeze(f.input(oldDetail,snapshot)),/mudou durante a consulta/);
 const valid=await Report.freeze(f.input(current,snapshot));assert.equal(valid.content.execution.version,current.execution.version);assert.equal(valid.content.rtis[0].deadlineAnchor.date,f.changedObserved);
 const thickness=await f.start(f.c1,'espessura'),freshSnapshot=await f.report();assert.equal(thickness.execution.type,'espessura');assert.equal(thickness.execution.recordClass,'measurement_draft');
 await assert.rejects(Report.freeze(f.input(thickness,freshSnapshot)),/Execução visual não encontrado/);
 const omitted=f.input(current,snapshot);delete omitted.scope.executionId;await assert.rejects(Report.freeze(omitted),/Execução visual não encontrado/);
 const noAutomaticLatest=await Report.freeze(f.input(current,freshSnapshot));assert.equal(noAutomaticLatest.content.execution.id,current.execution.id);
});
