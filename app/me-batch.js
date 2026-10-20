(function(root,factory){const api=factory(typeof module==='object'?require('./calculations.js'):root.IntegrityCalc);if(typeof module==='object')module.exports=api;else root.MEBatch=api;})(globalThis,function(C){
  'use strict';
  const POSITIONS=['0°','90°','180°','270°'];
  const TEXT_FIELDS={position:120,minimumSource:2000,missing:2000,justification:2000};
  const VALUE_FIELDS=['current','previous','minimum','initial'];
  const DATE_FIELDS=['currentDate','previousDate','initialDate'];
  const CHOICES={minimumKind:['required','alert','reference'],previousOrigin:['measured','nominal'],initialOrigin:['measured','nominal'],ratePolicy:['max','short','long']};
  function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
  function text(value,label,max,required=false){
    if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error(`${label}: texto ${required?'obrigatório, ':''}limitado a ${max} caracteres.`);
    return value.trim();
  }
  function key(value){return value.normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();}
  function angle(value){return value.replace(/\s/g,'').replace(/º$/,'°').replace(/^(0|90|180|270)$/,'$1°');}
  // Validate structure without requiring a complete history. Drafts may contain
  // empty readings; the assessment reports each missing datum independently.
  function validatePoints(points){
    if(!Array.isArray(points)||points.length<1||points.length>100)throw Error('Informe de 1 a 100 pontos de medição.');
    const names=new Set();
    return points.map((p,index)=>{
      if(!plain(p))throw Error(`Ponto ${index+1}: estrutura inválida.`);
      const name=text(p.name,`Ponto ${index+1}: identificação`,120,true);
      const location=text(p.location,`${name}: localização`,1000,true);
      if(names.has(key(name)))throw Error('Use identificações únicas para os pontos.');
      names.add(key(name));
      if(!['uniform','localized','unknown'].includes(p.mechanism))throw Error(`${name}: selecione o mecanismo de dano.`);
      if(p.layout!==undefined&&!['four','local'].includes(p.layout))throw Error(`${name}: distribuição de posições inválida.`);
      if(!Array.isArray(p.readings)||p.readings.length<1||p.readings.length>4)throw Error(`${name}: informe de 1 a 4 posições.`);
      if(p.layout==='four'&&p.readings.length!==4)throw Error(`${name}: a distribuição de quatro posições exige as quatro linhas.`);
      if(p.layout==='local'&&p.readings.length!==1)throw Error(`${name}: a distribuição localizada exige uma posição.`);
      const positions=new Set();
      const readings=p.readings.map((v,readingIndex)=>{
        if(!plain(v))throw Error(`${name}: leitura ${readingIndex+1} inválida.`);
        const position=text(v.position,`${name}: posição`,120,true);
        const positionKey=key(angle(position));
        if(positions.has(positionKey))throw Error(`${name}: identifique as posições sem duplicações.`);
        positions.add(positionKey);
        const reading={position};
        Object.entries(TEXT_FIELDS).forEach(([field,max])=>{if(field!=='position'&&v[field]!==undefined)reading[field]=text(v[field],`${name} / ${position}: ${field}`,max);});
        VALUE_FIELDS.forEach(field=>{
          if(v[field]!==undefined){
            if(!['string','number'].includes(typeof v[field])||(typeof v[field]==='number'&&!Number.isFinite(v[field]))||String(v[field]).length>80)throw Error(`${name} / ${position}: valor de espessura inválido.`);
            reading[field]=v[field];
          }
        });
        DATE_FIELDS.forEach(field=>{if(v[field]!==undefined)reading[field]=text(v[field],`${name} / ${position}: data`,10);});
        Object.entries(CHOICES).forEach(([field,values])=>{if(v[field]!==undefined){if(!values.includes(v[field]))throw Error(`${name} / ${position}: opção de cálculo inválida.`);reading[field]=v[field];}});
        ['comparable','useInitial'].forEach(field=>{if(v[field]!==undefined){if(typeof v[field]!=='boolean')throw Error(`${name} / ${position}: confirmação inválida.`);reading[field]=v[field];}});
        return reading;
      });
      if(p.layout==='four'&&POSITIONS.some(position=>!positions.has(key(position))))throw Error(`${name}: use as posições 0°, 90°, 180° e 270°.`);
      return {name,location,mechanism:p.mechanism,...(p.layout===undefined?{}:{layout:p.layout}),readings};
    });
  }
  function number(value,label){
    if(value===undefined||value===null||String(value).trim()==='')throw Error(`Informe ${label}.`);
    const string=String(value).trim();
    if(!/^[-+]?\d+(?:[.,]\d+)?$/.test(string))throw Error(`${label}: informe um número sem separador de milhar.`);
    const n=Number(string.replace(',','.'));
    if(!Number.isFinite(n)||n<=0)throw Error(`${label}: valor maior que zero necessário.`);
    return n;
  }
  function date(value,label){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error(`Informe ${label} completa.`);
    const ms=Date.parse(`${value}T00:00:00Z`);
    if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==value||value<'1900-01-01')throw Error(`${label}: data inválida.`);
    return ms;
  }
  function currentMeasurement(input,asOf){
    const measurement={valid:false,current:null,currentDate:input.currentDate||'',error:''};
    try{
      measurement.current=number(input.current,'a espessura atual');
      if(date(input.currentDate,'a data atual')>date(asOf,'a data da avaliação'))throw Error('A medição atual não pode ter data futura.');
      measurement.valid=true;
    }catch(error){measurement.current=null;measurement.error=error.message;}
    return measurement;
  }
  function compare(input,measurement){
    const comparison={valid:false,minimum:null,margin:null,minimumKind:input.minimumKind||'',minimumSource:input.minimumSource||'',error:''};
    try{
      if(!measurement.valid)throw Error(measurement.error);
      comparison.minimum=number(input.minimum,'a espessura mínima de referência');
      if(!['required','alert','reference'].includes(input.minimumKind))throw Error('Selecione a natureza da espessura mínima.');
      if(typeof input.minimumSource!=='string'||!input.minimumSource.trim())throw Error('Informe a fonte da espessura mínima.');
      comparison.margin=measurement.current-comparison.minimum;
      comparison.valid=true;
    }catch(error){comparison.error=error.message;}
    return comparison;
  }
  function assess(points,asOf){
    const assessmentDate=asOf||new Date().toISOString().slice(0,10);
    date(assessmentDate,'a data da avaliação');
    const checked=validatePoints(points);
    const rows=checked.flatMap(p=>p.readings.map(v=>{
      const input={...p,...v,point:`${p.name} / ${v.position}`,asOf:assessmentDate,ratePolicy:v.ratePolicy||'max',useInitial:v.useInitial===true};
      const measurement=currentMeasurement(input,assessmentDate),comparison=compare(input,measurement);
      let result=null,error='';
      try{result=C.life(input);}catch(e){error=e.message;}
      let status='INCONCLUSIVO';
      if(comparison.valid&&comparison.minimumKind==='required'){
        // An observed deficit does not disappear because a corrosion history is
        // missing, nominal, inconsistent or unsuitable for linear projection.
        if(comparison.margin<0)status='NÃO CONFORME';
        else if(comparison.margin===0)status='NO LIMITE — AVALIAR';
        else if(result&&result.status!=='inconsistent_history'&&p.mechanism==='uniform'&&!result.hypothesis)status='CONFORME';
      }
      return {point:p.name,location:p.location,position:v.position,input,measurement,comparison,result,error,status};
    }));
    const status=rows.some(r=>r.status==='NÃO CONFORME')?'NÃO CONFORME':rows.every(r=>r.status==='CONFORME')?'CONFORME':'INCONCLUSIVO';
    const measured=rows.filter(r=>r.measurement.valid);
    const minimum=measured.reduce((a,b)=>!a||b.measurement.current<a.measurement.current?b:a,null);
    const lives=rows.filter(r=>r.result&&r.result.status==='estimated'&&r.result.minimumKind==='required');
    const limiting=lives.reduce((a,b)=>!a||b.result.remainingYears<a.result.remainingYears?b:a,null);
    return {rows,status,minimum,limiting,complete:rows.every(r=>r.status==='CONFORME'&&r.result&&r.result.status==='estimated'),operationalApproval:false,scope:'Comparação das posições registradas com a espessura mínima requerida informada; não constitui liberação operacional.'};
  }
  return {assess,validatePoints};
});
