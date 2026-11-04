'use strict';
// Isolated synthetic records and image bytes only. No actual inspection, client,
// credential, model reproduction, signature or technical report is produced.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{jsPDF}=require('jspdf');
const Report=require('../app/gestao-tag-report.js');
const id=n=>n.toString(16).padStart(8,'0')+'-1111-4111-8111-'+n.toString(16).padStart(12,'0');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const scope={ownerId:id(1),contractId:id(2),systemId:id(3),assetId:id(4),inspectionId:id(5),executionId:id(6)},campaignId=id(7),person=id(8),catalogId=id(9),itemId=id(10),photoId=id(11),findingId=id(12),rtiId=id(13);
 const source={sourceId:'a'.repeat(64),fileHash:'a'.repeat(64),fileName:'SOMENTE-FIXTURE-SEM-VALOR-TECNICO.xlsx',locator:{sheet:'Fonte sintética',row:2}};
 const related={ownerId:scope.ownerId,contractId:scope.contractId,systemId:scope.systemId,assetId:scope.assetId,inspectionId:scope.inspectionId,executionId:scope.executionId,campaignId,module:'integridade'};
 const company={id:scope.ownerId,name:'CLIENTE SOMENTE FIXTURE'},contract={id:scope.contractId,name:'CONTRATO FIXTURE C1',modules:['integridade'],assetIds:[scope.assetId],version:2},system={id:scope.systemId,name:'SISTEMA FIXTURE',version:1},asset={id:scope.assetId,systemId:scope.systemId,tag:'TAG-APENAS-FIXTURE',type:'linha',version:1};
 const inspection={...related,id:scope.inspectionId,type:'visual',assigneeProfessionalId:person,assigneeName:'RESPONSÁVEL FIXTURE',version:4};
 const execution={...related,id:scope.executionId,recordClass:'field_lvt',executionVersion:1,type:'visual',status:'rascunho',version:3,observedOn:'2026-11-03',inspector:'RESPONSÁVEL FIXTURE',inspectorProfessionalId:person,catalogId,items:[{catalogItemId:'component-1',itemKey:'X-FONTE',lvtItemId:itemId}],answers:[{catalogItemId:'component-1',itemKey:'X-FONTE',conditionId:'c-1',recommendationId:'r-1',notCovered:false,photoIds:[photoId]}]};
 const catalog={id:catalogId,status:'verified',source,items:[{id:'component-1',itemKey:'X-FONTE',component:'COMPONENTE SOMENTE FIXTURE',conditions:[{id:'c-1',text:'CONDIÇÃO SALVA SOMENTE FIXTURE',source}],recommendations:[{id:'r-1',text:'RECOMENDAÇÃO SALVA SOMENTE FIXTURE',conditionIds:['c-1'],source}]}]};
 const item={...related,id:itemId,lvtId:execution.id,version:2,catalogItemId:'component-1',itemKey:'X-FONTE',component:'COMPONENTE SOMENTE FIXTURE',conditionId:'c-1',recommendationId:'r-1',description:catalog.items[0].conditions[0].text,conditionSource:source,recommendationSource:source};
 const photo={...related,id:photoId,lvtId:execution.id,lvtItemId:itemId,version:1,caption:'FOTO SOMENTE FIXTURE',source:{sourceId:'b'.repeat(64),fileHash:'b'.repeat(64),fileName:'SOMENTE-FIXTURE.png',locator:{section:'Item X-FONTE'}}};
 const finding={...related,id:findingId,lvtId:execution.id,lvtItemId:itemId,version:1,recommendationId:'r-1',recommendation:catalog.items[0].recommendations[0].text,recommendationSource:source};
 const rti={...finding,id:rtiId,findingId: findingId,due:'2026-11-30',sourceDue:'2001-01-01',sourceDate:'1999-01-01',deadlineAnchor:{date:null,status:'pending_observed_on'},deadlineReviewRequired:true,status:'aberta',currentness:'unknown',version:2};
 const snapshot={snapshotVersion:1,generatedAt:'2026-11-03T12:00:00Z',reportScope:{mode:'contract_system',ownerId:scope.ownerId,contractId:scope.contractId,systemId:scope.systemId},company,contract,system,assets:[asset],inspections:[copy(inspection)],lvts:[copy(execution)],lvtItems:[item],photos:[photo],findings:[finding],rtis:[rti],sourceProvenance:[source,photo.source],recordVersions:[]};
 for(const[kind,rows]of [['contract',[contract]],['asset',[asset]],['inspection',snapshot.inspections],['lvt',snapshot.lvts],['lvt_item',snapshot.lvtItems],['photo',snapshot.photos],['finding',snapshot.findings],['rti',snapshot.rtis]])for(const row of rows)snapshot.recordVersions.push({id:row.id,version:row.version,kind});
 return {scope,snapshot,detail:{inspection,execution,catalog,canAssign:true,canExecute:true},source};
}
function emptyFixture(){
 const f=fixture();f.detail.catalog={id:null,status:'unavailable',items:[],reason:'Fonte conferida ainda indisponível'};f.detail.execution.catalogId=null;f.detail.execution.items=[];f.detail.execution.answers=[];f.detail.execution.observedOn=null;f.snapshot.lvts=[copy(f.detail.execution)];
 f.snapshot.lvtItems=[];f.snapshot.photos=[];f.snapshot.findings=[];f.snapshot.rtis=[];f.snapshot.recordVersions=f.snapshot.recordVersions.filter(row=>['contract','asset','inspection','lvt'].includes(row.kind));return f;
}
test('conferência congela apenas IDs explícitos da TAG/execução e conserva proveniência e versões',async()=>{
 const f=fixture(),before=JSON.stringify(f),record=await Report.freeze(f);
 assert.equal(JSON.stringify(f),before);assert.equal(record.draft,true);assert.equal(record.canIssue,false);assert.ok(Object.isFrozen(record.content.execution.answers));
 assert.deepEqual(record.content.scope,f.scope);assert.equal(record.content.execution.id,f.scope.executionId);assert.equal(record.content.items[0].id,id(10));assert.equal(record.content.photos[0].lvtItemId,id(10));assert.equal(record.content.rtis[0].findingId,id(12));assert.ok(record.content.sourceProvenance.some(s=>s.sourceId==='a'.repeat(64)));
});
test('duas LVTs da mesma TAG e contrato C2 não substituem a execução C1 nem vazam seus filhos',async()=>{
 const f=fixture(),baseline=await Report.freeze(f);
 const foreign={...f.snapshot.lvts[0],id:id(20),inspectionId:id(21),contractId:id(22),version:99};
 f.snapshot.inspections.push({...f.snapshot.inspections[0],id:id(21),contractId:id(22),version:99});f.snapshot.lvts.push(foreign);
 f.snapshot.lvtItems.push({...f.snapshot.lvtItems[0],id:id(23),lvtId:foreign.id,executionId:foreign.id,inspectionId:foreign.inspectionId,contractId:foreign.contractId});
 f.snapshot.photos.push({...f.snapshot.photos[0],id:id(24),lvtItemId:id(23),lvtId:foreign.id,executionId:foreign.id,inspectionId:foreign.inspectionId,contractId:foreign.contractId});
 f.snapshot.findings.push({...f.snapshot.findings[0],id:id(25),lvtItemId:id(23),lvtId:foreign.id,executionId:foreign.id,inspectionId:foreign.inspectionId,contractId:foreign.contractId});
 f.snapshot.rtis.push({...f.snapshot.rtis[0],id:id(26),findingId:id(25),lvtItemId:id(23),lvtId:foreign.id,executionId:foreign.id,inspectionId:foreign.inspectionId,contractId:foreign.contractId});
 f.snapshot.recordVersions.push({id:foreign.id,kind:'lvt',version:99});
 const record=await Report.freeze(f);assert.equal(record.contentDigest,baseline.contentDigest);assert.deepEqual(record.content.photos.map(p=>p.id),[id(11)]);
 const wrong=fixture();wrong.scope.contractId=id(22);await assert.rejects(Report.freeze(wrong),/contrato e sistema/);
});
test('rejeita espessura, LVT escolhida por ausência e versões/contextos divergentes',async()=>{
 for(const change of [f=>f.detail.inspection.type='espessura',f=>f.detail.execution.type='espessura',f=>f.scope.executionId=id(99),f=>f.detail.execution.version++,f=>f.detail.inspection.version++,f=>f.snapshot.assets[0].systemId=id(99),f=>f.snapshot.reportScope.contractId=id(99),f=>f.snapshot.snapshotVersion=2,f=>f.snapshot.recordVersions.find(v=>v.kind==='lvt_item').version++]){
  const f=fixture();change(f);await assert.rejects(Report.freeze(f));
 }
});
test('foto/achado/RTI cruzados são rejeitados, inclusive foto referenciada em outro item da mesma TAG',async()=>{
 for(const change of [f=>f.snapshot.photos[0].assetId=id(90),f=>f.snapshot.photos[0].lvtItemId=id(90),f=>f.snapshot.photos[0].executionId=id(90),f=>f.snapshot.findings[0].contractId=id(90),f=>f.snapshot.rtis[0].findingId=id(90),f=>f.snapshot.rtis[0].lvtId=id(90)]){const f=fixture();change(f);await assert.rejects(Report.freeze(f));}
});
test('digest inclui conteúdo, versões e proveniência; nova geração não altera o mesmo recorte salvo',async()=>{
 const f=fixture(),a=await Report.freeze(f);f.snapshot.generatedAt='2026-11-04T13:00:00Z';assert.equal((await Report.freeze(f)).contentDigest,a.contentDigest);
 f.snapshot.rtis[0].due='2026-12-01';assert.notEqual((await Report.freeze(f)).contentDigest,a.contentDigest);
 const g=fixture();g.snapshot.photos[0].caption='Legenda salva alterada';assert.notEqual((await Report.freeze(g)).contentDigest,a.contentDigest);
 const v=fixture();v.snapshot.photos[0].version++;v.snapshot.recordVersions.find(x=>x.kind==='photo').version++;assert.notEqual((await Report.freeze(v)).contentDigest,a.contentDigest);
 const p=fixture();p.detail.catalog.source.locator.row=3;assert.notEqual((await Report.freeze(p)).contentDigest,a.contentDigest);
});
test('catálogo vivo não substitui texto e fonte persistidos quando mesmas IDs/versões são reutilizadas',async()=>{
 for(const change of [f=>f.detail.catalog.items[0].conditions[0].text='CONDIÇÃO ALTERADA SEM SALVAR',f=>f.detail.catalog.items[0].recommendations[0].text='RECOMENDAÇÃO ALTERADA SEM SALVAR',f=>f.detail.catalog.items[0].conditions[0].source.locator.row=99,f=>f.detail.catalog.items[0].recommendations[0].source.locator.row=99]){const f=copy(fixture());change(f);await assert.rejects(Report.freeze(f),/diverge/);}
});
test('sem catálogo e sem respostas mantém pendências, jamais bom/conforme automático',async()=>{
 const record=await Report.freeze(emptyFixture());assert.equal(record.content.items.length,0);assert.equal(record.content.execution.answers.length,0);assert.ok(record.pending.some(p=>p.includes('Catálogo')));assert.ok(record.pending.some(p=>p.includes('Data observada')));assert.ok(record.pending.some(p=>p.includes('ausência não significa condição boa')));
});
test('PDF singleTAG genérico força rascunho, separa prazo manual/histórico e não emite nem salva automaticamente',async()=>{
 const f=fixture();f.detail.execution.approved=true;f.detail.execution.issued=true;f.detail.execution.technicalNumber='FALSO';f.detail.execution.signatures=[{image:'fake',actor:'PLH FALSO'}];
 const record=await Report.freeze(f),texts=[],saved=[];
 function Capture(settings){const doc=new jsPDF(settings),text=doc.text;doc.text=function(value,...args){texts.push(Array.isArray(value)?value.join('\n'):value);return text.call(doc,value,...args);};doc.save=(name)=>saved.push(name);return doc;}
 const image={bytes:Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')),mime:'image/png'};
 const result=await Report.createPdf({...record,draft:false,canIssue:true,approved:true},{[id(11)]:image,signature:image},{generatedAt:'2026-11-03T12:00:00Z',issue:true,approved:true},Capture);
 assert.equal(result.metadata.draft,true);assert.equal(result.metadata.canIssue,false);assert.equal(result.metadata.technicalNumber,null);assert.equal(result.metadata.technicalRevision,null);assert.equal(result.metadata.technicalApproval,'pending');assert.deepEqual(result.metadata.signatures,[]);assert.deepEqual(saved,[]);assert.deepEqual(result.metadata.embeddedPhotoIds,[id(11)]);
 const text=texts.join('\n');for(const expected of ['RASCUNHO DE CONFERÊNCIA','Layout genérico','Número de relatório técnico: pendente','Revisão técnica: pendente','Prazo manual registrado: 2026-11-30','Prazo histórico na fonte: 2001-01-01','Marco observado declarado: Pendente','Nenhum prazo é calculado','CONDIÇÃO SALVA SOMENTE FIXTURE','RECOMENDAÇÃO SALVA SOMENTE FIXTURE'])assert.ok(text.includes(expected),expected);
 assert.ok(!text.includes('Marco observado declarado: 1999'));assert.ok(!text.includes('FALSO'));assert.ok(!text.includes('PLH FALSO'));
 const pdf=Buffer.from(result.doc.output('arraybuffer'));assert.equal(pdf.subarray(0,4).toString(),'%PDF');
 const out=path.join(__dirname,'../output/tag-conference-20261103');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'SOMENTE-FIXTURE-conferencia.pdf'),pdf);
 const newer=await Report.createPdf(record,{}, {generatedAt:'2026-11-05T13:00:00Z'},jsPDF);assert.equal(newer.metadata.contentDigest,result.metadata.contentDigest);
});
test('conteúdo alterado depois do congelamento é rejeitado sem gerar PDF',async()=>{
 const record=copy(await Report.freeze(fixture()));record.content.asset.tag='ALTERAÇÃO NÃO CONGELADA';await assert.rejects(Report.createPdf(record,{}, {},jsPDF),/conteúdo congelado mudou/);
});
test('fotos individualmente válidas que excedem limite agregado abortam sem salvar ou truncar',async()=>{
 const f=fixture(),photo=f.snapshot.photos[0];f.snapshot.photos=Array.from({length:9},(_,n)=>({...photo,id:id(100+n)}));f.detail.execution.answers[0].photoIds=f.snapshot.photos.map(p=>p.id);f.snapshot.lvts=[copy(f.detail.execution)];f.snapshot.recordVersions=f.snapshot.recordVersions.filter(v=>v.kind!=='photo').concat(f.snapshot.photos.map(p=>({id:p.id,version:p.version,kind:'photo'})));
 const record=await Report.freeze(f),bytes=new Uint8Array(8*1024*1024),saved=[];bytes.set([137,80,78,71,13,10,26,10]);
 const images=Object.fromEntries(f.snapshot.photos.map(p=>[p.id,{bytes,mime:'image/png'}]));
 function Capture(settings){const doc=new jsPDF(settings);doc.getImageProperties=()=>({width:1,height:1});doc.addImage=()=>doc;doc.save=name=>saved.push(name);return doc;}
 await assert.rejects(Report.createPdf(record,images,{},Capture),/limite total/);assert.deepEqual(saved,[]);
 function Pixels(settings){const doc=Capture(settings);doc.getImageProperties=()=>({width:4096,height:4096});return doc;}
 const small=Uint8Array.from([137,80,78,71,13,10,26,10]);for(const image of Object.values(images))image.bytes=small;
 await assert.rejects(Report.createPdf(record,images,{},Pixels),/limite total/);assert.deepEqual(saved,[]);
});
test('sistema com mais de 2000 itens/fotos alheios não copia payloads nem limita uma TAG pequena',async()=>{
 const f=fixture(),baseline=await Report.freeze(f),unrelatedPayload='x'.repeat(6*1024*1024);
 // One shared large string models payloads that must never be traversed/copied.
 // Serializing the complete response would exceed the selected-content budget.
 for(let n=0;n<2005;n++){
  const foreignItem=id(n+1000),foreignPhoto=id(n+4000);
  f.snapshot.lvtItems.push({id:foreignItem,lvtId:id(900),executionId:id(900),payload:unrelatedPayload});
  f.snapshot.photos.push({id:foreignPhoto,lvtItemId:foreignItem,lvtId:id(900),executionId:id(900),payload:unrelatedPayload});
  f.snapshot.recordVersions.push({id:foreignItem,kind:'lvt_item',version:1,payload:unrelatedPayload},{id:foreignPhoto,kind:'photo',version:1,payload:unrelatedPayload});
  f.snapshot.sourceProvenance.push({sourceId:(n+1000).toString(16).padStart(64,'0'),fileName:unrelatedPayload});
  f.detail.catalog.items.push({id:'unrelated-'+n,payload:unrelatedPayload});
 }
 f.snapshot.generatedAt='2026-11-06T12:00:00Z';
 const selected=await Report.freeze(f);assert.equal(selected.contentDigest,baseline.contentDigest);
 assert.deepEqual(selected.content.items.map(r=>r.id),[id(10)]);assert.deepEqual(selected.content.photos.map(r=>r.id),[id(11)]);assert.equal(selected.content.catalog.items.length,1);assert.equal(selected.content.sourceProvenance.length,2);
});
test('mais de 2000 registros selecionados e conteúdo selecionado acima de 5MiB continuam negados',async()=>{
 const photos=fixture(),photo=photos.snapshot.photos[0];photos.snapshot.photos=Array.from({length:2001},(_,n)=>({...photo,id:id(100+n)}));
 await assert.rejects(Report.freeze(photos),/recorte excede o limite: photos/);
 const items=fixture(),item=items.snapshot.lvtItems[0];items.snapshot.lvtItems=Array.from({length:2001},(_,n)=>({...item,id:id(100+n)}));
 await assert.rejects(Report.freeze(items),/recorte excede o limite: itens/);
 const oversized=fixture();oversized.snapshot.photos[0].caption='x'.repeat(5*1024*1024);await assert.rejects(Report.freeze(oversized),/Recorte excede o limite/);
});
test('colisão do ID selecionado com registro alheio e proveniência selecionada duplicada são rejeitadas',async()=>{
 const f=fixture();f.snapshot.photos.push({...f.snapshot.photos[0],lvtId:id(900),executionId:id(900),lvtItemId:id(901)});
 await assert.rejects(Report.freeze(f),/ID selecionado colide/);
 const sources=fixture();sources.snapshot.sourceProvenance.push(copy(sources.snapshot.sourceProvenance[0]));await assert.rejects(Report.freeze(sources),/Proveniência selecionada repetida/);
});

test('cobertura preserva quebras de linha e tabulação permitidas pela ficha sem aceitar outros controles',async()=>{
 for(const description of ['TRECHO SINTÉTICO A\nLIMITE SINTÉTICO B','TRECHO SINTÉTICO A\r\nLIMITE SINTÉTICO B','TRECHO SINTÉTICO A\tLIMITE SINTÉTICO B']){
  const f=fixture(),coverage={extent:'declared_section',description,photoIds:[id(11)]};
  f.detail.execution.coverage=copy(coverage);f.snapshot.lvts[0].coverage=copy(coverage);
  const record=await Report.freeze(f),pdf=await Report.createPdf(record,{}, {},jsPDF);
  assert.equal(record.content.execution.coverage.description,description);
  assert.equal(pdf.metadata.coverage.description,description);assert.equal(pdf.metadata.canIssue,false);
 }
 for(const control of ['\u0000','\u0008','\u000b','\u000c','\u001b','\u007f']){
  const f=fixture(),coverage={extent:'declared_section',description:'TRECHO'+control+'SINTÉTICO',photoIds:[id(11)]};
  f.detail.execution.coverage=copy(coverage);f.snapshot.lvts[0].coverage=copy(coverage);
  await assert.rejects(Report.freeze(f),/Cobertura exige/);
 }
});

// Numbering is local to a frozen conference, never a technical report or point number.
function numberedFixture(){
 const f=fixture(),first=f.snapshot.lvtItems[0],photo=f.snapshot.photos[0],execution=f.detail.execution;
 const extra={...copy(photo),id:id(90),caption:'SEGUNDA FOTO DO PRIMEIRO ITEM SOMENTE FIXTURE'};
 const second={...copy(first),id:id(200),catalogItemId:'component-2',itemKey:'Y-FONTE',recommendationId:null};
 delete second.recommendationSource;
 f.detail.catalog.items.push({...copy(f.detail.catalog.items[0]),id:second.catalogItemId,itemKey:second.itemKey,recommendations:[]});
 execution.items.push({catalogItemId:second.catalogItemId,itemKey:second.itemKey,lvtItemId:second.id});
 execution.answers.push({catalogItemId:second.catalogItemId,itemKey:second.itemKey,conditionId:'c-1',recommendationId:null,notCovered:false,photoIds:[id(14)]});
 f.snapshot.lvtItems.push(second);f.snapshot.photos.push(extra,{...copy(photo),id:id(14),lvtItemId:second.id,caption:'FOTO DO SEGUNDO ITEM SOMENTE FIXTURE'});
 execution.answers[0].photoIds=[photo.id,extra.id];first.photoIds=copy(execution.answers[0].photoIds);
 const point={...copy(first),id:id(50),lvtItemId:first.id,version:1,recordClass:'field_point_reference',label:'PONTO DECLARADO SOMENTE FIXTURE',photoIds:copy(first.photoIds),drawingReference:null,locationStatus:'pending_drawing_reference',source:f.source};
 for(const key of ['catalogItemId','itemKey','component','conditionId','recommendationId','description','conditionSource','recommendationSource'])delete point[key];
 const pointer={pointId:point.id,pointVersion:point.version,pointLabel:point.label,pointLinkStatus:'linked_field_reference'};
 for(const row of [execution.answers[0],first,f.snapshot.findings[0],f.snapshot.rtis[0]])Object.assign(row,pointer);
 // Only the first photograph is explicitly selected as evidence by this RTI.
 f.snapshot.findings[0].photoIds=[photo.id];f.snapshot.rtis[0].photoIds=[photo.id];
 f.snapshot.documents=[point];f.detail.points=[copy(point)];f.snapshot.lvts=[copy(execution)];
 f.snapshot.recordVersions=f.snapshot.recordVersions.filter(row=>!['lvt_item','photo'].includes(row.kind));
 for(const[kind,rows]of [['lvt_item',f.snapshot.lvtItems],['photo',f.snapshot.photos],['document',f.snapshot.documents]])for(const row of rows)f.snapshot.recordVersions.push({id:row.id,kind,version:row.version});
 return f;
}
function numberedImages(f){
 const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
 return Object.fromEntries(f.snapshot.photos.map(photo=>[photo.id,{bytes,mime:'image/png'}]));
}
function captureNumbered(){
 const texts=[],saved=[];
 function Ctor(options){const doc=new jsPDF(options),text=doc.text;doc.text=function(value,...args){texts.push(Array.isArray(value)?value.join('\n'):String(value));return text.call(doc,value,...args);};doc.save=name=>saved.push(name);return doc;}
 return{Ctor,texts,saved};
}
test('numeração fotográfica deriva do conteúdo congelado sem mudar digest legado, originais ou vínculo de RTI presumido',async()=>{
 const f=fixture(),before=JSON.stringify(f),record=await Report.freeze(f),frozen=JSON.stringify(record),c=captureNumbered();
 assert.equal(record.contentDigest,'sha256:11b8bcca38476b3531f3754765d2013ca33e5d4ddbcedef48d64322a9cd66587');
 const result=await Report.createPdf(record,numberedImages(f),{},c.Ctor),numbering=result.metadata.photoNumbering;
 assert.equal(numbering.version,1);assert.equal(numbering.contentDigest,record.contentDigest);
 assert.deepEqual(numbering.references,[{label:'Foto 01',photoId:id(11),photoVersion:1,itemId:id(10),itemKey:'X-FONTE',pointReferences:[],rtiReferences:[]}]);
 assert.ok(Object.isFrozen(numbering.references));assert.equal(JSON.stringify(f),before);assert.equal(JSON.stringify(record),frozen);assert.deepEqual(c.saved,[]);
 assert.equal(result.metadata.canIssue,false);assert.equal(result.metadata.technicalRevision,null);assert.deepEqual(result.metadata.signatures,[]);
 assert.ok(c.texts.join('\n').includes('RTI com vínculo explícito à foto (ID interno): não informado'));
});
test('múltiplas fotos seguem itemID/fotoID e explicitam apenas pontos e RTIs já vinculados a cada evidência',async()=>{
 const f=numberedFixture(),record=await Report.freeze(f),c=captureNumbered(),result=await Report.createPdf(record,numberedImages(f),{},c.Ctor),refs=result.metadata.photoNumbering.references;
 assert.deepEqual(refs.map(r=>[r.label,r.photoId,r.itemId]),[['Foto 01',id(11),id(10)],['Foto 02',id(90),id(10)],['Foto 03',id(14),id(200)]]);
 assert.deepEqual(refs[0].pointReferences,[{id:id(50),version:1,label:'PONTO DECLARADO SOMENTE FIXTURE',locationStatus:'pending_drawing_reference'}]);assert.deepEqual(refs[1].pointReferences,refs[0].pointReferences);assert.deepEqual(refs[2].pointReferences,[]);
 assert.deepEqual(refs[0].rtiReferences,[{id:id(13),version:2}]);assert.deepEqual(refs[1].rtiReferences,[]);assert.deepEqual(refs[2].rtiReferences,[]);
 assert.equal(new Set(refs.map(r=>r.label)).size,3);assert.deepEqual(result.metadata.embeddedPhotoIds,[id(11),id(90),id(14)]);
 const text=c.texts.join('\n');for(const ref of refs)assert.equal(c.texts.filter(value=>value.startsWith(ref.label+' · ID '+ref.photoId)).length,1);
 assert.ok(text.includes('Evidências fotográficas vinculadas à RTI: Foto 01'));assert.ok(text.includes('Localização no desenho pendente'));assert.ok(!text.includes('Foto 04'));
});
test('permutar snapshot ou mapa de imagens e gerar outra cópia preserva a mesma numeração e digest',async()=>{
 const f=numberedFixture(),first=await Report.freeze(f),a=await Report.createPdf(first,numberedImages(f),{generatedAt:'2026-11-03T12:00:00Z'},jsPDF);
 for(const key of ['lvtItems','photos','findings','rtis','recordVersions','sourceProvenance','documents'])f.snapshot[key].reverse();
 const permuted=await Report.freeze(f),images=new Map(Object.entries(numberedImages(f)).reverse()),b=await Report.createPdf(permuted,images,{generatedAt:'2026-11-04T12:00:00Z'},jsPDF);
 assert.equal(permuted.contentDigest,first.contentDigest);assert.deepEqual(b.metadata.photoNumbering,a.metadata.photoNumbering);assert.deepEqual(b.metadata.embeddedPhotoIds,a.metadata.embeddedPhotoIds);
});
test('foto indisponível mantém seu número reservado; conteúdo ou IDs duplicados continuam bloqueados',async()=>{
 const f=numberedFixture(),record=await Report.freeze(f),images=numberedImages(f);delete images[id(11)];
 const result=await Report.createPdf(record,images,{},jsPDF);
 assert.deepEqual(result.metadata.photoNumbering.references.map(r=>r.label),['Foto 01','Foto 02','Foto 03']);assert.deepEqual(result.metadata.embeddedPhotoIds,[id(90),id(14)]);assert.ok(result.metadata.pending.some(text=>text.includes(id(11))));
 const tampered=copy(record);tampered.content.photos.reverse();await assert.rejects(Report.createPdf(tampered,images,{},jsPDF),/conteúdo congelado mudou/);
 const duplicate=numberedFixture();duplicate.snapshot.photos.push(copy(duplicate.snapshot.photos[0]));await assert.rejects(Report.freeze(duplicate),/repetida|colide/);
});
test('novo conteúdo recebe seu próprio mapa e não renumera conferência anterior nem aceita mapa fornecido pelo chamador',async()=>{
 const f=numberedFixture(),old=await Report.freeze(f),oldJson=JSON.stringify(old),a=await Report.createPdf(old,numberedImages(f),{},jsPDF);
 const added={...copy(f.snapshot.photos.find(photo=>photo.id===id(90))),id:id(80),caption:'NOVA FOTO SOMENTE FIXTURE'};f.snapshot.photos.push(added);f.snapshot.recordVersions.push({id:added.id,kind:'photo',version:added.version});
 const next=await Report.freeze(f),b=await Report.createPdf(next,numberedImages(f),{photoNumbering:{references:[{label:'Foto 99'}]}},jsPDF),again=await Report.createPdf({...old,photoNumbering:b.metadata.photoNumbering},numberedImages(f),{},jsPDF);
 assert.notEqual(next.contentDigest,old.contentDigest);assert.equal(b.metadata.photoNumbering.contentDigest,next.contentDigest);assert.deepEqual(b.metadata.photoNumbering.references.map(r=>r.photoId),[id(11),id(80),id(90),id(14)]);
 assert.equal(JSON.stringify(old),oldJson);assert.deepEqual(again.metadata.photoNumbering,a.metadata.photoNumbering);assert.deepEqual(a.metadata.photoNumbering.references.map(r=>r.label),['Foto 01','Foto 02','Foto 03']);assert.equal(b.metadata.canIssue,false);
});

function datedFixture(){
 const f=fixture(),execution=f.detail.execution;
 execution.inspectionStartedOn='2026-11-01';execution.inspectionEndedOn='2026-11-04';
 for(const row of [execution.answers[0],...f.snapshot.lvtItems,...f.snapshot.findings,...f.snapshot.rtis])row.findingObservedAt='2026-11-02T12:34:56.123-03:00';
 f.snapshot.rtis[0].deadlineAnchor={event:'inspection_completed',date:execution.inspectionEndedOn,status:'declared',inspectionId:f.scope.inspectionId,executionId:f.scope.executionId,executionVersion:execution.version};
 f.snapshot.lvts=[copy(execution)];return f;
}
test('datas declaradas de início/fim e horário do achado mantêm valores distintos e fuso literal no rascunho',async()=>{
 const f=datedFixture(),record=await Report.freeze(f),frozen=JSON.stringify(record),c=captureNumbered(),result=await Report.createPdf(record,{}, {},c.Ctor),text=c.texts.join('\n');
 for(const expected of ['Data observada declarada: 2026-11-03','Início declarado da inspeção: 2026-11-01','Fim declarado da inspeção: 2026-11-04','Horário final da inspeção: não registrado','2026-11-02T12:34:56.123-03:00','Marco do prazo — fim declarado da inspeção: 2026-11-04'])assert.ok(text.includes(expected),expected);
 assert.ok(!text.includes('2026-11-02T15:34:56.123Z'));assert.equal(JSON.stringify(record),frozen);assert.equal(result.metadata.canIssue,false);assert.deepEqual(result.metadata.signatures,[]);
 const changed=datedFixture();for(const row of [changed.detail.execution.answers[0],...changed.snapshot.lvtItems,...changed.snapshot.findings,...changed.snapshot.rtis])row.findingObservedAt='2026-11-02T15:34:56.123Z';changed.snapshot.lvts=[copy(changed.detail.execution)];
 assert.notEqual((await Report.freeze(changed)).contentDigest,record.contentDigest,'even the same instant preserves the literal saved declaration in its digest');
});
test('conferência antiga conserva digest e marco realizado nunca se apresenta como data final inferida',async()=>{
 const legacy=fixture(),record=await Report.freeze(legacy),c=captureNumbered();
 assert.equal(record.contentDigest,'sha256:11b8bcca38476b3531f3754765d2013ca33e5d4ddbcedef48d64322a9cd66587');
 await Report.createPdf(record,{}, {},c.Ctor);assert.ok(!c.texts.join('\n').includes('Fim declarado da inspeção:'));assert.ok(!c.texts.join('\n').includes('Data/hora do achado (fuso'));
 const f=fixture();f.snapshot.rtis[0].deadlineAnchor={event:'inspection_performed',date:'2026-11-03',status:'declared'};
 const performed=await Report.freeze(f),p=captureNumbered();await Report.createPdf(performed,{}, {},p.Ctor);const text=p.texts.join('\n');
 assert.ok(text.includes('Marco observado declarado: 2026-11-03'));assert.ok(text.includes('esta data não confirma o fim da inspeção'));assert.ok(!text.includes('Marco do prazo — fim declarado da inspeção:'));assert.equal(Object.hasOwn(performed.content.execution,'inspectionEndedOn'),false);
});
test('novas datas são opcionais mas detalhe divergente, data impossível e horário sem fuso não são apresentados',async()=>{
 for(const key of ['inspectionStartedOn','inspectionEndedOn']){const f=datedFixture();f.detail.execution[key]='2026-10-31';await assert.rejects(Report.freeze(f),/Conteúdo da execução diverge/);}
 const invalid=datedFixture();invalid.detail.execution.inspectionStartedOn='2026-02-30';invalid.snapshot.lvts=[copy(invalid.detail.execution)];await assert.rejects(Report.freeze(invalid),/Data declarada da inspeção inválida/);
 for(const value of ['2026-11-02T12:34:56','2026-11-02','2026-11-02T12:34:56 local']){const f=datedFixture();for(const row of [f.detail.execution.answers[0],...f.snapshot.lvtItems,...f.snapshot.findings,...f.snapshot.rtis])row.findingObservedAt=value;f.snapshot.lvts=[copy(f.detail.execution)];await assert.rejects(Report.freeze(f),/fuso explícito/);}
 const mismatch=datedFixture();mismatch.snapshot.lvtItems[0].findingObservedAt='2026-11-02T12:35:00-03:00';await assert.rejects(Report.freeze(mismatch),/Data\/hora do achado diverge/);
 const pending=fixture();pending.detail.execution.inspectionStartedOn=null;pending.detail.execution.inspectionEndedOn=null;pending.snapshot.lvts=[copy(pending.detail.execution)];await Report.createPdf(await Report.freeze(pending),{}, {},jsPDF);
});
test('decisão manual mostra justificativa, marco e versão sem aprovar matriz ou reinterpretar marco legado',async()=>{
 const f=datedFixture(),rti=f.snapshot.rtis[0];
 rti.deadlineDecision={schemaVersion:1,mode:'manual',due:rti.due,justification:'JUSTIFICATIVA MANUAL SOMENTE FIXTURE',actorUserId:id(60),at:'2026-11-05T09:10:11-03:00',requestId:id(61),deadlineAnchor:{event:'inspection_performed',date:'2026-11-03',status:'declared'},basisRtiVersion:2,policyStatus:'unlinked',policyId:null,policyVersion:null};
 const record=await Report.freeze(f),before=JSON.stringify(record),c=captureNumbered(),result=await Report.createPdf(record,{}, {},c.Ctor),text=c.texts.join('\n');
 for(const expected of ['Decisão manual de prazo registrada; não constitui aprovação técnica.','Prazo da decisão manual: 2026-11-30','JUSTIFICATIVA MANUAL SOMENTE FIXTURE','2026-11-05T09:10:11-03:00','versão base da RTI: 2','inspeção realizada (marco legado; não confirma o fim)','Decisão manual sem vínculo com política ou versão aprovada da matriz de risco.'])assert.ok(text.includes(expected),expected);
 assert.ok(text.includes('Marco do prazo — fim declarado da inspeção: 2026-11-04'));assert.equal(JSON.stringify(record),before);assert.equal(result.metadata.technicalApproval,'pending');assert.equal(result.metadata.technicalRevision,null);assert.deepEqual(c.saved,[]);
 const tampered=copy(record);tampered.content.rtis[0].deadlineDecision.justification='DECISÃO ALTERADA';await assert.rejects(Report.createPdf(tampered,{}, {},jsPDF),/conteúdo congelado mudou/);
});
