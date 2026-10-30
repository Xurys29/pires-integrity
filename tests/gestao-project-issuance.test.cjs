'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/gestao-project-model.js');
const {jsPDF}=require('jspdf');
const PDF=require('../app/gestao-project-pdf.js');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const on=M.today();
 return {company:{id:'owner-fixture',name:'SYNTHETIC CLIENT'},asOf:on,contract:[{id:'C1',name:'SYNTHETIC CONTRACT',modules:['integridade'],assetIds:['A1']}],asset:[{id:'A1',tag:'SYNTHETIC-TAG',systemId:'S1'}],system:[{id:'S1',name:'SAME SYSTEM NAME'}],inspection:[],lvt:[],projectScope:[{id:'scope',contractId:'C1',module:'integridade',scopeVersion:1,assetIds:['A1'],createdAt:on}],projectPlan:[{id:'plan',contractId:'C1',module:'integridade',scopeVersion:1,planVersion:1,createdAt:on,tasks:[{id:'T1',name:'ADMINISTRATIVE ISSUANCE TASK',stage:'issuance',modality:'visual',targetKind:'asset',targetId:'A1',plannedDate:on}]}],projectEvent:[{id:'E1',contractId:'C1',module:'integridade',scopeVersion:1,planVersion:1,taskId:'T1',stage:'issuance',status:'done',on,createdAt:on,responsible:'SYNTHETIC OPERATOR',evidenceDocumentId:'D1',evidence:'ADMINISTRATIVE FIXTURE ONLY'}],document:[{id:'D1',contractId:'C1',module:'integridade',assetId:'A1',documentType:'outro',reference:'NOT A TECHNICAL REPORT',source:{sourceId:'a'.repeat(64)}}]};
}
test('issuance: administrative done remains visible without becoming technical issuance, including existing snapshot reload',()=>{
 const state=fixture(),before=JSON.stringify(state),model=M.build(state,'C1','integridade'),metric=model.kpis.find(x=>x.key==='issuance'),stage=model.lifecycle.find(x=>x.stage==='issuance');
 assert.equal(metric.value,null);assert.equal(metric.percent,null);assert.equal(metric.technicalAvailable,false);assert.equal(metric.administrativeCompleted,1);assert.deepEqual(metric.rows,[]);
 assert.equal(stage.done,null);assert.equal(stage.administrativeDone,1);assert.equal(stage.technicalAvailable,false);assert.equal(stage.records[0].status,'done');assert.equal(model.events[0].id,'E1');
 assert.equal(JSON.stringify(state),before,'Historical events, documents and statuses must remain unchanged.');
 const reload=M.build(JSON.parse(before),'C1','integridade');assert.deepEqual(reload.kpis.find(x=>x.key==='issuance'),metric);
});
test('issuance: attachments, metadata and completed planning stages cannot claim a technical report',()=>{
 const state=fixture(),on=M.today();
 state.inspection=[{id:'I1',contractId:'C1',module:'integridade',assetId:'A1',type:'visual',status:'concluida',done:on,evidence:'SYNTHETIC ADMINISTRATIVE EVIDENCE'}];
 state.lvt=[{id:'L1',inspectionId:'I1',assetId:'A1',contractId:'C1',status:'aprovada',signatureStatus:'assinada',issued:true}];
 state.document[0]={...state.document[0],documentType:'relatorio',status:'emitido',approved:true,signature:'IMAGE IS NOT A SIGNATURE ACT'};
 state.projectEvent[0]={...state.projectEvent[0],technicalAvailable:true,approved:true,issued:true};
 const model=M.build(state,'C1','integridade'),metric=model.kpis.find(x=>x.key==='issuance');
 assert.equal(metric.value,null);assert.equal(metric.administrativeCompleted,1);assert.equal(metric.technicalAvailable,false);assert.equal(model.lifecycle[2].done,null);
});
test('issuance: administrative progress respects contract, modality and cutoff without changing other module metrics',()=>{
 const state=fixture(),on=M.today(),prior='2026-01-01';
 state.contract.push({id:'C2',modules:['integridade'],assetIds:['A1']});
 state.projectEvent.push({...state.projectEvent[0],id:'E2',contractId:'C2'}, {...state.projectEvent[0],id:'E3',taskId:'OTHER-TASK'}, {...state.projectEvent[0],id:'E4'});
 let model=M.build(state,'C1','integridade');assert.equal(model.kpis.find(x=>x.key==='issuance').administrativeCompleted,1);
 assert.equal(model.events.length,3,'Repeated administrative events stay in history while their task is counted once.');
 model=M.build(state,'C1','integridade',{modality:'espessura'});assert.equal(model.kpis.find(x=>x.key==='issuance').administrativeCompleted,0);assert.equal(model.kpis.find(x=>x.key==='issuance').value,null);
 const historic=copy(state);historic.projectScope[0].createdAt=prior;historic.projectPlan[0].createdAt=prior;
 model=M.build(historic,'C1','integridade',{cutoff:prior});assert.equal(model.kpis.find(x=>x.key==='issuance').administrativeCompleted,0);assert.equal(model.kpis.find(x=>x.key==='issuance').value,null);
 const other=fixture();other.contract[0].modules=['rtis'];other.projectScope[0].module='rtis';other.projectPlan[0].module='rtis';other.projectPlan[0].tasks[0].modality='atendimento';other.projectEvent[0].module='rtis';
 assert.equal(M.build(other,'C1','rtis').lifecycle[2].done,1,'Unrelated administrative lifecycle remains compatible.');
 assert.equal(on,M.today());
});
test('issuance: executive summary also labels administrative events and unavailable technical issuance',async()=>{
 const model=M.build(fixture(),'C1','integridade'),rows=[];
 function Factory(options){const doc=new jsPDF(options),text=doc.text;doc.text=function(value,...args){rows.push(Array.isArray(value)?value.join(' '):String(value));return text.call(this,value,...args);};return doc;}
 PDF.createPdf(model,{contractId:'C1',stateHash:'b'.repeat(64),id:'SNAPSHOT-SYNTHETIC',createdAt:M.today()},{jsPDF:Factory});
 const text=rows.join('\n');assert.match(text,/Emissão técnica indisponível/);assert.match(text,/Tarefas concluídas administrativamente: 1/);assert.doesNotMatch(text,/null \/ 1/);assert.doesNotMatch(text,/Relatórios emitidos: 1/);
});
