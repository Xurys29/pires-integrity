'use strict';
// Candidate SQL only, with synthetic Auth/licensing/Storage and PGlite. No real
// matrix, calendar, account, signature, remote database or backup is involved.
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createScopedEdgeFixture}=require('./fixtures/gestao-scoped-edge.cjs');

async function fixture(t,{timeline=true,pending=false}={}){
 const f=await createScopedEdgeFixture(t),p=await f.photo(f.detail);assert.equal(p.status,200);
 const dates=(await f.db.query('select current_date::text today,(current_date-4)::text observed,(current_date-3)::text changed,(current_date+45)::text due')).rows[0];Object.assign(f,dates);
 f.answer={catalogItemId:'item-scoped-fixture',itemKey:'ITEM-SINTETICO',conditionId:'action-scoped',recommendationId:'treat-scoped',notCovered:false,photoIds:[p.data.photo.id],pointLabel:'PONTO DA DECISÃO EXCLUSIVAMENTE SINTÉTICO',findingObservedAt:f.observed+'T12:34:56-03:00'};
 f.save=(detail=f.detail,date=f.observed,extra={})=>f.op('execution.save',{inspectionId:detail.inspection.id,expectedVersion:detail.execution.version,requestId:randomUUID(),observedOn:date,answers:[f.answer],...(timeline?{inspectionStartedOn:f.observed,inspectionEndedOn:date}:{}),...extra},f.ids.inspector);
 f.detail=await f.save(f.detail,pending?null:f.observed,pending?{inspectionStartedOn:null,inspectionEndedOn:null,answers:[{...f.answer,findingObservedAt:null}]}:{});f.rti=async()=>(await f.op('state.get')).rti.find(r=>r.executionId===f.detail.execution.id);
 f.input=(rti,extra={})=>({id:rti.id,expectedVersion:rti.version,requestId:randomUUID(),due:f.due,deadlineBasis:structuredClone(rti.deadlineAnchor),evidence:'DECISÃO MANUAL E JUSTIFICATIVA EXCLUSIVAMENTE SINTÉTICAS; SEM CÁLCULO OU MATRIZ.',...extra});
 f.decide=(input,actor=f.ids.adminA)=>f.op('rtis.update',input,actor);
 return f;
}
async function snapshot(f){const all={};for(const table of ['records','record_origins','record_relations','audit','operation_receipts'])all[table]=(await f.db.query('select to_jsonb(t) row from pi_gestao_private.'+table+' t order by to_jsonb(t)::text')).rows.map(x=>x.row);return all;}
async function rejectedUnchanged(f,input,code){const before=await snapshot(f);await assert.rejects(f.decide(input),{code});assert.deepEqual(await snapshot(f),before);}

test('manual deadline: capability, exact declared basis, decision identity and audit remain separate from an unlinked matrix',async t=>{
 const f=await fixture(t),rti=await f.rti(),input=f.input(rti,{due:f.observed});
 assert.equal((await f.op('access.get')).rtiDeadlineDecisionVersion,1);
 const result=await f.decide(input),d=result.deadlineDecision;
 assert.equal(result.due,f.observed,'same-day manual choice is allowed without inventing an immediate-risk rule');
 assert.equal(d.schemaVersion,1);assert.equal(d.mode,'manual');assert.equal(d.due,input.due);assert.equal(d.justification,input.evidence);assert.equal(d.actorUserId,f.ids.adminA);assert.equal(d.requestId,input.requestId);assert.ok(Number.isFinite(Date.parse(d.at)));
 assert.deepEqual(d.deadlineAnchor,rti.deadlineAnchor);assert.equal(d.basisRtiVersion,rti.version);assert.equal(d.policyStatus,'unlinked');assert.equal(d.policyId,null);assert.equal(d.policyVersion,null);assert.equal(result.deadlineReviewRequired,false);
 assert.deepEqual(result.history.at(-1).deadlineDecision,d);assert.equal(result.history.at(-1).actor,f.ids.adminA);
 const audit=(await f.db.query('select body from pi_gestao_private.audit where record_id=$1 order by seq',[rti.id])).rows.map(x=>x.body);
 assert.ok(audit.some(x=>x.record?.deadlineDecision?.requestId===input.requestId));
 for(const field of ['risk','classification','riskCategory','calendar','automaticDeadline','interval'])assert.equal(Object.hasOwn(d,field),false);
 assert.deepEqual(await f.decide(input),result,'response retry never creates another decision or history event');
});

test('manual deadline: missing, stale or invented basis, missing justification and date before inspection fail atomically',async t=>{
 const f=await fixture(t),rti=await f.rti();
 for(const [patch,code] of [
  [{deadlineBasis:undefined},'40001'],
  [{deadlineBasis:{...rti.deadlineAnchor,date:f.changed}},'40001'],
  [{deadlineBasis:{...rti.deadlineAnchor,executionVersion:rti.deadlineAnchor.executionVersion+1}},'40001'],
  [{deadlineBasis:{...rti.deadlineAnchor,inspectionId:randomUUID()}},'40001'],
  [{evidence:''},'22023'],
  [{evidence:true},'22023'],
  [{due:'2000-01-01'},'22023'],
  [{due:'2026-02-30'},'22023'],
  [{due:true},'22023'],
  [{due:null},'22023']
 ])await rejectedUnchanged(f,f.input(rti,patch),code);
 assert.equal((await f.rti()).due,undefined);
});

test('manual deadline: competing versions and changed replay content cannot replace a prior decision',async t=>{
 const f=await fixture(t),rti=await f.rti(),a=f.input(rti),b=f.input(rti,{evidence:'OUTRA DECISÃO MANUAL SOMENTE FIXTURE'});
 // The fixture serializes PGlite calls; this proves optimistic-version behavior,
 // not independent native PostgreSQL sessions or lock timing.
 const responses=await Promise.allSettled([f.decide(a),f.decide(b)]);
 assert.equal(responses.filter(x=>x.status==='fulfilled').length,1);assert.equal(responses.filter(x=>x.status==='rejected'&&x.reason.code==='40001').length,1);
 const current=await f.rti();assert.equal(current.history.length,1);assert.equal(current.deadlineDecision.requestId,a.requestId);
 await rejectedUnchanged(f,{...a,evidence:'REPLAY COM CONTEÚDO DIFERENTE SOMENTE FIXTURE'},'23505');
 const before=await snapshot(f);assert.deepEqual(await f.decide(a),current);assert.deepEqual(await snapshot(f),before);
});

test('manual deadline: field edit requires a new current decision; old receipt never clears a later review',async t=>{
 const f=await fixture(t),rti=await f.rti(),original=f.input(rti);await f.decide(original);
 f.detail=await f.save(f.detail,f.changed);let current=await f.rti();assert.equal(current.deadlineReviewRequired,true);assert.equal(current.due,f.due);assert.equal(current.deadlineDecision.deadlineAnchor.date,f.observed);
 const before=await snapshot(f),retry=await f.decide(original);assert.equal(retry.deadlineReviewRequired,true);assert.equal(retry.deadlineAnchor.date,f.changed);assert.deepEqual(await snapshot(f),before);
 const followup=await f.decide({id:current.id,expectedVersion:current.version,requestId:randomUUID(),evidence:'ACOMPANHAMENTO SEM NOVA DECISÃO DE PRAZO, SOMENTE FIXTURE'});
 assert.equal(followup.deadlineReviewRequired,true);assert.deepEqual(followup.deadlineDecision,current.deadlineDecision);current=followup;
 await rejectedUnchanged(f,f.input(current,{deadlineBasis:rti.deadlineAnchor}),'40001');
 const updated=await f.decide(f.input(current,{evidence:'REVISÃO MANUAL JUSTIFICADA APÓS ALTERAÇÃO DA DATA, SOMENTE FIXTURE'}));
 assert.equal(updated.deadlineReviewRequired,false);assert.equal(updated.deadlineDecision.deadlineAnchor.date,f.changed);assert.equal(updated.history.length,3);
 const decisions=updated.history.filter(event=>event.deadlineDecision);assert.equal(decisions.length,2);assert.equal(decisions[0].deadlineDecision.deadlineAnchor.date,f.observed);assert.equal(decisions[1].deadlineDecision.deadlineAnchor.date,f.changed);
 assert.equal(updated.due,f.due);assert.equal(updated.id,rti.id);assert.equal((await f.op('state.get')).rti.length,1);
});

test('manual deadline: inspector, unrelated tenant/owner/contract and closed RTI cannot receive a new decision',async t=>{
 const f=await fixture(t),rti=await f.rti(),input=f.input(rti),before=await snapshot(f);
 for(const actor of [f.ids.inspector,f.ids.planner,f.ids.assistant])await assert.rejects(f.decide(input,actor),{code:'42501'});
 await assert.rejects(f.apiCall('rtis.update',{ownerId:f.ownerId,...input},f.ids.adminB,f.ids.tenantB));
 await assert.rejects(f.decide({...input,ownerId:randomUUID()}));assert.deepEqual(await snapshot(f),before);
 const original=(await f.db.query('select body from pi_gestao_private.records where id=$1',[rti.id])).rows[0].body;
 for(const patch of [{contractId:randomUUID()},{executionId:randomUUID()},{deadlineAnchor:{...rti.deadlineAnchor,date:f.changed}},{status:'encerrada'}]){
  await f.db.query('update pi_gestao_private.records set body=$1::jsonb where id=$2',[JSON.stringify({...original,...patch}),rti.id]);
  await rejectedUnchanged(f,input,'22023');
 }
 await f.db.query('update pi_gestao_private.records set body=$1::jsonb where id=$2',[JSON.stringify(original),rti.id]);
});

test('manual deadline: legacy RTI keeps historical update semantics and receives no fabricated inspection decision',async t=>{
 const f=await fixture(t),legacy=(await f.db.query("select pi_gestao_private.ga_put($1,$2,'rti',$3::jsonb,$4) value",[f.ids.tenantA,f.ownerId,JSON.stringify({assetId:f.asset.id,title:'RTI LEGADA EXCLUSIVAMENTE SINTÉTICA',sourceDate:'2001-01-01',status:'atualidade_desconhecida',history:[]}),f.ids.adminA])).rows[0].value;
 const input={id:legacy.id,expectedVersion:legacy.version,requestId:randomUUID(),due:f.due,evidence:'PRAZO MANUAL LEGADO SEM MARCO COMPROVADO; SOMENTE FIXTURE'};
 const updated=await f.decide(input);assert.equal(updated.due,f.due);assert.equal(updated.version,legacy.version+1);assert.equal(updated.deadlineAnchor,undefined);assert.equal(updated.deadlineDecision,undefined);assert.equal(updated.deadlineReviewRequired,undefined);
 await rejectedUnchanged(f,{...input,expectedVersion:updated.version,requestId:randomUUID(),deadlineBasis:(await f.rti()).deadlineAnchor},'22023');
});

test('manual deadline: failure while recording the decision rolls back deadline, follow-up, audit and receipt together',async t=>{
 const f=await fixture(t),rti=await f.rti(),input=f.input(rti,{action:'AÇÃO DE ACOMPANHAMENTO SOMENTE FIXTURE'});
 await f.db.exec("create function pi_gestao_private.fixture_manual_decision_failure() returns trigger language plpgsql as $$begin if new.kind='rti' and new.body ? 'deadlineDecision' then raise exception 'isolated_manual_decision_failure';end if;return new;end$$;create trigger fixture_manual_decision_failure before update on pi_gestao_private.records for each row execute function pi_gestao_private.fixture_manual_decision_failure();");
 const before=await snapshot(f);await assert.rejects(f.decide(input),/isolated_manual_decision_failure/);assert.deepEqual(await snapshot(f),before);
 await f.db.exec('drop trigger fixture_manual_decision_failure on pi_gestao_private.records;drop function pi_gestao_private.fixture_manual_decision_failure();');
 const result=await f.decide(input);assert.equal(result.deadlineDecision.requestId,input.requestId);assert.equal(result.history.length,1);assert.equal(result.actions.length,1);
});

test('manual deadline: revocation is checked again before replaying a successful management receipt',async t=>{
 const f=await fixture(t),input=f.input(await f.rti());await f.decide(input);
 await f.db.query('update pi_gestao_private.pilot_access set revoked_at=now() where user_id=$1',[f.ids.adminA]);
 const before=await snapshot(f);await assert.rejects(f.decide(input),{code:'42501'});assert.deepEqual(await snapshot(f),before);
});

test('inspection timeline: legacy observation never becomes final inspection date or a valid new deadline basis',async t=>{
 const f=await fixture(t,{timeline:false}),legacy=await f.rti();
 assert.equal(f.detail.execution.inspectionEndedOn,undefined);assert.equal(legacy.deadlineAnchor.event,'inspection_performed');assert.equal(legacy.deadlineAnchor.date,f.observed);
 await rejectedUnchanged(f,f.input(legacy),'22023');
 f.detail=await f.save(f.detail,f.observed,{inspectionStartedOn:f.observed,inspectionEndedOn:f.changed});
 const current=await f.rti();assert.equal(current.deadlineAnchor.event,'inspection_completed');assert.equal(current.deadlineAnchor.date,f.changed);assert.equal(f.detail.execution.observedOn,f.observed);assert.equal(current.sourceDate,f.observed);assert.equal(current.findingObservedAt,f.answer.findingObservedAt);
 await rejectedUnchanged(f,f.input(current,{due:f.observed}),'22023');
 const decision=await f.decide(f.input(current,{due:f.changed}));assert.equal(decision.due,f.changed);assert.equal(decision.deadlineDecision.deadlineAnchor.date,f.changed);
 for(const key of ['inspectionEndedAt','inspectionEndTime','calendar','computedHours'])assert.equal(Object.hasOwn(f.detail.execution,key),false);
});

test('inspection timeline: draft treatment opens exactly one RTI before observation, end date or finding time is known',async t=>{
 const f=await fixture(t,{pending:true}),rti=await f.rti();
 assert.equal(f.detail.execution.observedOn,null);assert.equal(f.detail.execution.inspectionStartedOn,null);assert.equal(f.detail.execution.inspectionEndedOn,null);assert.equal(rti.findingObservedAt,null);assert.equal(rti.deadlineAnchor.event,'inspection_completed');assert.equal(rti.deadlineAnchor.date,null);assert.equal(rti.deadlineAnchor.status,'pending_inspection_end');assert.equal(rti.status,'aberta');assert.equal(rti.due,undefined);
 assert.equal((await f.op('state.get')).rti.length,1);await rejectedUnchanged(f,f.input(rti),'22023');
 await assert.rejects(f.op('execution.submit',{inspectionId:f.detail.inspection.id,expectedVersion:f.detail.execution.version,requestId:randomUUID()},f.ids.inspector),/data final da inspeção/);
 const saved=await f.save(f.detail,null,{inspectionStartedOn:null,inspectionEndedOn:null,answers:[{...f.answer,findingObservedAt:null}]});assert.equal(saved.execution.id,f.detail.execution.id);assert.equal((await f.rti()).id,rti.id);assert.equal((await f.op('state.get')).rti.length,1);
});

test('inspection timeline: explicit dates and finding offset are validated without guessed timezones or hours',async t=>{
 const f=await fixture(t),before=await snapshot(f);
 for(const extra of [
  {inspectionStartedOn:null,inspectionEndedOn:f.changed},
  {inspectionStartedOn:f.changed,inspectionEndedOn:f.observed},
  {inspectionStartedOn:true},
  {inspectionEndedOn:'2026-02-30'},
  {inspectionEndedOn:f.due},
  ...[true,'2026-02-30T12:00:00Z',f.observed+'T12:00:00',f.observed+'T12:00-03:00',f.observed+'T24:00:00Z',f.changed+'T12:00:00-03:00','2000-01-01T12:00:00Z',f.due+'T12:00:00Z'].map(findingObservedAt=>({answers:[{...f.answer,findingObservedAt}]}))
 ]){await assert.rejects(f.save(f.detail,f.observed,extra),{code:'22023'});assert.deepEqual(await snapshot(f),before);}
 const stamp=f.observed+'T09:10:11.123456+05:30';f.detail=await f.save(f.detail,f.observed,{answers:[{...f.answer,findingObservedAt:stamp}]});
 const state=await f.op('state.get'),item=state.lvtItem.find(x=>x.id===f.detail.execution.items[0].lvtItemId),finding=state.finding.find(x=>x.id===(state.rti[0].findingId));
 for(const record of [f.detail.execution.answers[0],item,finding,state.rti[0]])assert.equal(record.findingObservedAt,stamp);
 assert.equal(state.rti[0].source.findingObservedAt,stamp);assert.equal(state.rti[0].deadlineAnchor.date,f.observed);
});

test('inspection timeline: final submission needs saved end and finding timestamp but still does not approve, issue or close RTI',async t=>{
 const f=await fixture(t,{pending:true}),id=f.detail.inspection.id;
 f.detail=await f.save(f.detail,null,{inspectionStartedOn:f.observed,inspectionEndedOn:f.changed,answers:[{...f.answer,findingObservedAt:null}]});
 await assert.rejects(f.op('execution.submit',{inspectionId:id,expectedVersion:f.detail.execution.version,requestId:randomUUID()},f.ids.inspector),/data\/hora do achado/);
 f.detail=await f.save(f.detail,null,{inspectionStartedOn:f.observed,inspectionEndedOn:f.changed,answers:[f.answer]});
 const input={inspectionId:id,expectedVersion:f.detail.execution.version,requestId:randomUUID()},sent=await f.op('execution.submit',input,f.ids.inspector),replay=await f.op('execution.submit',input,f.ids.inspector);
 assert.equal(sent.execution.status,'em_revisao');assert.equal(sent.execution.signatureStatus,'pendente');assert.equal(replay.execution.version,sent.execution.version);assert.equal(sent.execution.deadlineAnchor.event,'inspection_completed');assert.equal(sent.execution.deadlineAnchor.date,f.changed);assert.equal((await f.rti()).status,'aberta');assert.notEqual(sent.inspection.status,'concluida');
 await assert.rejects(f.op('rtis.update',f.input(await f.rti()),f.ids.inspector),{code:'42501'});
});

test('inspection timeline: changing or clearing final date preserves the old manual decision and requires review',async t=>{
 const f=await fixture(t),original=await f.decide(f.input(await f.rti()));
 f.detail=await f.save(f.detail,f.observed,{inspectionStartedOn:f.observed,inspectionEndedOn:f.changed});let rti=await f.rti();
 assert.equal(rti.deadlineReviewRequired,true);assert.equal(rti.due,original.due);assert.deepEqual(rti.deadlineDecision,original.deadlineDecision);assert.equal(rti.deadlineAnchor.date,f.changed);
 f.detail=await f.save(f.detail,f.observed,{inspectionEndedOn:null});rti=await f.rti();assert.equal(rti.deadlineAnchor.event,'inspection_completed');assert.equal(rti.deadlineAnchor.date,null);assert.equal(rti.deadlineAnchor.status,'pending_inspection_end');assert.equal(rti.deadlineReviewRequired,true);assert.equal(rti.due,original.due);assert.deepEqual(rti.deadlineDecision,original.deadlineDecision);
 await rejectedUnchanged(f,f.input(rti),'22023');
 const audit=(await f.db.query('select body from pi_gestao_private.audit where record_id=$1 order by seq',[rti.id])).rows.map(x=>x.body);assert.ok(audit.some(x=>x.previous?.deadlineAnchor?.date===f.observed&&x.record?.deadlineAnchor?.date===f.changed));
});

test('inspection timeline: omitted dates and finding timestamp preserve the exact explicit declarations',async t=>{
 const f=await fixture(t),{findingObservedAt,...answer}=f.answer;
 const saved=await f.op('execution.save',{inspectionId:f.detail.inspection.id,expectedVersion:f.detail.execution.version,requestId:randomUUID(),answers:[answer]},f.ids.inspector);
 assert.equal(saved.execution.observedOn,f.observed);assert.equal(saved.execution.inspectionStartedOn,f.observed);assert.equal(saved.execution.inspectionEndedOn,f.observed);assert.equal(saved.execution.answers[0].findingObservedAt,findingObservedAt);assert.equal((await f.rti()).findingObservedAt,findingObservedAt);
});
