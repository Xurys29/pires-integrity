"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261027162800_gestao_operacao_lvt_rti.sql'),'utf8');
async function fixture(t){const f=await setup();t.after(()=>f.close());await f.db.exec(migration);return f;}
const call=(f,action,payload)=>f.call(f.ids.tenantA,action,payload);
async function base(f){const owner=await call(f,'owners.create',{name:'Cliente isolado v2',source:'Fixture isolada'}),ownerId=owner.id,h=await call(f,'hierarchy.create',{ownerId,unit:'U',system:'S'}),asset=await call(f,'assets.create',{ownerId,unitId:h.unit.id,systemId:h.system.id,type:'linha',tag:'LINHA-FIXTURE',source:'Registro isolado'}),con=await call(f,'contracts.create',{ownerId,requestId:randomUUID(),name:'Escopo fixture',source:'Fixture',modules:['integridade'],assetIds:[asset.id]}),campaign=await call(f,'campaigns.create',{ownerId,requestId:randomUUID(),name:'Campanha fixture',contractId:con.id,systemId:h.system.id,module:'integridade',assetIds:[asset.id],source:'Fixture',status:'rascunho'}),inspection=await call(f,'inspections.create',{ownerId,requestId:randomUUID(),assetId:asset.id,contractId:con.id,campaignId:campaign.id,module:'integridade',type:'visual',status:'planejada',source:'Fixture'});return {ownerId,h,asset,con,campaign,inspection};}
async function original(f,ownerId,assetId){const sha=createHash('sha256').update(randomUUID()).digest('hex'),src=await f.register(f.ids.tenantA,f.ids.adminA,{sha,name:'evidencia-fixture.pdf',size:100,objectKey:await f.putObject(f.ids.tenantA,sha,100,'pdf'),workbook:{format:'document_pdf',sheets:[],metadata:{extraction:'not_performed'}}});return call(f,'documents.create',{ownerId,assetId,module:'rtis',documentType:'outro',reference:'Evidência isolada',sourceId:src.id,locator:{page:1}});}
test('v2: preenchimento LVT, RTI automática atômica, status independente e encerramento com evidência',async t=>{
 const f=await fixture(t),b=await base(f),{ownerId,asset,inspection}=b,today=(await f.db.query('select current_date::text as d')).rows[0].d;
 const lvt=await call(f,'field_lvts.create',{ownerId,requestId:randomUUID(),inspectionId:inspection.id,observedOn:today,inspector:'Inspetor fixture'}),input={ownerId,requestId:randomUUID(),lvtId:lvt.id,itemKey:'1.1',component:'Suporte fixture',condition:'Constatação fixture',observations:'Observação fixture',recommendation:'Recomendação fixture'},item=await call(f,'field_items.create',input);
 assert.ok(item.rti.id);assert.equal(item.rti.status,'aberta');assert.equal(item.rti.lvtItemId,item.id);
 assert.equal((await call(f,'field_items.create',input)).rti.id,item.rti.id);
 assert.equal((await call(f,'field_items.create',{...input,requestId:randomUUID()})).id,item.id);
 await assert.rejects(call(f,'field_items.create',{...input,requestId:randomUUID(),recommendation:'Outra'}),{code:'23505'});
 const noFinding=await call(f,'field_items.create',{...input,requestId:randomUUID(),itemKey:'1.2',recommendation:''});assert.equal(noFinding.rti,undefined);
 await assert.rejects(call(f,'field_items.create',{...input,requestId:randomUUID(),itemKey:'1.3',recommendation:'Não se aplica'}),/artificial/);
 let state=await call(f,'state.get',{ownerId});assert.equal(state.rti.length,1);assert.equal(state.lvtItem.length,2);
 const op=await call(f,'assets.operation',{ownerId,requestId:randomUUID(),assetId:asset.id,expectedVersion:asset.version||1,operation:'em_operacao',evidence:'Declaração real simulada na fixture isolada'});assert.equal(op.operation,'em_operacao');
 const cards=require('../app/gestao-asset-cards.js');assert.equal(cards.describe(op,state).rti.open,true);assert.equal(cards.describe(op,state).operation.tone,'green');
 const update={ownerId,requestId:randomUUID(),id:item.rti.id,expectedVersion:1,responsible:'Responsável fixture',due:null,action:'Ação fixture',evidence:'Acompanhamento fixture'},rti=await call(f,'rtis.update',update);assert.equal(rti.version,2);assert.equal(rti.actions.length,1);assert.equal((await call(f,'rtis.update',update)).version,2);
 await assert.rejects(call(f,'rtis.update',{...update,requestId:randomUUID()}),{code:'40001'});
 await assert.rejects(call(f,'rtis.update',{...update,requestId:randomUUID(),expectedVersion:2,status:'encerrada',confirmedOn:today,reinspection:'Verificação fixture'}),/evidência/);
 const doc=await original(f,ownerId,asset.id),closed=await call(f,'rtis.update',{...update,requestId:randomUUID(),expectedVersion:2,status:'encerrada',confirmedOn:today,reinspection:'Reinspeção fixture',evidenceDocumentId:doc.id});assert.equal(closed.status,'encerrada');assert.equal(closed.history.length,2);
 const done=await call(f,'inspections.update',{ownerId,requestId:randomUUID(),id:inspection.id,expectedVersion:1,status:'concluida',done:today,evidence:'Execução documentada fixture'});assert.equal(done.status,'concluida');
 await assert.rejects(call(f,'field_items.create',{...input,requestId:randomUUID(),itemKey:'1.4'}),/concluída/);
 const book=await call(f,'book.get',{ownerId,assetId:asset.id});assert.ok(book.records.some(r=>r.id===closed.id));
 const report=await call(f,'reports.system',{ownerId,systemId:asset.systemId});assert.equal(report.lvtItems.length,2);assert.equal(report.rtis[0].id,closed.id);
});
test('v2: histórico não vira atual, falha na RTI desfaz item e confirmação precisa ser de hoje',async t=>{
 const f=await fixture(t),{ownerId,inspection}=await base(f),lvt=await call(f,'field_lvts.create',{ownerId,requestId:randomUUID(),inspectionId:inspection.id,observedOn:'2020-01-01',inspector:'Histórico fixture'}),input={ownerId,requestId:randomUUID(),lvtId:lvt.id,itemKey:'1',component:'Ponto',condition:'Condição fixture',recommendation:'Recomendação fixture'},item=await call(f,'field_items.create',input);
 assert.equal(item.rti.currentness,'unknown');assert.equal(item.rti.status,'atualidade_desconhecida');
 await assert.rejects(call(f,'rtis.update',{ownerId,requestId:randomUUID(),id:item.rti.id,expectedVersion:1,status:'aberta',confirmedOn:'2020-01-01',evidence:'Fonte antiga'}),/hoje/);
 await f.db.exec("create function pi_gestao_private.fixture_v2_failure() returns trigger language plpgsql as $$ begin if new.kind='rti' then raise exception 'RTI failure fixture';end if;return new;end $$;create trigger fixture_v2_failure before insert on pi_gestao_private.records for each row execute function pi_gestao_private.fixture_v2_failure()");
 await assert.rejects(call(f,'field_items.create',{...input,requestId:randomUUID(),itemKey:'2'}),/RTI failure/);
 assert.equal((await call(f,'state.get',{ownerId})).lvtItem.length,1);
});
test('v2: equipamento, certificado, relação explícita e book sem duplicar certificado; limites de cliente',async t=>{
 const f=await fixture(t),{ownerId,h,asset}=await base(f),doc=await original(f,ownerId,asset.id),origin={sourceId:doc.source.sourceId,locator:{page:2}},v=await call(f,'assets.register',{ownerId,requestId:randomUUID(),systemId:h.system.id,type:'valvula',tag:'PSV-FIXTURE',...origin}),certificate=await call(f,'certificates.create',{ownerId,requestId:randomUUID(),assetId:v.id,reference:'Certificado fixture',...origin}),link=await call(f,'asset_links.create',{ownerId,requestId:randomUUID(),assetId:asset.id,toAssetId:v.id,reference:'P&ID fixture',kind:'valvula_psv',basis:'Vínculo explícito fixture',sourceId:origin.sourceId,locator:{page:3}});
 assert.equal(certificate.assetId,v.id);assert.equal(link.fromAssetId,asset.id);
 const state=await call(f,'state.get',{ownerId});assert.equal(state.certificate.length,1);assert.equal(state.relations[0].id,link.id);
 const book=await call(f,'book.get',{ownerId,assetId:asset.id});assert.ok(book.relatedRecords.some(r=>r.id===certificate.id));
 const other=await call(f,'owners.create',{name:'Outro cliente fixture v2',source:'Fixture'});
 await assert.rejects(call(f,'asset_links.create',{ownerId:other.id,requestId:randomUUID(),assetId:asset.id,toAssetId:v.id,reference:'Não vincular',kind:'valvula_psv',basis:'Fixture',...origin}),/Vínculo não encontrado/);
 await assert.rejects(call(f,'certificates.create',{ownerId,requestId:randomUUID(),assetId:asset.id,reference:'Não certificar',...origin}),/válvula cadastrada/);
 await assert.rejects(call(f,'assets.register',{ownerId,requestId:randomUUID(),systemId:h.system.id,type:'valvula',tag:'PSV-FIXTURE',...origin}),/já existe/);
});
test('v2: acesso exato e RLS preservados, recibo não contorna revogação',async t=>{
 const f=await fixture(t),{ownerId,asset}=await base(f),input={ownerId,requestId:randomUUID(),assetId:asset.id,expectedVersion:1,operation:'em_operacao',evidence:'Fixture'};
 await call(f,'assets.operation',input);
 await f.db.query('update pi_gestao_private.pilot_access set revoked_at=now() where user_id=$1',[f.ids.adminA]);
 await assert.rejects(call(f,'assets.operation',input),{code:'42501'});
 await assert.rejects(f.asRole('anon',null,db=>db.query('select public.pi_gestao_api($1,$2,$3)',[f.ids.tenantA,'assets.operation',JSON.stringify(input)])),{code:'42501'});
 for(const role of ['authenticated','service_role'])await assert.rejects(f.asRole(role,f.ids.master,db=>db.query('select * from pi_gestao_private.operation_receipts')),{code:'42501'});
});
test('v2: medições, enquadramento e prazos exigem origem e permanecem após reabertura',async t=>{
 const f=await fixture(t),{ownerId,h,asset,campaign,con}=await base(f),doc=await original(f,ownerId,asset.id),origin={sourceId:doc.source.sourceId,locator:{page:4}},today=(await f.db.query('select current_date::text as d')).rows[0].d;
 const equipment=await call(f,'assets.register',{ownerId,requestId:randomUUID(),systemId:h.system.id,type:'vaso',tag:'VASO-FIXTURE',...origin});
 const classification=await call(f,'classifications.create',{ownerId,requestId:randomUUID(),assetId:equipment.id,reference:'Documento fixture',scope:'covered',category:'II',responsible:'Responsável fixture',basis:'Conclusão documental fixture',...origin});
 assert.equal(classification.classificationMethod,'documented');
 await assert.rejects(call(f,'classifications.create',{ownerId,requestId:randomUUID(),assetId:asset.id,reference:'Doc fixture',scope:'covered',category:'II',responsible:'Fixture',basis:'Fixture',...origin}),/Categoria incompatível/);
 const deadline=await call(f,'deadlines.create',{ownerId,requestId:randomUUID(),assetId:equipment.id,reference:'Prazo fixture',type:'interna',due:'2027-01-10',sourceId:origin.sourceId,locator:{page:5}});assert.equal(deadline.due,'2027-01-10');
 const ins=await call(f,'inspections.create',{ownerId,requestId:randomUUID(),assetId:asset.id,contractId:con.id,campaignId:campaign.id,module:'integridade',type:'espessura',status:'planejada',source:'Fixture'}),input={ownerId,requestId:randomUUID(),assetId:asset.id,inspectionId:ins.id,reference:'ME fixture',measuredOn:today,readings:[{point:'P01',value:'3.20',unit:'mm'}],...origin},measurement=await call(f,'measurements.create',input);assert.equal(measurement.readings[0].value,'3.20');
 await assert.rejects(call(f,'measurements.create',{...input,requestId:randomUUID(),readings:[{point:'P01',value:'-2',unit:'mm'}]}),/Leitura/);
 await assert.rejects(call(f,'measurements.create',{...input,requestId:randomUUID(),assetId:equipment.id}),/mesmo ativo/);
 const state=await call(f,'state.get',{ownerId}),cards=require('../app/gestao-asset-cards.js');assert.equal(cards.describe(equipment,state).nr13.scope,'covered');assert.equal(cards.describe(equipment,state).nr13.category,'II');assert.equal(state.measurement.length,1);
 const disk=await f.db.dumpDataDir(),reopened=await setup({loadDataDir:disk});try{const restored=await reopened.call(f.ids.tenantA,'state.get',{ownerId});assert.equal(restored.measurement[0].id,measurement.id);assert.equal(restored.classification[0].id,classification.id);}finally{await reopened.close();}
});
