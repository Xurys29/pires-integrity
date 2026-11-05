'use strict';
// Small synthetic JSON records only. No accounts, originals, real inspection,
// drawing location, database, signature, technical decision or notification.
const {test}=require('node:test'),assert=require('node:assert/strict');
const TagReport=require('../app/gestao-tag-report.js'),Drawing=require('../lib/inspection-drawing-model.cjs');
const Packet=require('../lib/inspection-review-packet.cjs');
const id=n=>'e0000000-0000-4000-8000-'+String(n).padStart(12,'0');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const scope={ownerId:id(1),contractId:id(2),systemId:id(3),assetId:id(4),inspectionId:id(5),executionId:id(6)},campaignId=id(7),person=id(8),catalogId=id(9),itemId=id(10),photoId=id(11),findingId=id(12),rtiId=id(13);
 const source={sourceId:'a'.repeat(64),fileHash:'a'.repeat(64),fileName:'CATALOGO-SOMENTE-FIXTURE.xlsx',locator:{sheet:'SOMENTE FIXTURE',row:2}};
 const related={ownerId:scope.ownerId,contractId:scope.contractId,systemId:scope.systemId,assetId:scope.assetId,inspectionId:scope.inspectionId,executionId:scope.executionId,campaignId,module:'integridade'};
 const company={id:scope.ownerId,name:'CLIENTE SOMENTE FIXTURE'},contract={id:scope.contractId,name:'CONTRATO SOMENTE FIXTURE',modules:['integridade'],assetIds:[scope.assetId],version:2},system={id:scope.systemId,name:'SISTEMA SOMENTE FIXTURE',version:1},asset={id:scope.assetId,systemId:scope.systemId,lineId:id(40),tag:'TAG-SOMENTE-FIXTURE',type:'linha',version:1};
 const inspection={...related,id:scope.inspectionId,type:'visual',assigneeProfessionalId:person,version:4};
 const execution={...related,id:scope.executionId,recordClass:'field_lvt',executionVersion:1,type:'visual',status:'rascunho',version:3,observedOn:'2026-11-03',inspector:'RESPONSÁVEL SOMENTE FIXTURE',inspectorProfessionalId:person,catalogId,items:[{catalogItemId:'component-synthetic',itemKey:'1-FIXTURE',lvtItemId:itemId}],answers:[{catalogItemId:'component-synthetic',itemKey:'1-FIXTURE',conditionId:'condition-synthetic',recommendationId:'recommendation-synthetic',notCovered:false,photoIds:[photoId]}]};
 const catalog={id:catalogId,status:'verified',source,items:[{id:'component-synthetic',itemKey:'1-FIXTURE',component:'COMPONENTE SOMENTE FIXTURE',conditions:[{id:'condition-synthetic',text:'CONDIÇÃO SOMENTE FIXTURE',source}],recommendations:[{id:'recommendation-synthetic',text:'RECOMENDAÇÃO SOMENTE FIXTURE',conditionIds:['condition-synthetic'],source}]}]};
 const item={...related,id:itemId,lvtId:execution.id,version:2,catalogItemId:'component-synthetic',itemKey:'1-FIXTURE',component:'COMPONENTE SOMENTE FIXTURE',conditionId:'condition-synthetic',recommendationId:'recommendation-synthetic',description:catalog.items[0].conditions[0].text,conditionSource:source,recommendationSource:source};
 const photo={...related,id:photoId,lvtId:execution.id,lvtItemId:itemId,version:1,caption:'FOTO SOMENTE FIXTURE',source:{sourceId:'b'.repeat(64),fileHash:'b'.repeat(64),fileName:'FOTO-SOMENTE-FIXTURE.png',locator:{section:'Item 1-FIXTURE'}}};
 const finding={...related,id:findingId,lvtId:execution.id,lvtItemId:itemId,version:1,recommendationId:'recommendation-synthetic',recommendation:catalog.items[0].recommendations[0].text,recommendationSource:source};
 const rti={...finding,id:rtiId,findingId,due:'2027-02-01',issuedNumber:'NUMERO-HISTORICO-SOMENTE-FIXTURE',sourceDue:'2001-01-01',deadlineAnchor:{event:'inspection_performed',date:'2026-11-03',status:'declared',inspectionId:inspection.id,executionId:execution.id,executionVersion:execution.version},deadlineReviewRequired:true,photoIds:[photoId],status:'aberta',currentness:'unknown',version:2};
 const snapshot={snapshotVersion:1,generatedAt:'2026-11-03T10:00:00Z',reportScope:{mode:'contract_system',ownerId:scope.ownerId,contractId:scope.contractId,systemId:scope.systemId},company,contract,system,assets:[asset],inspections:[clone(inspection)],lvts:[clone(execution)],lvtItems:[item],photos:[photo],findings:[finding],rtis:[rti],sourceProvenance:[source,photo.source],recordVersions:[]};
 for(const[kind,rows]of [['contract',[contract]],['asset',[asset]],['inspection',snapshot.inspections],['lvt',snapshot.lvts],['lvt_item',snapshot.lvtItems],['photo',snapshot.photos],['finding',snapshot.findings],['rti',snapshot.rtis]])for(const row of rows)snapshot.recordVersions.push({id:row.id,version:row.version,kind});
 return {scope,detail:{inspection,execution,catalog},snapshot};
}
function drawingInput(tag=fixture(),snapshotId=id(70)){
 const s=tag.scope,scope={ownerId:s.ownerId,contractId:s.contractId,systemId:s.systemId,assetId:s.assetId,lineId:tag.snapshot.assets[0].lineId};
 return {snapshotId,scope,drawing:{documentId:id(71),sourceHash:'c'.repeat(64),number:'DESENHO-SOMENTE-FIXTURE',revision:'FONTE-00',sheet:'1/2'},coordinateFrame:{kind:'normalized_2d',origin:'top_left',xAxis:'right',yAxis:'down'},
  references:{contract:{id:s.contractId,ownerId:s.ownerId,assetIds:[s.assetId]},asset:{id:s.assetId,ownerId:s.ownerId,systemId:s.systemId,lineId:scope.lineId,tag:tag.snapshot.assets[0].tag},line:{id:scope.lineId,ownerId:s.ownerId,systemId:s.systemId,assetId:s.assetId,identifier:'LINHA-DECLARADA-SOMENTE-FIXTURE'},
   items:[{id:id(10),...scope,lvtId:s.executionId,inspectionId:s.inspectionId}],photos:[{id:id(11),...scope,lvtId:s.executionId,lvtItemId:id(10)}],rtis:[{id:id(13),...scope,lvtId:s.executionId,lvtItemId:id(10),photoIds:[id(11)]}]},
  points:[{id:id(72),label:'PONTO SOMENTE FIXTURE',position:{x:0.2,y:0.8},lvtItemId:id(10),photoIds:[id(11)],rtiIds:[id(13)]}],annotations:[],sketches:[]};
}
const prepare=(tagInput,drawingSnapshots=[],previousPacket)=>Packet.prepareReviewPacket({tagInput,drawingSnapshots,...(previousPacket?{previousPacket}:{})});
function changeDue(tag,day){const rti=tag.snapshot.rtis[0];rti.due='2027-02-'+String(day).padStart(2,'0');rti.version++;tag.snapshot.recordVersions.find(row=>row.id===rti.id).version=rti.version;}

test('packet revalidates through original TagReport.freeze and keeps distinct internal IDs with no technical acts',async()=>{
 const input=fixture(),before=clone(input),tag=await TagReport.freeze(input),packet=await prepare(input);
 assert.equal(packet.schema,Packet.SCHEMA);assert.deepEqual(packet.content.tagSnapshot,tag);assert.deepEqual(input,before);assert.deepEqual(packet.content.scope,input.scope);
 assert.equal(packet.lineage.internalRevision,1);assert.equal(packet.previousPacket,null);assert.match(packet.packetId,/^review-packet:[a-f0-9]{64}$/);assert.match(packet.packetDigest,/^sha256:[a-f0-9]{64}$/);
 for(const [key,value]of Object.entries({draft:true,canIssue:false,technicalNumber:null,technicalRevision:null,reviewRequestSent:false,technicalDecision:'pending',identityVerified:false,accessVerified:false,sourceBytesVerified:false,reviewStatus:'prepared_offline'}))assert.equal(packet[key],value,key);
 assert.deepEqual(packet.signatures,[]);assert.equal(packet.content.tagSnapshot.content.rtis[0].issuedNumber,'NUMERO-HISTORICO-SOMENTE-FIXTURE');assert.equal(packet.content.tagSnapshot.content.rtis[0].due,'2027-02-01');
 assert.ok(Object.isFrozen(packet.content.tagSnapshot.content.rtis[0].deadlineAnchor));assert.throws(()=>{packet.content.scope.assetId=id(99);},TypeError);
 assert.deepEqual(await Packet.verifyReviewPacket(packet),packet);assert.deepEqual(Object.keys(Packet).sort(),['SCHEMA','prepareReviewPacket','verifyReviewPacket']);
});

test('generation date changes preserve content and packet identity; a no-op parent creates no new revision',async()=>{
 const input=fixture(),a=await prepare(input);input.snapshot.generatedAt='2036-01-01T10:00:00Z';const b=await prepare(input),same=await prepare(input,[],a);
 assert.equal(b.contentDigest,a.contentDigest);assert.equal(b.packetDigest,a.packetDigest);assert.equal(b.packetId,a.packetId);assert.equal(same.lineage.internalRevision,1);assert.deepEqual(same,a);
});

test('verified drawing references bind exact item/photo/RTI and retain reported source and physical-location limits',async()=>{
 const input=fixture(),drawing=Drawing.createDrawingSnapshot(drawingInput(input)),packet=await prepare(input,[drawing]);
 assert.deepEqual(packet.content.drawingSnapshots[0],Drawing.verifyDrawingSnapshot(drawing));assert.deepEqual(packet.content.drawingSnapshots[0].content.points[0].position,{x:0.2,y:0.8});
 assert.equal(packet.content.drawingSnapshots[0].provenance.originalBytesVerified,false);assert.equal(packet.content.drawingSnapshots[0].provenance.sourceHashStatus,'reported_unverified');assert.equal(packet.content.drawingSnapshots[0].approvedAsBuilt,false);
 assert.deepEqual(await Packet.verifyReviewPacket(packet),packet);
});

test('changed content makes a new internal revision and preserves complete old snapshots without mutation or deadline recalculation',async()=>{
 const input=fixture(),drawing=Drawing.createDrawingSnapshot(drawingInput(input)),previous=await prepare(input,[drawing]),old=JSON.stringify(previous);changeDue(input,2);
 const packet=await prepare(input,[drawing],clone(previous));assert.equal(packet.lineage.internalRevision,2);assert.equal(packet.lineage.seriesId,previous.lineage.seriesId);assert.equal(packet.lineage.previousPacketId,previous.packetId);assert.equal(packet.lineage.previousPacketDigest,previous.packetDigest);
 assert.notEqual(packet.packetId,previous.packetId);assert.notEqual(packet.contentDigest,previous.contentDigest);assert.equal(JSON.stringify(previous),old);assert.equal(JSON.stringify(packet.previousPacket),old);
 assert.equal(packet.previousPacket.content.tagSnapshot.content.rtis[0].due,'2027-02-01');assert.equal(packet.content.tagSnapshot.content.rtis[0].due,'2027-02-02');assert.deepEqual(packet.content.tagSnapshot.content.rtis[0].deadlineAnchor,previous.content.tagSnapshot.content.rtis[0].deadlineAnchor);
 assert.deepEqual(await Packet.verifyReviewPacket(packet),packet);
});

test('drawing revision retains original positions and previous source sheet; explicitly removing a current drawing does not delete history',async()=>{
 const input=fixture(),oldDrawing=Drawing.createDrawingSnapshot(drawingInput(input)),first=await prepare(input,[oldDrawing]),newInput=drawingInput(input,id(73));newInput.drawing.revision='FONTE-01';newInput.drawing.sheet='2/2';newInput.drawing.sourceHash='d'.repeat(64);newInput.points[0].position={x:0.75,y:0.1};
 const revised=Drawing.reviseDrawingSnapshot(oldDrawing,newInput),second=await prepare(input,[revised],first);
 assert.equal(second.content.drawingSnapshots[0].modelRevision,2);assert.deepEqual(second.content.drawingSnapshots[0].previousSnapshot.content.points[0].position,{x:0.2,y:0.8});assert.equal(second.previousPacket.content.drawingSnapshots[0].content.drawing.sheet,'1/2');
 const third=await prepare(input,[],second);assert.equal(third.content.drawingSnapshots.length,0);assert.equal(third.previousPacket.content.drawingSnapshots[0].content.drawing.revision,'FONTE-01');assert.equal(third.previousPacket.previousPacket.packetDigest,first.packetDigest);
});

test('valid drawing model containing another LVT of the same TAG is rejected by the single-execution packet',async()=>{
 const input=fixture(),mixed=drawingInput(input),scope=mixed.scope;
 mixed.references.items.push({id:id(80),...scope,lvtId:id(81),inspectionId:id(82)});mixed.references.photos.push({id:id(83),...scope,lvtId:id(81),lvtItemId:id(80)});
 mixed.points.push({id:id(84),label:'SEGUNDA LVT EXPLÍCITA SOMENTE FIXTURE',position:{x:0.7,y:0.2},lvtItemId:id(80),photoIds:[id(83)],rtiIds:[]});
 const validDrawing=Drawing.createDrawingSnapshot(mixed);assert.equal(validDrawing.content.points.length,2);await assert.rejects(prepare(input,[validDrawing]),/execução visual selecionada/);
 const other=drawingInput(input,id(90));other.references.photos[0].id=id(91);other.references.rtis[0].photoIds=[id(91)];other.points[0].photoIds=[id(91)];
 await assert.rejects(prepare(input,[Drawing.createDrawingSnapshot(other)]),/foto não pertence/);
 const rti=drawingInput(input,id(92));rti.references.rtis[0].photoIds=[];await assert.rejects(prepare(input,[Drawing.createDrawingSnapshot(rti)]),/RTI ou fotos divergem/);
});

test('scope, stale versions, parent content/history tampering and drawing tampering fail before any packet is accepted',async()=>{
 const input=fixture(),drawing=Drawing.createDrawingSnapshot(drawingInput(input)),parent=await prepare(input,[drawing]);
 const stale=fixture();stale.detail.execution.version++;await assert.rejects(prepare(stale),/mudou durante a consulta/);
 const thickness=fixture();for(const row of [thickness.detail.inspection,thickness.detail.execution,thickness.snapshot.inspections[0],thickness.snapshot.lvts[0]])row.type='espessura';
 await assert.rejects(prepare(thickness),/somente a execução visual/);
 const other=fixture();other.scope.contractId=id(99);await assert.rejects(prepare(other),/contrato e sistema/);
 const extraScope=fixture();extraScope.scope.note='METADADO NÃO PODE ALTERAR SÉRIE';await TagReport.freeze(extraScope);await assert.rejects(prepare(extraScope,[],parent),error=>error.code==='invalid_inspection_review_packet');
 for(const mutate of [p=>p.content.tagSnapshot.content.rtis[0].due='2099-01-01',p=>p.lineage.internalRevision=7,p=>p.packetId='review-packet:'+'0'.repeat(64),p=>p.content.drawingSnapshots[0].content.points[0].position.x=0.4]){
  const changed=clone(parent);mutate(changed);await assert.rejects(prepare(input,[drawing],changed));
 }
 const revised=fixture();changeDue(revised,2);const second=await prepare(revised,[drawing],parent),corrupt=clone(second);corrupt.previousPacket.content.tagSnapshot.content.asset.tag='OUTRA TAG';await assert.rejects(Packet.verifyReviewPacket(corrupt));
 const changedDrawing=clone(drawing);changedDrawing.approvedAsBuilt=true;await assert.rejects(prepare(input,[changedDrawing]));
});

test('forged approval, technical identity, signatures, notification and verified-access claims are rejected',async()=>{
 for(const mutate of [f=>f.detail.execution.approved=true,f=>f.snapshot.canIssue=true,f=>f.detail.execution.technicalNumber='NUMERO-FALSO',f=>f.detail.execution.technicalRevision='REV-FALSA',f=>f.detail.execution.signatureStatus='signed',f=>f.detail.execution.signatures=[{image:'imagem-falsa'}],f=>f.detail.execution.inspectorSignatureDataUrl='data:image/png;base64,FAKE',f=>f.snapshot.identityVerified=true,f=>f.snapshot.accessVerified=true,f=>f.snapshot.reviewRequestSent=true]){
  const input=fixture();mutate(input);await assert.rejects(prepare(input),error=>error.code==='invalid_inspection_review_packet');
 }
 const packet=await prepare(fixture());for(const [key,value]of [['technicalDecision','approved'],['signatures',['fake']],['canIssue',true],['reviewRequestSent',true],['identityVerified',true]]){
  const changed=clone(packet);changed[key]=value;await assert.rejects(Packet.verifyReviewPacket(changed),error=>error.code==='invalid_inspection_review_packet');
 }
});

test('no catalogue, date or drawing remains an explicitly pending draft without fabricated good conditions',async()=>{
 const input=fixture();input.detail.catalog={id:null,status:'unavailable',items:[],reason:'ORIGINAL SOMENTE FIXTURE INDISPONÍVEL'};input.detail.execution.catalogId=null;input.detail.execution.items=[];input.detail.execution.answers=[];input.detail.execution.observedOn=null;input.snapshot.lvts=[clone(input.detail.execution)];
 input.snapshot.lvtItems=[];input.snapshot.photos=[];input.snapshot.findings=[];input.snapshot.rtis=[];input.snapshot.recordVersions=input.snapshot.recordVersions.filter(row=>['contract','asset','inspection','lvt'].includes(row.kind));
 const packet=await prepare(input);assert.equal(packet.content.drawingSnapshots.length,0);assert.equal(packet.content.tagSnapshot.content.items.length,0);assert.ok(packet.content.tagSnapshot.pending.some(note=>note.includes('Catálogo')));assert.ok(packet.content.tagSnapshot.pending.some(note=>note.includes('Data observada')));assert.equal(packet.technicalDecision,'pending');assert.equal(packet.reviewRequestSent,false);
});

test('history/byte/drawing limits reject without truncation and accessor inputs are not executed',async()=>{
 const input=fixture();let packet=await prepare(input);for(let day=2;day<=20;day++){changeDue(input,day);packet=await prepare(input,[],packet);}
 assert.equal(packet.lineage.internalRevision,20);changeDue(input,21);await assert.rejects(prepare(input,[],packet),/cadeia excede 20/);assert.equal(packet.lineage.internalRevision,20);
 await assert.rejects(Packet.verifyReviewPacket({oversized:'x'.repeat(16*1024*1024+1)}),/excede|limite/);
 let deep={};for(let i=0;i<100;i++)deep={next:deep};await assert.rejects(Packet.verifyReviewPacket(deep),error=>error.code==='invalid_inspection_review_packet'&&/profundidade JSON/.test(error.message));
 const small=fixture(),drawing=Drawing.createDrawingSnapshot(drawingInput(small));await assert.rejects(prepare(small,Array(33).fill(drawing)),/até 32/);await assert.rejects(prepare(small,[drawing,drawing]),/repetido/);
 let invoked=false;Object.defineProperty(small.snapshot,'approved',{get(){invoked=true;return true;},enumerable:true});await assert.rejects(prepare(small),/acessor/);assert.equal(invoked,false);
 await assert.rejects(Packet.prepareReviewPacket({tagInput:fixture()}),/lista explícita/);
});
