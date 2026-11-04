'use strict';
// Synthetic Auth/RPC boundary only. This verifies fail-closed negotiation, not
// a real Supabase session, deployment or PostgreSQL/RLS integration.
const {test}=require('node:test'),assert=require('node:assert/strict');
const TENANT='10000000-0000-4000-8000-000000000001',USER='20000000-0000-4000-8000-000000000001';
const OWNER='30000000-0000-4000-8000-000000000001',INSPECTION='40000000-0000-4000-8000-000000000001';
const ITEM='50000000-0000-4000-8000-000000000001',REQUEST='60000000-0000-4000-8000-000000000001';
const ORIGIN='https://handshake.fixture.invalid';
async function fixture(grant={},role='inspector'){
 const {createGestaoHandler}=await import('../supabase/functions/_shared/gestao-api-core.mjs');
 const calls=[];let privileged=0;
 const handler=createGestaoHandler({appOrigin:ORIGIN,preparedSources:[{id:'admin-only-source',name:'ADMIN SOMENTE FIXTURE'}],
  createUserClient(){return{auth:{getUser:async()=>({data:{user:{id:USER,email:'person@fixture.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false}},error:null})},
   rpc:async(name,args={})=>{calls.push({name,args});if(name==='pi_my_company_access')return{data:[{id:TENANT,name:'TENANT SOMENTE FIXTURE'}],error:null};
    if(args.p_action==='access.get')return{data:{tenant:TENANT,actorUserId:USER,pilot:true,read:true,role,write:role==='admin',...grant},error:null};
    return{data:{action:args.p_action,...args.p_payload},error:null};}};},
  createServiceClient(){privileged++;throw Error('Privileged client must not be needed for handshake test');}
 });
 async function send(route='status',{method='GET',tenant=true,body}={}){
  const headers=new Headers({Origin:ORIGIN,Authorization:'Bearer synthetic.fixture.signature'});
  if(tenant)headers.set('X-Pires-Tenant',TENANT);
  if(body!==undefined)headers.set('Content-Type','application/json');
  const response=await handler(new Request('https://handshake.fixture.invalid/functions/v1/gestao-api/'+route,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return{status:response.status,data:await response.json()};
 }
 return{send,calls,serviceCount:()=>privileged};
}

test('Edge handshake: absent, partial, string and unknown SQL versions never advertise or reach new inspection routes',async()=>{
 const cases=[{},
  {inspectionScopeVersion:1},{inspectorWorkspaceVersion:1},
  {inspectionScopeVersion:0,inspectorWorkspaceVersion:1},{inspectionScopeVersion:1,inspectorWorkspaceVersion:0},
  {inspectionScopeVersion:'1',inspectorWorkspaceVersion:1},{inspectionScopeVersion:1,inspectorWorkspaceVersion:'1'},
  {inspectionScopeVersion:2,inspectorWorkspaceVersion:1},{inspectionScopeVersion:1,inspectorWorkspaceVersion:2},
  {inspectionScopeVersion:true,inspectorWorkspaceVersion:1},{inspectionScopeVersion:1,inspectorWorkspaceVersion:null}];
 for(const version of cases){
  const f=await fixture({...version,inspectionWriteAllowed:true});
  const status=await f.send();assert.equal(status.status,200);
  assert.equal(status.data.capabilities.inspectionExecutionVersion,0);assert.equal(status.data.capabilities.inspectorWorkspaceVersion,0);
  assert.equal(status.data.capabilities.assignedExecutionWrite,false);assert.equal(status.data.accessMode,'scope_unavailable');assert.deepEqual(status.data.preparedSources,[]);
  f.calls.length=0;
  const routes=['execution','execution-context','execution/'+INSPECTION,'execution/'+INSPECTION+'/context','execution/'+INSPECTION+'/report','execution/'+INSPECTION+'/sources/'+'a'.repeat(64),'reports/contracts/'+REQUEST+'/system/'+ITEM];
  for(const route of routes){const r=await f.send('companies/'+OWNER+'/'+route);assert.equal(r.status,503,route);assert.equal(r.data.code,'inspection_backend_unavailable');}
  for(const operation of ['assign','start','save','submit','catalog-select']){
   const r=await f.send('companies/'+OWNER+'/execution-'+operation,{method:'POST',body:{inspectionId:INSPECTION,requestId:REQUEST}});assert.equal(r.status,503);assert.equal(r.data.code,'inspection_backend_unavailable');
  }
  const photo=await f.send('companies/'+OWNER+'/execution/'+INSPECTION+'/items/'+ITEM+'/photos/'+REQUEST,{method:'POST',body:{}});assert.equal(photo.status,503);
  assert.ok(f.calls.every(x=>x.args.p_action==='access.get'),'no business RPC before exact SQL handshake');assert.equal(f.serviceCount(),0);
 }
});

test('Edge handshake: selected SQL v1 enables assigned inspection, with write permission remaining explicit',async()=>{
 for(const allowed of [true,false,'true']){
  const f=await fixture({inspectionScopeVersion:1,inspectorWorkspaceVersion:1,inspectionWriteAllowed:allowed});
  const status=await f.send();assert.equal(status.status,200);assert.equal(status.data.accessMode,'assigned_inspector');
  assert.equal(status.data.capabilities.inspectionExecutionVersion,1);assert.equal(status.data.capabilities.inspectorWorkspaceVersion,1);assert.equal(status.data.capabilities.assignedExecutionWrite,allowed===true);assert.equal(status.data.capabilities.write,false);assert.deepEqual(status.data.preparedSources,[]);
  const read=await f.send('companies/'+OWNER+'/execution/'+INSPECTION);assert.equal(read.status,200);assert.equal(read.data.action,'execution.get');
  const started=await f.send('companies/'+OWNER+'/execution-start',{method:'POST',body:{inspectionId:INSPECTION,requestId:REQUEST}});assert.equal(started.status,allowed===true?200:403);
  assert.equal(f.serviceCount(),0);
 }
});

test('Edge handshake: old SQL management and consultation remain available while new contract reports fail before RPC',async()=>{
 for(const role of ['admin','planner','assistant']){
  const f=await fixture({},role),status=await f.send();assert.equal(status.status,200);assert.equal(status.data.capabilities.inspectionExecutionVersion,0);assert.equal(status.data.capabilities.assignedExecutionWrite,false);
  assert.equal(status.data.accessMode,role==='admin'?'management':'consultation');assert.equal(status.data.capabilities.write,role==='admin');assert.equal(status.data.preparedSources.length,1);
  for(const route of ['state','book/'+ITEM,'reports/system/'+ITEM])assert.equal((await f.send('companies/'+OWNER+'/'+route)).status,200);
  f.calls.length=0;
  const report=await f.send('companies/'+OWNER+'/reports/contracts/'+REQUEST+'/system/'+ITEM);assert.equal(report.status,503);assert.equal(report.data.code,'inspection_backend_unavailable');assert.ok(f.calls.every(x=>x.args.p_action==='access.get'));
 }
});

test('Edge handshake: tenantless status does not advertise a selected execution backend',async()=>{
 const f=await fixture({inspectionScopeVersion:1,inspectorWorkspaceVersion:1,inspectionWriteAllowed:true});
 const r=await f.send('status',{tenant:false});assert.equal(r.status,200);assert.equal(r.data.tenant,null);assert.equal(r.data.accessMode,null);
 assert.equal(r.data.capabilities.inspectionExecutionVersion,0);assert.equal(r.data.capabilities.inspectorWorkspaceVersion,0);assert.equal(r.data.capabilities.assignedExecutionWrite,false);
});
