'use strict';
// Candidate SQL only in disposable PGlite. Fixture Auth/licensing/Storage and
// all actors/records/images are synthetic. No remote project is contacted.
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createScopedEdgeFixture,IMAGE}=require('./fixtures/gestao-scoped-edge.cjs');

async function servicePhoto(f,detail,{operation=randomUUID(),source={},actor=f.ids.inspector}={}){
 const sha=source.sha||createHash('sha256').update(IMAGE).digest('hex'),payload={ownerId:f.ownerId,inspectionId:detail.inspection.id,lvtItemId:detail.execution.items[0].lvtItemId,expectedVersion:detail.execution.version,requestId:operation,source:{sha,name:'FOTO-SOMENTE-FIXTURE.png',size:IMAGE.length,objectKey:await f.putObject(f.ids.tenantA,sha,IMAGE.length,'png'),workbook:{format:'image_png',sheets:[],metadata:{extraction:'not_performed'}},...source}};
 const invoke=(input=payload,user=actor)=>f.serial(()=>f.asRole('service_role',null,async db=>(await db.query('select public.pi_gestao_execution_photo($1,$2,$3::jsonb) as value',[f.ids.tenantA,user,JSON.stringify(input)])).rows[0].value));
 return {payload,invoke};
}
async function fixtureChange(f,sql,args=[]){
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 try{return await f.db.query(sql,args);}finally{await f.db.query("select set_config('request.jwt.claim.sub','',false)");}
}

test('assignment eligibility: engineer reviewers and nonmanager actors are rejected atomically; unlinked exercise inspectors remain eligible',async t=>{
 const f=await createScopedEdgeFixture(t,{start:false}),engineer=randomUUID(),unlinked=randomUUID();
 for(const[id,role,key]of[[engineer,'engineer_reviewer','EF-SYNTHETIC-ONLY'],[unlinked,'inspector','IF-SYNTHETIC-ONLY']])await fixtureChange(f,"insert into pi_team_private.professionals(tenant_id,id,name,functional_role,exercise,exercise_key,created_by,updated_by) values($1,$2,$3,$4,true,$5,$6,$6)",[f.ids.tenantA,id,'PROFISSIONAL SOMENTE FIXTURE '+role,role,key,f.ids.adminA]);
 const detail=await f.op('execution.get',{inspectionId:f.inspection.id}),list=await f.op('execution.list');
 for(const response of[detail,list]){
  assert.equal(response.professionals.find(person=>person.id===engineer).functionalRole,'engineer_reviewer');
  assert.equal(response.professionals.find(person=>person.id===unlinked).functionalRole,'inspector');assert.equal(response.professionals.find(person=>person.id===unlinked).accessLinked,false);
 }
 const snapshot=async()=>({inspection:(await f.db.query('select body,version from pi_gestao_private.records where tenant_id=$1 and id=$2',[f.ids.tenantA,f.inspection.id])).rows[0],counts:(await f.db.query('select (select count(*)::int from auth.users) users,(select count(*)::int from pi_gestao_private.pilot_access) pilots,(select count(*)::int from pi_gestao_private.operation_receipts) receipts,(select count(*)::int from pi_gestao_private.audit) audits')).rows[0]});
 const before=await snapshot(),payload=professionalId=>({inspectionId:f.inspection.id,professionalId,expectedVersion:detail.inspection.version,requestId:randomUUID()});
 await assert.rejects(f.op('execution.assign',payload(engineer)),{code:'22023'});assert.deepEqual(await snapshot(),before);
 for(const actor of[f.ids.inspector,f.ids.planner,f.ids.assistant]){await assert.rejects(f.op('execution.assign',payload(unlinked),actor),{code:'42501'});assert.deepEqual(await snapshot(),before);}
 const assigned=await f.op('execution.assign',payload(unlinked));assert.equal(assigned.inspection.assigneeProfessionalId,unlinked);assert.equal(assigned.canExecute,false,'planning does not create login or execution permission');
 const after=await snapshot();assert.equal(after.counts.users,before.counts.users);assert.equal(after.counts.pilots,before.counts.pilots);
 assert.deepEqual((await f.db.query('select user_id,exercise,exercise_key,functional_role from pi_team_private.professionals where tenant_id=$1 and id=$2',[f.ids.tenantA,unlinked])).rows[0],{user_id:null,exercise:true,exercise_key:'IF-SYNTHETIC-ONLY',functional_role:'inspector'});
});

test('assignment eligibility: existing engineer assignment stays readable and unchanged until a legitimate new assignment',async t=>{
 const f=await createScopedEdgeFixture(t,{start:false}),engineer=randomUUID();
 await fixtureChange(f,"insert into pi_team_private.professionals(tenant_id,id,name,functional_role,exercise,exercise_key,created_by,updated_by) values($1,$2,'ENGENHEIRO HISTÓRICO SOMENTE FIXTURE','engineer_reviewer',true,'EF-HISTORICAL-SYNTHETIC',$3,$3)",[f.ids.tenantA,engineer,f.ids.adminA]);
 // Model a pre-existing assignment in a disposable fixture, not a migration or a new API assignment.
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(jsonb_set(body,'{assigneeProfessionalId}',to_jsonb($1::text)),'{assigneeName}','\"ENGENHEIRO HISTÓRICO SOMENTE FIXTURE\"'::jsonb) where tenant_id=$2 and id=$3",[engineer,f.ids.tenantA,f.inspection.id]);
 const before=(await f.db.query('select body,version from pi_gestao_private.records where tenant_id=$1 and id=$2',[f.ids.tenantA,f.inspection.id])).rows[0],detail=await f.op('execution.get',{inspectionId:f.inspection.id});
 assert.equal(detail.inspection.assigneeProfessionalId,engineer);assert.equal(detail.canExecute,false);
 await assert.rejects(f.op('execution.assign',{inspectionId:f.inspection.id,professionalId:engineer,expectedVersion:detail.inspection.version,requestId:randomUUID()}),{code:'22023'});
 assert.deepEqual((await f.db.query('select body,version from pi_gestao_private.records where tenant_id=$1 and id=$2',[f.ids.tenantA,f.inspection.id])).rows[0],before);
 const fixed=await f.op('execution.assign',{inspectionId:f.inspection.id,professionalId:f.professionals.inspector,expectedVersion:detail.inspection.version,requestId:randomUUID()});assert.equal(fixed.inspection.assigneeProfessionalId,f.professionals.inspector);
 assert.equal((await f.db.query('select exercise_key from pi_team_private.professionals where tenant_id=$1 and id=$2',[f.ids.tenantA,engineer])).rows[0].exercise_key,'EF-HISTORICAL-SYNTHETIC');
});

test('assignment scope: active assigned inspector can execute without generic write, while manager assignment and read-only roles remain distinct',async t=>{
 const f=await createScopedEdgeFixture(t,{start:false});
 const access=await f.op('access.get',{},f.ids.inspector);assert.equal(access.write,false);assert.equal(access.inspectionWriteAllowed,true);assert.equal(access.inspectionScopeVersion,1);
 const before=(await f.db.query('select (select count(*)::int from auth.users) users,(select count(*)::int from pi_gestao_private.pilot_access) pilot')).rows[0];
 let detail=await f.op('execution.start',{inspectionId:f.inspection.id,requestId:randomUUID()},f.ids.inspector);assert.equal(detail.canExecute,true);assert.equal(detail.canAssign,false);assert.equal(detail.writeAllowed,true);assert.equal(detail.administrativeWriteAllowed,false);
 detail=await f.op('execution.save',{inspectionId:detail.inspection.id,expectedVersion:detail.execution.version,requestId:randomUUID(),observedOn:'2026-10-28',answers:[{catalogItemId:'item-scoped-fixture',itemKey:'ITEM-SINTETICO',conditionId:'good-scoped',recommendationId:null,notCovered:false,photoIds:[]}]},f.ids.inspector);
 assert.equal(detail.execution.answers.length,1);assert.equal(detail.execution.createdBy,f.ids.inspector);
 await assert.rejects(f.op('execution.assign',{inspectionId:f.inspection.id,professionalId:f.professionals.admin,expectedVersion:detail.inspection.version,requestId:randomUUID()},f.ids.inspector),{code:'42501'});
 for(const action of ['assets.create','photos.create','sources.get','imports.preview','state.get','book.get','history.get','reports.system','execution.catalog.select'])await assert.rejects(f.op(action,{inspectionId:detail.inspection.id,assetId:f.asset.id,lvtItemId:detail.execution.items[0].lvtItemId,requestId:randomUUID()},f.ids.inspector),{code:'42501'},action);
 const planner=await f.createActivity({type:'espessura',assignee:'other'});assert.equal((await f.op('execution.get',{inspectionId:planner.inspection.id},f.ids.planner)).canExecute,false);
 await assert.rejects(f.op('execution.start',{inspectionId:planner.inspection.id,requestId:randomUUID()},f.ids.planner),{code:'42501'});
 assert.deepEqual((await f.db.query('select (select count(*)::int from auth.users) users,(select count(*)::int from pi_gestao_private.pilot_access) pilot')).rows[0],before);
});

test('assignment scope: own context and report exclude another assignment in the same owner/system/contract and filtered owners cannot reveal unrelated clients',async t=>{
 const f=await createScopedEdgeFixture(t),other=await f.createActivity({assignee:'admin',start:true});
 const unrelated=(await f.op('owners.create',{name:'OUTRO CLIENTE SINTÉTICO INACESSÍVEL',source:'Fixture'})).id;
 const own=await f.op('execution.context',{},f.ids.inspector);assert.equal(own.scopeMode,'assigned_inspector');assert.equal(own.inspectionScopeVersion,1);assert.equal(own.company.id,f.ownerId);
 assert.deepEqual(own.inspection.map(x=>x.id),[f.inspection.id]);assert.deepEqual(own.lvt.map(x=>x.id),[f.detail.execution.id]);assert.ok(!own.lvtItem.some(x=>x.lvtId===other.execution.id));assert.ok(!own.recordVersions.some(x=>[other.inspection.id,other.execution.id,...other.execution.items.map(x=>x.lvtItemId)].includes(x.id)));
 const owners=await f.apiCall('owners.list',{},f.ids.inspector);assert.deepEqual(owners.map(x=>x.id),[f.ownerId]);assert.ok(!JSON.stringify(owners).includes(unrelated));
 const report=await f.op('execution.report',{inspectionId:f.inspection.id},f.ids.inspector);assert.deepEqual(report.inspections.map(x=>x.id),[f.inspection.id]);assert.deepEqual(report.lvts.map(x=>x.id),[f.detail.execution.id]);assert.equal(report.canIssue,false);assert.equal(report.catalogBindings.length,1);
 for(const action of ['execution.get','execution.report','execution.context','execution.catalog'])await assert.rejects(f.op(action,{inspectionId:other.inspection.id},f.ids.inspector),{code:'42501'},action);
 await assert.rejects(f.apiCall('execution.context',{ownerId:unrelated,inspectionId:f.inspection.id},f.ids.inspector),{code:'22023'});
 await assert.rejects(f.apiCall('execution.context',{ownerId:unrelated},f.ids.inspector),{code:'42501'},'an empty context cannot reveal unrelated owner metadata');
 await assert.rejects(f.apiCall('execution.get',{ownerId:f.ownerId,inspectionId:f.inspection.id},f.ids.adminB,f.ids.tenantB),{code:'22023'});
});

test('assignment scope: photo commit and internal actor helpers are service-only, with no inspector-controlled actor or generic source grant',async t=>{
 const f=await createScopedEdgeFixture(t),op=await servicePhoto(f,f.detail);
 for(const role of ['anon','authenticated'])await assert.rejects(f.serial(()=>f.asRole(role,role==='authenticated'?f.ids.inspector:null,db=>db.query('select public.pi_gestao_execution_photo($1,$2,$3::jsonb)',[f.ids.tenantA,f.ids.adminA,JSON.stringify(op.payload)]))),{code:'42501'});
 for(const name of ['ga_execution_actor_scope','ga_execution_photo_scope','ga_execution_context','ga_execution_source','ga_execution_photo']){
  const allowed=(await f.db.query("select bool_or(has_function_privilege('authenticated',p.oid,'EXECUTE')) allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pi_gestao_private' and p.proname=$1",[name])).rows[0].allowed;assert.equal(allowed,false,name);
 }
 await assert.rejects(f.serial(()=>f.asRole('authenticated',f.ids.inspector,db=>db.query('select public.pi_gestao_register_source($1,$2,$3::jsonb)',[f.ids.tenantA,f.ids.inspector,JSON.stringify(op.payload.source)]))),{code:'42501'});
 const wrong=await f.createActivity({assignee:'admin',start:true});await assert.rejects(op.invoke({...op.payload,inspectionId:wrong.inspection.id,lvtItemId:wrong.execution.items[0].lvtItemId}),{code:'42501'});
 const linked=await op.invoke();assert.equal(linked.linked,true);assert.equal(linked.photo.inspectionId,f.inspection.id);assert.equal(linked.photo.lvtItemId,f.detail.execution.items[0].lvtItemId);assert.equal(linked.inspectionId,f.inspection.id);
});

test('assignment scope: contract and campaign projections use their own assigned inspections rather than the inspector global TAG set',async t=>{
 const f=await createScopedEdgeFixture(t),b=await f.op('assets.create',{unitId:f.unit.id,systemId:f.system.id,type:'linha',tag:'TAG-B-SOMENTE-FIXTURE',source:'Fixture'});
 const c2=await f.op('contracts.create',{requestId:randomUUID(),name:'C2 SOMENTE FIXTURE',source:'Fixture',modules:['integridade'],assetIds:[f.asset.id,b.id]});
 const ca2=await f.op('campaigns.create',{requestId:randomUUID(),name:'CAMPANHA C2 SOMENTE FIXTURE',source:'Fixture',contractId:c2.id,systemId:f.system.id,module:'integridade',assetIds:[f.asset.id,b.id],status:'rascunho'});
 const i2=await f.op('inspections.create',{requestId:randomUUID(),assetId:b.id,contractId:c2.id,campaignId:ca2.id,module:'integridade',type:'espessura',status:'planejada',source:'Fixture'});
 await f.op('execution.assign',{inspectionId:i2.id,professionalId:f.professionals.inspector,expectedVersion:i2.version,requestId:randomUUID()});
 await fixtureChange(f,"update pi_gestao_private.records set body=jsonb_set(jsonb_set(body,'{assetIds}',$1::jsonb),'{moduleAssetIds,integridade}',$1::jsonb) where id=$2",[JSON.stringify([f.asset.id,b.id]),f.contract.id]);
 await fixtureChange(f,"update pi_gestao_private.records set body=jsonb_set(body,'{assetIds}',$1::jsonb) where id=$2",[JSON.stringify([f.asset.id,b.id]),f.campaign.id]);
 const context=await f.op('execution.context',{},f.ids.inspector),contracts=new Map(context.contract.map(x=>[x.id,x])),campaigns=new Map(context.campaign.map(x=>[x.id,x]));
 assert.deepEqual(contracts.get(f.contract.id).assetIds,[f.asset.id]);assert.deepEqual(contracts.get(f.contract.id).moduleAssetIds.integridade,[f.asset.id]);assert.deepEqual(contracts.get(c2.id).assetIds,[b.id]);assert.deepEqual(campaigns.get(f.campaign.id).assetIds,[f.asset.id]);assert.deepEqual(campaigns.get(ca2.id).assetIds,[b.id]);assert.deepEqual(new Set(context.asset.map(x=>x.id)),new Set([f.asset.id,b.id]));
 for(const actor of [f.ids.planner,f.ids.assistant]){const state=await f.op('state.get',{},actor);assert.ok(state.asset.some(x=>x.id===b.id),'existing non-inspector read-only consultation is preserved');await assert.rejects(f.op('assets.create',{unitId:f.unit.id,systemId:f.system.id,type:'linha',tag:'NO-WRITE',source:'Fixture'},actor),{code:'42501'});}
});

test('assignment scope: canonical photo source is bound to current execution/item, repeat is stable and rechecks revoked assignment before returning a receipt',async t=>{
 const f=await createScopedEdgeFixture(t),op=await servicePhoto(f,f.detail),linked=await op.invoke(),same=await op.invoke();assert.equal(same.photo.id,linked.photo.id);
 const source=await f.op('execution.source',{inspectionId:f.inspection.id,lvtItemId:f.detail.execution.items[0].lvtItemId,sourceId:op.payload.source.sha},f.ids.inspector);assert.equal(source.sha,op.payload.source.sha);
 const saved=await f.op('execution.save',{inspectionId:f.inspection.id,expectedVersion:f.detail.execution.version,requestId:randomUUID(),observedOn:'2026-10-28',answers:[]},f.ids.inspector);
 assert.ok(saved.execution.version>op.payload.expectedVersion);assert.equal((await op.invoke()).photo.id,linked.photo.id);
 const authorize={inspectionId:f.inspection.id,lvtItemId:op.payload.lvtItemId,expectedVersion:op.payload.expectedVersion,requestId:op.payload.requestId};assert.equal((await f.op('execution.photo.authorize',authorize,f.ids.inspector)).canUpload,true);
 await assert.rejects(f.op('execution.photo.authorize',{...authorize,requestId:randomUUID()},f.ids.inspector),{code:'40001'});
 const other=await f.createActivity({assignee:'admin',start:true});
 await assert.rejects(f.op('execution.source',{inspectionId:other.inspection.id,sourceId:op.payload.source.sha},f.ids.inspector),{code:'42501'});
 await assert.rejects(f.op('execution.source',{inspectionId:f.inspection.id,lvtItemId:other.execution.items[0].lvtItemId,sourceId:op.payload.source.sha},f.ids.inspector),{code:'42501'});
 await assert.rejects(f.op('execution.source',{inspectionId:f.inspection.id,sourceId:'f'.repeat(64)},f.ids.inspector),{code:'42501'});
 await assert.rejects(op.invoke({...op.payload,source:{...op.payload.source,name:'MUDADO.png'}}),{code:'23505'});
 assert.equal((await f.db.query("select count(*)::int n from pi_gestao_private.records where kind='photo'")).rows[0].n,1);
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{assigneeProfessionalId}',to_jsonb($1::text)) where id=$2",[f.professionals.admin,f.inspection.id]);
 await assert.rejects(op.invoke(),{code:'42501'});await assert.rejects(f.op('execution.source',{inspectionId:f.inspection.id,sourceId:op.payload.source.sha},f.ids.inspector),{code:'42501'});
 await assert.rejects(f.op('execution.context',{},f.ids.inspector),{code:'42501'});assert.equal((await f.apiCall('owners.list',{},f.ids.inspector)).length,0);
});

test('assignment scope: failed atomic photo linkage rolls back new source/photo/receipt and retry preserves existing Storage object',async t=>{
 const f=await createScopedEdgeFixture(t),op=await servicePhoto(f,f.detail);
 await f.db.exec("create function pi_gestao_private.fixture_scoped_photo_failure() returns trigger language plpgsql as $$begin if new.kind='photo' then raise exception 'SCOPED_PHOTO_FIXTURE_FAILURE';end if;return new;end$$;create trigger fixture_scoped_photo_failure before insert on pi_gestao_private.records for each row execute function pi_gestao_private.fixture_scoped_photo_failure();");
 await assert.rejects(op.invoke(),/SCOPED_PHOTO_FIXTURE_FAILURE/);
 assert.equal((await f.db.query('select count(*)::int n from pi_gestao_private.sources where id=$1',[op.payload.source.sha])).rows[0].n,0);assert.equal((await f.db.query("select count(*)::int n from pi_gestao_private.operation_receipts where action='execution.photo.register'")).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from storage.objects where name=$1',[op.payload.source.objectKey])).rows[0].n,1);
 await f.db.exec('drop trigger fixture_scoped_photo_failure on pi_gestao_private.records;drop function pi_gestao_private.fixture_scoped_photo_failure();');
 const linked=await op.invoke();assert.equal((await op.invoke()).photo.id,linked.photo.id);assert.equal((await f.db.query('select count(*)::int n from pi_gestao_private.sources where id=$1',[op.payload.source.sha])).rows[0].n,1);
});

test('assignment scope: current identity, membership, pilot, professional, licence and campaign scope are revalidated on reads and attachment writes',async t=>{
 const f=await createScopedEdgeFixture(t),op=await servicePhoto(f,f.detail);await op.invoke();
 const changes=[
  ["update auth.fixture_users set verified=false where id=$1","update auth.fixture_users set verified=true where id=$1",f.ids.inspector],
  ["update public.pi_company_memberships set access_state='revoked' where user_id=$1","update public.pi_company_memberships set access_state='active' where user_id=$1",f.ids.inspector],
  ["update pi_gestao_private.pilot_access set revoked_at=now() where user_id=$1","update pi_gestao_private.pilot_access set revoked_at=null where user_id=$1",f.ids.inspector],
  ["update pi_team_private.professionals set access_revoked_at=now() where user_id=$1","update pi_team_private.professionals set access_revoked_at=null where user_id=$1",f.ids.inspector],
  ["update pi_access_private.fixture_licenses set active=false where company_id=$1","update pi_access_private.fixture_licenses set active=true where company_id=$1",f.ids.tenantA]
 ];
 for(const [deny,restore,id] of changes){await fixtureChange(f,deny,[id]);for(const action of ['execution.get','execution.report','execution.source'])await assert.rejects(f.op(action,{inspectionId:f.inspection.id,sourceId:op.payload.source.sha},f.ids.inspector),{code:'42501'},deny+' '+action);await assert.rejects(op.invoke(),{code:'42501'});await fixtureChange(f,restore,[id]);}
 const campaign=(await f.db.query('select body from pi_gestao_private.records where id=$1',[f.campaign.id])).rows[0].body;
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{assetIds}','[]') where id=$1",[f.campaign.id]);await assert.rejects(f.op('execution.context',{},f.ids.inspector),{code:'42501'});await assert.rejects(op.invoke(),{code:'42501'});await f.db.query('update pi_gestao_private.records set body=$1::jsonb where id=$2',[JSON.stringify(campaign),f.campaign.id]);
 await f.db.exec('update pi_access_private.tenant_rollout set writes_paused=true');assert.equal((await f.op('execution.get',{inspectionId:f.inspection.id},f.ids.inspector)).canExecute,false);await assert.rejects(op.invoke(),{code:'42501'});
 t.diagnostic('Programming day/15-day policy and independent PostgreSQL-session races are not established by these assignment-only PGlite cases.');
});
