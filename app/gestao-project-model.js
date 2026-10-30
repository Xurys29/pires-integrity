(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.PiresProjectModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const stages={execution:'Execução',review:'Revisão',issuance:'Emissão',acceptance:'Aceite',received:'Recebimento',test:'Ensaio'};
 const modalities={visual:'Visual',espessura:'Espessura',interna:'Interna',externa:'Externa',atendimento:'Atendimento',certificacao:'Certificação'};
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
 const day=x=>String(x||'').slice(0,10),date=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'')&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
 const latest=xs=>xs.at(-1),pct=(n,d)=>d>0?Math.round(n/d*100):null;
 function build(state,contractId,module,filters={}){
  const c=(state.contract||[]).find(x=>x.id===contractId&&x.recordClass!=='commercial_reference'&&x.modules?.includes(module));
  if(!c)throw Error('Projeto não disponível neste cliente e módulo.');
  const cutoff=filters.cutoff||today();if(!date(cutoff)||cutoff>today())throw Error('Data de corte inválida.');
  const modality=filters.modality||({integridade:'visual',nr13:'externa',rtis:'atendimento',valvulas:'certificacao'}[module]);
  if(!modalities[modality])throw Error('Modalidade inválida.');
  const source=(key)=>(state[key]||[]).filter(x=>x.contractId===c.id&&x.module===module),scope=latest(source('projectScope').filter(x=>day(x.createdAt)<=cutoff));
  const ids=new Set(scope?.assetIds||(c.scopeVersion?[]:c.moduleAssetIds?.[module]||c.assetIds||[])),assets=(state.asset||[]).filter(x=>ids.has(x.id)),confirmed=!!scope;
  const inspections=(state.inspection||[]).filter(x=>x.contractId===c.id&&x.module===module&&ids.has(x.assetId)&&(!x.createdAt||day(x.createdAt)<=cutoff));
  const sameMode=x=>(x.type||x.modality)===modality,ins=inspections.filter(sameMode),doneIns=ins.filter(x=>x.status==='concluida'&&date(x.done)&&x.done<=cutoff&&!!(x.executionSource||x.executionEvidence||x.evidence||x.history?.some(e=>e.evidence)));
  const plans=source('projectPlan').filter(x=>day(x.createdAt)<=cutoff&&x.scopeVersion===(scope?.scopeVersion||0)),plan=latest(plans),tasks=(plan?.tasks||[]).filter(x=>x.modality===modality);
  const events=source('projectEvent').filter(x=>x.on<=cutoff&&x.evidenceDocumentId&&x.evidence&&x.responsible);
  const taskEvents=t=>{
   const list=events.filter(x=>x.taskId===t.id),inspection=t.stage==='execution'&&t.targetKind==='inspection'?doneIns.find(x=>x.id===t.targetId):null;
   if(inspection)list.push({taskId:t.id,status:'done',on:inspection.done,createdAt:inspection.updatedAt||inspection.done,evidence:inspection.executionSource,origin:'inspection'});
   return list.sort((a,b)=>a.on.localeCompare(b.on)||(a.createdAt||'').localeCompare(b.createdAt||''));
  };
  const eventFor=t=>latest(taskEvents(t));
  const statusFor=t=>eventFor(t)?.status||'pending';
  const taskDone=t=>statusFor(t)==='done';
  const rtis=(state.rti||[]).filter(x=>module==='rtis'?(scope?.rtiIds||c.rtiIds||[]).includes(x.id):x.contractId===c.id&&ids.has(x.assetId));
  const cards=root.PiresAssetCards||(typeof require==='function'?require('./gestao-asset-cards.js'):null);
  const current=x=>cards?.describeRti(x)||{open:false,currentness:'unknown'};
  const opened=rtis.filter(x=>current(x).open&&day(x.currentnessConfirmedAt)<=cutoff),closed=rtis.filter(x=>current(x).currentness==='confirmed_current'&&x.status==='encerrada'&&day(x.currentnessConfirmedAt)<=cutoff&&(x.closureDocumentId&&x.reinspection&&x.closureEvidence));
  const result={contract:c,module,client:state.company,scope,scopeVersion:scope?.scopeVersion||0,plan,planVersion:plan?.planVersion||0,cutoff,modality,updatedAt:state.asOf||null,assets,inspections:ins,rtis,tasks,events,kpis:[],systems:[],priorities:[],photos:[],series:[],forecast:null};
  const metric=(key,label,rows,unit,definition,base=null,known=true)=>({key,label,value:known?rows.length:null,rows,unit,definition,denominator:base,percent:known&&base!==null?pct(rows.length,base):null});
  const taskMetric=(stage,label)=>{const all=tasks.filter(x=>x.stage===stage);return metric(stage,label,all.filter(taskDone),'entregas',`Eventos de ${stages[stage].toLowerCase()} concluídos, com data, responsável e documento de evidência. Cada etapa é independente.`,all.length||null,!!plan&&all.length>0);};
  // Planning events remain administrative history. This version has no verified
  // technical issuance lifecycle; no event, attachment or caller-supplied status
  // can stand in for a reviewed and signed individual inspection report.
  const technicalIssuanceMetric=()=>({...metric('issuance','Relatórios tecnicamente emitidos',[],'relatórios','Emissão técnica ainda indisponível neste fluxo. Eventos do planejamento registram progresso administrativo e não comprovam revisão, assinatura ou emissão de relatório.',tasks.filter(x=>x.stage==='issuance').length||null,false),technicalAvailable:false,administrativeCompleted:tasks.filter(x=>x.stage==='issuance'&&taskDone(x)).length});
  const inspectionMetric=()=>{const planned=tasks.filter(x=>x.stage==='execution');return planned.length?metric('execution','Inspeções realizadas',planned.filter(taskDone),'serviços de inspeção','Serviços da modalidade concluídos com evidência; tarefas ligadas a uma inspeção acompanham sua execução automaticamente.',planned.length):metric('execution','Inspeções realizadas',doneIns,'inspeções','Inspeções concluídas com data e evidência, na modalidade selecionada. A base contém inspeções explicitamente planejadas, não o número de ativos.',ins.length||null,ins.length>0);};
  if(module==='integridade'){
   result.kpis=[metric('scope','Ativos no escopo',assets,'ativos únicos','Identidades únicas vinculadas à versão do escopo selecionada.',null,confirmed),inspectionMetric(),metric('review','LVTs em revisão',tasks.filter(t=>t.stage==='review'&&['submitted','in_progress','returned'].includes(statusFor(t))),'entregas','Entregas de revisão com evento aberto, sem conclusão. Ter uma LVT anexada não equivale a revisão.',null,!!plan&&tasks.some(x=>x.stage==='review')),technicalIssuanceMetric(),metric('rtis','RTIs originadas',rtis,'RTIs','RTIs vinculadas ao contrato e ao ativo de origem. A situação histórica permanece separada da atual.',null,confirmed)];
  }else if(module==='rtis'){
   result.kpis=[metric('scope','RTIs do escopo',rtis,'RTIs','Mesmos IDs de RTI incluídos explicitamente neste projeto; contrato de origem preservado.',null,confirmed),metric('execution','Atendimento concluído',closed,'RTIs','Encerramentos confirmados com evidência documental e reinspeção.',rtis.length||null,confirmed),metric('open','Abertas confirmadas',opened,'RTIs','Somente abertura atual confirmada com data e evidência.',null,confirmed),metric('overdue','RTIs vencidas',opened.filter(x=>date(x.due)&&x.due<cutoff),'RTIs','Abertas confirmadas com prazo documentado anterior à data de corte.',null,confirmed),metric('unassigned','Sem responsável',opened.filter(x=>!x.responsible),'RTIs','Abertas confirmadas sem responsável registrado.',null,confirmed)];
  }else if(module==='nr13'){
   const overdue=(state.deadline||[]).filter(x=>ids.has(x.assetId)&&date(x.due)&&x.due<cutoff&&!inspections.some(i=>i.assetId===x.assetId&&i.type===x.type&&i.status==='concluida'&&date(i.done)&&i.done>=x.due&&i.done<=cutoff));
   result.kpis=[metric('scope','Equipamentos do escopo',assets,'equipamentos','Equipamentos explicitamente incluídos no projeto NR-13.',null,confirmed),inspectionMetric(),metric('books','Books com pendências',assets.filter(x=>cards?.describe(x,state).book.pending?.length),'equipamentos','Pendências documentais identificadas no book. Não altera enquadramento ou situação operacional.',null,confirmed),metric('overdue','Inspeções vencidas',overdue,'prazos documentados','Prazos documentados vencidos sem execução vinculada comprovada na mesma modalidade.',null,confirmed),metric('rtiAssets','Ativos com RTI aberta',assets.filter(x=>(state.rti||[]).some(r=>r.assetId===x.id&&current(r).open)),'equipamentos','Ativos com pelo menos uma RTI atual confirmada aberta, independentemente da operação.',null,confirmed)];
  }else{
   result.kpis=[metric('scope','Válvulas do escopo',assets,'válvulas','Válvulas e PSVs explicitamente vinculadas ao projeto.',null,confirmed),taskMetric('received','Recebidas'),taskMetric('execution','Execução concluída'),taskMetric('test','Ensaios concluídos'),taskMetric('issuance','Certificados emitidos')];
  }
  result.lifecycle=['execution','review','issuance','acceptance'].map(stage=>{const administrativeDone=tasks.filter(x=>x.stage===stage&&taskDone(x)).length,unavailable=module==='integridade'&&stage==='issuance';return {stage,label:unavailable?'Emissão técnica':stages[stage],total:tasks.filter(x=>x.stage===stage).length,done:unavailable?null:administrativeDone,administrativeDone,...(unavailable?{technicalAvailable:false}:{}),records:tasks.filter(x=>x.stage===stage).map(x=>({...x,status:statusFor(x),event:eventFor(x)}))};});
  for(const s of state.system||[]){const a=assets.filter(x=>x.systemId===s.id);if(!a.length)continue;const set=new Set(a.map(x=>x.id)),plannedTasks=tasks.filter(t=>t.stage==='execution'&&set.has(t.targetKind==='asset'?t.targetId:(state[t.targetKind]||[]).find(x=>x.id===t.targetId)?.assetId)),planned=plannedTasks.length?plannedTasks:ins.filter(x=>set.has(x.assetId)),done=plannedTasks.length?plannedTasks.filter(taskDone):doneIns.filter(x=>set.has(x.assetId));result.systems.push({...s,assets:a,planned:planned.length,done:done.length,unit:plannedTasks.length?'serviços':'inspeções',percent:pct(done.length,planned.length)});}
  result.priorities=opened.map(x=>({kind:'rti',id:x.id,assetId:x.assetId,title:x.title||x.recommendation||'RTI aberta',responsible:x.responsible||null,due:x.due||null}));
  result.pendingRows=(scope?.decisions||[]).filter(x=>x.decision?.action==='review');
  for(const review of (state.document||[]).filter(x=>x.recordClass==='line_list_review'&&x.contractId===c.id))for(const r of review.pendingRows||[])result.pendingRows.push({...r,sourceId:review.source?.sourceId,origin:'source_review'});
  if(result.pendingRows.length)result.priorities.unshift({kind:'scope',title:`${result.pendingRows.length} linhas do escopo em revisão`});
  for(const t of tasks.filter(t=>date(t.plannedDate)&&t.plannedDate<cutoff&&!taskDone(t)))result.priorities.push({kind:'task',id:t.id,title:t.name,due:t.plannedDate,responsible:t.responsible||null});
  const insIds=new Set(inspections.map(x=>x.id)),lvts=(state.lvt||[]).filter(x=>insIds.has(x.inspectionId)),lvtIds=new Set(lvts.map(x=>x.id)),items=(state.lvtItem||[]).filter(x=>lvtIds.has(x.lvtId)),itemIds=new Set(items.map(x=>x.id));
  result.photos=(state.photo||[]).filter(x=>itemIds.has(x.lvtItemId)).map(x=>({...x,item:items.find(i=>i.id===x.lvtItemId)}));
  const execution=tasks.filter(x=>x.stage==='execution'),dated=execution.filter(x=>date(x.plannedDate));
  if(execution.length&&dated.length===execution.length){
   const dates=[...new Set([...dated.map(x=>x.plannedDate),...execution.map(t=>eventFor(t)?.on).filter(Boolean),cutoff])].sort();
   result.series=dates.map(d=>({date:d,planned:pct(execution.filter(x=>x.plannedDate<=d).length,execution.length),actual:d<=cutoff?pct(execution.filter(t=>latest(taskEvents(t).filter(e=>e.on<=d))?.status==='done').length,execution.length):null}));
   const completions=execution.filter(taskDone).map(t=>eventFor(t).on).sort(),unique=[...new Set(completions)],elapsed=unique.length>1?(Date.parse(unique.at(-1))-Date.parse(unique[0]))/86400000:0;
   if(completions.length>=3&&unique.length>=3&&elapsed>=7&&completions.length<execution.length){const rate=(completions.length-1)/elapsed,remaining=execution.length-completions.length,estimate=new Date(Date.parse(cutoff)+Math.ceil(remaining/rate)*86400000).toISOString().slice(0,10);result.forecast={date:estimate,method:'Estimativa linear em dias corridos pelo ritmo entre a primeira e a última conclusão; pressupõe continuidade do ritmo.',observations:completions.length};}
  }
  result.statusFor=statusFor;return result;
 }
 return Object.freeze({build,today,date,pct,stages,modalities});
});
