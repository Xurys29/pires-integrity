(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.PiresProjectPDF=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const clean=x=>String(x??'A confirmar').replace(/[\u2010-\u2015]/g,'-').replace(/[\u0000-\u001f]/g,' '),names={integridade:'Inspeção de Integridade',rtis:'Gestão de RTI',nr13:'Gestão NR-13',valvulas:'Certificação de Válvulas'};
 function createPdf(model,snapshot,{jsPDF=root.PiresPDF?.jsPDF||root.jspdf?.jsPDF||root.jsPDF,images=new Map()}={}){
  if(!jsPDF||!snapshot?.stateHash||snapshot.contractId!==model.contract.id)throw Error('Resumo persistido e gerador PDF obrigatórios.');
  const pdf=new jsPDF({unit:'mm',format:'a4'});let y=32;
  const next=height=>{if(y+height>274){pdf.addPage();y=30;}};
  const text=(value,size=10,bold=false,color=[23,57,75])=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);const lines=pdf.splitTextToSize(clean(value),174);for(const line of lines){next(size*.5+2);pdf.text(line,18,y);y+=size*.5+1;}y+=2;};
  const title=t=>{next(20);y+=5;text(t,14,true);};
  text('RESUMO EXECUTIVO',10,true,[147,107,12]);text(model.contract.name,22,true);text(model.client.name+' | '+names[model.module]);
  text('Contrato: '+(model.contract.contractReference||'a confirmar')+' | Unidade: '+(model.contract.unit||'a confirmar'));
  text('Responsável: '+(model.contract.responsible||'a confirmar'));
  text('Data de corte: '+model.cutoff+' | Escopo V'+model.scopeVersion+' | Planejamento V'+model.planVersion);
  text('Modalidade: '+model.modality+' | Gerado em: '+new Date(snapshot.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}));
  text('Resumo dos registros do projeto. Situação operacional e conformidade técnica permanecem independentes. Dados ausentes são indicados como pendentes.',9);
  title('Indicadores');
  for(const k of model.kpis){text(k.label+': '+(k.value===null?'A apurar':k.value+' '+k.unit)+(k.percent===null?'':` (${k.percent}% de ${k.denominator})`),12,true);text(k.definition,9);}
  title('Avanço por sistema');
  if(!model.systems.length)text('Escopo ainda não confirmado.');
  for(const s of model.systems)text(`${s.name}: ${s.assets.length} ativos. ${s.planned?s.done+' / '+s.planned+' '+s.unit+' concluídos':'Execução a planejar.'}`);
  next(model.series.length?95:30);title('Planejado e realizado');
  if(model.series.length){
   next(65);const top=y,w=168,h=40,first=Date.parse(model.series[0].date),range=Math.max(86400000,Date.parse(model.series.at(-1).date)-first);pdf.setDrawColor(225,232,235);for(const v of[0,50,100])pdf.line(22,top+h-v/100*h,190,top+h-v/100*h);
   pdf.setTextColor(98,119,128);pdf.setFontSize(8);pdf.text('100%',18,top-2);pdf.text('0%',18,top+h+4);pdf.text(model.series[0].date,22,top+h+9);if(model.series.length>1)pdf.text(model.series.at(-1).date,190,top+h+9,{align:'right'});
   for(const[key,color]of[['planned',[179,130,0]],['actual',[0,74,102]]]){pdf.setDrawColor(...color);pdf.setFillColor(...color);pdf.setLineWidth(.7);const series=model.series.filter(x=>x[key]!==null);for(let j=0;j<series.length;j++){const b=series[j],bx=22+(Date.parse(b.date)-first)/range*w,by=top+h-b[key]/100*h;pdf.circle(bx,by,1,'F');if(j){const a=series[j-1];pdf.line(22+(Date.parse(a.date)-first)/range*w,top+h-a[key]/100*h,bx,by);}}}y+=56;text('Dourado: planejado | Azul: realizado | Serviços da mesma modalidade, pesos iguais.',9);
  }else text('Planejamento sem série completa de datas. Curva não calculada.');
  text(model.forecast?`Previsão estimada: ${model.forecast.date}. ${model.forecast.method}`:'Previsão de conclusão: a definir.');
  title('Entregas independentes');for(const l of model.lifecycle)text(l.label+': '+(l.total?l.done+' / '+l.total+' entregas concluídas':'base a definir'));
  title('Ações e decisões');if(!model.priorities.length)text('Nenhuma ação priorizada pelos registros deste escopo; não equivale a aprovação técnica.');
  for(const p of model.priorities){text(p.title,11,true);text(`Responsável: ${p.responsible||'a confirmar'} | Prazo: ${p.due||'a confirmar'}`,9);}
  if(model.photos.length){title('Evidências dos itens');for(const p of model.photos.slice(0,6)){next(95);text(p.caption||'Foto do item '+p.item?.itemKey,11,true);const img=images.get(p.id);if(img){try{const props=pdf.getImageProperties(img),height=Math.min(72,174*props.height/props.width),width=height*props.width/props.height;next(height+16);pdf.addImage(img,props.fileType,18,y,width,height);y+=height+4;}catch{text('Foto indisponível para este resumo; consultar item de origem.',9);}}else text('Foto pendente de carregamento; consultar item de origem.',9);text('Item: '+(p.item?.itemKey||p.lvtItemId)+' | Ativo: '+(model.assets.find(a=>a.id===p.item?.assetId)?.tag||'a confirmar'),9);}}
  title('Rastreabilidade');text('Snapshot: '+snapshot.id,8);text('Base SHA-256: '+snapshot.stateHash,8);text('Este resumo é independente do relatório técnico por sistema e do aceite contratual.',9);
  const pages=pdf.getNumberOfPages();for(let p=1;p<=pages;p++){pdf.setPage(p);pdf.setFillColor(0,60,88);pdf.rect(0,0,210,18,'F');pdf.setTextColor(255,255,255);pdf.setFont('helvetica','bold');pdf.setFontSize(10);pdf.text('PIRES INTEGRITY  |  GESTÃO DE ATIVOS',18,11);pdf.setDrawColor(223,230,233);pdf.line(18,282,192,282);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(98,119,128);pdf.text('Data de corte '+model.cutoff+' | Escopo V'+model.scopeVersion,18,288);pdf.text(p+' / '+pages,192,288,{align:'right'});}return pdf;
 }
 async function download(model,snapshot,options={}){const images=new Map();for(const p of model.photos.slice(0,6)){try{if(options.loadPhoto)images.set(p.id,await options.loadPhoto(p));}catch{ /* Missing originals remain explicitly pending. */ }}const pdf=createPdf(model,snapshot,{...options,images});pdf.save('Resumo-'+model.contract.name.replace(/[^a-zA-Z0-9-]/g,'_').slice(0,70)+'-'+model.cutoff+'.pdf');return pdf;}
 return {createPdf,download};
});
