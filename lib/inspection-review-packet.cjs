'use strict';

// Local JSON preparation only. Digests detect changed content; they authenticate
// no person, original, permission, technical decision, signature or submission.
const {createHash}=require('node:crypto');
const TagReport=require('../app/gestao-tag-report.js');
const Drawing=require('./inspection-drawing-model.cjs');
const SCHEMA='pires-inspection-review-packet-v1';
const SCOPE=['ownerId','contractId','systemId','assetId','inspectionId','executionId'];
const MAX_BYTES=16*1024*1024,MAX_HISTORY=20,MAX_DRAWINGS=32,MAX_JSON_DEPTH=96;
const FIXED=Object.freeze({draft:true,canIssue:false,technicalNumber:null,technicalRevision:null,signatures:[],reviewRequestSent:false,technicalDecision:'pending',identityVerified:false,accessVerified:false,sourceBytesVerified:false,reviewStatus:'prepared_offline'});
const FIELDS=['schema','modelVersion','packetId','lineage','content','contentDigest','previousPacket','packetDigest',...Object.keys(FIXED)];
const own=(value,key)=>Object.hasOwn(value,key);
function invalid(path,message){const error=new TypeError(path+': '+message);error.code='invalid_inspection_review_packet';error.path=path;throw error;}
function canonical(value,path='input',ancestors=new Set(),budget={remaining:MAX_BYTES}){
 const take=text=>{budget.remaining-=Buffer.byteLength(text);if(budget.remaining<0)invalid(path,'pacote excede 16 MiB');return text;};
 if(value===null||typeof value==='boolean')return take(JSON.stringify(value));
 if(typeof value==='string'){if(value.length>budget.remaining||!value.isWellFormed())invalid(path,'texto excede o limite ou contém Unicode inválido');return take(JSON.stringify(value));}
 if(typeof value==='number'&&Number.isFinite(value))return take(JSON.stringify(value));
 if(!value||typeof value!=='object'||ancestors.has(value))invalid(path,'somente JSON finito, sem ciclos');
 if(ancestors.size>=MAX_JSON_DEPTH)invalid(path,'profundidade JSON excede 96 objetos/listas');
 const array=Array.isArray(value),proto=Object.getPrototypeOf(value),descriptors=Object.getOwnPropertyDescriptors(value);
 if(!array&&proto!==Object.prototype&&proto!==null||Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!('value'in descriptors[key])))invalid(path,'objetos simples sem acessores ou símbolos obrigatórios');
 if(array&&Object.keys(value).length!==value.length)invalid(path,'lista esparsa ou com propriedades extras');
 ancestors.add(value);take('[]');
 const keys=array?Array.from({length:value.length},(_,i)=>String(i)):Object.keys(descriptors).sort();
 if(keys.length>1)take(','.repeat(keys.length-1));
 const result=(array?'[':'{')+keys.map(key=>(array?'':take(JSON.stringify(key)+':'))+canonical(descriptors[key].value,path+'.'+key,ancestors,budget)).join(',')+(array?']':'}');
 ancestors.delete(value);return result;
}
const copy=value=>JSON.parse(canonical(value));
const digest=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}
function object(value,path,keys){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid(path,'objeto obrigatório');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 for(const key of Reflect.ownKeys(descriptors))if(typeof key!=='string'||!('value'in descriptors[key])||!keys.includes(key))invalid(path,'campo não reconhecido ou acessor');
 for(const key of keys)if(!own(value,key))invalid(path+'.'+key,'campo explícito obrigatório');
 return value;
}
function authority(value,path='content'){
 if(!value||typeof value!=='object')return;
 for(const [key,entry]of Object.entries(value)){
  if(['approved','approvedAsBuilt','issued','signed','canIssue','identityVerified','accessVerified','sourceBytesVerified','originalBytesVerified','reviewRequestSent'].includes(key)&&entry!==false&&entry!==null)invalid(path+'.'+key,'ato, acesso ou aprovação não são verificados offline');
  if(['technicalNumber','technicalRevision'].includes(key)&&entry!==null)invalid(path+'.'+key,'identidade técnica não é atribuída por este pacote');
  if(['technicalApproval','technicalDecision'].includes(key)&&![null,false,'pending','unavailable','pendente'].includes(entry))invalid(path+'.'+key,'decisão técnica deve permanecer pendente');
  if(key==='signatures'&&(!Array.isArray(entry)||entry.length)||/SignatureDataUrl$|^signatureDataUrl$/.test(key)&&entry)invalid(path+'.'+key,'imagem ou declaração de assinatura não é aceita');
  if(key==='signatureStatus'&&![null,'pending','pendente','unavailable'].includes(entry))invalid(path+'.'+key,'assinatura deve permanecer pendente');
  authority(entry,path+'.'+key);
 }
}
function tagInputOf(tag){
 const c=tag.content;
 return {scope:c.scope,detail:{inspection:c.inspection,execution:c.execution,catalog:c.catalog},snapshot:{snapshotVersion:1,reportScope:{mode:'contract_system',ownerId:c.scope.ownerId,contractId:c.scope.contractId,systemId:c.scope.systemId},company:c.company,contract:c.contract,system:c.system,assets:[c.asset],inspections:[c.inspection],lvts:[c.execution],lvtItems:c.items,photos:c.photos,findings:c.findings,rtis:c.rtis,recordVersions:c.recordVersions,sourceProvenance:c.sourceProvenance}};
}
async function verifyTag(tag){
 object(tag,'tagSnapshot',['schema','version','draft','canIssue','content','contentDigest','pending']);authority(tag);
 object(tag.content?.scope,'tagSnapshot.content.scope',SCOPE);
 const checked=await TagReport.freeze(tagInputOf(tag));
 if(canonical(checked)!==canonical(tag))invalid('tagSnapshot','conteúdo, versões ou pendências divergem da conferência original');
 return checked;
}
function sameIds(left,right,path){for(const key of SCOPE)if(left[key]!==right[key])invalid(path+'.'+key,'pacotes de inspeções ou execuções distintas não podem compartilhar a cadeia');}
const sameSet=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&new Set(left).size===left.length&&left.every(id=>right.includes(id));
function drawingBindings(snapshot,tag,known=new Set()){
 const c=tag.content,s=c.scope,items=new Map(c.items.map(row=>[row.id,row])),photos=new Map(c.photos.map(row=>[row.id,row])),rtis=new Map(c.rtis.map(row=>[row.id,row]));
 const visit=node=>{
  const d=node.content;
  for(const key of ['ownerId','contractId','systemId','assetId'])if(d.scope[key]!==s[key])invalid('drawing.scope.'+key,'desenho pertence a outro recorte');
  if(c.asset.lineId&&d.scope.lineId!==c.asset.lineId)invalid('drawing.scope.lineId','linha declarada diverge da TAG');
  if(d.references.asset.tag!==c.asset.tag||d.references.contract.assetIds.some(id=>!c.contract.assetIds?.includes(id)))invalid('drawing.references','identificação ou escopo do desenho diverge do recorte salvo');
  for(const row of d.references.items)if(!items.has(row.id)||row.lvtId!==s.executionId||row.inspectionId!==s.inspectionId)invalid('drawing.references.items','item não pertence à execução visual selecionada');
  for(const row of d.references.photos){const photo=photos.get(row.id);if(!photo||row.lvtId!==s.executionId||row.lvtItemId!==photo.lvtItemId)invalid('drawing.references.photos','foto não pertence ao mesmo item da execução selecionada');}
  for(const row of d.references.rtis){const rti=rtis.get(row.id);if(!rti||row.lvtId!==s.executionId||row.lvtItemId!==rti.lvtItemId||!sameSet(row.photoIds,rti.photoIds||[]))invalid('drawing.references.rtis','RTI ou fotos divergem do item salvo da execução selecionada');}
  // An archived drawing was already checked against its archived TAG content.
  // Keep that history without transplanting old marks onto a new sheet/version.
  if(node.previousSnapshot&&!known.has(node.previousSnapshot.contentDigest))visit(node.previousSnapshot);
 };
 visit(snapshot);
}
function knownDrawings(packet,result=new Set()){
 if(!packet)return result;
 const add=snapshot=>{result.add(snapshot.contentDigest);if(snapshot.previousSnapshot)add(snapshot.previousSnapshot);};
 for(const snapshot of packet.content.drawingSnapshots)add(snapshot);
 return knownDrawings(packet.previousPacket,result);
}
function drawingsOf(snapshots,tag,previous){
 if(!Array.isArray(snapshots)||snapshots.length>MAX_DRAWINGS)invalid('drawingSnapshots','lista explícita de até 32 desenhos obrigatória');
 const seen=new Set(),known=knownDrawings(previous);
 return snapshots.map(snapshot=>{
  const checked=Drawing.verifyDrawingSnapshot(snapshot);
  if(seen.has(checked.snapshotId))invalid('drawingSnapshots','snapshot de desenho repetido');seen.add(checked.snapshotId);
  authority(checked);drawingBindings(checked,tag,known);return checked;
 }).sort((a,b)=>a.snapshotId.localeCompare(b.snapshotId));
}
const seriesId=scope=>'review-series:'+digest({schema:SCHEMA,scope}).slice(7);
const identity=(contentDigest,lineage)=>'review-packet:'+digest({schema:SCHEMA,contentDigest,lineage}).slice(7);
function bodyOf(packet){const {packetDigest,...body}=packet;return body;}
async function verifyNode(packet,depth=0,seen=new Set()){
 if(depth>=MAX_HISTORY)invalid('previousPacket','cadeia excede 20 pacotes locais');
 object(packet,'packet',FIELDS);object(packet.lineage,'lineage',['seriesId','internalRevision','previousPacketId','previousPacketDigest']);object(packet.content,'content',['scope','tagSnapshot','drawingSnapshots']);
 object(packet.content.scope,'content.scope',SCOPE);
 for(const [key,value]of Object.entries(FIXED))if(canonical(packet[key])!==canonical(value))invalid('packet.'+key,'estado offline deve permanecer sem aprovação, envio ou acesso verificado');
 if(packet.schema!==SCHEMA||packet.modelVersion!==1||!Number.isSafeInteger(packet.lineage.internalRevision)||packet.lineage.internalRevision<1)invalid('packet','schema ou versão interna inválida');
 if(typeof packet.packetId!=='string'||seen.has(packet.packetId))invalid('packet.packetId','identidade ausente ou repetida na cadeia');seen.add(packet.packetId);
 const previous=packet.previousPacket===null?null:await verifyNode(packet.previousPacket,depth+1,seen);
 const tag=await verifyTag(packet.content.tagSnapshot);sameIds(packet.content.scope,tag.content.scope,'content.scope');
 if(previous)sameIds(packet.content.scope,previous.content.scope,'previousPacket.scope');
 const lineage={seriesId:seriesId(tag.content.scope),internalRevision:previous?previous.lineage.internalRevision+1:1,previousPacketId:previous?.packetId||null,previousPacketDigest:previous?.packetDigest||null};
 if(canonical(packet.lineage)!==canonical(lineage))invalid('lineage','origem ou sequência interna divergente');
 const drawings=drawingsOf(packet.content.drawingSnapshots,tag,previous);
 if(canonical(drawings)!==canonical(packet.content.drawingSnapshots))invalid('drawingSnapshots','ordem canônica dos desenhos divergente');
 const contentDigest=digest({schema:SCHEMA,content:packet.content});
 if(packet.contentDigest!==contentDigest||packet.packetId!==identity(contentDigest,lineage)||packet.packetDigest!==digest(bodyOf(packet)))invalid('packetDigest','pacote ou histórico mudou; digest local não é assinatura');
 if(previous?.contentDigest===contentDigest)invalid('lineage','conteúdo igual deve manter o pacote anterior');
 return packet;
}
async function verifyReviewPacket(packet){return frozen(await verifyNode(copy(packet)));}
async function prepareReviewPacket(input){
 if(!input||typeof input!=='object'||Array.isArray(input))invalid('input','objeto obrigatório');
 const descriptors=Object.getOwnPropertyDescriptors(input);
 for(const key of Reflect.ownKeys(descriptors))if(typeof key!=='string'||!['tagInput','drawingSnapshots','previousPacket'].includes(key)||!('value'in descriptors[key]))invalid('input','campo não reconhecido ou acessor');
 if(!own(input,'tagInput')||!own(input,'drawingSnapshots'))invalid('input','tagInput e lista explícita drawingSnapshots são obrigatórios');
 object(input.tagInput,'tagInput',['scope','detail','snapshot']);
 object(input.tagInput.scope,'tagInput.scope',SCOPE);
 // Inspect root claims without traversing unrelated TAGs from a system response.
 for(const row of [input.tagInput,input.tagInput.detail,input.tagInput.snapshot]){
  if(!row||typeof row!=='object')invalid('tagInput','contexto de conferência ausente');
  const claims={};for(const key of ['approved','approvedAsBuilt','issued','signed','canIssue','technicalNumber','technicalRevision','technicalDecision','technicalApproval','signatures','identityVerified','accessVerified','sourceBytesVerified','originalBytesVerified','reviewRequestSent']){
   const descriptor=Object.getOwnPropertyDescriptor(row,key);if(descriptor&&!('value'in descriptor))invalid('tagInput.'+key,'acessor não é aceito');if(descriptor)claims[key]=descriptor.value;
  }authority(claims);
 }
 const tag=await TagReport.freeze(input.tagInput);authority(tag);
 const previous=input.previousPacket===undefined||input.previousPacket===null?null:await verifyReviewPacket(input.previousPacket);
 if(previous)sameIds(tag.content.scope,previous.content.scope,'previousPacket.scope');
 const drawings=drawingsOf(input.drawingSnapshots,tag,previous),content=copy({scope:tag.content.scope,tagSnapshot:tag,drawingSnapshots:drawings}),contentDigest=digest({schema:SCHEMA,content});
 if(previous?.contentDigest===contentDigest)return previous;
 const lineage={seriesId:seriesId(tag.content.scope),internalRevision:previous?previous.lineage.internalRevision+1:1,previousPacketId:previous?.packetId||null,previousPacketDigest:previous?.packetDigest||null};
 const body={schema:SCHEMA,modelVersion:1,packetId:identity(contentDigest,lineage),lineage,content,contentDigest,previousPacket:previous,...copy(FIXED)};
 const result=copy({...body,packetDigest:digest(body)});await verifyNode(result);return frozen(result);
}
module.exports=Object.freeze({SCHEMA,prepareReviewPacket,verifyReviewPacket});
