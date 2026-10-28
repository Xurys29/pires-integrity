'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{setup}=require('./fixtures/gestao-postgres-fixture.cjs'),M=require('../app/gestao-project-model.js');
async function fixture(t){const f=await setup();t.after(()=>f.close());await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');for(const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));return f;}
async function base(f,module='integridade'){
 const call=(action,payload={})=>f.call(f.ids.tenantA,action,payload),owner=await call('owners.create',{name:'Cliente isolado painel',source:'Fixture'}),ownerId=owner.id;
 const write=(action,payload={})=>call(action,{ownerId,requestId:randomUUID(),module,...payload});
 const h=await write('hierarchy.create',{unit:'U1',system:'S1'}),asset=await write('assets.create',{unitId:h.unit.id,systemId:h.system.id,type:'linha',tag:'L-01',source:'Fixture'});
 const c=await write('projects.create',{name:'Projeto isolado',source:'Pedido fixture',unit:'U1'});
 const project=(action,payload={})=>write('projects.'+action,{contractId:c.id,...payload});
 return {call,write,project,ownerId,h,asset,c,module};
}
async function source(f,b,rows){const sha='e'.repeat(64),objectKey=await f.putObject(f.ids.tenantA,sha,500);return f.register(f.ids.tenantA,f.ids.adminA,{sha,name:'Lista-isolada.xlsx',size:500,objectKey,workbook:{format:'xlsx',sheets:[{name:'Lista',maxRow:rows.length,maxColumn:4,rows:rows.map((values,j)=>({row:j+1,values}))}],metadata:{}}});}
async function scope(b,ids){const preview=await b.project('preview',{mode:'existing',ids});return b.project('scope',{previewId:preview.id,scopeMode:'replace',confirm:true,decisions:preview.rows.map(r=>({row:r.row,action:'link'}))});}
test('projects: scoped source preview, explicit decisions, idempotency and canonical identity',async t=>{
 const f=await fixture(t),b=await base(f);await source(f,b,[['L-01','U1','S1','linha'],['L-02','U1','S1','linha'],['DUP','U1','S1','linha'],['DUP','U1','S1','linha'],['','U1','S1','linha']]);
 const p=await b.project('preview',{sourceId:'e'.repeat(64),sheet:'Lista',start:1,end:5,mapping:{tag:'A',unit:'B',system:'C',type:'D'},basis:'Unidade e cliente conferidos na fixture'});
 assert.deepEqual(p.rows.map(r=>r.action),['link','new','review','review','review']);
 const input={ownerId:b.ownerId,module:b.module,contractId:b.c.id,requestId:randomUUID(),previewId:p.id,scopeMode:'replace',confirm:true,decisions:p.rows.map(r=>({row:r.row,action:r.action,reason:r.issues.join('; ')}))};
 const s=await b.call('projects.scope',input),again=await b.call('projects.scope',input);assert.equal(s.id,again.id);assert.equal(s.assetIds.length,2);assert.ok(s.assetIds.includes(b.asset.id));
 const state=await b.call('state.get',{ownerId:b.ownerId});assert.equal(state.asset.length,2);assert.equal(state.projectScope.length,1);assert.equal(state.projectDashboardVersion,1);
 const repeated=await b.project('preview',{sourceId:'e'.repeat(64),sheet:'Lista',start:1,end:2,mapping:{tag:'A',unit:'B',system:'C',type:'D'},basis:'Mesmo original'});assert.deepEqual(repeated.rows.map(r=>r.action),['link','link']);
 const append=await b.project('scope',{previewId:repeated.id,scopeMode:'append',confirm:true,decisions:repeated.rows.map(r=>({row:r.row,action:'link'}))});assert.equal(append.decisions.filter(r=>r.decision.action==='review').length,3,'adding accepted rows retains unresolved rows');
 await assert.rejects(b.project('scope',{...input,requestId:randomUUID()}),{code:'40001'});
 await scope(b,[b.asset.id]);const after=await b.call('state.get',{ownerId:b.ownerId});assert.equal(after.asset.length,2);assert.equal(after.projectScope.length,3);assert.equal(after.contract[0].assetIds.length,1);
 const model=M.build(after,b.c.id,b.module);assert.equal(model.kpis[0].value,1);assert.equal(model.kpis[1].value,null);assert.equal(model.series.length,0);
});
test('projects: planning, independent events, immutable snapshot, persistence and access denial',async t=>{
 const f=await fixture(t),b=await base(f);await scope(b,[b.asset.id]);const state=await b.call('state.get',{ownerId:b.ownerId}),sha='d'.repeat(64),objectKey=await f.putObject(f.ids.tenantA,sha,500,'pdf');
 await f.register(f.ids.tenantA,f.ids.adminA,{sha,name:'Evidencia-isolada.pdf',size:500,objectKey,workbook:{format:'document_pdf',sheets:[],metadata:{extraction:'not_performed'}}});
 const doc=await b.write('documents.create',{contractId:b.c.id,assetId:b.asset.id,module:'integridade',reference:'Evidência fixture',documentType:'outro',sourceId:sha,locator:{page:1}});
 const today=M.today(),tasks=['execution','review','issuance','acceptance'].map(stage=>({id:randomUUID(),name:stage,targetId:b.asset.id,targetKind:'asset',stage,modality:'visual',plannedDate:today,weight:1}));
 const plan=await b.project('plan',{expectedVersion:state.contract[0].version,tasks,basis:'Base isolada aprovada'});assert.equal(plan.planVersion,1);
 const eventInput={taskId:tasks[0].id,status:'done',on:today,responsible:'Fixture',evidenceDocumentId:doc.id,evidence:'Execução fixture'};await b.project('event',eventInput);
 const before=await b.call('state.get',{ownerId:b.ownerId}),model=M.build(before,b.c.id,b.module);assert.deepEqual(model.lifecycle.map(x=>x.done),[1,0,0,0]);assert.equal(model.series.at(-1).actual,100);
 const snapshot=await b.project('snapshot',{cutoff:today,modality:'visual'});assert.equal(snapshot.state.projectEvent.length,1);assert.equal(snapshot.stateHash.length,64);
 await b.project('event',{...eventInput,taskId:tasks[1].id,status:'submitted'});const frozen=await b.project('snapshot_get',{id:snapshot.id});assert.equal(frozen.state.projectEvent.length,1);
 const fresh=await b.call('state.get',{ownerId:b.ownerId});assert.ok(fresh.document.every(x=>x.recordClass!=='projectSnapshot'&&x.recordClass!=='projectPreview'));assert.equal(fresh.projectSnapshot[0].state,undefined);
 const other=await b.call('owners.create',{name:'Outro cliente isolado',source:'Fixture'});
 await assert.rejects(b.call('projects.snapshot_get',{ownerId:other.id,id:snapshot.id}),/Vínculo não encontrado/);
 await assert.rejects(f.call(f.ids.tenantA,'projects.snapshot_get',{ownerId:b.ownerId,id:snapshot.id},f.ids.stranger),{code:'42501'});
 const disk=await f.db.dumpDataDir(),reopened=await setup({loadDataDir:disk});try{const s=await reopened.call(f.ids.tenantA,'state.get',{ownerId:b.ownerId});assert.equal(s.projectPlan[0].id,plan.id);assert.equal(s.projectEvent.length,2);}finally{await reopened.close();}
 await f.db.query('update pi_gestao_private.pilot_access set revoked_at=now() where user_id=$1',[f.ids.adminA]);await assert.rejects(b.project('snapshot_get',{id:snapshot.id}),{code:'42501'});
});
test('projects: cross-module, stale plan, conflict and incomplete decisions cannot commit',async t=>{
 const f=await fixture(t),b=await base(f),p=await b.project('preview',{mode:'existing',ids:[b.asset.id]});
 await assert.rejects(b.project('scope',{previewId:p.id,scopeMode:'replace',confirm:true,decisions:[]}),/decisão/);
 await assert.rejects(b.project('preview',{module:'nr13',mode:'existing',ids:[b.asset.id]}),/Contrato não pertence/);
 await scope(b,[b.asset.id]);let state=await b.call('state.get',{ownerId:b.ownerId});
 await assert.rejects(b.project('plan',{expectedVersion:1,tasks:[],basis:'Fixture'}),{code:'40001'});
 const task={id:randomUUID(),name:'Serviço',targetKind:'asset',targetId:b.asset.id,stage:'execution',modality:'visual'};
 await assert.rejects(b.project('plan',{expectedVersion:state.contract[0].version,tasks:[task,{...task,id:randomUUID()}],basis:'Fixture'}),/Entrega repetida/);
 await assert.rejects(b.project('plan',{expectedVersion:state.contract[0].version,tasks:[{...task,modality:'certificacao'}],basis:'Fixture'}),/incompatível/);
 await source(f,b,[['l-01','U1','S1','linha']]);const conflict=await b.project('preview',{sourceId:'e'.repeat(64),sheet:'Lista',start:1,end:1,mapping:{tag:'A',unit:'B',system:'C',type:'D'},basis:'Fixture'});assert.equal(conflict.rows[0].action,'review');assert.equal(conflict.rows[0].existingId,b.asset.id);
 const other=await b.write('projects.create',{name:'Projeto B',source:'Fixture'});
 await assert.rejects(b.project('plan',{expectedVersion:state.contract[0].version,tasks:[{id:randomUUID(),name:'Inválida',targetId:other.id,targetKind:'asset',stage:'execution',modality:'visual',plannedDate:null}],basis:'Fixture'}),/Vínculo não encontrado/);
});
test('model: no attachment-based completion, distinct units and confirmed RTIs only',()=>{
 const c={id:'c',modules:['rtis'],assetIds:['a'],rtiIds:['h','r']},state={company:{id:'o',name:'Fixture'},contract:[c],asset:[{id:'a',type:'tanque'}],projectScope:[{contractId:'c',module:'rtis',scopeVersion:1,createdAt:M.today(),assetIds:['a'],rtiIds:['h','r']}],rti:[{id:'h',assetId:'a',status:'aberta',currentness:'unknown',due:'2000-01-01'},{id:'r',assetId:'a',status:'aberta',currentness:'confirmed_current',currentnessConfirmedAt:M.today(),currentnessEvidence:'Verificação fixture',due:'2000-01-01'}],document:[{id:'d',assetId:'a'}]};
 const m=M.build(state,'c','rtis');assert.deepEqual(m.kpis.map(k=>k.value),[2,0,1,1,1]);assert.equal(m.lifecycle[2].done,0);assert.equal(m.forecast,null);
});

test('projects: 1380 existing canonical links stay within the authenticated request budget',async t=>{
 const f=await fixture(t),b=await base(f);await f.db.query("insert into pi_gestao_private.records(tenant_id,owner_id,kind,body) select $1,$2,'asset',jsonb_build_object('tag','LOAD-'||n,'unitId',$3::text,'systemId',$4::text,'type','linha','technical',jsonb_build_object('sourceText',repeat('Technical fixture detail ',300))) from generate_series(1,1379) n",[f.ids.tenantA,b.ownerId,b.h.unit.id,b.h.system.id]);
 const rows=(await b.call('state.get',{ownerId:b.ownerId})).asset;
 const start=performance.now(),p=await b.project('preview',{mode:'existing',ids:rows.map(x=>x.id)}),previewMs=performance.now()-start;
 assert.ok(JSON.stringify(p).length<700000,'preview must contain bounded identity summaries, not technical bodies');
 const commitStart=performance.now(),s=await b.project('scope',{previewId:p.id,scopeMode:'replace',confirm:true,decisions:p.rows.map(r=>({row:r.row,action:'link'}))}),commitMs=performance.now()-commitStart;
 assert.equal(s.assetIds.length,1380);t.diagnostic(JSON.stringify({previewMs,commitMs}));assert.ok(previewMs<8000&&commitMs<8000,'each phase must finish inside the 8-second budget on the isolated database');
});
