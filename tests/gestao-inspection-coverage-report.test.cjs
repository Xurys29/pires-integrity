'use strict';
// Real local Edge core, PostgreSQL candidate and report/PDF helper. All Auth,
// licensing, Storage, originals and choices remain isolated synthetic fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createScopedEdgeFixture,IMAGE}=require('./fixtures/gestao-scoped-edge.cjs');
const {jsPDF}=require('jspdf');
const Report=require('../app/gestao-tag-report.js');

test('multiline coverage survives inspector save, reload and individual draft PDF',async t=>{
 const f=await createScopedEdgeFixture(t);let detail=f.detail;
 const uploaded=await f.photo(detail);assert.equal(uploaded.status,200);assert.equal(uploaded.data.linked,true);
 const photoId=uploaded.data.photo.id,definition=f.catalogItems[0];
 for(const description of ['TRECHO SINTÉTICO A\nLIMITE SINTÉTICO B','TRECHO SINTÉTICO A\r\nLIMITE SINTÉTICO B','TRECHO SINTÉTICO A\tLIMITE SINTÉTICO B']){
  const saved=await f.send('execution-save',{inspectionId:detail.inspection.id,expectedVersion:detail.execution.version,requestId:randomUUID(),observedOn:'2026-10-28',outcome:'good_condition',coverage:{extent:'declared_section',description,photoIds:[photoId]},answers:[{catalogItemId:definition.id,itemKey:definition.itemKey,conditionId:'good-scoped',recommendationId:null,notCovered:false,photoIds:[photoId],pointLabel:null}]});
  assert.equal(saved.status,200);assert.equal(saved.data.execution.coverage.description,description);
  detail=(await f.send('execution/'+detail.inspection.id)).data;
  assert.equal(detail.execution.coverage.description,description);
  const response=await f.send('execution/'+detail.inspection.id+'/report');assert.equal(response.status,200);
  const scope={ownerId:f.ownerId,contractId:f.contract.id,systemId:f.system.id,assetId:f.asset.id,inspectionId:detail.inspection.id,executionId:detail.execution.id};
  const record=await Report.freeze({scope,detail,snapshot:response.data});
  const pdf=await Report.createPdf(record,new Map([[photoId,{bytes:IMAGE,mime:'image/png'}]]),{},jsPDF);
  assert.equal(record.content.execution.coverage.description,description);
  assert.equal(pdf.metadata.coverage.description,description);assert.equal(pdf.metadata.coverage.extent,'declared_section');
  assert.deepEqual(pdf.metadata.embeddedPhotoIds,[photoId]);assert.equal(pdf.metadata.canIssue,false);
  assert.equal(pdf.metadata.draft,true);assert.equal(record.content.rtis.length,0);
  assert.ok(pdf.doc.output('arraybuffer').byteLength>1000);
 }
});
