'use strict';
// Actual candidate SQL, isolated synthetic catalogues/identities/Storage only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const candidate=fs.readFileSync(path.join(__dirname,'../supabase/inspection-execution.sql'),'utf8');

async function fixture(t){
 const f=await setup();t.after(()=>f.close());
 await f.db.exec('create table public.pi_assessments(id uuid primary key);alter table public.pi_assessments enable row level security;');
 for(const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')&&!x.startsWith('20261026150913')).sort())await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await f.db.exec(candidate);f.professionalId=randomUUID();f.inspectorProfessionalId=randomUUID();
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 for(const [id,user] of [[f.professionalId,f.ids.adminA],[f.inspectorProfessionalId,f.ids.inspector]])await f.db.query('insert into pi_team_private.professionals(tenant_id,id,user_id,name,created_by,updated_by) values($1,$2,$3,$4,$5,$5)',[f.ids.tenantA,id,user,'PROFISSIONAL EXCLUSIVAMENTE SINTÉTICO DO CATÁLOGO',f.ids.adminA]);
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 f.ownerId=(await f.call(f.ids.tenantA,'owners.create',{name:'CLIENTE EXCLUSIVAMENTE SINTÉTICO DO CATÁLOGO',source:'Fixture isolada'})).id;
 f.rpc=(action,payload={},actor=f.ids.adminA)=>f.call(f.ids.tenantA,action,{ownerId:f.ownerId,...payload},actor);
 const h=await f.rpc('hierarchy.create',{unit:'UNIDADE SINTÉTICA CATÁLOGO',system:'SISTEMA SINTÉTICO CATÁLOGO'});f.system=h.system;
 f.asset=await f.rpc('assets.create',{unitId:h.unit.id,systemId:h.system.id,type:'linha',tag:'TAG-EXCLUSIVAMENTE-SINTÉTICA-CATÁLOGO',source:'Fixture'});
 f.contract=await f.rpc('contracts.create',{requestId:randomUUID(),name:'CONTRATO EXCLUSIVAMENTE SINTÉTICO CATÁLOGO',source:'Fixture',modules:['integridade'],assetIds:[f.asset.id]});
 f.campaign=await f.rpc('campaigns.create',{requestId:randomUUID(),name:'CAMPANHA EXCLUSIVAMENTE SINTÉTICA CATÁLOGO',source:'Fixture',contractId:f.contract.id,systemId:f.system.id,module:'integridade',assetIds:[f.asset.id],status:'rascunho'});
 f.inspection=async(type='visual',person=f.professionalId)=>{const i=await f.rpc('inspections.create',{requestId:randomUUID(),assetId:f.asset.id,contractId:f.contract.id,campaignId:f.campaign.id,module:'integridade',type,status:'planejada',source:'Fixture'});return f.rpc('execution.assign',{inspectionId:i.id,professionalId:person,expectedVersion:i.version,requestId:randomUUID()});};
 f.catalogue=async(overrides={})=>{
  const sha=createHash('sha256').update(randomUUID()).digest('hex');
  const original=await f.register(f.ids.tenantA,f.ids.adminA,{sha,name:'CATÁLOGO EXCLUSIVAMENTE SINTÉTICO.pdf',size:32,objectKey:await f.putObject(f.ids.tenantA,sha,32,'pdf'),workbook:{format:'document_pdf',sheets:[],metadata:{extraction:'not_performed'}}});
  const source={sourceId:original.id,fileHash:original.id,fileName:original.name,locator:{page:1}},id=randomUUID();
  const items=[{id:'synthetic-item',itemKey:'ITEM-SINTÉTICO',component:'COMPONENTE EXCLUSIVAMENTE SINTÉTICO',conditions:[{id:'condition',text:'CONDIÇÃO EXCLUSIVAMENTE SINTÉTICA',supportsGoodCondition:true,source}],recommendations:[]}];
  const value={id,original,items,versionLabel:'VERSÃO-1-EXCLUSIVAMENTE-SINTÉTICA',procedureReference:'PROCEDIMENTO EXCLUSIVAMENTE SINTÉTICO; SEM VALIDADE TÉCNICA',applicability:{inspectionTypes:['visual'],assetTypes:['linha'],contractIds:[f.contract.id],assetIds:[f.asset.id]},...overrides};
  await f.db.query('insert into pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id,source_id,source_locator,items,verified_by,verified_at,version_label,procedure_reference,applicability) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now(),$8,$9,$10::jsonb)',[f.ids.tenantA,f.ownerId,id,original.id,JSON.stringify({page:1}),JSON.stringify(value.items),f.ids.adminA,value.versionLabel,value.procedureReference,JSON.stringify(value.applicability)]);
  return value;
 };
 f.pinPayload=async(d,c)=>{d=await f.rpc('execution.get',{inspectionId:d.inspection.id});return {inspectionId:d.inspection.id,catalogId:c.id,expectedCatalogHash:d.catalogChoices.find(x=>x.id===c.id)?.contentHash||'0'.repeat(64),expectedVersion:d.inspection.version,requestId:randomUUID()};};
 f.pin=async(d,c,extra={})=>f.rpc('execution.catalog.select',{...await f.pinPayload(d,c),...extra});
 f.start=d=>f.rpc('execution.start',{inspectionId:d.inspection.id,requestId:randomUUID()});
 f.answer={catalogItemId:'synthetic-item',itemKey:'ITEM-SINTÉTICO',conditionId:'condition',recommendationId:null,notCovered:false,photoIds:[]};
 f.save=d=>f.rpc('execution.save',{inspectionId:d.inspection.id,expectedVersion:d.execution.version,requestId:randomUUID(),answers:[f.answer]});
 f.countBindings=async()=>Number((await f.db.query('select count(*) n from pi_gestao_private.inspection_catalog_bindings')).rows[0].n);
 return f;
}

test('catalogue binding: newest catalogue is never auto-selected and visual start requires explicit applicable pin; thickness stays separate',async t=>{
 const f=await fixture(t),c=await f.catalogue(),newer=await f.catalogue({versionLabel:'OUTRA VERSÃO SINTÉTICA'}),d=await f.inspection();
 assert.equal(d.catalog.id,null);assert.equal(d.catalogBinding.status,'not_selected');assert.equal(d.execution,null);assert.deepEqual(d.catalogChoices.map(x=>x.id).sort(),[c.id,newer.id].sort());
 await assert.rejects(f.start(d),{code:'22023'});assert.equal(await f.countBindings(),0);
 const measurement=await f.start(await f.inspection('espessura'));assert.equal(measurement.execution.type,'espessura');assert.equal(measurement.catalogBinding.status,'not_applicable');
});

test('catalogue binding: manager pins exact reviewed hash/version before start; replay, reload and execution keep immutable identity',async t=>{
 const f=await fixture(t),c=await f.catalogue();let d=await f.inspection();const payload=await f.pinPayload(d,c),firstVersion=d.inspection.version;
 d=await f.rpc('execution.catalog.select',payload);assert.equal(d.inspection.version,firstVersion+1);assert.equal(d.catalogBinding.status,'pinned');assert.match(d.catalogBinding.contentHash,/^[a-f0-9]{64}$/);assert.equal(d.catalogBinding.versionLabel,c.versionLabel);assert.equal(d.catalogBinding.procedureReference,c.procedureReference);assert.equal(d.catalogBinding.scope.assetId,f.asset.id);
 assert.deepEqual(await f.rpc('execution.catalog.select',payload),d);assert.equal(await f.countBindings(),1);
 const binding=d.catalogBinding;d=await f.start(d);assert.equal(d.execution.catalogBindingId,binding.id);assert.equal(d.execution.catalogHash,binding.contentHash);assert.equal(d.execution.catalogVersion,c.versionLabel);assert.deepEqual(d.catalog.items,c.items);
 const disk=await f.db.dumpDataDir(),r=await setup({loadDataDir:disk});try{const loaded=await r.call(f.ids.tenantA,'execution.get',{ownerId:f.ownerId,inspectionId:d.inspection.id});assert.deepEqual(loaded.catalogBinding,binding);assert.deepEqual(loaded.catalog,d.catalog);assert.equal(loaded.execution.id,d.execution.id);}finally{await r.close();}
});

test('catalogue binding: inspector cannot select or replace a catalogue even when assigned to that inspection',async t=>{
 const f=await fixture(t),c=await f.catalogue(),d=await f.inspection('visual',f.inspectorProfessionalId),payload=await f.pinPayload(d,c);
 const own=await f.rpc('execution.get',{inspectionId:d.inspection.id},f.ids.inspector);assert.deepEqual(own.catalogChoices,[]);assert.equal(own.canSelectCatalog,false);
 await assert.rejects(f.rpc('execution.catalog.select',payload,f.ids.inspector),{code:'42501'});assert.equal(await f.countBindings(),0);
});

test('catalogue binding: missing procedure/version or wrong modality, equipment, contract, TAG and owner never become applicable',async t=>{
 const f=await fixture(t);const d=await f.inspection();
 for(const override of [{versionLabel:null},{procedureReference:null},{applicability:null},{applicability:{inspectionTypes:['visual'],assetTypes:['linha'],contractIds:[f.contract.id,{}],assetIds:[f.asset.id]}},{applicability:{inspectionTypes:['espessura'],assetTypes:['linha'],contractIds:[f.contract.id],assetIds:[f.asset.id]}},{applicability:{inspectionTypes:['visual'],assetTypes:['vaso'],contractIds:[f.contract.id],assetIds:[f.asset.id]}},{applicability:{inspectionTypes:['visual'],assetTypes:['linha'],contractIds:[randomUUID()],assetIds:[f.asset.id]}},{applicability:{inspectionTypes:['visual'],assetTypes:['linha'],contractIds:[f.contract.id],assetIds:[randomUUID()]}}]){
  const c=await f.catalogue(override),detail=await f.rpc('execution.get',{inspectionId:d.inspection.id});assert.ok(!detail.catalogChoices.some(x=>x.id===c.id));await assert.rejects(f.pin(d,c),{code:'22023'});
 }
 const foreignId=randomUUID();await assert.rejects(f.rpc('execution.catalog.select',{...await f.pinPayload(d,{id:foreignId}),catalogId:foreignId}),{code:'22023'});assert.equal(await f.countBindings(),0);
});

test('catalogue binding: changed catalogue after choice review rejects stale expected hash and preserves prior selection',async t=>{
 const f=await fixture(t),c=await f.catalogue();let d=await f.inspection();const payload=await f.pinPayload(d,c);
 await f.db.query("update pi_gestao_private.inspection_catalogs set procedure_reference='OUTRO PROCEDIMENTO EXCLUSIVAMENTE SINTÉTICO' where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.ownerId,c.id]);
 await assert.rejects(f.rpc('execution.catalog.select',payload),{code:'40001'});assert.equal(await f.countBindings(),0);d=await f.pin(d,c);assert.equal(d.catalogBinding.status,'pinned');
 await assert.rejects(f.rpc('execution.catalog.select',{...payload,requestId:randomUUID()}),{code:'40001'});assert.equal(await f.countBindings(),1);
});

test('catalogue binding: live row mutation or a newer catalogue cannot change pinned phrases, source, applicability or draft on resume',async t=>{
 const f=await fixture(t),c=await f.catalogue();let d=await f.start(await f.pin(await f.inspection(),c));const pinned=JSON.parse(JSON.stringify(d.catalog)),binding=d.catalogBinding;
 const changed=JSON.parse(JSON.stringify(c.items));changed[0].conditions[0].text='TEXTO POSTERIOR EXCLUSIVAMENTE SINTÉTICO';changed[0].conditions[0].supportsGoodCondition='invalid';
 await f.db.query('update pi_gestao_private.inspection_catalogs set items=$1::jsonb,active=false,version_label=$2,procedure_reference=$3,applicability=$4::jsonb where tenant_id=$5 and owner_id=$6 and id=$7',[JSON.stringify(changed),'VERSÃO POSTERIOR SINTÉTICA','PROCEDIMENTO POSTERIOR SINTÉTICO',JSON.stringify({}),f.ids.tenantA,f.ownerId,c.id]);await f.catalogue({versionLabel:'MAIS NOVA SINTÉTICA'});
 d=await f.rpc('execution.get',{inspectionId:d.inspection.id});assert.deepEqual(d.catalog,pinned);assert.deepEqual(d.catalogBinding,binding);d=await f.save(d);assert.equal(d.execution.answers[0].conditionId,'condition');assert.deepEqual(d.catalog,pinned);assert.equal(await f.countBindings(),1);
 const report=await f.rpc('reports.system',{contractId:f.contract.id,systemId:f.system.id});const row=report.catalogBindings.find(x=>x.id===binding.id);assert.deepEqual(row.catalog,pinned);assert.equal(row.contentHash,binding.contentHash);
});

test('catalogue binding: same version cannot be reused with changed content; explicit pre-start new-version rebind preserves all history',async t=>{
 const f=await fixture(t),c=await f.catalogue();let d=await f.pin(await f.inspection(),c);const old=d.catalogBinding;
 const changed=JSON.parse(JSON.stringify(c.items));changed[0].conditions[0].text='NOVA FRASE EXCLUSIVAMENTE SINTÉTICA';
 await f.db.query('update pi_gestao_private.inspection_catalogs set items=$1::jsonb where tenant_id=$2 and owner_id=$3 and id=$4',[JSON.stringify(changed),f.ids.tenantA,f.ownerId,c.id]);await assert.rejects(f.pin(d,c),{code:'22023'});assert.equal(await f.countBindings(),1);
 await f.db.query("update pi_gestao_private.inspection_catalogs set version_label='VERSÃO-2-EXCLUSIVAMENTE-SINTÉTICA' where tenant_id=$1 and owner_id=$2 and id=$3",[f.ids.tenantA,f.ownerId,c.id]);d=await f.pin(d,c);assert.notEqual(d.catalogBinding.id,old.id);assert.equal(await f.countBindings(),2);
 const history=(await f.db.query('select snapshot from pi_gestao_private.inspection_catalog_bindings where id=$1',[old.id])).rows[0].snapshot;assert.deepEqual(history.items,c.items);d=await f.start(d);await assert.rejects(f.pin(d,c),{code:'22023'});assert.equal(await f.countBindings(),2);
});

test('catalogue binding: binding snapshots reject update/delete, and execution pointer tampering is detected before use',async t=>{
 const f=await fixture(t),c=await f.catalogue();let d=await f.start(await f.pin(await f.inspection(),c));
 await assert.rejects(f.db.query('update pi_gestao_private.inspection_catalog_bindings set snapshot=snapshot where id=$1',[d.catalogBinding.id]),{code:'55000'});
 await assert.rejects(f.db.query('delete from pi_gestao_private.inspection_catalog_bindings where id=$1',[d.catalogBinding.id]),{code:'55000'});
 const original=(await f.db.query('select * from pi_gestao_private.inspection_catalog_bindings where id=$1',[d.catalogBinding.id])).rows[0];
 for(const missing of ['catalog-id','inspection-scope']){
  const snapshot=JSON.parse(JSON.stringify(original.snapshot)),scope=JSON.parse(JSON.stringify(original.scope));if(missing==='catalog-id')delete snapshot.id;else delete scope.inspectionId;
  const hash=(await f.db.query('select pi_gestao_private.ga_hash($1::jsonb) hash',[JSON.stringify(snapshot)])).rows[0].hash;
  await assert.rejects(f.db.query('insert into pi_gestao_private.inspection_catalog_bindings(tenant_id,owner_id,inspection_id,catalog_id,source_id,snapshot,content_hash,scope,selected_by,selection_version) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10)',[original.tenant_id,original.owner_id,original.inspection_id,original.catalog_id,original.source_id,JSON.stringify(snapshot),hash,JSON.stringify(scope),original.selected_by,original.selection_version]),{code:'23514'});
 }
 await f.db.query("update pi_gestao_private.records set body=jsonb_set(body,'{catalogHash}',to_jsonb($2::text)) where id=$1",[d.execution.id,'0'.repeat(64)]);
 await assert.rejects(f.rpc('execution.get',{inspectionId:d.inspection.id}),{code:'22023'});
});

test('catalogue binding: restored legacy draft stays readable but cannot be silently pinned, edited or duplicated',async t=>{
 const f=await fixture(t),c=await f.catalogue();let d=await f.start(await f.pin(await f.inspection(),c));const id=d.execution.id;
 await f.db.query('update pi_gestao_private.inspection_executions set catalog_binding_id=null where execution_id=$1',[id]);
 await f.db.query("update pi_gestao_private.records set body=body-'catalogBindingId'-'catalogHash'-'catalogVersion' where id in ($1,$2)",[id,d.inspection.id]);
 d=await f.rpc('execution.get',{inspectionId:d.inspection.id});assert.equal(d.execution.id,id);assert.equal(d.catalogBinding.status,'legacy_unpinned');assert.equal(d.canExecute,false);assert.deepEqual(d.catalog.items,c.items);
 await assert.rejects(f.save(d),{code:'42501'});await assert.rejects(f.start(d),{code:'42501'});await assert.rejects(f.pin(d,c),{code:'22023'});assert.equal((await f.db.query('select count(*) n from pi_gestao_private.inspection_executions')).rows[0].n,1);
});

test('catalogue binding: pinned original remains required and unavailable bytes never trigger catalogue substitution',async t=>{
 const f=await fixture(t),c=await f.catalogue();let d=await f.start(await f.pin(await f.inspection(),c));await f.catalogue({versionLabel:'SUBSTITUTO SINTÉTICO NÃO SELECIONADO'});
 await f.db.query("delete from storage.objects where bucket_id='pi-gestao-sources' and name=$1",[f.ids.tenantA+'/'+c.original.id+'/original.pdf']);
 await assert.rejects(f.rpc('execution.get',{inspectionId:d.inspection.id}),{code:'22023'});assert.equal(await f.countBindings(),1);
});
