'use strict';
// Small synthetic records and images only. No real inspection/report, catalogue,
// source drawing, signature, account, deadline policy or technical act.
const {test}=require('node:test'),assert=require('node:assert/strict'),{jsPDF}=require('jspdf');
const Report=require('../app/gestao-tag-report.js');
const id=n=>'b0000000-0000-4000-8000-'+String(n).padStart(12,'0'),copy=value=>JSON.parse(JSON.stringify(value));
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
const image=()=>({bytes:png.slice(),mime:'image/png'});
function fixture({mode='none',photos=2,items=1}={}){
 const scope={ownerId:id(1),contractId:id(2),systemId:id(3),assetId:id(4),inspectionId:id(5),executionId:id(6)},campaignId=id(7),person=id(8),catalogId=id(9),isLegacy=mode==='legacy',treatment=mode==='treatment'||isLegacy;
 const source={sourceId:'a'.repeat(64),fileHash:'a'.repeat(64),fileName:'CATALOGO SOMENTE FIXTURE.pdf',locator:{page:1}};
 const related={...scope,campaignId,module:'integridade'},company={id:scope.ownerId,name:'CLIENTE SOMENTE FIXTURE'},contract={id:scope.contractId,name:'CONTRATO SOMENTE FIXTURE',assetIds:[scope.assetId],modules:['integridade'],version:1},system={id:scope.systemId,name:'SISTEMA SOMENTE FIXTURE'},asset={id:scope.assetId,systemId:scope.systemId,tag:'TAG SOMENTE FIXTURE',version:1},inspection={...related,id:scope.inspectionId,type:'visual',assigneeProfessionalId:person,version:1};
 const catalog={id:catalogId,status:'verified',source,items:[]},execution={...related,id:scope.executionId,recordClass:'field_lvt',executionVersion:1,type:'visual',status:'rascunho',version:2,observedOn:'2026-11-03',inspector:'INSPETOR SOMENTE FIXTURE',inspectorProfessionalId:person,catalogId,items:[],answers:[],technicalReviewRequired:false};
 if(!isLegacy)execution.outcome=treatment?'treatment_required':'good_condition';
 const snapshot={snapshotVersion:1,reportScope:{mode:'contract_system',ownerId:scope.ownerId,contractId:scope.contractId,systemId:scope.systemId},company,contract,system,assets:[asset],inspections:[copy(inspection)],lvts:[],lvtItems:[],photos:[],findings:[],rtis:[],documents:[],recordVersions:[],sourceProvenance:[source]};
 for(let n=0;n<items;n++){
  const itemId=id(10+n),catalogItemId='ITEM-SYNTHETIC-'+n,conditionId='CONDITION-SYNTHETIC-'+n,condition={id:conditionId,text:treatment?'CONDIÇÃO COM TRATATIVA SOMENTE FIXTURE':'CONDIÇÃO SEM TRATATIVA SOMENTE FIXTURE',source};
  if(!isLegacy)condition.supportsGoodCondition=!treatment;
  const definition={id:catalogItemId,itemKey:String(n+1),component:'COMPONENTE SOMENTE FIXTURE '+n,conditions:[condition],recommendations:[]},answer={catalogItemId,itemKey:definition.itemKey,conditionId,recommendationId:null,notCovered:false,photoIds:[]};
  const item={...related,id:itemId,lvtId:execution.id,version:1,catalogItemId,itemKey:definition.itemKey,component:definition.component,conditionId,description:condition.text,conditionSource:source,recommendationId:null,recommendationSource:null};
  if(!isLegacy){for(const row of[answer,item])Object.assign(row,{conditionSupportsGoodCondition:!treatment,requiresTreatment:null,actionabilityStatus:'not_selected',pointId:null,pointLabel:null,pointVersion:null,pointLinkStatus:'not_declared'});}
  if(n===0)for(let p=0;p<photos;p++){
   const photoId=id(20+p),photoSource={sourceId:(p+1).toString(16).repeat(64),fileHash:(p+1).toString(16).repeat(64),fileName:'FOTO PARCIAL SOMENTE FIXTURE '+p+'.png',locator:{section:'Item sintético '+definition.itemKey}};
   snapshot.photos.push({...related,id:photoId,lvtId:execution.id,lvtItemId:itemId,caption:'FOTO PARCIAL SOMENTE FIXTURE '+p,source:photoSource,version:1});snapshot.sourceProvenance.push(photoSource);answer.photoIds.push(photoId);
  }
  item.photoIds=copy(answer.photoIds);
  if(n===0&&mode!=='none'){
   const recommendation={id:'RECOMMENDATION-SYNTHETIC',text:mode==='no_action'?'SEM TRATATIVA SOMENTE FIXTURE':'RECOMENDAÇÃO COM TRATATIVA SOMENTE FIXTURE',conditionIds:[conditionId],source};
   if(!isLegacy)recommendation.requiresTreatment=treatment;
   definition.recommendations.push(recommendation);answer.recommendationId=recommendation.id;item.recommendationId=recommendation.id;item.recommendationSource=source;
   if(!isLegacy){item.recommendation=recommendation.text;for(const row of[answer,item])Object.assign(row,{requiresTreatment:treatment,actionabilityStatus:'catalog_declared'});}
   if(treatment){
    let point=null;
    if(!isLegacy){point={...related,id:id(50),lvtId:execution.id,lvtItemId:itemId,recordClass:'field_point_reference',label:'PONTO CONFIRMADO SOMENTE FIXTURE',photoIds:copy(answer.photoIds),drawingReference:null,locationStatus:'pending_drawing_reference',source:{format:'field_record',actorUserId:person},version:3};snapshot.documents.push(point);for(const row of[answer,item])Object.assign(row,{pointId:point.id,pointLabel:point.label,pointVersion:point.version,pointLinkStatus:'linked_field_reference'});}
    const finding={...related,id:id(40),kind:'finding',lvtId:execution.id,lvtItemId:itemId,description:condition.text,conditionId,recommendation:recommendation.text,recommendationId:recommendation.id,recommendationSource:source,photoIds:copy(answer.photoIds),version:1};
    if(point)Object.assign(finding,{pointId:point.id,pointLabel:point.label,pointLinkStatus:'linked_field_reference',pointVersion:point.version,requiresTreatment:true,actionabilityStatus:'catalog_declared'});
    const rti={...finding,id:id(41),kind:'rti',findingId:finding.id,title:recommendation.text,status:'aberta',deadlineAnchor:{event:'inspection_performed',date:execution.observedOn,status:'declared',inspectionId:scope.inspectionId,executionId:scope.executionId,executionVersion:execution.version},version:1};if(!isLegacy)rti.recommendationWithdrawn=false;snapshot.findings.push(finding);snapshot.rtis.push(rti);
   }
  }
  catalog.items.push(definition);execution.items.push({catalogItemId,itemKey:definition.itemKey,lvtItemId:itemId});execution.answers.push(answer);snapshot.lvtItems.push(item);
 }
 if(!isLegacy)execution.coverage={extent:'declared_section',description:'TRECHO SINTÉTICO ENTRE MARCAS DECLARADAS A E B',photoIds:copy(execution.answers[0].photoIds)};
 const f={scope,detail:{inspection,execution,catalog,points:copy(snapshot.documents)},snapshot};sync(f);return f;
}
function sync(f){
 f.snapshot.lvts=[copy(f.detail.execution)];f.snapshot.inspections=[copy(f.detail.inspection)];
 f.snapshot.recordVersions=[];
 for(const[kind,rows]of[['contract',[f.snapshot.contract]],['asset',f.snapshot.assets],['inspection',f.snapshot.inspections],['lvt',f.snapshot.lvts],['lvt_item',f.snapshot.lvtItems],['photo',f.snapshot.photos],['finding',f.snapshot.findings],['rti',f.snapshot.rtis],['document',f.snapshot.documents]])for(const row of rows)f.snapshot.recordVersions.push({id:row.id,kind,version:row.version});return f;
}
function images(f){return Object.fromEntries(f.snapshot.photos.map(photo=>[photo.id,image()]));}
function capture(){const texts=[],saved=[];let created=0;function Ctor(options){created++;const doc=new jsPDF(options),write=doc.text;doc.text=function(value,...args){texts.push(Array.isArray(value)?value.join('\n'):String(value));return write.call(doc,value,...args);};doc.save=name=>saved.push(name);return doc;}return {Ctor,texts,saved,get created(){return created;}};}

test('good declaration embeds all selected coverage photographs, preserves declared section and creates no RTI or technical act',async()=>{
 const f=fixture(),before=JSON.stringify(f),record=await Report.freeze(f),c=capture(),result=await Report.createPdf(record,images(f),{},c.Ctor);
 assert.equal(JSON.stringify(f),before);assert.equal(record.content.rtis.length,0);assert.equal(record.content.findings.length,0);assert.equal(Object.hasOwn(record.content,'points'),false);
 assert.deepEqual(result.metadata.embeddedPhotoIds,f.detail.execution.coverage.photoIds);assert.equal(result.metadata.outcome,'good_condition');assert.equal(result.metadata.coverage.extent,'declared_section');assert.equal(result.metadata.coverage.basis,'inspector_declared_not_inferred_from_photos');assert.equal(result.metadata.canIssue,false);assert.equal(result.metadata.technicalApproval,'pending');assert.deepEqual(result.metadata.signatures,[]);assert.deepEqual(c.saved,[]);
 const text=c.texts.join('\n');for(const expected of['Boas condições declaradas','Cobertura DECLARADA pelo inspetor: trecho declarado','TRECHO SINTÉTICO ENTRE MARCAS DECLARADAS A E B','Foto parcial não comprova','Nenhuma RTI desta execução','RASCUNHO DE CONFERÊNCIA'])assert.ok(text.includes(expected),expected);assert.ok(!text.includes('Cobertura DECLARADA pelo inspetor: linha integral declarada'));
 assert.equal(Buffer.from(result.doc.output('arraybuffer')).subarray(0,4).toString(),'%PDF');
});
test('one photo is sufficient for the report, never a default photo or a photo requirement fabricated for each good item',async()=>{
 const f=fixture({photos:1,items:2}),record=await Report.freeze(f),result=await Report.createPdf(record,images(f),{},jsPDF);assert.equal(record.content.items.length,2);assert.deepEqual(result.metadata.embeddedPhotoIds,[id(20)]);assert.equal(result.metadata.coverage.extent,'declared_section');
});
test('good declaration without photographs or explicit coverage is rejected; real existing photo records alone do not satisfy selection',async()=>{
 const absent=fixture({photos:0});await assert.rejects(Report.freeze(absent),/foto vinculada/);
 const noCoverage=fixture();delete noCoverage.detail.execution.coverage;sync(noCoverage);await assert.rejects(Report.freeze(noCoverage),/cobertura explicitamente/);
 const unselected=fixture();unselected.detail.execution.answers[0].photoIds=[];sync(unselected);await assert.rejects(Report.freeze(unselected),/Foto de cobertura/);
});
test('coverage rejects invented extent, blank limits, duplicate or foreign photos, even for the same TAG',async()=>{
 for(const mutate of[c=>c.extent='automatic_entire_line',c=>c.description=' ',c=>c.photoIds=[id(999)],c=>c.photoIds.push(c.photoIds[0]),c=>c.approved=true]){const f=fixture();mutate(f.detail.execution.coverage);sync(f);await assert.rejects(Report.freeze(f));}
 const crossed=fixture();crossed.snapshot.photos[0].inspectionId=id(99);await assert.rejects(Report.freeze(crossed),/escopo/);
});
test('whole-line extent requires its own declaration; photographs never promote a declared section and changes alter the digest',async()=>{
 const f=fixture(),section=await Report.freeze(f);f.detail.execution.coverage.extent='declared_entire_line';f.detail.execution.coverage.description='LINHA INTEGRAL DECLARADA SOMENTE FIXTURE';sync(f);const whole=await Report.freeze(f),c=capture(),result=await Report.createPdf(whole,images(f),{},c.Ctor);assert.notEqual(whole.contentDigest,section.contentDigest);assert.equal(result.metadata.coverage.extent,'declared_entire_line');assert.ok(c.texts.join('\n').includes('linha integral declarada'));assert.ok(c.texts.join('\n').includes('sem inferência automática'));
});
test('explicit no-treatment catalogue choice preserves its saved text/source without finding or RTI',async()=>{
 const f=fixture({mode:'no_action'}),record=await Report.freeze(f),c=capture(),result=await Report.createPdf(record,images(f),{},c.Ctor);assert.equal(record.content.rtis.length,0);assert.equal(record.content.findings.length,0);assert.ok(c.texts.join('\n').includes('SEM TRATATIVA SOMENTE FIXTURE'));assert.ok(c.texts.join('\n').includes('Escolha documental sem tratativa: não cria nova RTI'));assert.equal(result.metadata.outcome,'good_condition');
 for(const mutate of[x=>x.detail.catalog.items[0].recommendations[0].text='MUDANÇA SOMENTE FIXTURE',x=>x.detail.catalog.items[0].recommendations[0].requiresTreatment=true,x=>x.snapshot.lvtItems[0].recommendation='TEXTO DIFERENTE',x=>x.snapshot.lvtItems[0].recommendationSource.locator.page=2]){const changed=copy(f);mutate(changed);await assert.rejects(Report.freeze(changed),/diverge/);}
});
test('good condition depends on persisted and catalogue classification, complete answers and absence of same-execution RTI',async()=>{
 for(const flag of[false,null]){const f=fixture();f.detail.catalog.items[0].conditions[0].supportsGoodCondition=flag;f.detail.execution.answers[0].conditionSupportsGoodCondition=flag;f.snapshot.lvtItems[0].conditionSupportsGoodCondition=flag;sync(f);await assert.rejects(Report.freeze(f),/Boas condições exigem/);}
 const changed=fixture();changed.detail.catalog.items[0].conditions[0].supportsGoodCondition=false;await assert.rejects(Report.freeze(changed),/classificação de boas condições/);
 const incomplete=fixture({items:2});incomplete.detail.execution.answers.pop();sync(incomplete);await assert.rejects(Report.freeze(incomplete),/Boas condições exigem/);
 const technical=fixture();technical.detail.execution.technicalReviewRequired=true;sync(technical);await assert.rejects(Report.freeze(technical),/Boas condições exigem/);
 const active=fixture({mode:'treatment'});active.detail.execution.outcome='good_condition';sync(active);await assert.rejects(Report.freeze(active),/Boas condições exigem/);
});
test('good PDF refuses every missing or invalid required image before any good-condition heading or save',async()=>{
 const f=fixture(),record=await Report.freeze(f),c=capture(),partial=images(f);delete partial[id(21)];await assert.rejects(Report.createPdf(record,partial,{},c.Ctor),/todas as fotos/);assert.equal(c.created,0);assert.deepEqual(c.texts,[]);assert.deepEqual(c.saved,[]);
 for(const invalid of[{bytes:Uint8Array.of(1,2,3),mime:'image/png'},{bytes:png.slice(),mime:'image/gif'},{bytes:Uint8Array.from([137,80,78,71,13,10,26,10]),mime:'image/png'}]){const bad=images(f);bad[id(21)]=invalid;const captureBad=capture();await assert.rejects(Report.createPdf(record,bad,{},captureBad.Ctor),/Foto|Fotografia/);assert.deepEqual(captureBad.texts,[]);assert.deepEqual(captureBad.saved,[]);}
 const map=new Map(Object.entries(images(f))),result=await Report.createPdf(record,map,{},jsPDF);assert.equal(result.metadata.embeddedPhotoIds.length,2);
});
test('active treatment validates canonical field point from detail and snapshot with exact version, item and evidence',async()=>{
 const f=fixture({mode:'treatment'}),record=await Report.freeze(f),c=capture(),result=await Report.createPdf(record,images(f),{},c.Ctor);assert.deepEqual(record.content.points,f.snapshot.documents);assert.equal(result.metadata.pointReferences[0].id,id(50));assert.ok(c.texts.join('\n').includes('PONTO CONFIRMADO SOMENTE FIXTURE'));assert.ok(c.texts.join('\n').includes('Localização no isométrico: pendente'));assert.ok(c.texts.join('\n').includes(id(41)));assert.equal(result.metadata.outcome,'treatment_required');assert.equal(result.metadata.canIssue,false);
 for(const mutate of[x=>x.snapshot.documents=[],x=>x.detail.points[0].version++,x=>x.snapshot.rtis[0].pointVersion++,x=>x.detail.execution.answers[0].pointId=id(999),x=>{x.snapshot.documents[0].contractId=id(99);x.detail.points=copy(x.snapshot.documents);},x=>{x.snapshot.documents[0].drawingReference={fabricated:true};x.detail.points=copy(x.snapshot.documents);}]){const invalid=copy(f);mutate(invalid);sync(invalid);await assert.rejects(Report.freeze(invalid));}
 const noPoint=copy(f);noPoint.snapshot.documents=[];noPoint.detail.points=[];for(const row of[noPoint.detail.execution.answers[0],noPoint.snapshot.lvtItems[0],noPoint.snapshot.findings[0],noPoint.snapshot.rtis[0]]){row.pointId=null;row.pointLabel=null;row.pointLinkStatus='pending';}sync(noPoint);await assert.rejects(Report.freeze(noPoint),/ponto/);
});
test('withdrawn treatment retains canonical historical photos and RTI, requires review and cannot become good',async()=>{
 const f=fixture({mode:'treatment'}),answer=f.detail.execution.answers[0],item=f.snapshot.lvtItems[0];f.detail.execution.outcome='technical_review';f.detail.execution.coverage=null;f.detail.execution.technicalReviewRequired=true;
 for(const row of[answer,item])Object.assign(row,{recommendationId:null,requiresTreatment:null,actionabilityStatus:'not_selected',photoIds:[]});item.recommendation=null;item.recommendationSource=null;f.snapshot.documents[0].photoIds=[];f.snapshot.documents[0].version++;for(const row of[answer,item,f.snapshot.findings[0],f.snapshot.rtis[0]])row.pointVersion=f.snapshot.documents[0].version;f.detail.points=copy(f.snapshot.documents);Object.assign(f.snapshot.rtis[0],{recommendationWithdrawn:true,technicalReviewRequired:true,historicalEvidencePreserved:true});sync(f);
 const before=JSON.stringify(f),record=await Report.freeze(f),c=capture();await Report.createPdf(record,images(f),{},c.Ctor);assert.equal(JSON.stringify(f),before);assert.deepEqual(record.content.rtis[0].photoIds,[id(20),id(21)]);assert.equal(record.content.rtis[0].status,'aberta');assert.ok(c.texts.join('\n').includes('RTI preservada para gestão técnica'));
 f.detail.execution.outcome='good_condition';sync(f);await assert.rejects(Report.freeze(f),/Boas condições exigem/);
});
test('legacy unclassified generic conference keeps its saved shape and does not acquire good status from absence or text',async()=>{
 const f=fixture({mode:'legacy'}),record=await Report.freeze(f),before=JSON.stringify(f),c=capture(),result=await Report.createPdf(record,images(f),{},c.Ctor);assert.equal(Object.hasOwn(record.content.execution,'outcome'),false);assert.equal(Object.hasOwn(record.content,'points'),false);assert.equal(result.metadata.outcome,'pending');assert.equal(result.metadata.outcomeStatus,'legacy_unclassified');assert.equal(result.metadata.coverage,null);assert.ok(c.texts.join('\n').includes('Registro legado sem classificação explícita'));assert.equal(JSON.stringify(f),before);
});
test('actual SQL-style legacy normalization keeps effective treatment and RTI without pretending curation or a drawing point',async()=>{
 const f=fixture({mode:'legacy'});f.detail.execution.outcome='pending';f.detail.execution.coverage=null;
 for(const row of[f.detail.execution.answers[0],f.snapshot.lvtItems[0]])Object.assign(row,{conditionSupportsGoodCondition:null,requiresTreatment:true,actionabilityStatus:'legacy_unclassified',pointId:null,pointLabel:null,pointVersion:null,pointLinkStatus:'pending'});
 for(const row of[...f.snapshot.findings,...f.snapshot.rtis])Object.assign(row,{requiresTreatment:true,actionabilityStatus:'legacy_unclassified',pointId:null,pointLabel:null,pointVersion:null,pointLinkStatus:'pending'});
 sync(f);const record=await Report.freeze(f),c=capture(),result=await Report.createPdf(record,images(f),{},c.Ctor);assert.equal(record.content.rtis.length,1);assert.equal(result.metadata.outcome,'pending');assert.ok(record.pending.some(note=>note.includes('escolha legada sem classificação')));assert.ok(c.texts.join('\n').includes('Escolha legada sem classificação'));assert.equal(Object.hasOwn(record.content,'points'),false);
 for(const declared of['good_condition','treatment_required']){const forged=copy(f);forged.detail.execution.outcome=declared;sync(forged);await assert.rejects(Report.freeze(forged),/classificação de tratativa explícita/);}
});
test('declaring treatment without any actionable recommendation is rejected rather than fabricating an RTI',async()=>{
 const f=fixture({mode:'no_action'});f.detail.execution.outcome='treatment_required';sync(f);await assert.rejects(Report.freeze(f),/recomendação acionável/);
});
test('another inspection and contract cannot supply coverage photos or replace a current field point',async()=>{
 const f=fixture({mode:'treatment'}),foreign=copy(f.snapshot.documents[0]);foreign.id=id(88);foreign.inspectionId=id(89);foreign.executionId=id(90);foreign.lvtId=id(90);foreign.lvtItemId=id(91);foreign.contractId=id(92);f.snapshot.documents.push(foreign);f.detail.points.push(copy(foreign));f.snapshot.recordVersions.push({id:foreign.id,kind:'document',version:foreign.version});const record=await Report.freeze(f);assert.deepEqual(record.content.points.map(p=>p.id),[id(50)]);
 const substituted=copy(f);substituted.snapshot.documents[0]=copy(foreign);substituted.snapshot.documents[0].id=id(50);await assert.rejects(Report.freeze(substituted));
});
test('same-version detail cannot replace saved outcome, coverage, answers, date or responsible identity',async()=>{
 for(const mutate of[x=>x.outcome='pending',x=>x.coverage=null,x=>x.coverage.description='OUTRO TRECHO',x=>x.answers[0].photoIds=[],x=>x.observedOn='2026-11-02',x=>x.inspector='OUTRO RESPONSÁVEL',x=>x.technicalReviewRequired=true]){
  const f=fixture();mutate(f.snapshot.lvts[0]);await assert.rejects(Report.freeze(f),/Conteúdo da execução diverge do snapshot salvo/);
 }
});
test('active curated treatment rejects missing pointer versions, stale evidence, withdrawn links and invented geometry',async()=>{
 for(const mutate of[x=>delete x.detail.execution.answers[0].pointVersion,x=>delete x.snapshot.lvtItems[0].pointVersion,x=>delete x.snapshot.findings[0].pointVersion,x=>x.snapshot.rtis[0].photoIds=[],x=>x.snapshot.findings[0].photoIds=[id(20)],x=>x.snapshot.rtis[0].requiresTreatment=false,x=>delete x.snapshot.findings[0].actionabilityStatus,x=>x.snapshot.rtis[0].recommendationWithdrawn=true,x=>{x.snapshot.documents[0].geometry={x:1,y:2};x.detail.points=copy(x.snapshot.documents);}]){
  const f=fixture({mode:'treatment'});mutate(f);sync(f);await assert.rejects(Report.freeze(f));
 }
});
test('withdrawn RTI keeps historical photos but must still reference the current field document version',async()=>{
 const f=fixture({mode:'treatment'});f.detail.execution.outcome='technical_review';f.detail.execution.coverage=null;f.detail.execution.technicalReviewRequired=true;
 for(const row of[f.detail.execution.answers[0],f.snapshot.lvtItems[0]])Object.assign(row,{recommendationId:null,requiresTreatment:null,actionabilityStatus:'not_selected',photoIds:[],pointVersion:4});
 f.snapshot.documents[0].photoIds=[];f.snapshot.documents[0].version=4;f.detail.points=copy(f.snapshot.documents);Object.assign(f.snapshot.rtis[0],{recommendationWithdrawn:true,technicalReviewRequired:true,historicalEvidencePreserved:true,pointVersion:4});sync(f);
 await assert.rejects(Report.freeze(f),/versão do ponto diverge/);f.snapshot.findings[0].pointVersion=4;const record=await Report.freeze(f);assert.deepEqual(record.content.rtis[0].photoIds,[id(20),id(21)]);assert.equal(record.content.points[0].version,4);
});
test('good PDF rejects JPEG headers without image scans before writing text and accepts a complete synthetic JPEG',async()=>{
 const f=fixture({photos:1}),record=await Report.freeze(f),headerOnly=Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,255,192,0,17,8,0,1,0,1,3,1,17,0,2,17,0,3,17,0,255,217]),c=capture();
 await assert.rejects(Report.createPdf(record,{[id(20)]:{bytes:headerOnly,mime:'image/jpeg'}},{},c.Ctor),/JPEG incompleta/);assert.deepEqual(c.texts,[]);assert.deepEqual(c.saved,[]);
 // Tiny generated 2x3 image, the same synthetic photographic fixture used by
 // document-original tests. No field photograph or customer content.
 const jpeg=Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==','base64'));
 const result=await Report.createPdf(record,{[id(20)]:{bytes:jpeg,mime:'image/jpeg'}},{},jsPDF);assert.deepEqual(result.metadata.embeddedPhotoIds,[id(20)]);assert.ok(Buffer.from(result.doc.output('arraybuffer')).includes(Buffer.from('/Subtype /Image')));assert.equal(result.metadata.canIssue,false);
});
