'use strict';
// Real candidate SQL + Edge core. Auth/JWT transport, licensing and Storage
// objects are isolated synthetic fixtures; this is not Supabase integration.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {setup}=require('./gestao-postgres-fixture.cjs');
const {catalogueMetadata,selectCatalogue}=require('./gestao-explicit-catalogue.cjs');
const IMAGE=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
const ORIGIN='https://scoped-edge.fixture.invalid';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function createScopedEdgeFixture(t,options={}){
 const f=await setup();if(t)t.after(()=>f.close());f.files=new Map();f.events=[];f.hooks=options.hooks||{};f.origin=options.appOrigin||ORIGIN;
 let tail=Promise.resolve();f.serial=fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;};
 f.apiCall=(action,payload={},actor=f.ids.adminA,tenant=f.ids.tenantA)=>f.serial(()=>f.call(tenant,action,payload,actor));
 await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');
 for(const file of fs.readdirSync(path.join(__dirname,'../../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())await f.db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',file),'utf8'));
 await f.db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/inspection-execution.sql'),'utf8'));
 f.professionals={};await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 for(const [name,user] of [['admin',f.ids.adminA],['inspector',f.ids.inspector],['other',f.ids.planner]]){
  const id=randomUUID();f.professionals[name]=id;
  await f.db.query('insert into pi_team_private.professionals(tenant_id,id,user_id,name,functional_role,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$6)',[f.ids.tenantA,id,user,'PROFISSIONAL EXCLUSIVAMENTE SINTÉTICO '+name,'inspector',f.ids.adminA]);
 }
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 f.ownerId=(await f.apiCall('owners.create',{name:'CLIENTE EXCLUSIVAMENTE SINTÉTICO EDGE-SQL',source:'Fixture isolada sem valor técnico'})).id;
 f.op=(action,payload={},actor=f.ids.adminA)=>f.apiCall(action,{ownerId:f.ownerId,...payload},actor);
 const h=await f.op('hierarchy.create',{unit:'UNIDADE SINTÉTICA',system:'SISTEMA SINTÉTICO'});f.unit=h.unit;f.system=h.system;
 f.asset=await f.op('assets.create',{unitId:h.unit.id,systemId:h.system.id,type:'linha',tag:'TAG-SOMENTE-FIXTURE-EDGE',source:'Fixture'});
 f.contract=await f.op('contracts.create',{requestId:randomUUID(),name:'CONTRATO SINTÉTICO EDGE',source:'Fixture',modules:['integridade'],assetIds:[f.asset.id]});
 f.campaign=await f.op('campaigns.create',{requestId:randomUUID(),name:'CAMPANHA SINTÉTICA EDGE',source:'Fixture',contractId:f.contract.id,systemId:h.system.id,module:'integridade',assetIds:[f.asset.id],status:'rascunho'});
 const catalogBytes=new TextEncoder().encode('%PDF-1.7\n% SYNTHETIC CATALOGUE ONLY; NO TECHNICAL VALIDITY\n%%EOF\n'),catalogSha=hash(catalogBytes);
 const objectKey=await f.putObject(f.ids.tenantA,catalogSha,catalogBytes.length,'pdf');f.files.set(objectKey,catalogBytes);
 f.catalogOriginal=await f.register(f.ids.tenantA,f.ids.adminA,{sha:catalogSha,name:'CATALOGO-EXCLUSIVAMENTE-SINTETICO.pdf',size:catalogBytes.length,objectKey,workbook:{format:'document_pdf',sheets:[],metadata:{extraction:'not_performed'}}});
 f.catalogId=randomUUID();const source={sourceId:catalogSha,fileHash:catalogSha,fileName:f.catalogOriginal.name,format:'document_pdf',locator:{page:1}};
 f.catalogItems=[{id:'item-scoped-fixture',itemKey:'ITEM-SINTETICO',component:'COMPONENTE EXCLUSIVAMENTE SINTÉTICO',conditions:[{id:'good-scoped',text:'CONDIÇÃO FAVORÁVEL SOMENTE FIXTURE',supportsGoodCondition:true,source},{id:'action-scoped',text:'CONDIÇÃO COM TRATATIVA SOMENTE FIXTURE',supportsGoodCondition:false,source}],recommendations:[{id:'none-scoped',text:'Sem recomendações.',requiresTreatment:false,conditionIds:['good-scoped'],source},{id:'treat-scoped',text:'TRATATIVA EXCLUSIVAMENTE SINTÉTICA',requiresTreatment:true,conditionIds:['action-scoped'],source}]}];
 if(options.guidanceMapping){const entry=require('../../lib/rti-guidance-registry.cjs').getRegistry().entries[0];f.catalogItems[0].guidanceBindings=[{conditionId:'action-scoped',recommendationId:'treat-scoped',mappingStatus:options.guidanceMapping==='conflict'?'conflict':'verified_link',ruleRef:entry.ruleRef,mappingEvidence:{conditionSource:source,recommendationSource:source,reviewReference:'APLICABILIDADE EXCLUSIVAMENTE SINTÉTICA'}}];}
 await f.db.query('insert into pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id,source_id,source_locator,items,verified_by,verified_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now())',[f.ids.tenantA,f.ownerId,f.catalogId,catalogSha,JSON.stringify({page:1}),JSON.stringify(f.catalogItems),f.ids.adminA]);
 await catalogueMetadata(f,{ownerId:f.ownerId,catalogId:f.catalogId,contractIds:[f.contract.id],assetIds:[f.asset.id]});
 f.createActivity=async({type='visual',assignee='inspector',start=false,bindCatalog=options.bindCatalog!==false}={})=>{
  let i=await f.op('inspections.create',{requestId:randomUUID(),assetId:f.asset.id,contractId:f.contract.id,campaignId:f.campaign.id,module:'integridade',type,status:'planejada',source:'Fixture isolada'});
  await f.op('execution.assign',{inspectionId:i.id,professionalId:f.professionals[assignee],expectedVersion:i.version,requestId:randomUUID()});
  if(type==='visual'&&bindCatalog)await selectCatalogue(f,{ownerId:f.ownerId,inspectionId:i.id,catalogId:f.catalogId});
  const detail=await f.op(start?'execution.start':'execution.get',{inspectionId:i.id,...(start?{requestId:randomUUID()}:{})},start?(assignee==='inspector'?f.ids.inspector:assignee==='admin'?f.ids.adminA:f.ids.planner):f.ids.adminA);
  return detail;
 };
 const {createGestaoHandler}=await import('../../supabase/functions/_shared/gestao-api-core.mjs');
 const {validatePhoto,validateDocument}=await import('../../supabase/functions/_shared/document-original.mjs');
 const actors={admin:f.ids.adminA,inspector:f.ids.inspector,other:f.ids.planner,planner:f.ids.planner,assistant:f.ids.assistant};
 f.handler=createGestaoHandler({appOrigin:f.origin,preparedSources:[{id:'never-disclose-to-inspector',name:'ADMIN SOURCE FIXTURE'}],
  createUserClient(token){const actor=actors[token.split('.')[0]]||f.ids.stranger;return{
   auth:{getUser:async()=>({data:{user:{id:actor,email:'synthetic@fixture.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false}},error:null})},
   rpc:async(name,args={})=>{
    f.events.push({kind:'userRpc',actor,name,args});
    if(name==='pi_my_company_access')return{data:[{id:f.ids.tenantA,name:'Tenant isolado'}],error:null};
    if(name!=='pi_gestao_api')throw Error('Unexpected user RPC');
    try{await f.hooks.beforeUserRpc?.(f,args,actor);return{data:await f.apiCall(args.p_action,args.p_payload,actor,args.p_tenant),error:null};}
    catch(error){return{data:null,error:{code:error.code}};}
   }
  };},
  createServiceClient(){f.events.push({kind:'serviceClient'});return{
   storage:{from(bucket){if(bucket!=='pi-gestao-sources')throw Error('Unexpected bucket');return{
    async upload(key,bytes,settings){f.events.push({kind:'upload',key,settings});await f.hooks.beforeUpload?.(f,key,bytes);
     if(f.hooks.uploadError)return{error:f.hooks.uploadError};
     if(f.files.has(key))return{error:{statusCode:'409',error:'Duplicate'}};
     f.files.set(key,Uint8Array.from(bytes));await f.serial(()=>f.putObject(f.ids.tenantA,hash(bytes),bytes.length,key.endsWith('.png')?'png':'jpg'));await f.hooks.afterUpload?.(f,key,bytes);return{data:{path:key},error:null};},
    async download(key){f.events.push({kind:'download',key});await f.hooks.duringDownload?.(f,key);const bytes=f.files.get(key);return bytes?{data:new Blob([bytes]),error:null}:{data:null,error:{statusCode:'404'}};}
   };}},
   async rpc(name,args){f.events.push({kind:'serviceRpc',name,args});await f.hooks.beforeServiceRpc?.(f,name,args);
    if(name!=='pi_gestao_execution_photo'&&name!=='pi_gestao_register_source')throw Error('Unexpected service RPC');
    let value;try{value=await f.serial(()=>f.asRole('service_role',null,async db=>(await db.query('select public.'+name+'($1,$2,$3::jsonb) as value',[args.p_tenant,args.p_actor,JSON.stringify(args.p_payload)])).rows[0].value));}
    catch(error){return{data:null,error:{code:error.code}};}
    await f.hooks.afterServiceRpc?.(f,name,args,value);return{data:value,error:null};}
  };},validatePhoto:async(...args)=>{f.events.push({kind:'validatePhoto'});await f.hooks.duringValidation?.(f);return validatePhoto(...args);},validateDocument});
 f.send=async(route,body,settings={})=>{
  const headers=new Headers({Origin:f.origin,Authorization:'Bearer '+(settings.actor||'inspector')+'.synthetic.signature','X-Pires-Tenant':settings.tenant||f.ids.tenantA});
  if(body!==undefined)headers.set('Content-Type','application/json');for(const[k,v]of Object.entries(settings.headers||{}))v===null?headers.delete(k):headers.set(k,v);
  const full=route.startsWith('companies')||['status','tenants','sources/photo'].includes(route)?route:'companies/'+f.ownerId+'/'+route;
  const response=await f.handler(new Request('https://scoped-edge.fixture.invalid/functions/v1/gestao-api/'+full,{method:settings.method||(body===undefined&&settings.raw===undefined?'GET':'POST'),headers,...(settings.raw!==undefined?{body:settings.raw,...(settings.raw instanceof ReadableStream?{duplex:'half'}:{})}:body!==undefined?{body:JSON.stringify(body)}:{})}));
  return{status:response.status,data:response.headers.get('Content-Type')?.includes('application/json')?await response.json():null,response};
 };
 f.photo=async(detail,{requestId=randomUUID(),bytes=IMAGE,headers={},...settings}={})=>f.send('execution/'+detail.inspection.id+'/items/'+detail.execution.items[0].lvtItemId+'/photos/'+requestId,undefined,{...settings,raw:bytes,headers:{'Content-Type':'image/png','X-Pires-Source-Name':encodeURIComponent('FOTO-EXCLUSIVAMENTE-SINTETICA.png'),'X-Pires-Execution-Version':String(detail.execution.version),...headers}});
 f.image=IMAGE;f.hash=hash;f.detail=await f.createActivity({start:options.start!==false});f.inspection=f.detail.inspection;
 return f;
}
module.exports={createScopedEdgeFixture,IMAGE,ORIGIN,hash};
