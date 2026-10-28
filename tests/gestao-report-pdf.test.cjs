"use strict";
// All records and raster images here are isolated fixtures, never operational data.
const { test } = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto"),
  { zlibSync } = require("fflate"), { jsPDF } = require("jspdf"), Report = require("../app/gestao-report-pdf.js");
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height, rgb) {
  const chunk = (name, bytes) => {
    const type = Buffer.from(name), out = Buffer.alloc(bytes.length + 12);
    out.writeUInt32BE(bytes.length); type.copy(out, 4); Buffer.from(bytes).copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([type, Buffer.from(bytes)])), bytes.length + 8); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3, stripe = x < width / 8 || y < height / 8;
    raw.set(stripe ? [240, 212, 83] : rgb, offset);
  }
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array())]));
}
function fixture() {
  const systemId = "system-layout-fixture", assetId = "asset-layout-fixture", inspectionId = "inspection-layout-fixture", lvtId = "lvt-layout-fixture";
  const source = { sourceId: "a".repeat(64), fileHash: "a".repeat(64), fileName: "fonte-sintetica-layout.xlsx", format: "xlsx", locator: { sheet: "LVT fixture", row: 21 } };
  return {
    generatedAt: "2026-10-26T12:00:00Z", company: { id: "owner-layout-fixture", name: "FIXTURE DE LAYOUT — SEM INSPEÇÃO REAL" },
    system: { id: systemId, name: "SISTEMA SINTÉTICO PARA QA", version: 1 },
    campaign: { id: "campaign-layout-fixture", name: "Rascunho isolado de layout", systemId, status: "rascunho", version: 1 },
    contract: { id: "contract-layout-fixture", name: "Escopo sintético de QA", version: 1 },
    assets: [{ id: assetId, tag: "TAG-FIXTURE-LAYOUT", systemId, version: 3, operation: "nao_informado" }],
    inspections: [{ id: inspectionId, assetId, systemId, version: 1, done: null, sourceDate: "2024-07-30" }],
    lvts: [{ id: lvtId, assetId, systemId, inspectionId, version: 1, reference: "LVT-FIXTURE", sourceDate: "2024-07-30", source }],
    lvtItems: [
      { id: "item-A", assetId, inspectionId, systemId, lvtId, version: 1, itemKey: "10.1", component: "Componente repetido A", description: "Inspeção visual do componente A — dado sintético de layout.", source },
      { id: "item-B", assetId, inspectionId, systemId, lvtId, version: 2, itemKey: "10.1", component: "Componente repetido B", description: "Mesmo item textual em componente diferente; preservar identidade B.", source: { ...source, locator: { sheet: "LVT fixture", row: 22 } } },
      { id: "item-C", assetId, inspectionId, systemId, lvtId, version: 1, itemKey: "10.2", component: "Componente C", description: "Sem foto nem recomendação na fixture.", source: { ...source, locator: { sheet: "LVT fixture", row: 23 } } },
    ],
    photos: [
      { id: "photo-A", assetId, systemId, lvtId, lvtItemId: "item-A", caption: "FOTO SINTÉTICA A — paisagem azul, item A.", source },
      { id: "photo-B", assetId, systemId, lvtId, lvtItemId: "item-B", caption: "FOTO SINTÉTICA B — retrato vermelho, item B.", source: { ...source, locator: { sheet: "LVT fixture", row: 22 } } },
    ],
    findings: [{ id: "finding-A", assetId, systemId, lvtId, lvtItemId: "item-A", version: 1, description: "Achado sintético A para validar associação.", recommendation: "Recomendação sintética somente no item A.", sourceStatus: "pendente na fonte", sourceDate: "2024-07-30", currentness: "unknown", source }],
    rtis: [{ id: "rti-A", assetId, systemId, lvtItemId: "item-A", findingId: "finding-A", version: 1, title: "RTI sintética exclusiva da fixture", recommendation: "Recomendação sintética somente no item A.", issuedNumber: null, sourceStatus: "pendente na fonte", sourceDate: "2024-07-30", status: "atualidade_desconhecida", currentness: "unknown", due: null, cause: null, source }],
  };
}
function images() { return { "photo-A": { bytes: png(900,400,[30,100,180]), mime: "image/png" }, "photo-B": { bytes: png(300,800,[180,55,55]), mime: "image/png" } }; }
function capture(rows) {
  return function (options) {
    const doc = new jsPDF(options), original = doc.text;
    doc.text = function (value, x, y, ...rest) { rows.push({ text: Array.isArray(value) ? value.join("\n") : value, x, y, page: doc.getNumberOfPages() }); return original.call(doc,value,x,y,...rest); };
    return doc;
  };
}
test("PDF por sistema incorpora fotos no item correto, preserva repetidos e força rascunho", () => {
  const input = fixture(), before = JSON.stringify(input), rows = [], result = Report.createPdf(input,images(),{},capture(rows));
  assert.equal(JSON.stringify(input),before);
  assert.equal(result.metadata.draft,true); assert.equal(result.metadata.canIssue,false);
  assert.deepEqual(result.metadata.embeddedPhotoIds,["photo-A","photo-B"]);
  assert.deepEqual(result.metadata.photoPlacements.map(p=>[p.photoId,p.lvtItemId]),[["photo-A","item-A"],["photo-B","item-B"]]);
  assert.equal(result.metadata.photoPlacements[0].width/result.metadata.photoPlacements[0].height,900/400);
  assert.equal(result.metadata.photoPlacements[1].width/result.metadata.photoPlacements[1].height,300/800);
  assert.ok(result.metadata.photoPlacements.every(p=>p.x>=16&&p.x+p.width<=194.001&&p.y+p.height<278));
  const text=rows.map(r=>r.text).join("\n");
  for(const value of ["Componente repetido A","Componente repetido B","FOTO SINTÉTICA A","FOTO SINTÉTICA B","Situação atual não confirmada","Foto pendente/ausente na fonte","ID interno","número histórico","não definido"])assert.ok(text.includes(value),value);
  assert.ok(result.metadata.pending.some(v=>v.includes("item-C")));
  assert.ok(rows.every(r=>r.x>=0&&r.x<=210&&r.y>=0&&r.y<297));
  const pdf=Buffer.from(result.doc.output("arraybuffer"));
  assert.match(pdf.toString("latin1"),/\/Subtype \/Image/);
  assert.ok(pdf.byteLength>5000);
  assert.equal(result.doc.getGestaoSnapshot().snapshotId,result.metadata.snapshotId);
  assert.match(result.filename,/-RASCUNHO\.pdf$/);
  fs.mkdirSync(path.resolve(__dirname,"../output"),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,"../output/gestao-report-fixture.pdf"),pdf);
  fs.writeFileSync(path.resolve(__dirname,"../output/gestao-report-fixture-qa.json"),JSON.stringify({fixtureOnly:true,metadata:result.metadata,textRows:rows},null,2));
});
test("hash identifica snapshot canônico e não autentica ou aprova relatório",()=>{
  const input=fixture(), result=Report.snapshot(input), model=result.model;
  function sorted(value){return Array.isArray(value)?value.map(sorted):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;}
  const encoded=JSON.stringify(sorted({schema:Report.SCHEMA,generatorVersion:Report.VERSION,model}));
  assert.equal(result.snapshotId,"sha256:"+createHash("sha256").update(encoded).digest("hex"));
  const changed=fixture();changed.lvtItems[1].version++;
  assert.notEqual(Report.snapshot(changed).snapshotId,result.snapshotId);
  assert.throws(()=>Report.createPdf(input,images(),{issue:true},jsPDF),/Emissão definitiva/);
});
test("foto indisponível vira pendência e nunca é substituída ou buscada por URL",()=>{
  const rows=[],result=Report.createPdf(fixture(),{}, {},capture(rows));
  assert.deepEqual(result.metadata.embeddedPhotoIds,[]);
  assert.ok(result.metadata.pending.some(v=>v.includes("photo-A")));
  assert.ok(rows.some(r=>r.text.includes("bytes indisponíveis")||r.text.includes("indisponível")));
  assert.throws(()=>Report.createPdf(fixture(),{"photo-A":{bytes:png(2,2,[1,2,3]),mime:"image/svg+xml"}}, {},jsPDF),/JPEG\/PNG/);
});
test("IDs cruzados e item/componente repetidos não são mesclados por TAG ou rótulo",()=>{
  const input=fixture();input.photos[0].lvtItemId="item-inexistente";
  assert.throws(()=>Report.snapshot(input),/Foto\/achado/);
  const other=fixture();other.rtis[0].lvtItemId="item-B";
  assert.throws(()=>Report.snapshot(other),/RTI\/achado\/item/);
  const system=fixture();system.assets[0].systemId="outro-sistema";
  assert.throws(()=>Report.snapshot(system),/outro sistema|sistema explícito/);
  const duplicate=fixture();duplicate.lvtItems[1].id="item-A";
  assert.throws(()=>Report.snapshot(duplicate),/IDs canônicos/);
});
test("textos extensos paginam sem corte e incluem última recomendação/foto associada",()=>{
  const input=fixture();input.lvtItems[0].description="Texto extenso de QA e rastreabilidade. ".repeat(500)+" MARCADOR-FINAL-ITEM-A";
  input.findings[0].recommendation="Recomendação longa de QA. ".repeat(220)+" MARCADOR-FINAL-RECOMENDACAO";
  const rows=[],result=Report.createPdf(input,images(),{},capture(rows));
  const text=rows.map(r=>r.text).join("\n");
  assert.match(text,/MARCADOR-FINAL-ITEM-A/);assert.match(text,/MARCADOR-FINAL-RECOMENDACAO/);
  assert.ok(result.metadata.pageCount>5);
  assert.ok(rows.every(r=>r.y<297));
  assert.deepEqual(result.metadata.embeddedPhotoIds,["photo-A","photo-B"]);
});
test("snapshot rejeita getters/ciclos e não executa getters de dados externos",()=>{
  let ran=false;const input=fixture();Object.defineProperty(input,"trap",{enumerable:true,get(){ran=true;return 1;}});
  assert.throws(()=>Report.snapshot(input),/getters/);assert.equal(ran,false);
  const cyclic=fixture();cyclic.self=cyclic;assert.throws(()=>Report.snapshot(cyclic),/ciclos/);
});
test("relatório reúne várias TAGs do mesmo sistema sem unir itens por rótulo",()=>{
  const input=fixture(), source=input.lvtItems[0].source;
  input.assets.push({id:"asset-2",tag:"TAG-FIXTURE-LAYOUT",systemId:input.system.id,version:1});
  input.inspections.push({id:"inspection-2",assetId:"asset-2",systemId:input.system.id,version:1});
  input.lvts.push({id:"lvt-2",assetId:"asset-2",inspectionId:"inspection-2",systemId:input.system.id,source,version:1});
  input.lvtItems.push({id:"item-2",assetId:"asset-2",inspectionId:"inspection-2",lvtId:"lvt-2",systemId:input.system.id,itemKey:"10.1",component:"Componente independente da segunda TAG",source,version:1});
  const rows=[],result=Report.createPdf(input,images(),{},capture(rows));
  assert.equal(result.metadata.counts.assets,2);assert.equal(result.metadata.counts.items,4);
  assert.ok(rows.some(r=>r.text.includes("Componente independente da segunda TAG")));
  const crossed=fixture();crossed.lvtItems[0].campaignId="outra-campanha";
  assert.throws(()=>Report.snapshot(crossed),/outra campanha/);
});
