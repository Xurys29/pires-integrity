'use strict';
// Validation only: the actual Edge core delegates RPC to the actual candidate
// SQL in isolated PGlite. Auth, JWT verification and Supabase transport are NOT
// exercised; no remote services, accounts or credentials are used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const ORIGIN='https://edge-sql.fixture.invalid';

async function fixture(t){
 const f=await setup();t.after(()=>f.close());
 await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');
 for(const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())
  await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/inspection-execution.sql'),'utf8'));
 f.persons={};
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 for(const [name,user] of [['admin',f.ids.adminA],['inspector',f.ids.inspector]]){
  const id=randomUUID();f.persons[name]=id;
  await f.db.query('insert into pi_team_private.professionals(tenant_id,id,user_id,name,created_by,updated_by) values($1,$2,$3,$4,$5,$5)',[f.ids.tenantA,id,user,'SYNTHETIC EDGE SQL '+name,f.ids.adminA]);
 }
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 const owner=await f.call(f.ids.tenantA,'owners.create',{name:'SYNTHETIC EDGE SQL CLIENT',source:'Local validation only'});
 f.ownerId=owner.id;
 f.exec=(action,payload={})=>f.call(f.ids.tenantA,action,{ownerId:owner.id,...payload});
 const h=await f.exec('hierarchy.create',{unit:'SYNTHETIC UNIT',system:'SYNTHETIC SYSTEM'});
 f.asset=await f.exec('assets.create',{unitId:h.unit.id,systemId:h.system.id,type:'linha',tag:'SYNTHETIC-TAG',source:'Local validation only'});
 f.contract=await f.exec('contracts.create',{requestId:randomUUID(),name:'SYNTHETIC CONTRACT',source:'Fixture',modules:['integridade'],assetIds:[f.asset.id]});
 f.campaign=await f.exec('campaigns.create',{requestId:randomUUID(),name:'SYNTHETIC CAMPAIGN',source:'Fixture',contractId:f.contract.id,systemId:h.system.id,module:'integridade',assetIds:[f.asset.id],status:'rascunho'});
 f.inspection=type=>f.exec('inspections.create',{requestId:randomUUID(),assetId:f.asset.id,contractId:f.contract.id,campaignId:f.campaign.id,module:'integridade',type,status:'planejada',source:'Local validation only'});
 const {createGestaoHandler}=await import('../supabase/functions/_shared/gestao-api-core.mjs');
 f.actions=[];
 const handler=createGestaoHandler({appOrigin:ORIGIN,createUserClient(token){
  const user=token.startsWith('inspector.')?f.ids.inspector:f.ids.adminA;
  return {auth:{getUser:async()=>({data:{user:{id:user,email:'synthetic@fixture.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false}},error:null})},
   rpc:async(name,args)=>{
    assert.equal(name,'pi_gestao_api');f.actions.push({actor:user,action:args.p_action});
    try{return {data:await f.call(args.p_tenant,args.p_action,args.p_payload,user),error:null};}
    catch(error){return {data:null,error:{code:error.code}};}
   }};
 },createServiceClient(){throw Error('Normal execution must not create privileged client');}});
 f.send=async(operation,body,settings={})=>{
  const headers={Origin:ORIGIN,Authorization:'Bearer '+(settings.inspector?'inspector':'admin')+'.synthetic.signature','X-Pires-Tenant':settings.tenant||f.ids.tenantA};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(settings.anonymous)delete headers.Authorization;
  const response=await handler(new Request('https://edge-sql.fixture.invalid/functions/v1/gestao-api/companies/'+(settings.ownerId||f.ownerId)+'/'+operation,{method:body===undefined?'GET':'POST',headers,...(body!==undefined?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json()};
 };
 return f;
}

test('local Edge core -> candidate SQL: type, stable draft, replay, stale save and SQL validation mapped to HTTP',async t=>{
 const f=await fixture(t),i=await f.inspection('espessura');
 let r=await f.send('execution-start',{inspectionId:i.id,requestId:randomUUID()});assert.equal(r.status,403);
 r=await f.send('execution-assign',{inspectionId:i.id,professionalId:f.persons.admin,expectedVersion:i.version,requestId:randomUUID()});assert.equal(r.status,200);
 const start={inspectionId:i.id,requestId:randomUUID()};
 r=await f.send('execution-start',start);assert.equal(r.status,200);const eid=r.data.execution.id;
 for(const requestId of [start.requestId,randomUUID()]){const replay=await f.send('execution-start',{...start,requestId});assert.equal(replay.status,200);assert.equal(replay.data.execution.id,eid);}
 const today=(await f.db.query('select current_date::text d')).rows[0].d;
 const body={inspectionId:i.id,expectedVersion:r.data.execution.version,requestId:randomUUID(),observedOn:today,answers:[],instrument:'SYNTHETIC INSTRUMENT',readings:[{point:'SYNTHETIC DOCUMENTED POINT',value:'3.25',unit:'mm'}]};
 const saved=await f.send('execution-save',body);assert.equal(saved.status,200);assert.equal(saved.data.execution.type,'espessura');assert.equal(saved.data.execution.recordClass,'measurement_draft');
 const replay=await f.send('execution-save',body);assert.equal(replay.status,200);assert.equal(replay.data.execution.version,saved.data.execution.version);
 const stale=await f.send('execution-save',{...body,requestId:randomUUID()});assert.equal(stale.status,409);assert.equal(stale.data.code,'review_required');
 const invalid=await f.send('execution-save',{...body,requestId:randomUUID(),expectedVersion:saved.data.execution.version,answers:[{catalogItemId:'forged-visual-item'}]});assert.equal(invalid.status,400);assert.equal(invalid.data.code,'validation_failed');
 const after=await f.send('execution/'+i.id);assert.equal(after.status,200);assert.equal(after.data.execution.id,eid);assert.equal(after.data.execution.version,saved.data.execution.version);assert.equal(after.data.execution.readings.length,1);
 assert.equal((await f.db.query('select count(*)::int n from pi_gestao_private.inspection_executions')).rows[0].n,1);
 const visual=await f.inspection('visual');await f.send('execution-assign',{inspectionId:visual.id,professionalId:f.persons.admin,expectedVersion:visual.version,requestId:randomUUID()});
 const v=await f.send('execution-start',{inspectionId:visual.id,requestId:randomUUID()});assert.equal(v.status,200);assert.equal(v.data.execution.answers.length,0);assert.equal(v.data.catalog.status,'unavailable');
 const submit=await f.send('execution-submit',{inspectionId:visual.id,expectedVersion:v.data.execution.version,requestId:randomUUID()});assert.equal(submit.status,400);
});

test('local Edge core -> candidate SQL: inspector assignment is readable but write, other assignment, tenant and missing Auth fail',async t=>{
 const f=await fixture(t),i=await f.inspection('visual');
 let r=await f.send('execution-assign',{inspectionId:i.id,professionalId:f.persons.inspector,expectedVersion:i.version,requestId:randomUUID()});assert.equal(r.status,200);
 r=await f.send('execution/'+i.id,undefined,{inspector:true});assert.equal(r.status,200);assert.equal(r.data.writeAllowed,false);assert.equal(r.data.canExecute,false);
 const before=f.actions.length;
 r=await f.send('execution-start',{inspectionId:i.id,requestId:randomUUID()},{inspector:true});assert.equal(r.status,403);assert.equal(r.data.code,'write_denied');assert.equal(f.actions.slice(before).some(x=>x.action==='execution.start'),false);
 const j=await f.inspection('visual');
 r=await f.send('execution/'+j.id,undefined,{inspector:true});assert.equal(r.status,403);assert.equal(r.data.code,'access_denied');
 r=await f.send('execution/'+i.id,undefined,{tenant:f.ids.tenantB});assert.equal(r.status,403);
 r=await f.send('execution/'+i.id,undefined,{anonymous:true});assert.equal(r.status,401);assert.equal(r.data.code,'auth_required');
 assert.equal((await f.db.query('select count(*)::int n from pi_gestao_private.inspection_executions')).rows[0].n,0);
});

test('local Edge core -> candidate SQL: contract report URL isolates shared assets and rejects contradictory campaign/scope',async t=>{
 const f=await fixture(t),systemId=f.asset.systemId;
 const asset2=await f.exec('assets.create',{unitId:f.asset.unitId,systemId,type:'linha',tag:'SYNTHETIC-C2-ONLY',source:'Local validation only'});
 const c2=await f.exec('contracts.create',{requestId:randomUUID(),name:'SYNTHETIC CONTRACT C2 SHARED',source:'Fixture',modules:['integridade'],assetIds:[f.asset.id,asset2.id]});
 const camp2=await f.exec('campaigns.create',{requestId:randomUUID(),name:'SYNTHETIC CAMPAIGN C2',source:'Fixture',contractId:c2.id,systemId,module:'integridade',assetIds:[f.asset.id,asset2.id],status:'rascunho'});
 const own=await f.inspection('visual'),other=await f.exec('inspections.create',{requestId:randomUUID(),assetId:f.asset.id,contractId:c2.id,campaignId:camp2.id,module:'integridade',type:'visual',status:'planejada',source:'Fixture'});
 const scoped=await f.send('reports/contracts/'+f.contract.id.toUpperCase()+'/system/'+systemId.toUpperCase());assert.equal(scoped.status,200);assert.equal(scoped.data.contract.id,f.contract.id);assert.equal(scoped.data.reportScope.mode,'contract_system');assert.deepEqual(scoped.data.assets.map(x=>x.id),[f.asset.id]);assert.deepEqual(scoped.data.inspections.map(x=>x.id),[own.id]);assert.equal(scoped.data.recordVersions.some(x=>x.id===other.id),false);assert.equal(scoped.data.canIssue,false);
 const campaign=await f.send('reports/contracts/'+f.contract.id+'/campaign/'+f.campaign.id);assert.equal(campaign.status,200);assert.equal(campaign.data.campaign.systemId,systemId);assert.equal(campaign.data.contract.id,f.contract.id);
 const contradiction=await f.send('reports/contracts/'+f.contract.id+'/campaign/'+camp2.id);assert.equal(contradiction.status,403);assert.equal(contradiction.data.code,'access_denied');
 const query=await f.send('reports/contracts/'+f.contract.id+'/system/'+systemId+'?contractId='+c2.id);assert.equal(query.status,400);
 const legacy=await f.send('reports/system/'+systemId);assert.equal(legacy.status,200);assert.equal(legacy.data.reportScope.mode,'system_all_contracts');assert.equal(legacy.data.inspections.length,2);assert.equal(legacy.data.assets.length,2);
 assert.equal((await f.send('reports/contracts/'+f.contract.id+'/system/'+systemId,undefined,{tenant:f.ids.tenantB})).status,403);
});
