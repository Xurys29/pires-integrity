'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('PDF generators resolve the exact browser vendor bundle without injected constructors',()=>{
 const context=vm.createContext({console,TextEncoder,TextDecoder,atob,btoa,setTimeout,clearTimeout});
 for(const file of ['vendor/pdf.js','gestao-project-pdf.js','gestao-report-pdf.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../app',file),'utf8'),context);
 const result=vm.runInContext(`(()=>{
  const model={contract:{id:'fixture',name:'Projeto isolado'},client:{name:'Fixture'},module:'integridade',cutoff:'2026-10-27',scopeVersion:1,planVersion:0,modality:'visual',kpis:[],systems:[],series:[],lifecycle:[],priorities:[],photos:[]};
  const executive=PiresProjectPDF.createPdf(model,{id:'fixture-snapshot',contractId:'fixture',stateHash:'a'.repeat(64),createdAt:'2026-10-27T12:00:00Z'});
  const technical=PiresGestaoReportPDF.createPdf({generatedAt:'2026-10-27T12:00:00Z',company:{id:'o',name:'Fixture'},system:{id:'s',name:'Sistema isolado'},assets:[],inspections:[],lvts:[],lvtItems:[],photos:[],findings:[],rtis:[]});
  return {executive:executive.output().slice(0,5),technical:technical.doc.output().slice(0,5)};
 })()`,context);
 assert.equal(result.executive,'%PDF-');assert.equal(result.technical,'%PDF-');
});
