'use strict';
const ME_APP_VERSION='0.6.0',ME_LOCAL_REVIEW='PIRES-PMTA-ME-20261015-R3';
const ME_JSON_MAX_BYTES=100000000;
const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const fields=['tag','service','material','reportNumber','inspector','instrument','calibration','procedure','orientation','drawing','notes','verdict','reviewer','basis','next'];
const suggestions=[["Confirmar espessura abaixo da mínima", "Confirmar a indicação de baixa espessura mediante repetição da medição e verificação da condição superficial, do ajuste do equipamento e da rastreabilidade do ponto. Delimitar a extensão da perda nas imediações e encaminhar os resultados ao responsável técnico para avaliação da condição operacional e definição das ações de reparo, substituição ou demais medidas aplicáveis."], ["Caracterizar dano localizado", "Executar mapeamento complementar da região afetada, registrando a menor espessura, a localização e a extensão do dano, com leituras na área de maior perda e em região adjacente de referência. Avaliar a necessidade de ensaio complementar e de análise específica para perda localizada. A taxa apurada neste ponto não deve ser extrapolada para os demais pontos do equipamento."], ["Verificar histórico inconsistente", "Repetir as leituras e conferir a identificação física dos pontos, as datas, a técnica de medição, o equipamento, o transdutor e a preparação superficial utilizados nas campanhas. Registrar as evidências e a justificativa técnica da divergência. Manter a projeção suspensa até que a comparabilidade do histórico esteja demonstrada."], ["Monitorar perda uniforme", "Manter o monitoramento dos pontos identificados, preservando a referência de posição entre campanhas. Submeter a taxa de corrosão e a projeção de vida remanescente ao responsável técnico, considerando o mecanismo de dano, as condições de operação e o plano de inspeção aplicável. O prazo de reinspeção deve ser definido e registrado pelo responsável técnico."], ["Validar a referência mínima", "Validar e registrar a origem e a aplicabilidade da espessura mínima adotada, identificando o documento, a revisão, o material, a geometria e as condições de projeto pertinentes. Distinguir espessura requerida, espessura nominal e valor de alerta antes de emitir a conclusão técnica."], ["Complementar posições não medidas", "Registrar os pontos não medidos, o motivo da restrição e sua localização no plano de medição. Programar a obtenção das leituras faltantes ou um ensaio alternativo tecnicamente adequado, conforme avaliação do responsável. Limitar a conclusão às posições efetivamente avaliadas e explicitar a pendência no relatório."]];
let points=[],lastText='',serial=0,lastModel=null,cloud=null,saveTicket=0,accessGeneration=0,sessionClosed=false,sessionUserId=null;
function input(value='',type='text'){const n=el('input');n.type=type;n.value=value;return n;}
function select(values,value){const n=el('select');values.forEach(([v,t])=>{const o=el('option',t);o.value=v;n.append(o);});n.value=value;return n;}
function bind(parent,label,control,obj,key){const l=el('label',label);l.append(control);parent.append(l);control.oninput=()=>{obj[key]=control.type==='checkbox'?control.checked:control.value;invalidate();};return control;}
function invalidate(){$('output').hidden=true;lastText='';lastModel=null;saveTicket++;$('saveStatus').textContent='Revise o relatório antes da emissão.';$('save').disabled=false;}
const reportSignatures=PiresReportSignatures.create($('meReportSignatures'),{prefix:'me',onChange:invalidate});
const riskAssessment=PiresMERisk.create($('meRiskAssessment'),{onChange:invalidate});
function reading(position){return {position,current:'',previous:'',minimum:'',currentDate:'',previousDate:'',minimumSource:'',minimumKind:'required',previousOrigin:'measured',comparable:false,missing:''};}
function newPoint(){return {name:`P${String(++serial).padStart(2,'0')}`,location:'',layout:'four',mechanism:'unknown',readings:['0°','90°','180°','270°'].map(reading)};}
function render(){
  $('points').replaceChildren();points.forEach((p,index)=>{
    const card=el('div');card.className='point';const grid=el('div');grid.className='grid';card.append(el('h3',`Ponto ${index+1}`),grid);
    bind(grid,'Identificação',input(p.name),p,'name');bind(grid,'Componente / localização',input(p.location),p,'location');
    const layout=bind(grid,'Distribuição',select([['four','Quatro geratrizes — 0°, 90°, 180° e 270°'],['local','Posição específica complementar']],p.layout),p,'layout');
    layout.oninput=()=>{p.savedLayouts={...(p.savedLayouts||{}),[p.layout]:p.readings};p.layout=layout.value;p.readings=p.savedLayouts[p.layout]||(p.layout==='four'?['0°','90°','180°','270°'].map(reading):[reading('Localizada')]);invalidate();render();};
    bind(grid,'Mecanismo de dano',select([['unknown','Não definido'],['uniform','Perda uniforme'],['localized','Dano localizado']],p.mechanism),p,'mechanism');
    const wrap=el('div');wrap.className='tablewrap';const table=el('table');table.className='readings';const head=el('tr');['Posição','Atual (mm)','Anterior (mm)','Data atual','Data anterior','Mínima (mm)','Natureza','Fonte da mínima','Origem anterior','Mesmo local / condições','Ausência / observação'].forEach(t=>head.append(el('th',t)));table.append(head);
    p.readings.forEach(r=>{const tr=el('tr');
      const configs=[['position',input(r.position)],['current',input(r.current)],['previous',input(r.previous)],['currentDate',input(r.currentDate,'date')],['previousDate',input(r.previousDate,'date')],['minimum',input(r.minimum)],['minimumKind',select([['required','Requerida'],['alert','Alerta'],['reference','Referência']],r.minimumKind)],['minimumSource',input(r.minimumSource)],['previousOrigin',select([['measured','Medida'],['nominal','Nominal']],r.previousOrigin)],['comparable',input('','checkbox')],['missing',input(r.missing)]];
      configs.forEach(([key,c],i)=>{const td=el('td');if(c.type==='text')c.maxLength=['missing','minimumSource'].includes(key)?2000:120;c.setAttribute('aria-label',`${p.name} ${r.position} ${head.children[i].textContent}`);if(c.type==='checkbox')c.checked=r[key];c.oninput=()=>{r[key]=c.type==='checkbox'?c.checked:c.value;invalidate();};td.append(c);tr.append(td);});table.append(tr);
    });wrap.append(table);card.append(wrap);const remove=el('button','Remover ponto');remove.type='button';remove.onclick=async()=>{if(await confirmLocal(`Remover ${p.name} e suas leituras?`)){points.splice(index,1);invalidate();render();}};card.append(remove);$('points').append(card);
  });
}
suggestions.forEach(([title],i)=>{const l=el('label');l.className='check';const c=input('','checkbox');c.id=`rec${i}`;l.append(c,el('span',title));$('recommendations').append(l);});
$('add').onclick=()=>{const n=Number($('quantity').value);if(!Number.isInteger(n)||n<1||n>20||points.length+n>100){$('error').textContent='Adicione de 1 a 20 pontos por vez, até 100 pontos.';return;}for(let i=0;i<n;i++)points.push(newPoint());invalidate();render();};
function payload(){return {kind:'pires-me-v1',demo:$('demo').checked,metadata:Object.fromEntries(fields.map(k=>[k,$(k).value])),signatures:reportSignatures.getValue(),risk:riskAssessment.getValue(),points:JSON.parse(JSON.stringify(points)),recommendations:suggestions.map((_,i)=>$(`rec${i}`).checked)};}
function download(content,name,type){const a=el('a'),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportData(){const draft=payload();if(lastModel)draft.reportSnapshot=PiresMEPDF.snapshot(lastModel);if(new TextEncoder().encode(JSON.stringify(draft,null,2)).byteLength>ME_JSON_MAX_BYTES)throw Error('Os dados JSON excedem o limite de 100 MB. Divida os pontos em relatórios menores antes de exportar.');return draft;}
$('export').onclick=async()=>{const accessTicket=accessGeneration;try{if(cloud?.configured&&(!await checkAccess()||accessTicket!==accessGeneration||sessionClosed))return;download(JSON.stringify(exportData(),null,2),'pires-me-dados.json','application/json');$('error').textContent='';}catch(e){if(accessTicket===accessGeneration&&!sessionClosed)$('error').textContent=e.message;}};
function restore(d){
  if(!d||!['pires-me-v1','pires-me-local-v1'].includes(d.kind))throw Error('Formato de dados incompatível.');
  const checked=MEBatch.validatePoints(d.points);
  if(!d.metadata||typeof d.metadata!=='object')throw Error('Identificação do relatório ausente.');
  fields.forEach(k=>{if(d.metadata[k]!==undefined&&(typeof d.metadata[k]!=='string'||d.metadata[k].length>10000))throw Error('Dados de identificação inválidos.');});
  const signatures=PiresReportSignatures.normalize(d.signatures);
  const risk=PiresMERisk.normalize(d.risk);
  fields.forEach(k=>$(k).value=d.metadata[k]||'');
  reportSignatures.setValue(signatures);
  riskAssessment.setValue(risk);
  if(!['PENDENTE DE VALIDAÇÃO','APROVADO NO ESCOPO AVALIADO','REPROVADO NO ESCOPO AVALIADO'].includes($('verdict').value))$('verdict').value='PENDENTE DE VALIDAÇÃO';
  points=checked;serial=points.length;$('demo').checked=d.demo===true;
  suggestions.forEach((_,i)=>$(`rec${i}`).checked=d.recommendations?.[i]===true);invalidate();render();$('error').textContent='';
}
$('import').onchange=async()=>{try{const file=$('import').files[0];if(!file||file.size>ME_JSON_MAX_BYTES)throw Error('Selecione um JSON de até 100 MB.');const d=JSON.parse(await file.text());MEBatch.validatePoints(d.points);if(!await confirmLocal('Substituir os dados desta sessão pelos dados importados?'))return;restore(d);}catch(e){$('error').textContent=e.message;}finally{$('import').value='';}};
$('example').onclick=async()=>{if(!await confirmLocal('Carregar dados fictícios e substituir os dados desta tela?'))return;
reportSignatures.setValue({plh:{name:'Profissional fictício — demonstração',specialty:'Engenharia mecânica',registration:'DEMO-SEM-CREA'},company:{name:'Empresa inspetora fictícia — demonstração',cnpj:'DEMO-SEM-CNPJ'},inspector:{name:'Inspetor de demonstração',qualification:'Medição de espessura — exemplo fictício',registration:'DEMO-SEM-CERTIFICAÇÃO'}});
riskAssessment.clear();
$('demo').checked=true;const d={tag:'DEMO-LINHA-01',service:'Água — exemplo fictício',material:'Aço carbono — exemplo',reportNumber:'DEMO-ME-001',inspector:'Inspetor de demonstração',instrument:'UT-DEMO / 001',calibration:'Certificado fictício — não válido',procedure:'Modelo demonstrativo ME / revisão 0',orientation:'0° geratriz superior; observador olhando a jusante',drawing:'Croqui demonstrativo: P01 trecho reto; P02 indicação localizada',verdict:'PENDENTE DE VALIDAÇÃO'};fields.forEach(k=>$(k).value=d[k]||'');serial=0;points=[newPoint(),newPoint()];points[0].location='Trecho reto a 1 m da referência';points[0].mechanism='uniform';points[1].location='Indicação localizada a 2 m da referência';points[1].layout='local';points[1].mechanism='localized';points[1].readings=[reading('Localizada')];points.forEach((p,i)=>p.readings.forEach((r,j)=>Object.assign(r,{current:String(i?3.8:5.5-j*.2),previous:'6.0',minimum:'4.0',currentDate:'2026-01-01',previousDate:'2025-01-01',minimumSource:'Referência fictícia 4 mm — apenas demonstração',comparable:true})));suggestions.forEach((_,i)=>$(`rec${i}`).checked=[0,1].includes(i));invalidate();render();};
const fmt=n=>n===null||n===undefined?'Indeterminado':Number(n).toLocaleString('pt-BR',{maximumFractionDigits:3});
function comparisonLabel(status){return status==='CONFORME'?'APROVADO NA COMPARAÇÃO':status==='NÃO CONFORME'?'REPROVADO NA COMPARAÇÃO':'PENDENTE / AVALIAR';}
function pointSummaries(result){
  const grouped=new Map();result.rows.forEach(row=>{if(!grouped.has(row.point))grouped.set(row.point,[]);grouped.get(row.point).push(row);});
  return [...grouped].map(([point,rows])=>{
    const status=rows.some(row=>row.status==='NÃO CONFORME')?'NÃO CONFORME':rows.every(row=>row.status==='CONFORME')?'CONFORME':'INCONCLUSIVO';
    const eligible=rows.filter(row=>row.result?.status==='estimated'&&row.input.minimumKind==='required');
    const limiting=eligible.reduce((best,row)=>!best||row.result.remainingMonths<best.result.remainingMonths?row:best,null);
    return {point,rows,status,limiting,thresholdReached:rows.some(row=>row.result?.status==='at_or_below_minimum'&&row.input.minimumKind==='required'),complete:rows.every(row=>row.status==='CONFORME'&&row.result?.status==='estimated')};
  });
}
function renderPointSummary(report,result){
  report.append(el('h2','2. Resumo por ponto — quatro geratrizes'));
  const wrapper=el('div');wrapper.className='tablewrap';const table=el('table');table.className='point-summary';const head=el('tr');
  ['Ponto','0° (mm)','90° (mm)','180° (mm)','270° (mm)','Mínima requerida (mm)','Vida estimada (meses)','Resultado da comparação'].forEach(title=>head.append(el('th',title)));table.append(head);
  pointSummaries(result).forEach(summary=>{
    const tr=el('tr'),values=[summary.point];
    ['0°','90°','180°','270°'].forEach(position=>{const row=summary.rows.find(item=>item.position.replace(/\s/g,'').replace(/º$/,'°').replace(/^(0|90|180|270)$/,'$1°')===position);values.push(row?.measurement.valid?fmt(row.measurement.current):summary.rows[0]?.input.layout==='local'?'Específica':'Não medida');});
    const minima=[...new Set(summary.rows.map(row=>row.comparison.valid&&row.input.minimumKind==='required'?fmt(row.comparison.minimum):'Pendente'))];
    values.push(minima.join(' / '),summary.thresholdReached?'0 · mínima atingida':summary.limiting?`${fmt(summary.limiting.result.remainingMonths)}${summary.complete?'':' · parcial'}`:'Indeterminada',comparisonLabel(summary.status));
    values.forEach((value,index)=>{const cell=el('td',value);if(index===7)cell.className=summary.status==='CONFORME'?'comparison-approved':summary.status==='NÃO CONFORME'?'comparison-rejected':'comparison-pending';tr.append(cell);});table.append(tr);
  });wrapper.append(table);report.append(wrapper,el('p','O resultado do ponto considera todas as posições registradas. A menor vida estimada só representa o ponto completo quando todas as leituras possuem projeção elegível. Leituras ausentes, no limite ou sem premissas válidas mantêm a avaliação pendente.'));
}
$('form').addEventListener('input',invalidate);
$('form').onsubmit=async e=>{e.preventDefault();const accessTicket=accessGeneration;$('error').textContent='';try{if(cloud?.configured&&(!await checkAccess()||accessTicket!==accessGeneration||sessionClosed))return;
if(!points.length||points.some(p=>!p.name.trim()||!p.location.trim()))throw Error('Identifique pelo menos um ponto e sua localização.');
if(new Set(points.map(p=>p.name.trim())).size!==points.length)throw Error('Use identificações únicas para os pontos.');
if(points.some(p=>p.readings.some(r=>!r.position.trim())||new Set(p.readings.map(r=>r.position.trim())).size!==p.readings.length))throw Error('Identifique cada posição sem duplicações no mesmo ponto.');
const today=new Date().toLocaleDateString('sv-SE'),result=MEBatch.assess(points,today),draft=payload(),d=draft.metadata;lastModel={metadata:d,signatures:draft.signatures,result,risk:riskAssessment.assess(d),recommendations:suggestions.filter((_,i)=>$(`rec${i}`).checked).map(([,text])=>text).concat(d.notes.trim()?[d.notes.trim()]:[]),generatedAt:new Date().toISOString(),demo:$('demo').checked,provenance:{appVersion:ME_APP_VERSION,reviewId:ME_LOCAL_REVIEW}};
if(d.verdict!=='PENDENTE DE VALIDAÇÃO'&&(!d.reviewer.trim()||!d.basis.trim()))throw Error('Informe responsável técnico e fundamentação do parecer.');
if(d.verdict==='APROVADO NO ESCOPO AVALIADO'&&result.status!=='CONFORME')throw Error('Aprovação indisponível: há posições não conformes, no limite ou inconclusivas. Conclua a avaliação complementar.');
const report=$('report');report.replaceChildren();if(lastModel.demo)report.append(el('p','DEMONSTRAÇÃO — DADOS FICTÍCIOS. Não utilizar para decisões sobre ativos reais.'));report.append(el('h1','Relatório de Medição de Espessura e Avaliação de Vida Remanescente'),el('p','PIRES INTEGRITY · RELATÓRIO TÉCNICO · Documento para revisão'),el('p',`Gerado em ${new Date(lastModel.generatedAt).toLocaleString('pt-BR')}`));
const box=el('div');box.className='headline';box.append(el('h2',`Resultado geral: ${comparisonLabel(result.status)}`),el('p',`Parecer declarado pelo responsável: ${d.verdict}`),el('p','Escopo da aprovação ou reprovação automática: comparação das posições registradas com a espessura mínima requerida informada. Não constitui certificação do equipamento ou liberação operacional.'));report.append(box);
report.append(el('h2','1. Identificação e rastreabilidade'));fields.filter(k=>!['notes','verdict','basis','next','reviewer'].includes(k)).forEach(k=>report.append(el('p',`${$(k).parentElement.firstChild.textContent}: ${d[k]}`)));
renderPointSummary(report,result);const readingsDetail=el('details');readingsDetail.className='readings-detail';readingsDetail.append(el('summary','Conferir leituras, datas, taxas e margem por geratriz'));
const table=el('table'),head=el('tr');['Ponto / posição','Atual / anterior / mínima (mm)','Datas atual / anterior','Taxa (mm/ano)','Margem (mm)','Prazo estimado (meses)','Resultado'].forEach(t=>head.append(el('th',t)));table.append(head);
result.rows.forEach(r=>{const tr=el('tr'),v=r.result;[`${r.point} / ${r.position}`,`${r.input.current||'Ausente'} / ${r.input.previous||'Ausente'} / ${r.input.minimum||'Ausente'}`,`${r.input.currentDate||'—'} / ${r.input.previousDate||'—'}`,v?fmt(v.adoptedRate):'Indeterminado',fmt(r.comparison.margin),v?.status==='at_or_below_minimum'&&r.input.minimumKind==='required'?'0 · mínima atingida':v&&['estimated','hypothesis'].includes(v.status)&&r.input.mechanism==='uniform'?fmt(v.remainingMonths):'Não aplicável',comparisonLabel(r.status)].forEach(t=>tr.append(el('td',t)));table.append(tr);});const detailWrap=el('div');detailWrap.className='tablewrap';detailWrap.append(table);readingsDetail.append(detailWrap);report.append(readingsDetail);
report.append(el('h2','3. Análise e memória de cálculo'),el('p','Taxa = (espessura anterior − atual) / intervalo em anos; intervalo = dias / 365. Projeção = (atual − referência mínima) / taxa positiva. Meses = anos × 12. Referência de alerta representa prazo até alerta; nominal representa hipótese histórica.'));
if(result.minimum)report.append(el('p',`Menor espessura atual válida: ${fmt(result.minimum.measurement.current)} mm — ${result.minimum.point}, ${result.minimum.position}.`));
if(result.limiting)report.append(el('p',`Menor vida estimada entre posições elegíveis: ${fmt(result.limiting.result.remainingMonths)} meses — ${result.limiting.point}, ${result.limiting.position}. ${result.complete?'Todas as posições possuem projeção elegível.':'Há posições sem projeção elegível; este valor não representa a vida global da TAG.'}`));
const conditionsDetail=el('details');conditionsDetail.className='readings-detail';conditionsDetail.append(el('summary','Conferir fontes e condicionantes por geratriz'));
result.rows.forEach(r=>{conditionsDetail.append(el('h3',`${r.point} / ${r.position} — ${r.location}`),el('p',`Fonte da referência: ${r.input.minimumSource||'Não informada'}. Natureza: ${{required:'Requerida',alert:'Alerta',reference:'Referência'}[r.input.minimumKind]||'Não informada'}. Mecanismo: ${{uniform:'uniforme',localized:'localizado',unknown:'não definido'}[r.input.mechanism]||'não definido'}.`));if(r.comparison.error)conditionsDetail.append(el('p',`Comparação inconclusiva: ${r.comparison.error}`));if(r.error)conditionsDetail.append(el('p',`Avaliação inconclusiva: ${r.error}`));if(r.input.missing)conditionsDetail.append(el('p',`Observação de campo: ${r.input.missing}`));r.result?.warnings.forEach(w=>conditionsDetail.append(el('p',w)));});report.append(conditionsDetail);
report.append(el('h2','4. Recomendações para avaliação do responsável'));let count=0;suggestions.forEach(([,text],i)=>{if($(`rec${i}`).checked){report.append(el('p',text));count++;}});if(d.notes.trim())report.append(el('p',d.notes));else if(!count)report.append(el('p','Nenhuma recomendação selecionada. Revisão técnica pendente.'));
if(lastModel.risk){const risk=lastModel.risk.result,input=lastModel.risk.input,panel=el('div');panel.className='risk-summary';panel.append(el('h3',`Matriz PI — ${risk.governing.category} · ${risk.governing.label}`),el('p',`Ponto / componente: ${input.riskPoint}. Avaliador: ${input.assessor}. Data: ${input.riskDate}.`),el('p',`Anomalia: ${input.anomaly}`),el('p',`Evidências: ${input.evidence}`),el('p',`Recomendação da Matriz PI: ${risk.governing.action}`));risk.elements.forEach(item=>panel.append(el('p',`${item.impactLabel||item.label}: PoF ${item.pof} × CoF ${item.cof} = ${item.score} · ${item.category}. Fundamentação: ${item.justification}`)));risk.warnings.forEach(warning=>panel.append(el('p',warning)));report.append(panel);}
report.append(el('h2','5. Parecer e acompanhamento'),el('p',d.verdict),el('p',`Responsável / registro: ${d.reviewer||'Pendente'}`),el('p',`Fundamentação: ${d.basis||'Pendente de análise'}`),el('p',`Próxima inspeção: ${d.next||'Não definida'}. Prazo independente da projeção de vida remanescente.`),el('p','Critério de comparação: margem positiva com referência requerida e histórico coerente permite classificar a comparação de espessuras como conforme. No limite exige avaliação; dano localizado ou referência não requerida não recebe aprovação automática. Confirmar código, edição, incerteza de medição e critério aplicável antes da emissão definitiva.'));
report.append(el('h2','6. Responsáveis e assinaturas'));
const signatures=lastModel.signatures,signatureBlocks=el('div');signatureBlocks.className='report-signatures-grid report-signature-preview';
[[signatures.plh,'Profissional Legalmente Habilitado',[['Nome','name'],['Especialidade','specialty'],['CREA / registro profissional','registration']]],[signatures.company,'Empresa Inspetora',[['Razão social','name'],['CNPJ','cnpj']]],[signatures.inspector,'Inspetor',[['Nome','name'],['Qualificação / atividade','qualification'],['Registro / certificação','registration']]]].forEach(([person,title,labels])=>{const block=el('div');block.append(el('h3',title));labels.forEach(([label,key])=>block.append(el('p',`${label}: ${person[key]||'Não informado'}`)));block.append(el('p',person.signatureDataUrl?'Imagem da assinatura anexada.':'Assinatura: __________________________________'));signatureBlocks.append(block);});report.append(signatureBlocks,el('p','A imagem anexada representa a assinatura informada pelo usuário; não constitui assinatura digital verificável.'));
lastText=report.innerText;$('output').hidden=false;lastText=report.innerText;$('output').scrollIntoView({behavior:'smooth'});
}catch(err){lastModel=null;$('output').hidden=true;$('error').textContent=err.message;}};
$('print').onclick=async()=>{const accessTicket=accessGeneration;try{if(cloud?.configured&&(!await checkAccess()||accessTicket!==accessGeneration||sessionClosed))return;if(!lastModel)throw Error('Calcule e revise o relatório antes de exportar.');PiresMEPDF.create(lastModel,PiresPDF.jsPDF).save(PiresMEPDF.filename(lastModel));$('saveStatus').textContent='PDF gerado. Confira o arquivo na pasta de downloads.';}catch(e){if(accessTicket===accessGeneration&&!sessionClosed)$('saveStatus').textContent='Não foi possível gerar o PDF: '+e.message;}};
$('save').onclick=async()=>{if(!lastModel||!cloud?.configured)return;const accessTicket=accessGeneration;if(!await checkAccess()||accessTicket!==accessGeneration||sessionClosed)return;const ticket=saveTicket;$('save').disabled=true;$('saveStatus').textContent='Salvando no histórico.';try{const draft=payload();await cloud.save({version:'0.6.0',engineVersion:'ME-1 / '+IntegrityCalc.VERSION,createdAt:lastModel.generatedAt,type:'life',inputs:{tag:draft.metadata.tag,meBatch:draft},results:lastModel.result,note:'Medições por posição e comparação com a referência mínima informada.',recommendations:lastModel.recommendations},lastText,crypto.randomUUID());if(ticket===saveTicket&&accessTicket===accessGeneration&&!sessionClosed)$('saveStatus').textContent='Relatório salvo no histórico da sua conta.';}catch(e){if(ticket===saveTicket&&accessTicket===accessGeneration&&!sessionClosed){$('save').disabled=false;$('saveStatus').textContent=e.message;}}};
function closeAccess(message,endSession=false,clearDraft=endSession){
  // Invalidate all earlier permission, detail, calculation and export continuations.
  accessGeneration++;saveTicket++;if(endSession)sessionClosed=true;
  $('form').hidden=true;$('output').hidden=true;$('save').hidden=true;
  lastModel=null;lastText='';$('report').replaceChildren();
  if(clearDraft){points=[];serial=0;fields.forEach(key=>$(key).value='');suggestions.forEach((_,index)=>$(`rec${index}`).checked=false);reportSignatures.clear();riskAssessment.clear();render();}
  $('access').textContent=message;$('loginLink').hidden=false;
}
async function checkAccess(){
  const ticket=accessGeneration;
  try {
    if (!cloud?.configured) return cloud?.config?.mode === 'demo';
    if(sessionClosed)return false;
    const grant=await cloud.requireAccess(undefined,true);
    if(ticket!==accessGeneration||sessionClosed)return false;
    if(sessionUserId&&grant.user_id&&grant.user_id!==sessionUserId){closeAccess('Sessão alterada. Entre novamente para continuar.',true);return false;}
    sessionUserId=grant.user_id||sessionUserId;
    if(grant.company_role==='client'){
      closeAccess('O perfil Cliente consulta somente documentos explicitamente liberados pela Gestão. O editor não está disponível para este perfil.',false,true);
      $('loginLink').href='index.html?documents=1';$('loginLink').textContent='Consultar documentos liberados';
      return false;
    }
    return true;
  } catch(error) {
    if(ticket===accessGeneration&&!sessionClosed)closeAccess(error instanceof PiresCloud.CloudError?error.message:'Não foi possível confirmar seu acesso. Tente novamente.');
    return false;
  }
}
async function initialize(){
  const ticket=accessGeneration;
  try {
    cloud=PiresCloud.create(window.PIRES_CONFIG,window.PiresSupabase?.createClient);
    if (cloud.configured) {
      // Listen before the initial asynchronous authorization, including startup.
      cloud.subscribe((event,session)=>{
        if(event==='SIGNED_OUT'||!session){closeAccess('Sessão encerrada. Entre novamente para continuar.',true);return;}
        if(sessionClosed)return;
        const nextUserId=session.user?.id;
        if(sessionUserId&&nextUserId!==sessionUserId){closeAccess('Sessão alterada. Entre novamente para continuar.',true);return;}
        sessionUserId=nextUserId||sessionUserId;
        const eventTicket=accessGeneration;
        setTimeout(()=>{if(eventTicket===accessGeneration&&!sessionClosed)void checkAccess();},0);
      });
      window.addEventListener('focus',()=>void checkAccess());
      if(typeof setInterval==='function')setInterval(()=>void checkAccess(),60000);
      if (!await checkAccess()||ticket!==accessGeneration||sessionClosed) return;
      $('access').textContent='Exporte o PDF ou salve a avaliação no histórico da sua conta.';
      $('save').hidden=false;
    } else {$('access').textContent='Prévia local: dados mantidos nesta sessão. Exporte JSON e PDF para preservar seu trabalho.';}
    if(ticket!==accessGeneration||sessionClosed)return;
    $('form').hidden=false;
    const id=new URLSearchParams(location.search).get('assessment');
    if(id&&cloud.configured){
      if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Identificador de avaliação inválido.');
      const record=await cloud.load(id);
      if(ticket!==accessGeneration||sessionClosed)return;
      restore(record.payload?.inputs?.meBatch);$('access').textContent='Medições recuperadas do histórico. Confira as referências e calcule novamente.';
    }
  }catch(error){if(ticket===accessGeneration&&!sessionClosed)closeAccess(error instanceof PiresCloud.CloudError?error.message:'Acesso indisponível. Tente novamente.');}
}
void initialize();
points.push(newPoint());render();

function confirmLocal(message){return new Promise(resolve=>{const dialog=el('dialog'),p=el('p',message),yes=el('button','Confirmar'),no=el('button','Cancelar');yes.type=no.type='button';const finish=value=>{dialog.close();dialog.remove();resolve(value);};yes.onclick=()=>finish(true);no.onclick=()=>finish(false);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.append(p,no,yes);document.body.append(dialog);dialog.showModal();});}
