'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { jsPDF } = require('jspdf');
const PDF = require('../app/calculator-pdf.js');
const NRPDF = require('../app/nr13-pdf.js');
const C = require('../app/calculations.js');
const N = require('../app/nr13.js');
const { fixture } = require('./calculator-pdf.fixture.cjs');
const base = { tag:'TESTE-NR13',service:'Ar comprimido - teste fictício',material:'Aço carbono - teste',pmtaTask:'nr13',nrProfile:'cylindrical',nrSource:'Documento fictício do equipamento',nrHead:'elliptical',nrMaterialKind:'metal',nrExclusion:'none',nrFluid:'air',nrFluidSource:'Ar comprimido sem outro perigo determinante - teste',nrDiameter:'1500',nrDiameterUnit:'mm',nrVolume:'7.068583471',nrVolumeUnit:'m3',nrPressure:'8',nrPressureUnit:'bar',nrRegime:'positive' };
function nr(changes={}) { const inputs={...base,...changes}; return {type:'pmta',inputs,results:N.assess(inputs),version:'0.6.0',engineVersion:N.VERSION,createdAt:'2026-10-20T12:00:00Z',sources:[N.SOURCE],note:'Avaliação indicativa, revisão técnica pendente.',recommendations:'Conferir documentação e revisar com responsável técnico.'}; }
function capture(rows,images) { return function Constructor(options) { const doc=new jsPDF({...options,compress:false}),text=doc.text,addImage=doc.addImage; doc.text=function(content,x,y,opts){ rows.push({text:Array.isArray(content)?content.join('\n'):content,x,y,page:doc.internal.getCurrentPageInfo().pageNumber}); return text.call(doc,content,x,y,opts); }; doc.addImage=function(...args){images.push({page:doc.internal.getCurrentPageInfo().pageNumber,x:args[2],y:args[3],w:args[4],h:args[5]}); return addImage.apply(doc,args);}; return doc; }; }
const text=rows=>rows.map(row=>row.text).join('\n');
function png(width=120,height=60) {
  function crc(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;}
  function chunk(type,data){const name=Buffer.from(type),n=Buffer.alloc(4),tail=Buffer.alloc(4);n.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([n,name,data,tail]);}
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc((1+width*3)*height,210);for(let y=0;y<height;y++)raw[y*(1+width*3)]=0;
  return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
test('PMTA v3: modelo neutro, foto ausente explícita na primeira página e memorial completo',()=>{
  const snapshot=fixture(),before=JSON.stringify(snapshot),rows=[],images=[];
  const output=PDF.createPdf(snapshot,{},capture(rows,images)),body=text(rows);
  assert.equal(JSON.stringify(snapshot),before);assert.equal(output.metadata.version,3);assert.equal(output.metadata.photoAttached,false);assert.equal(images.length,0);
  assert.match(body,/Foto do equipamento não informada/);assert.equal(rows.find(row=>row.text.includes('Foto do equipamento')).page,1);
  assert.doesNotMatch(body,/PIRES INTEGRITY|ÍNDICE/);assert.doesNotMatch(body,/Profissional Legalmente Habilitado|Empresa Inspetora/);
  for(const pattern of [/P_projeto \[MPa\] = P_projeto \[bar\] \/ 10/,/P_operacao \[MPa\] = P_operacao \[bar\] \/ 10/,/R \[mm\] = D \[mm\] \/ 2/,/SE \[MPa\]/,/t_circ = P x R/,/t_long = P x R/,/P_circ \[bar\]/,/P_long \[bar\]/,/t_nominal_casco >=/,/t_nominal_tampo >=/,/L_coroa \[mm\] = 0,90/,/Margem \[bar\] = P_parcial/,/V_cilindro \[m³\]/,/V_tampo \[m³\]/,/V_total \[m³\]/,/P \/ \(S x E\) <= 0,385/,/t_ef_casco \/ R <= 0,5/]) assert.match(body,pattern);
  assert.equal(output.metadata.technicalSigned,false);assert.equal(output.metadata.digitallySigned,false);
  for(const entry of output.metadata.index)assert.ok(rows.some(row=>row.text===entry.title&&row.page===entry.page));
});
test('PMTA reprovado preserva falhas e valores salvos sem recalcular ou aprovar',()=>{
  const snapshot=fixture('pmta',{shell:'5',headThickness:'5'});snapshot.results=C.pmta(snapshot.inputs);snapshot.results.volume=123.456789;const rows=[];
  assert.equal(snapshot.results.shellMeets,false);assert.equal(snapshot.results.headMeets,false);
  PDF.createPdf(snapshot,{},capture(rows,[]));const body=text(rows);assert.match(body,/RESULTADO ARITMÉTICO INSUFICIENTE/);assert.match(body,/Não atende à espessura calculada/);assert.match(body,/123,456789 m³/);assert.doesNotMatch(body,/\bNaN\b|\bInfinity\b|equipamento aprovado/i);
});
test('PMTA com código conserva traço do limite t/L já aplicado pelo motor',()=>{
  const snapshot=fixture();snapshot.inputs.constructionCode={profileId:'asme-viii-1',division:'1',edition:'2019',source:'Documento fictício do teste'};
  const codes=require('../app/construction-code.js');snapshot.inputs.constructionCode=codes.assertDiv1(snapshot.inputs.constructionCode);snapshot.results=C.pmta(snapshot.inputs);const rows=[];PDF.createPdf(snapshot,{},capture(rows,[]));assert.match(text(rows),/t_ef_tampo \/ L_coroa >= 0,002/);
});
test('PNG logo opcional esquerda e foto proporcional na primeira página antes da identificação, ambos relatórios',()=>{
  for(const [api,snapshot] of [[PDF,fixture()],[NRPDF,nr()]]){const rows=[],images=[],meta={logoDataUrl:png(160,80),equipmentPhotoDataUrl:png(),equipmentPhotoCaption:'Equipamento fictício - vista geral'};const before=JSON.stringify({snapshot,meta});const output=api.createPdf(snapshot,meta,capture(rows,images));assert.equal(JSON.stringify({snapshot,meta}),before);assert.equal(output.metadata.photoAttached,true);assert.ok(images.some(image=>image.page===1&&image.x<50&&image.y<25));const photo=images.find(image=>image.page===1&&image.y>40);assert.ok(photo);assert.ok(Math.abs(photo.w/photo.h-2)<1e-10);assert.ok(rows.find(row=>row.text==='01 - Identificação e rastreabilidade').y>photo.y+photo.h||rows.find(row=>row.text==='01 - Identificação e rastreabilidade').page>1);assert.match(text(rows),/Equipamento fictício - vista geral/);}
});
test('JPEG real incorporado; foto inválida rejeitada sem substituição fictícia',()=>{
  const image=fs.readFileSync(path.resolve(__dirname,'../site/assets/portfolio-1-1.jpg'));
  for(const [api,snapshot] of [[PDF,fixture()],[NRPDF,nr()]]){const images=[];const output=api.createPdf(snapshot,{equipmentPhotoDataUrl:'data:image/jpeg;base64,'+image.toString('base64')},capture([],images));assert.equal(output.metadata.photoAttached,true);assert.ok(images.length);assert.throws(()=>api.createPdf(snapshot,{equipmentPhotoDataUrl:'https://example.invalid/foto.jpg'},jsPDF),/PNG ou JPEG/);}
});
test('NR13 possui contrato próprio e preserva entradas, critérios, categoria e P x V salvos',()=>{
  const snapshot=nr(),before=JSON.stringify(snapshot);snapshot.results.pvMPaM3=99.123456789;const changed=JSON.stringify(snapshot),rows=[];const output=NRPDF.createPdf(snapshot,{},capture(rows,[]));assert.equal(JSON.stringify(snapshot),changed);assert.notEqual(before,changed);const body=text(rows);assert.match(body,/RELATÓRIO DE ENQUADRAMENTO NR-13/);assert.match(body,/99,123456789 MPa.m³/);assert.match(body,/800 kPa/);assert.match(body,/Categoria do vaso/);assert.match(body,/III/);assert.match(body,/7.068583471/);assert.match(body,/13.5.1.1.3/);assert.doesNotMatch(body,/RELATÓRIO DE PMTA|PIRES INTEGRITY|NaN|Infinity/);assert.equal(output.metadata.mode,'nr13');assert.equal(output.metadata.technicalSigned,false);assert.equal(output.metadata.incomplete,false);assert.throws(()=>NRPDF.createPdf(fixture(),{},jsPDF),/somente enquadramento/);assert.throws(()=>PDF.createPdf(snapshot,{},jsPDF),/apenas PMTA parcial/);
});
test('NR13 limiares, exclusão, tanque e registro incompleto não recebem categoria ou cálculos inventados',()=>{
  const cases=[nr({nrPressure:'1',nrPressureUnit:'MPa',nrVolume:'1'}),nr({nrExclusion:'a'}),nr({nrProfile:'atmospheric',nrSupport:'ground',nrTankDefinition:'yes',nrFluid:'flammable',nrDiameter:'4',nrDiameterUnit:'m',nrVolume:'30',nrPressure:'0',nrPressureUnit:'kPa'}),{type:'pmta',inputs:{tag:'INCOMPLETO'},results:{mode:'nr13',status:'review_required',scope:'pending'}}];
  for(const snapshot of cases){const rows=[],before=JSON.stringify(snapshot);const output=NRPDF.createPdf(snapshot,{},capture(rows,[]));const body=text(rows);assert.equal(JSON.stringify(snapshot),before);assert.match(body,/Não calculado \/ não atribuído/);assert.doesNotMatch(body,/\bNaN\b|\bInfinity\b|equipamento aprovado|liberado para operação/i);assert.equal(output.metadata.technicalSigned,false);if(snapshot.results.category===undefined)assert.equal(output.metadata.incomplete,true);}
  const bad=nr();bad.results.pvKPaM3=NaN;assert.throws(()=>NRPDF.createPdf(bad,{},jsPDF),/numérico inválido/);
});
test('NR13 converte expressões das unidades declaradas e mantém null de intervalo sem SPIE inventado',()=>{
  const snapshot=nr({nrPressure:'800',nrPressureUnit:'kPa',nrVolume:'7068,583471',nrVolumeUnit:'L',nrDiameter:'1,5',nrDiameterUnit:'m'});const rows=[];NRPDF.createPdf(snapshot,{},capture(rows,[]));const body=text(rows);assert.match(body,/V \[m³\] = V \[L\] \/ 1000/);assert.match(body,/D \[mm\] = D \[m\] x 1000/);assert.match(body,/800 kPa/);assert.match(body,/1,5 m/);
  const categoryV=nr({nrFluid:'other',nrPressure:'0.1',nrPressureUnit:'MPa',nrVolume:'1'});assert.equal(categoryV.results.intervals.withSPIE.internal,null);const vrows=[];NRPDF.createPdf(categoryV,{},capture(vrows,[]));assert.match(text(vrows),/Não indicado no registro - verificar condições aplicáveis/);
});
test('assinatura só exibe grupos preenchidos e nunca autentica signatário; vida continua suportada',()=>{
  for(const [api,snapshot] of [[PDF,fixture('life')],[NRPDF,nr()]]){const rows=[];const output=api.createPdf(snapshot,{signatures:{inspector:{name:'Inspetor fictício',qualification:'Teste local'}}},capture(rows,[]));const body=text(rows);assert.match(body,/Inspetor fictício/);assert.doesNotMatch(body,/Profissional Legalmente Habilitado|Empresa Inspetora/);assert.match(body,/não autentica signatários/);assert.equal(output.metadata.digitallySigned,false);}
});
test('textos extensos quebram páginas, mantêm índice real e todos textos dentro da página',()=>{
  for(const [api,snapshot] of [[PDF,fixture()],[NRPDF,nr()]]){const rows=[];snapshot.results.warnings.push(('Pendência extensa de teste para revisão documental. ').repeat(180));const output=api.createPdf(snapshot,{notes:('Nota extensa de teste. ').repeat(100),equipmentPhotoDataUrl:png(),equipmentPhotoCaption:('Descrição extensa. ').repeat(80)},capture(rows,[]));assert.ok(output.metadata.pageCount>4);assert.ok(rows.every(row=>typeof row.y!=='number'||row.y<290));for(const entry of output.metadata.index)assert.ok(rows.some(row=>row.text===entry.title&&row.page===entry.page));assert.doesNotMatch(text(rows),/NaN|Infinity/);}
});

test('unidades desconhecidas não produzem conversão falsa no NR13',()=>{for(const [key,unit] of [['nrPressureUnit','psi'],['nrVolumeUnit','kg'],['nrDiameterUnit','cm']]){const snapshot=nr();snapshot.inputs[key]=unit;assert.throws(()=>NRPDF.createPdf(snapshot,{},jsPDF),/unidade da conversão/);}});
test('gráfico de vida com premissas longas permanece na área útil',()=>{const snapshot=fixture('life');snapshot.inputs.assumptions='Hipotese de servico. '.repeat(70);const rows=[];PDF.createPdf(snapshot,{},capture(rows,[]));const axis=rows.find(row=>row.text==='Anos desde a medição atual');assert.ok(axis&&axis.y<269,JSON.stringify(axis));});
