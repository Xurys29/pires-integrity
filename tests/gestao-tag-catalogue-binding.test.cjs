'use strict';
// Synthetic local JSON and image records only. Tokens are deliberately opaque:
// PostgreSQL's JSON hash is not recomputed using JavaScript canonical ordering.
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{jsPDF}=require('jspdf');
const Report=require('../app/gestao-tag-report.js'),Packet=require('../lib/inspection-review-packet.cjs');
const id=n=>'c0000000-0000-4000-8000-'+String(n).padStart(12,'0'),copy=value=>JSON.parse(JSON.stringify(value));
function fixture({pinned=true}={}){
 const scope={ownerId:id(1),contractId:id(2),systemId:id(3),assetId:id(4),inspectionId:id(5),executionId:id(6)},catalogId=id(7),itemId=id(8),personId=id(9),campaignId=id(10),source={sourceId:'a'.repeat(64),fileHash:'a'.repeat(64),fileName:'CATALOGUE-SYNTHETIC-ONLY.pdf',locator:{page:1}};
 const related={...scope,module:'integridade',campaignId},company={id:scope.ownerId,name:'CLIENTE SOMENTE FIXTURE'},contract={id:scope.contractId,name:'CONTRATO SOMENTE FIXTURE',assetIds:[scope.assetId],version:1},system={id:scope.systemId,name:'SISTEMA SOMENTE FIXTURE'},asset={id:scope.assetId,systemId:scope.systemId,type:'linha',tag:'TAG SOMENTE FIXTURE',version:1},inspection={...related,id:scope.inspectionId,type:'visual',assigneeProfessionalId:personId,version:4};
 const definition={id:'ITEM-SYNTHETIC',itemKey:'1',component:'COMPONENTE SOMENTE FIXTURE',conditions:[{id:'CONDITION-SYNTHETIC',text:'CONDIÇÃO SOMENTE FIXTURE',source}],recommendations:[]};
 const execution={...related,id:scope.executionId,version:2,recordClass:'field_lvt',executionVersion:1,type:'visual',status:'rascunho',observedOn:'2026-11-03',inspector:'INSPETOR SOMENTE FIXTURE',inspectorProfessionalId:personId,catalogId,items:[{catalogItemId:definition.id,itemKey:definition.itemKey,lvtItemId:itemId}],answers:[{catalogItemId:definition.id,itemKey:definition.itemKey,conditionId:definition.conditions[0].id,recommendationId:null,notCovered:false,photoIds:[]}]};
 const catalog={id:catalogId,status:'verified',source,verifiedAt:'2026-11-03T10:00:00+00:00',items:[definition,{...copy(definition),id:'UNSELECTED-SYNTHETIC',itemKey:'2'}]};
 const item={...related,id:itemId,lvtId:execution.id,version:1,catalogItemId:definition.id,itemKey:definition.itemKey,component:definition.component,conditionId:definition.conditions[0].id,recommendationId:null,description:definition.conditions[0].text,conditionSource:source};
 const snapshot={snapshotVersion:1,reportScope:{mode:'contract_system',ownerId:scope.ownerId,contractId:scope.contractId,systemId:scope.systemId},company,contract,system,assets:[asset],inspections:[copy(inspection)],lvts:[copy(execution)],lvtItems:[item],photos:[],findings:[],rtis:[],recordVersions:[['contract',contract],['asset',asset],['inspection',inspection],['lvt',execution],['lvt_item',item]].map(([kind,row])=>({kind,id:row.id,version:row.version})),sourceProvenance:[source]},detail={inspection,execution,catalog};
 if(pinned){
  Object.assign(catalog,{tenantId:id(11),ownerId:scope.ownerId,versionLabel:'VERSÃO SOMENTE FIXTURE 1',procedureReference:'PROCEDIMENTO SOMENTE FIXTURE; SEM VALIDADE TÉCNICA',applicability:{inspectionTypes:['visual'],assetTypes:['linha'],contractIds:[scope.contractId],assetIds:[scope.assetId]}});
  detail.catalogBinding={status:'pinned',id:id(12),catalogId,contentHash:'b'.repeat(64),versionLabel:catalog.versionLabel,procedureReference:catalog.procedureReference,selectedAt:'2026-11-03T10:01:00+00:00',selectedBy:personId,selectionVersion:3,scope:{ownerId:scope.ownerId,inspectionId:scope.inspectionId,contractId:scope.contractId,systemId:scope.systemId,assetId:scope.assetId,inspectionType:inspection.type,assetType:asset.type}};
  Object.assign(execution,{catalogBindingId:detail.catalogBinding.id,catalogHash:detail.catalogBinding.contentHash,catalogVersion:detail.catalogBinding.versionLabel});sync(f());
 }
 function f(){return{scope,detail,snapshot};}return f();
}
function sync(f){f.snapshot.lvts=[copy(f.detail.execution)];if(f.detail.catalogBinding)f.snapshot.catalogBindings=[{...copy(f.detail.catalogBinding),catalog:copy(f.detail.catalog)}];return f;}
const input=f=>({tagInput:f,drawingSnapshots:[]});
function canonical(value){return value&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'):JSON.stringify(value);}
const digest=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
function rehashTag(tag){tag.contentDigest=digest({schema:tag.schema,content:tag.content});return tag;}
function rehashPacket(packet){packet.contentDigest=digest({schema:packet.schema,content:packet.content});packet.packetId='review-packet:'+digest({schema:packet.schema,contentDigest:packet.contentDigest,lineage:packet.lineage}).slice(7);const{packetDigest,...body}=packet;packet.packetDigest=digest(body);return packet;}

test('pinned catalogue preserves its full immutable body, SQL token and selection lineage through an actual draft PDF and packet',async()=>{
 const f=fixture(),before=JSON.stringify(f),record=await Report.freeze(f),pdf=await Report.createPdf(record,{}, {},jsPDF),packet=await Packet.prepareReviewPacket(input(f));
 assert.equal(JSON.stringify(f),before);assert.deepEqual(record.content.catalog,f.detail.catalog);assert.equal(record.content.catalog.items.length,2);assert.deepEqual(record.content.catalogBinding,f.detail.catalogBinding);assert.ok(Object.isFrozen(record.content.catalogBinding.scope));assert.ok(Object.isFrozen(record.content.catalog.items));
 assert.equal(pdf.metadata.catalogBinding.contentHash,'b'.repeat(64));assert.equal(pdf.metadata.canIssue,false);assert.equal(Buffer.from(pdf.doc.output('arraybuffer')).subarray(0,4).toString(),'%PDF');assert.deepEqual(pdf.metadata.signatures,[]);assert.deepEqual(await Packet.verifyReviewPacket(packet),packet);assert.equal(packet.identityVerified,false);assert.equal(packet.sourceBytesVerified,false);
});
test('execution pointer changes at the same saved version are rejected against the canonical SQL snapshot',async()=>{
 for(const key of['catalogBindingId','catalogHash','catalogVersion']){
  const f=fixture();f.detail.execution[key]=key==='catalogBindingId'?id(99):'CHANGED';await assert.rejects(Report.freeze(f),/Conteúdo da execução diverge/);
 }
});
test('partial pointers and missing, stale or forged binding metadata cannot claim a pinned catalogue',async()=>{
 for(const mutate of[f=>delete f.detail.execution.catalogHash,f=>delete f.detail.execution.catalogVersion,f=>delete f.detail.catalogBinding,f=>f.detail.catalogBinding.status='verified',f=>f.detail.catalogBinding.contentHash='c'.repeat(64),f=>f.detail.catalogBinding.versionLabel='OUTRA VERSÃO',f=>f.detail.catalogBinding.catalogId=id(99),f=>f.snapshot.catalogBindings=[],f=>f.snapshot.catalogBindings.push(copy(f.snapshot.catalogBindings[0]))]){
  const f=fixture();mutate(f);f.snapshot.lvts=[copy(f.detail.execution)];await assert.rejects(Report.freeze(f));
 }
 const noPointers=fixture({pinned:false});noPointers.detail.catalogBinding=fixture().detail.catalogBinding;await assert.rejects(Report.freeze(noPointers),/sem ponteiros/);
});
test('pinned full snapshot comparison detects changes to unused catalogue choices, source or procedure metadata',async()=>{
 for(const mutate of[f=>f.detail.catalog.items[1].conditions[0].text='CHANGED UNUSED TEXT',f=>f.snapshot.catalogBindings[0].catalog.items[1].component='CHANGED UNUSED COMPONENT',f=>f.detail.catalog.source.locator.page=2,f=>f.detail.catalogBinding.procedureReference='OUTRO PROCEDIMENTO',f=>f.snapshot.catalogBindings[0].selectedAt='2026-11-03T11:00:00+00:00']){
  const f=fixture();mutate(f);await assert.rejects(Report.freeze(f),/snapshot integral do catálogo diverge/);
 }
});
test('pinned snapshot retains all nested metadata and includes it in the local digest without altering the PostgreSQL token',async()=>{
 const f=fixture();f.detail.catalog.items[1].source={generatedAt:'2026-11-03T08:00:00Z',sourceId:'a'.repeat(64)};sync(f);const first=await Report.freeze(f);assert.equal(first.content.catalog.items[1].source.generatedAt,'2026-11-03T08:00:00Z');
 const drift=copy(f);drift.detail.catalog.items[1].source.generatedAt='2026-11-03T09:00:00Z';await assert.rejects(Report.freeze(drift),/snapshot integral do catálogo diverge/);sync(drift);const second=await Report.freeze(drift);assert.notEqual(first.contentDigest,second.contentDigest);assert.equal(first.content.catalogBinding.contentHash,second.content.catalogBinding.contentHash);
 const packet=await Packet.prepareReviewPacket(input(f));assert.deepEqual(await Packet.verifyReviewPacket(packet),packet);await Report.createPdf(first,{}, {},jsPDF);
});
test('mutually matching binding responses still require valid scope, metadata and opaque SQL token format',async()=>{
 for(const mutate of[f=>f.detail.catalogBinding.scope.contractId=id(99),f=>f.detail.catalogBinding.scope.inspectionType='espessura',f=>f.detail.catalogBinding.scope.assetType='vaso',f=>f.detail.catalogBinding.selectionVersion=0,f=>f.detail.catalogBinding.selectionVersion=999,f=>f.detail.catalogBinding.selectedBy='unknown',f=>f.detail.catalogBinding.selectedAt='invalid',f=>f.detail.catalogBinding.contentHash='sha256:'+'b'.repeat(64),f=>f.detail.catalogBinding.versionLabel='',f=>f.detail.catalogBinding.procedureReference='',f=>f.detail.catalog.ownerId=id(99),f=>f.detail.catalog.tenantId='unknown',f=>f.detail.catalog.status='approved',f=>f.detail.catalog.versionLabel='OTHER',f=>f.detail.catalog.procedureReference='OTHER',f=>f.detail.catalogBinding.approved=true]){
  const f=fixture();mutate(f);sync(f);await assert.rejects(Report.freeze(f));
 }
});
test('new packet revisions preserve the exact catalogue binding while field content can evolve',async()=>{
 const f=fixture(),first=await Packet.prepareReviewPacket(input(f));f.snapshot.lvtItems[0].version++;f.snapshot.recordVersions.find(row=>row.kind==='lvt_item').version++;const second=await Packet.prepareReviewPacket({...input(f),previousPacket:first});assert.equal(second.lineage.internalRevision,2);assert.equal(second.previousPacket.packetDigest,first.packetDigest);assert.deepEqual(second.content.tagSnapshot.content.catalogBinding,first.content.tagSnapshot.content.catalogBinding);assert.deepEqual(await Packet.verifyReviewPacket(second),second);
 for(const mutate of[x=>x.detail.catalogBinding.contentHash='c'.repeat(64),x=>x.detail.catalogBinding.id=id(98),x=>x.detail.catalog.items[1].component='COHERENTLY CHANGED UNUSED CATALOGUE']){
  const changed=copy(f);mutate(changed);changed.detail.execution.catalogHash=changed.detail.catalogBinding.contentHash;changed.detail.execution.catalogBindingId=changed.detail.catalogBinding.id;sync(changed);await assert.rejects(Packet.prepareReviewPacket({...input(changed),previousPacket:first}),/catálogo são imutáveis/);
 }
});
test('recomputed local packet digests cannot rewrite a pinned catalogue in an existing execution history',async()=>{
 const f=fixture(),first=await Packet.prepareReviewPacket(input(f));f.snapshot.lvtItems[0].version++;f.snapshot.recordVersions.find(row=>row.kind==='lvt_item').version++;const second=await Packet.prepareReviewPacket({...input(f),previousPacket:first}),forged=copy(second);
 forged.content.tagSnapshot.content.catalog.items[1].component='ALTERED BUT REHASHED';rehashTag(forged.content.tagSnapshot);rehashPacket(forged);await assert.rejects(Packet.verifyReviewPacket(forged),/catálogo são imutáveis/);
});
test('legacy records retain the old shape and cannot silently acquire or drop a binding within the same execution lineage',async()=>{
 const legacy=fixture({pinned:false}),record=await Report.freeze(legacy),oldPacket=await Packet.prepareReviewPacket(input(legacy));assert.equal(Object.hasOwn(record.content,'catalogBinding'),false);assert.equal(Object.hasOwn(record.content.catalog,'tenantId'),false);assert.equal(record.content.catalog.items.length,1);assert.deepEqual(await Packet.verifyReviewPacket(oldPacket),oldPacket);
 const pinned=fixture();await assert.rejects(Packet.prepareReviewPacket({...input(pinned),previousPacket:oldPacket}),/catálogo são imutáveis/);const newPacket=await Packet.prepareReviewPacket(input(pinned));await assert.rejects(Packet.prepareReviewPacket({...input(legacy),previousPacket:newPacket}),/catálogo são imutáveis/);
});
