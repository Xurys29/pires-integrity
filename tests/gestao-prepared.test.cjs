const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
async function fixture(t){const f=await setup();t.after(()=>f.close());await f.db.exec(read('../supabase/migrations/20261027162800_gestao_operacao_lvt_rti.sql'));await f.db.exec(read('fixtures/gestao-prepared-candidate.sql'));await f.db.exec(read('../supabase/migrations/20261027190611_gestao_line_list_batches.sql'));return f;}
const call=(f,a,p)=>f.call(f.ids.tenantA,a,p);
async function owner(f){return (await call(f,'owners.create',{name:'Perenco',source:'LOCAL FIXTURE ONLY'})).id;}
const catalog=JSON.parse(read('../supabase/functions/_shared/prepared-documents.private.json'));
const manifest=JSON.parse(read('../supabase/functions/_shared/perenco-line-list.private.json'));
const privateOptions={skip:process.env.PIRES_PRIVATE_FIXTURES!=='1'?'Requires authorized customer originals, excluded from public GitHub':false};
async function sources(f){for(const c of catalog){const ext=c.name.endsWith('.xlsx')?'xlsx':'pdf';await f.register(f.ids.tenantA,f.ids.adminA,{sha:c.sha,name:c.name,size:c.size,objectKey:await f.putObject(f.ids.tenantA,c.sha,c.size,ext),workbook:{format:'document_'+ext,sheets:[],metadata:{extraction:'not_performed'}}});}}
test('NR13: strict thresholds, fluid evidence, exclusions, tank no vessel category',async t=>{
 const f=await fixture(t),calc=async(type,inputs)=>(await f.db.query('select pi_gestao_private.ga_nr13_result($1,$2) r',[type,JSON.stringify(inputs)])).rows[0].r;
 const tank={pressureKpa:'0',volumeM3:'21',diameterM:'3.01',metal:'yes',support:'ground',tankDefinition:'yes',fluidCriterion:'combustible',temperatureC:'25',fluidEvidence:'FDS fixture'};
 assert.equal((await calc('tanque',tank)).scope,'covered');assert.equal((await calc('tanque',tank)).category,null);
 assert.equal((await calc('tanque',{...tank,diameterM:'3'})).scope,'not_covered');assert.equal((await calc('tanque',{...tank,volumeM3:'20'})).scope,'not_covered');
 assert.equal((await calc('tanque',{...tank,fluidEvidence:null})).scope,'pending');assert.equal((await calc('tanque',{...tank,pressureKpa:'103'})).scope,'pending');
 assert.equal((await calc('tanque',{...tank,support:'saddles'})).scope,'excluded');
 const tq=await calc('tanque',{pressureKpa:'0',volumeM3:'112.5',temperatureC:'25',metal:'yes',support:'unknown',tankDefinition:'unknown',geometry:'rectangular'});assert.equal(tq.scope,'pending');assert.equal(tq.missing.length,4);
 const vessel={pressureKpa:'1000',volumeM3:'2',diameterM:'1',fluidCriterion:'air',fluidEvidence:'Evidence',exclusionsReviewed:'yes',specificExclusion:'no'};
 assert.equal((await calc('vaso',vessel)).category,'IV');assert.equal((await calc('vaso',{...vessel,volumeM3:'1'})).category,null);assert.equal((await calc('vaso',{...vessel,volumeM3:'0.008'})).scope,'not_covered');
 assert.equal((await calc('vaso',{...vessel,diameterM:'0.149'})).scope,'excluded');assert.equal((await calc('vaso',{...vessel,fluidCriterion:'toxic',toxicPpm:'20'})).fluidClass,'A');
 assert.equal((await calc('caldeira',{...vessel,pressureKpa:'1960'})).category,'A');assert.equal((await calc('caldeira',{...vessel,pressureKpa:'60'})).scope,'not_covered');
 await assert.rejects(calc('vaso',{...vessel,volumeM3:'-1'}));
});
test('TQ book: originals required, PCH-2 distinct, atomic, idempotent, persistent and calculated',privateOptions,async t=>{
 const f=await fixture(t),ownerId=await owner(f);
 await assert.rejects(call(f,'perenco.tq_book',{ownerId}));assert.equal((await call(f,'state.get',{ownerId})).asset.length,0);
 await sources(f);const asset=await call(f,'perenco.tq_book',{ownerId});assert.equal(asset.tag,'TQ-04761');assert.equal(asset.classification.result.scope,'pending');assert.equal(asset.classification.result.missing.length,4);
 assert.equal((await call(f,'perenco.tq_book',{ownerId})).id,asset.id);
 const state=await call(f,'state.get',{ownerId});assert.equal(state.unit[0].name,'Plataforma de Cherne 2 (PCH-2)');assert.equal(state.document.length,3);assert.equal(state.rti.length,0);assert.equal(state.inspection.length,0);assert.equal(state.deadline.length,0);
 const base={ownerId,assetId:asset.id,sourceId:catalog[1].sha,locator:{page:1},inputs:{volumeM3:'112.5',pressureKpa:'0'}};
 await assert.rejects(call(f,'nr13.assess',{...base,result:{scope:'covered'}}),/servidor/);
 const c=await call(f,'nr13.assess',base);assert.equal((await call(f,'nr13.assess',base)).id,c.id);
 const other=(await call(f,'owners.create',{name:'Other fixture',source:'Fixture'})).id;
 await assert.rejects(call(f,'nr13.assess',{...base,ownerId:other}),/Vínculo/);
 await assert.rejects(f.call(f.ids.tenantB,'perenco.tq_book',{ownerId},f.ids.adminA),{code:'42501'});
 await f.db.query('update pi_gestao_private.pilot_access set revoked_at=now() where user_id=$1',[f.ids.adminA]);
 await assert.rejects(call(f,'perenco.tq_book',{ownerId}),{code:'42501'});
 for(const role of ['anon','authenticated'])await assert.rejects(f.asRole(role,f.ids.stranger,db=>db.query('select * from pi_gestao_private.records')),{code:'42501'});
});
test('PCH-1: exact source manifest, duplicates held, no formula imports, repeated run stable',privateOptions,async t=>{
 const f=await fixture(t),ownerId=await owner(f);await sources(f);
 const digest=(await f.db.query('select pi_gestao_private.ga_hash($1::jsonb) h',[JSON.stringify(manifest)])).rows[0].h;console.log('manifest sha256 canonical:',digest);
 const changed=structuredClone(manifest);changed.rows[0].tag='ALTERED';await assert.rejects(call(f,'line_lists.prepare',{ownerId,manifest:changed}),/diverge/);
 let result=await call(f,'line_lists.prepare',{ownerId,manifest});assert.equal(result.done,false);assert.equal(result.processed,100);
 const first=(await call(f,'state.get',{ownerId})).asset.map(a=>a.id);
 assert.equal((await call(f,'state.get',{ownerId})).campaign.length,0);
 const checkpoint=(await f.db.query("select id,consumed from pi_gestao_private.previews where body ? 'jobKey'")).rows[0];assert.equal(checkpoint.consumed,true);
 await assert.rejects(call(f,'imports.commit',{ownerId,previewId:checkpoint.id,confirm:true}));
 await f.db.query('update pi_gestao_private.pilot_access set revoked_at=now() where user_id=$1',[f.ids.adminA]);
 await assert.rejects(call(f,'line_lists.prepare',{ownerId,manifest}),{code:'42501'});
 await f.db.query('update pi_gestao_private.pilot_access set revoked_at=null where user_id=$1',[f.ids.adminA]);
 let batches=1;while(result.done===false){result=await call(f,'line_lists.prepare',{ownerId,manifest});batches++;assert.ok(batches<=18);}
 assert.equal(batches,18);assert.equal(result.importedCount,1380);assert.equal(result.pendingCount,389);assert.equal(result.duplicateRows,315);
 const state=await call(f,'state.get',{ownerId});assert.equal(state.asset.length,result.importedCount);assert.equal(state.rti.length,0);assert.equal(state.inspection.length,0);assert.equal(state.campaign.length,Object.keys(result.systems).length);
 assert.equal(state.campaign.length,23);assert.ok(first.every(id=>state.asset.some(a=>a.id===id)));assert.ok(state.campaign.every(c=>c.status==='rascunho'&&!c.plannedStart&&!c.plannedEnd));
 assert.ok(state.asset.every(a=>!manifest.rows.find(r=>r.row===a.source.locator.row)?.issues.length));
 assert.equal((await call(f,'line_lists.prepare',{ownerId,manifest})).id,result.id);assert.equal((await call(f,'state.get',{ownerId})).asset.length,result.importedCount);
 console.log('validated list:',JSON.stringify({imported:result.importedCount,pending:result.pendingCount,systems:state.system.length,campaigns:state.campaign.length}));
 const disk=await f.db.dumpDataDir(),reopened=await setup({loadDataDir:disk});try{assert.equal((await reopened.call(f.ids.tenantA,'state.get',{ownerId})).asset.length,result.importedCount);}finally{await reopened.close();}
});
test('Packaged originals: exact hashes and validators; no URL/credential fields',privateOptions,async()=>{
 const {preparedReader}=await import('../supabase/functions/_shared/prepared-originals.mjs'),{validateDocument}=await import('../supabase/functions/_shared/document-original.mjs');
 const reader=preparedReader(catalog);for(const c of catalog){assert.deepEqual(Object.keys(c).sort(),['base64','id','name','sha','size']);const original=await reader(c.id),envelope=await validateDocument(original.bytes,{name:c.name,mime:c.name.endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});assert.equal(envelope.format,original.format);assert.equal(envelope.metadata.extraction,'not_performed');}
 await assert.rejects(reader('arbitrary-url'));await assert.rejects(preparedReader([{...catalog[1],sha:'0'.repeat(64)}])(catalog[1].id));
});
