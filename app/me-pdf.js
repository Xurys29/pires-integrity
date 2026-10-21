(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./report-signatures.js'):root.PiresReportSignatures);if(typeof module==='object'&&module.exports)module.exports=api;else root.PiresMEPDF=api;})(globalThis,function(Signatures){
  'use strict';
  const VERSION='1.4.0';
  const SNAPSHOT_SCHEMA='pires-me-pdf-snapshot-v1';
  // JSON data only: key order is normalized, array order and raw values retained.
  // Shared rows (minimum/limiting) are allowed; actual cycles are not.
  function canonical(value,ancestors=new Set()){
    if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
    if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Snapshot de ME contém número não finito.');return JSON.stringify(value);}
    if(!value||typeof value!=='object'||ancestors.has(value))throw Error('Snapshot de ME deve conter somente dados JSON sem ciclos.');
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(!array&&prototype!==null&&Object.getPrototypeOf(prototype)!==null)throw Error('Snapshot de ME deve conter somente objetos e arrays JSON.');
    const descriptors=Object.getOwnPropertyDescriptors(value);
    for(const key of Reflect.ownKeys(descriptors))if(!('value' in descriptors[key]))throw Error('Snapshot de ME deve conter dados JSON sem getters ou setters.');
    ancestors.add(value);
    let output;
    if(array)output='['+Array.from({length:descriptors.length.value},(_,i)=>{const own=descriptors[i];if(!own){if(i in value)throw Error('Snapshot de ME deve conter arrays JSON sem índices herdados.');return 'null';}return own.value===undefined?'null':canonical(own.value,ancestors);}).join(',')+']';
    else output='{'+Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonical(value[key],ancestors)).join(',')+'}';
    ancestors.delete(value);return output;
  }
  // FIPS 180-4 SHA-256, synchronous so existing PDF.create callers stay synchronous.
  // This identifies the JSON snapshot; it neither signs nor authenticates a PDF.
  function sha256(value){
    const bytes=new TextEncoder().encode(value),length=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(length);
    data.set(bytes);data[bytes.length]=0x80;
    const view=new DataView(data.buffer),bits=bytes.length*8;
    view.setUint32(length-8,Math.floor(bits/0x100000000));view.setUint32(length-4,bits>>>0);
    const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),rotate=(x,n)=>(x>>>n)|(x<<(32-n));
    for(let offset=0;offset<length;offset+=64){
      for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
      for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],s0=rotate(x,7)^rotate(x,18)^(x>>>3),s1=rotate(y,17)^rotate(y,19)^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}
      let [a,b,c,d,e,f,g,z]=h;
      for(let i=0;i<64;i++){const t1=(z+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
      [a,b,c,d,e,f,g,z].forEach((v,i)=>{h[i]=(h[i]+v)>>>0;});
    }
    return h.map(v=>v.toString(16).padStart(8,'0')).join('');
  }
  function snapshot(model){
    const body={schema:SNAPSHOT_SCHEMA,generatorVersion:VERSION,model},encoded=canonical(body);
    const record=JSON.parse(encoded);validate(record.model);
    return {...record,snapshotId:'sha256:'+sha256(encoded)};
  }
  function traceRecord(record){
    const model=record.model,origin=model.provenance||{},engineVersions=[...new Set(model.result.rows.map(row=>row.result?.version).filter(Boolean))].sort();
    const enginesMissing=model.result.rows.filter(row=>!row.result?.version).length;
    return {schema:SNAPSHOT_SCHEMA,generatorVersion:VERSION,appVersion:origin.appVersion||null,reviewId:origin.reviewId||null,engineVersions,enginesMissing,snapshotId:record.snapshotId};
  }
  function trace(model){return traceRecord(snapshot(model));}
  const COLORS={blue:[0,67,84],ink:[28,42,49],yellow:[238,181,44],line:[208,217,219],pale:[243,247,248],red:[156,38,38],green:[31,104,64]};
  const LABELS={reportNumber:'Número do relatório',tag:'TAG / identificação',service:'Serviço / fluido',material:'Material',inspector:'Inspetor / identificação',instrument:'Instrumento / número de série',calibration:'Certificado de calibração / validade',procedure:'Procedimento / revisão',orientation:'Referência angular e direção de observação',drawing:'Croqui / referência de localização'};
  const MECHANISMS={uniform:'Perda uniforme',localized:'Dano localizado',unknown:'Não definido'};
  const MINIMUMS={required:'Requerida',alert:'Alerta',reference:'Referência de cenário'};
  const ORIGINS={measured:'Medição anterior',nominal:'Espessura nominal - hipótese histórica'};
  function clean(value){return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').replace(/\u2026/g,'...').replace(/\u2265/g,'>=').replace(/\u2264/g,'<=').replace(/\u00D7/g,'x').trim();}
  function numeric(value){return typeof value==='number'&&Number.isFinite(value);}
  function number(value,digits=3){return numeric(value)?value.toLocaleString('pt-BR',{maximumFractionDigits:digits,minimumFractionDigits:0}):'Indeterminado';}
  function thickness(value){if(numeric(value))return number(value);const v=clean(value);return v||'Ausente';}
  function date(value){const v=clean(value);return /^\d{4}-\d{2}-\d{2}/.test(v)?`${v.slice(8,10)}/${v.slice(5,7)}/${v.slice(0,4)}`:v||'Não informada';}
  function nonempty(value,fallback='Não informado'){return clean(value)||fallback;}
  function comparisonLabel(status){return status==='CONFORME'?'ATENDE À COMPARAÇÃO':status==='NÃO CONFORME'?'NÃO ATENDE À COMPARAÇÃO':'PENDENTE / AVALIAR';}
  function comparisonColor(status){return status==='CONFORME'?COLORS.green:status==='NÃO CONFORME'?COLORS.red:COLORS.blue;}
  function groupedPoints(rows){const points=new Map();rows.forEach(row=>{const key=clean(row.point);if(!points.has(key))points.set(key,{name:key,location:clean(row.location),rows:[]});points.get(key).rows.push(row);});return Array.from(points.values()).map(point=>({...point,status:point.rows.some(row=>row.status==='NÃO CONFORME')?'NÃO CONFORME':point.rows.every(row=>row.status==='CONFORME')?'CONFORME':'INCONCLUSIVO'}));}
  function projection(row){
    const r=row.result;
    if(r?.status==='estimated')return number(r.remainingMonths,1);
    if(r?.status==='hypothesis'&&row.input.mechanism==='uniform')return `${number(r.remainingMonths,1)} (cenário)`;
    if(row.input.mechanism!=='uniform')return 'Não aplicável';
    if(r?.status==='at_or_below_minimum')return 'Sem margem';
    return 'Indeterminado';
  }
  function filename(model){const m=model?.metadata||{};const segment=clean(m.reportNumber||m.tag||'relatorio').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'relatorio';return `Pires-ME-${segment}.pdf`;}
  function assertGeneratedAt(value){
    const match=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
    const invalid=()=>{throw Error('Data de geração do relatório de ME inválida.');};
    if(!match)invalid();
    const day=new Date(match[1]+'T00:00:00Z');
    if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==match[1])invalid();
    if(match[2]!==undefined&&(Number(match[2])>23||Number(match[3])>59||Number(match[4])>59||!Number.isFinite(Date.parse(value))))invalid();
    return value;
  }
  function validate(model){
    if(!model||typeof model!=='object'||!model.metadata||!model.result||!Array.isArray(model.result.rows)||model.result.rows.length<1||model.result.rows.length>400)throw Error('Modelo do relatório de ME inválido.');
    if(!['CONFORME','NÃO CONFORME','INCONCLUSIVO'].includes(model.result.status))throw Error('Resultado global inválido.');
    if(!Array.isArray(model.recommendations)||model.recommendations.some(v=>typeof v!=='string'))throw Error('Recomendações inválidas.');
    const texts=Object.values(model.metadata);if(texts.some(v=>typeof v!=='string')||texts.some(v=>v.length>30000)||model.recommendations.some(v=>v.length>30000))throw Error('Texto do relatório inválido ou excessivamente longo.');
    assertGeneratedAt(model.generatedAt);
    if(model.metadata.verdict==='APROVADO NO ESCOPO AVALIADO'&&model.result.status!=='CONFORME')throw Error('Aprovação indisponível: a comparação contém posições não conformes ou inconclusivas.');
    if(model.metadata.verdict&&model.metadata.verdict!=='PENDENTE DE VALIDAÇÃO'&&(!clean(model.metadata.reviewer)||!clean(model.metadata.basis)))throw Error('Informe responsável técnico e fundamentação do parecer.');
    model.result.rows.forEach(row=>{if(!row||!row.input||!row.measurement||!row.comparison)throw Error('Linha de medição inválida.');});
    if(model.provenance!==undefined){
      if(!model.provenance||typeof model.provenance!=='object'||Array.isArray(model.provenance))throw Error('Origem do snapshot de ME inválida.');
      for(const field of ['appVersion','reviewId'])if(model.provenance[field]!==undefined&&(typeof model.provenance[field]!=='string'||!/^[A-Za-z0-9._+/-]{1,100}$/.test(model.provenance[field])))throw Error('Versão ou revisão do snapshot de ME inválida.');
    }
    model.result.rows.forEach(row=>{if(row.result?.version!==undefined&&row.result.version!==null&&(typeof row.result.version!=='string'||!/^[A-Za-z0-9._+/-]{1,100}$/.test(row.result.version)))throw Error('Versão do motor de ME inválida.');});
    if(model.risk!==undefined&&model.risk!==null){
      const risk=model.risk;
      if(!risk.input||!risk.result?.profile||!risk.result.probability||!risk.result.governing||!Array.isArray(risk.result.elements)||risk.result.elements.length!==3)throw Error('Avaliação da Matriz PI inválida.');
      if(clean(risk.input.tag)!==clean(model.metadata.tag))throw Error('A TAG da Matriz PI deve corresponder à TAG das medições.');
      Object.values(risk.input).forEach(value=>{if(typeof value==='string'&&value.length>30000)throw Error('Texto da Matriz PI excessivamente longo.');});
    }
  }
  function create(model,jsPDFctor){
    const record=snapshot(model),identity=traceRecord(record);
    if(typeof jsPDFctor!=='function')throw Error('Biblioteca PDF indisponível. Atualize a página.');
    if(!Signatures)throw Error('Campos de assinatura indisponíveis. Atualize a página.');
    model=record.model;
    const signatures=Signatures.normalize(model.signatures);
    const doc=new jsPDFctor({orientation:'landscape',unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
    const md=model.metadata,result=model.result,W=297,H=210,M=14,WIDTH=W-M*2,TOP=33,BOTTOM=H-17;
    let y=TOP,sectionId=0;
    doc.setProperties({title:`Relatório de Medição de Espessura - ${clean(md.tag)}`,subject:`Medição de espessura e vida remanescente | Snapshot ${identity.snapshotId}`,author:'Pires Integrity',creator:`Pires Integrity / ME PDF ${VERSION} | App ${identity.appVersion||'não informada'} | Motor ${identity.engineVersions.join('/')||'não informado'} | Versão do motor ausente em ${identity.enginesMissing} posição(ões) | Revisão ${identity.reviewId||'não informada'}`,keywords:`Pires Integrity, ME, ${SNAPSHOT_SCHEMA}, ${identity.snapshotId}`});
    function color(c){doc.setTextColor(...c);}
    function font(size=9,style='normal'){doc.setFont('helvetica',style);doc.setFontSize(size);color(COLORS.ink);}
    function fit(text,width){let v=clean(text);while(doc.getTextWidth(v)>width&&v.length)v=v.slice(0,-1);return v.length<clean(text).length?`${v.slice(0,-3)}...`:v;}
    function header(){
      doc.setFillColor(...COLORS.blue);doc.rect(0,0,W,25,'F');doc.setFillColor(...COLORS.yellow);doc.rect(0,25,W,1.5,'F');
      font(16,'bold');color([255,255,255]);doc.text('PIRES INTEGRITY',M,10);
      font(10,'bold');color([255,255,255]);doc.text('RELATÓRIO DE MEDIÇÃO DE ESPESSURA',M,18);
      font(8);color([255,255,255]);doc.text(fit(`Relatório: ${nonempty(md.reportNumber)} | TAG: ${nonempty(md.tag)}`,153),W-M,10,{align:'right'});
      const emitted=/^\d{4}-\d{2}-\d{2}$/.test(model.generatedAt)?date(model.generatedAt):new Date(model.generatedAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
      doc.text(`Emissão: ${emitted}${model.demo?' | DADOS FICTÍCIOS - DEMONSTRAÇÃO':''}`,W-M,18,{align:'right'});
      y=TOP;
    }
    function page(){doc.addPage();header();}
    function room(height){if(y+height>BOTTOM)page();}
    function lines(text,width=WIDTH,size=9){font(size);return doc.splitTextToSize(clean(text)||'-',width);}
    function paragraph(text,{size=9,bold=false,indent=0,gap=2,tint=COLORS.ink}={}){
      const content=lines(text,WIDTH-indent,size),lh=size*.3528*1.32;
      content.forEach(line=>{room(lh+1);font(size,bold?'bold':'normal');color(tint);doc.text(line,M+indent,y+lh*.79);y+=lh;});y+=gap;
    }
    function heading(title){room(15);y+=3;doc.setFillColor(...COLORS.blue);doc.rect(M,y,WIDTH,7,'F');font(10,'bold');color([255,255,255]);doc.text(`${++sectionId}. ${title}`,M+3,y+4.8);y+=10;}
    function subheading(title){room(12);y+=2;paragraph(title,{size:9.5,bold:true,gap:2,tint:COLORS.blue});}
    function table(columns,widths,rows,{size=8,compact=false,padding=compact?1:3,statusColumn=-1,statuses=[]}={}){
      const lh=size*.3528*1.25,headerHeight=Math.max(...columns.map((value,i)=>lines(value,widths[i]-4,size).length))*lh+4;
      function tableHeader(){room(headerHeight+6);doc.setFillColor(...COLORS.blue);doc.rect(M,y,WIDTH,headerHeight,'F');let x=M;columns.forEach((value,i)=>{font(size,'bold');color([255,255,255]);doc.text(doc.splitTextToSize(clean(value),widths[i]-4),x+2,y+3);x+=widths[i];});y+=headerHeight;}
      tableHeader();
      rows.forEach((values,index)=>{
        const cells=values.map((value,i)=>lines(value,widths[i]-4,size)),count=Math.max(...cells.map(value=>value.length));let offset=0;
        const fullHeight=count*lh+padding;
        if(y+fullHeight>BOTTOM&&fullHeight<=BOTTOM-TOP-headerHeight){page();tableHeader();}
        while(offset<count){
          if(y+lh+3>BOTTOM){page();tableHeader();}
          const capacity=Math.max(1,Math.floor((BOTTOM-y-padding)/lh)),take=Math.min(count-offset,capacity),height=take*lh+padding;
          if(index%2===0){doc.setFillColor(...COLORS.pale);doc.rect(M,y,WIDTH,height,'F');}
          doc.setDrawColor(...COLORS.line);doc.setLineWidth(.15);let x=M;
          cells.forEach((value,i)=>{doc.rect(x,y,widths[i],height);font(size,i===statusColumn?'bold':'normal');if(i===statusColumn)color(comparisonColor(statuses[index]));const part=value.slice(offset,offset+take);if(part.length)doc.text(part,x+2,y+2.5);x+=widths[i];});
          y+=height;offset+=take;if(offset<count){page();tableHeader();}
        }
      });y+=3;
    }
    header();
    const points=groupedPoints(result.rows);
    paragraph('Medição de espessura e vida remanescente',{size:14,bold:true,tint:COLORS.blue,gap:2});
    if(model.demo)paragraph('DEMONSTRAÇÃO: leituras e premissas fictícias para teste. A TAG pode vir de um cadastro real; este documento não representa uma inspeção executada.',{size:8.5,bold:true,tint:COLORS.red,gap:2});
    paragraph(`RESULTADO: ${comparisonLabel(result.status)}`,{size:11,bold:true,tint:comparisonColor(result.status),gap:1});
    paragraph(`Classificação do cálculo: ${result.status}. ${points.length} pontos / ${result.rows.length} geratrizes ou posições registradas.`,{size:8.5,gap:1});
    paragraph(nonempty(result.scope,'Escopo restrito às posições registradas e às referências informadas; não constitui liberação operacional.'),{size:8,gap:1});
    heading('Identificação e rastreabilidade');
    const pairs=[['reportNumber','tag'],['service','material'],['inspector','instrument'],['calibration','procedure'],['orientation','drawing']];
    table(['Identificação / referência','Identificação / referência'],[134.5,134.5],pairs.map(pair=>pair.map(key=>`${LABELS[key]}: ${nonempty(md[key])}`)),{size:8.2,compact:true});
    heading('Resumo por ponto - quatro geratrizes');
    const pointRows=points.map((point,index)=>{
      const readings=['0°','90°','180°','270°'].map(position=>{const row=point.rows.find(item=>clean(item.position).replace(/º$/,'°').replace(/\s/g,'')===position);return row?(row.measurement.valid?number(row.measurement.current):thickness(row.input.current)):'Não registrada';});
      const eligible=point.rows.filter(row=>row.result?.status==='estimated'&&row.result.minimumKind==='required'),limit=eligible.reduce((a,b)=>!a||b.result.remainingMonths<a.result.remainingMonths?b:a,null);
      const exhausted=point.rows.filter(row=>row.comparison.valid&&row.comparison.minimumKind==='required'&&row.comparison.margin<=0);
      const pointLife=exhausted.length?(exhausted.some(row=>row.result?.status==='at_or_below_minimum'&&row.input.mechanism==='uniform')?'0 - mínima atingida':'Sem margem'):limit?`${number(limit.result.remainingMonths,1)}${eligible.length===point.rows.length?'':' (parcial)'}`:'Indeterminado';
      return [`${point.name} [L${index+1}]`,...readings,pointLife,comparisonLabel(point.status)];
    });
    table(['Ponto / referência\nde localização','0°\n(mm)','90°\n(mm)','180°\n(mm)','270°\n(mm)','Menor vida elegível\n(meses)','Comparação de\nespessuras'],[81,22,22,22,22,41,59],pointRows.slice(0,6),{size:8,statusColumn:6,statuses:points.slice(0,6).map(point=>point.status),compact:true});
    if(pointRows.length>6)paragraph(`Resumo inicial: 6 de ${pointRows.length} pontos. Continuação na próxima folha; nenhuma leitura foi descartada.`,{size:8,gap:1});
    paragraph('O resultado do ponto considera todas as posições registradas: uma posição não conforme reprova a comparação do ponto; lacunas ou igualdade com a mínima mantêm a avaliação pendente.',{size:8,gap:1});
    if(result.minimum)paragraph(`Menor espessura atual: ${number(result.minimum.measurement.current)} mm em ${clean(result.minimum.point)} / ${clean(result.minimum.position)}.`,{size:8.5,bold:true,gap:1});
    if(result.limiting)paragraph(`Menor vida elegível: ${number(result.limiting.result.remainingMonths,1)} meses em ${clean(result.limiting.point)} / ${clean(result.limiting.position)}. ${result.complete?'Projeção elegível em todas as posições.':'Existem posições sem projeção elegível; não representa a vida global da TAG.'}`,{size:8.5,bold:true,gap:1});
    else paragraph('Vida remanescente global da TAG: não determinada. Nenhuma projeção elegível.',{size:8.5,bold:true,gap:1});

    if(pointRows.length>6){page();heading('Resumo por ponto - continuação');table(['Ponto / referência','0° (mm)','90° (mm)','180° (mm)','270° (mm)','Vida (meses)','Comparação'],[81,22,22,22,22,41,59],pointRows.slice(6),{size:8,statusColumn:6,statuses:points.slice(6).map(point=>point.status),compact:true});}
    const premises=[],premiseIds=new Map();
    function premise(row){const input=row.input;const data={currentDate:input.currentDate,previousDate:input.previousDate,minimumKind:input.minimumKind,minimumSource:input.minimumSource,previousOrigin:input.previousOrigin,mechanism:input.mechanism,comparable:input.comparable,useInitial:input.useInitial,initial:input.initial,initialDate:input.initialDate,initialOrigin:input.initialOrigin,ratePolicy:row.result?.policy||input.ratePolicy,justification:row.result?.justification||input.justification};const key=JSON.stringify(data);if(!premiseIds.has(key)){const id=`F${premises.length+1}`;premiseIds.set(key,id);premises.push({id,data,rows:[]});}const id=premiseIds.get(key);premises.find(item=>item.id===id).rows.push(`${clean(row.point)} / ${clean(row.position)}`);return id;}
    const detailRows=result.rows.map(row=>{const r=row.result,c=row.comparison,m=row.measurement;return [`${clean(row.point)} / ${clean(row.position)}`,thickness(row.input.previous),m.valid?number(m.current):thickness(row.input.current),c.valid?number(c.minimum):thickness(row.input.minimum),c.valid?number(c.margin):'Indeterminado',r?number(r.adoptedRate):'Indeterminado',projection(row),comparisonLabel(row.status),premise(row)];});
    page();heading('Registro por geratriz e resultado individual');
    paragraph('Espessuras / margem: mm. Taxa: mm/ano. Vida: meses desde a medição atual. F1, F2... identificam as datas e fontes descritas na próxima seção.',{size:8,gap:2});
    table(['Ponto / geratriz','Anterior\n(mm)','Atual\n(mm)','Mínima\n(mm)','Margem\n(mm)','Taxa adotada\n(mm/ano)','Vida\n(meses)','Comparação','Fonte /\ndatas'],[31,24,24,24,24,29,34,57,22],detailRows,{size:7.2,compact:true,padding:.5,statusColumn:7,statuses:result.rows.map(row=>row.status)});
    paragraph('ATENDE À COMPARAÇÃO = CONFORME nas posições registradas. NÃO ATENDE À COMPARAÇÃO = NÃO CONFORME. PENDENTE / AVALIAR = INCONCLUSIVO ou NO LIMITE - AVALIAR. Não equivale à liberação operacional.',{size:8,gap:1});

    page();heading('Datas, fontes e premissas');
    const locationRows=[];for(let i=0;i<points.length;i+=2)locationRows.push([`${'L'+(i+1)} - ${points[i].name}: ${nonempty(points[i].location)}`,points[i+1]?`${'L'+(i+2)} - ${points[i+1].name}: ${nonempty(points[i+1].location)}`:'-']);
    table(['Localização dos pontos','Localização dos pontos'],[134.5,134.5],locationRows,{size:7.7,compact:true});
    premises.forEach(item=>{
      const input=item.data;
      subheading(`${item.id} - ${item.rows.length} posições`);
      paragraph(`Atual: ${date(input.currentDate)}. Anterior: ${date(input.previousDate)}. Histórico: ${ORIGINS[input.previousOrigin]||'Não definido'}. Mecanismo: ${MECHANISMS[input.mechanism]||'Não definido'}. Posições e condições comparáveis: ${input.comparable===true?'confirmadas pelo usuário':'não confirmadas'}.`,{size:8.3,gap:1});
      paragraph(`Mínima ${MINIMUMS[input.minimumKind]||'não definida'}. Fonte da espessura mínima: ${nonempty(input.minimumSource)}.`,{size:8.3,gap:1});
      if(input.useInitial)paragraph(`Histórico inicial: ${thickness(input.initial)} mm em ${date(input.initialDate)} (${ORIGINS[input.initialOrigin]||'origem não definida'}).`,{size:8.3,gap:1});
      if(input.ratePolicy&&input.ratePolicy!=='max')paragraph(`Critério da taxa: ${{short:'Curto prazo',long:'Longo prazo'}[input.ratePolicy]||nonempty(input.ratePolicy)}. Justificativa: ${nonempty(input.justification)}.`,{size:8.3,gap:1});
    });
    heading('Memória de cálculo resumida');
    paragraph('A projeção por corrosão uniforme é independente do código de construção. Para ASME VIII, Divisão 3, ela não substitui a avaliação de fadiga, mecânica da fratura ou a vida em ciclos. A espessura mínima deve ter base documental própria.',{size:8.5,gap:2});
    paragraph('Intervalo (anos) = dias corridos entre as datas / 365. Taxa de curto prazo = (anterior - atual) / intervalo. Margem = atual - mínima. Vida (anos) = margem / taxa positiva; vida (meses) = anos x 12.',{size:8.5,gap:2});
    paragraph('Taxa e projeção são calculadas individualmente para cada geratriz. O aplicativo não substitui as quatro leituras pela média. Nominal como histórico ou mínima de cenário são hipóteses; referência de alerta produz prazo até alerta.',{size:8.5,gap:2});
    paragraph('Requerida: margem negativa = REPROVADO, inclusive sem histórico; igualdade = NO LIMITE - AVALIAR. Margem positiva elegível, histórico comparável/coerente e perda uniforme = APROVADO na comparação. Outras situações = PENDENTE / AVALIAR. Dano localizado, ganho de espessura, taxa não positiva ou ausência de dados podem impedir a projeção.',{size:8.3,gap:2});
    const messages=new Map();
    function message(value,row){const text=clean(value);if(!text)return;if(!messages.has(text))messages.set(text,[]);messages.get(text).push(`${clean(row.point)} / ${clean(row.position)}`);}
    result.rows.forEach(row=>{
      [row.error,!row.measurement.valid?row.measurement.error:'',!row.comparison.valid?row.comparison.error:'',row.input.missing,...(row.result?.warnings||[])].forEach(value=>message(value,row));
      const r=row.result;if(r?.longRate!==null&&r?.longRate!==undefined)paragraph(`${clean(row.point)} / ${clean(row.position)}: taxa curto prazo ${number(r.shortRate)}; longo prazo ${number(r.longRate)}; adotada ${number(r.adoptedRate)} mm/ano. Critério: ${nonempty(r.policy)}. Justificativa: ${nonempty(r.justification,'Maior taxa disponível')}.`,{size:8.3,gap:1});
    });
    if(messages.size){subheading('Ressalvas / dados pendentes');messages.forEach((refs,text)=>{const unique=Array.from(new Set(refs));paragraph(`${text} [${unique.length===result.rows.length?`Todas as ${result.rows.length} posições`:unique.join('; ')}]`,{size:8,gap:1});});}
    heading('Matriz PI e recomendações');
    if(model.risk){
      const risk=model.risk,input=risk.input,r=risk.result;
      paragraph(`Matriz ${nonempty(r.profile.name)} - revisão ${nonempty(r.profile.revision)}; regras ${nonempty(r.profile.rulesVersion)}. Avaliador: ${nonempty(input.assessor)}. Data: ${date(input.riskDate)}. Ponto / componente: ${nonempty(input.riskPoint)}.`,{size:8.3,gap:1});
      paragraph(`Anomalia: ${nonempty(input.anomaly)}. Evidência: ${nonempty(input.evidence)}.`,{size:8.3,gap:1});
      paragraph(`Probabilidade (PoF): ${number(r.probability.value,0)} - ${nonempty(r.probability.label)}. Justificativa: ${nonempty(input.pofReason)}.`,{size:8.3,gap:1});
      table(['Elemento','PoF','CoF','Pontuação','Categoria indicativa','Justificativa da consequência'],[40,15,15,23,45,131],r.elements.map(element=>[`${nonempty(element.code)} - ${nonempty(element.impactLabel||element.label)}`,number(element.pof,0),number(element.cof,0),number(element.score,0),`${nonempty(element.category)} - ${nonempty(element.label)}`,nonempty(element.justification)]),{size:8,compact:true});
      paragraph(`Risco governante: ${nonempty(r.governing.category)} - ${nonempty(r.governing.label)} (${nonempty(r.governing.code)}; pontuação ${number(r.governing.score,0)}). Recomendação: ${nonempty(r.governing.action)}.`,{size:8.5,bold:true,gap:2});
      (r.warnings||[]).forEach(text=>paragraph(text,{size:8,gap:1}));
    }else paragraph('Matriz PI não avaliada. A vida remanescente isoladamente não determina a probabilidade de falha; classificação de risco e recomendações da matriz pendentes.',{size:8.5,gap:2});
    heading('Recomendações e parecer técnico');
    // Older browser payloads also append the free-form notes to recommendations.
    // Keep that text once, in its canonical observations section.
    const recommendations=model.recommendations.filter(text=>!clean(md.notes)||clean(text)!==clean(md.notes));
    if(recommendations.length)recommendations.forEach((text,i)=>paragraph(`${i+1}) ${text}`,{size:8.5,gap:1}));
    else paragraph('Recomendações pendentes de revisão técnica.',{size:8.5,gap:1});
    if(clean(md.notes)){subheading('Observações complementares');paragraph(md.notes,{size:8.5});}
    const review=[
      {text:`Parecer declarado: ${nonempty(md.verdict,'PENDENTE DE VALIDAÇÃO')}`,size:10,bold:true},
      {text:`Responsável técnico / registro profissional: ${nonempty(md.reviewer,'Pendente')}`,size:9},
      {text:`Fundamentação do parecer: ${nonempty(md.basis,'Pendente de análise técnica')}`,size:9},
      {text:`Próxima inspeção / acompanhamento: ${nonempty(md.next,'Não definido')}. O prazo de inspeção é independente da projeção de vida remanescente e deve considerar os requisitos aplicáveis e as condições de serviço.`,size:9}
    ];
    const reviewHeight=review.reduce((height,item)=>height+lines(item.text,WIDTH,item.size).length*item.size*.3528*1.32+2,0);
    if(reviewHeight<=BOTTOM-TOP)room(reviewHeight+1);
    review.forEach(item=>paragraph(item.text,{size:item.size,bold:item.bold===true}));
    page();heading('Responsáveis e assinaturas');
    y=Signatures.draw(doc,signatures,{x:M,y:50,width:WIDTH,maxHeight:135}).bottom+6;
    paragraph('Documento gerado pelo aplicativo. A identificação digitada e a imagem de assinatura anexada não constituem assinatura digital verificável, certificação ou liberação operacional.',{size:8});
    subheading('Identificação do snapshot');
    paragraph(`Aplicativo de origem: ${identity.appVersion||'não informado'}. Motor nos resultados: ${identity.engineVersions.join(' / ')||'não informado'}${identity.engineVersions.length>1?' (versões distintas)':''}. Gerador PDF ME: ${VERSION}. Revisão local: ${identity.reviewId||'não informada'}.`,{size:7.2,gap:1});
    if(identity.enginesMissing)paragraph(`Versão do motor não informada em ${identity.enginesMissing} de ${result.rows.length} posições. As versões identificadas não comprovam a origem das demais posições.`,{size:7.2,gap:1});
    paragraph(`Snapshot SHA-256: ${identity.snapshotId.slice(7)}`,{size:7.2,gap:1});
    paragraph('Identifica o modelo de dados recebido, incluindo entradas e resultados. Não é hash do arquivo PDF, assinatura digital, comprovação de produção ou aprovação técnica.',{size:7.2,gap:1});
    const total=doc.getNumberOfPages();
    for(let p=1;p<=total;p++){
      doc.setPage(p);doc.setDrawColor(...COLORS.line);doc.setLineWidth(.2);doc.line(M,H-13,W-M,H-13);font(6.5);color(COLORS.blue);doc.text(`Snapshot SHA-256: ${identity.snapshotId.slice(7)}`,M,H-10);font(7.4);doc.text(fit(`Pires Integrity | ${nonempty(md.reportNumber)} | ${nonempty(md.tag)}`,190),M,H-7);doc.text(`Página ${p} de ${total}`,W-M,H-7,{align:'right'});
    }
    // Return copies so later UI edits cannot change the snapshot of this emission.
    doc.getMESnapshot=()=>JSON.parse(JSON.stringify(record));
    return doc;
  }
  return {VERSION,SNAPSHOT_SCHEMA,create,filename,comparisonLabel,snapshot,trace,assertGeneratedAt};
});
