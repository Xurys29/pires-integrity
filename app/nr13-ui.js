(function (root) {
  'use strict';
  const N=root.IntegrityNR13, $=id=>document.getElementById(id);
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  function field(parent,id,label,type='text',options) {
    const box=el('div');box.id=id+'Field';const l=el('label',label);l.htmlFor=id;
    const input=el(options?'select':type==='textarea'?'textarea':'input');input.id=id;input.name=id;input.required=true;
    if(options) for(const [value,text] of options) {const o=el('option',text);o.value=value;input.append(o);}
    else if(type==='textarea') input.rows=3;
    else {input.type='text';if(type==='decimal')input.inputMode='decimal';}
    box.append(l,input);parent.append(box);return input;
  }
  function card(parent,title) {const c=el('div',undefined,'card');c.append(el('h2',title));const grid=el('div',undefined,'fields');c.append(grid);parent.append(c);return {c,grid};}
  function conditional(id,visible) {$(id+'Field').classList.toggle('hidden',!visible);$(id).disabled=!visible;}
  function inputs() {return Object.fromEntries(new FormData($('calcForm')));}
  function selected() {return $('pmtaTask').value==='nr13';}
  function sync(active=true) {
    const nr=selected();$('nr13Fields').disabled=!nr;$('nr13Fields').classList.toggle('hidden',!nr);
    $('pmtaPressureFields').disabled=nr;$('pmtaPressureFields').classList.toggle('hidden',nr);
    if(active) {$('loadExample').textContent=nr?'Carregar exemplo NR-13':'Carregar exemplo da planilha';$('calculate').textContent=nr?'Gerar enquadramento e premissas':'Calcular avaliação';}
    const profile=N.CATALOG.find(p=>p.id===$('nrProfile').value);
    const tank=profile?.family==='tank', vessel=profile?.family==='vessel', fluid=$('nrFluid').value;
    const standalone=profile?.family==='other'||['buried','structural'].includes(profile?.id);
    for(const id of ['nrMaterialKind','nrFluid','nrFluidSource','nrPressure','nrPressureUnit','nrVolume','nrVolumeUnit','nrDiameter','nrDiameterUnit','nrExclusion']) conditional(id,!standalone);
    for(const id of ['nrSupport','nrTankDefinition']) conditional(id,Boolean(tank)&&!standalone);
    for(const id of ['nrRegime','nrHead']) conditional(id,Boolean(vessel));
    conditional('nrFluidTemperature',!standalone&&fluid==='combustible');conditional('nrToxicLimit',!standalone&&fluid==='toxic');conditional('nrFluidClass',!standalone&&['mixture','documented'].includes(fluid));
    $('nrDiameter').labels[0].textContent=tank?'Diâmetro externo do tanque':'Diâmetro interno do vaso';
    $('nrVolume').labels[0].textContent=tank?'Capacidade nominal do tanque':'Volume interno do vaso / câmara';
    $('nrExclusion').querySelectorAll('option').forEach(o=>{if(!['','unknown','none'].includes(o.value))o.disabled=!vessel;});
    if($('nrExclusion').selectedOptions[0]?.disabled) $('nrExclusion').value='unknown';
    $('nrPremises').replaceChildren();
    if(profile) {
      $('nrPremises').append(el('p',`Referência a confirmar: ${profile.code}. ${profile.refs}.`),el('p',profile.capability));
      const list=el('ul');[...N.COMMON,...profile.inputs].forEach(t=>list.append(el('li',t)));$('nrPremises').append(list);
      if(vessel) {$('nrPremises').append(el('p',N.HEADS.find(h=>h[0]===$('nrHead').value)?.[2]||'Selecione a geometria dos tampos para consultar premissas específicas.'));}
    }
    preview();
  }
  function preview() {
    $('nrLive').replaceChildren();
    if(!selected())return;
    try {const r=N.assess(inputs());$('nrLive').append(el('strong',status(r)),el('p',r.category?`Classe ${r.fluidClass} • Grupo ${r.group} • P·V = ${fmt(r.pvMPaM3)} MPa·m³`:r.warnings.at(-1)));}
    catch(error) {$('nrLive').append(el('strong','Preencha os dados para obter o enquadramento.'),el('p',error instanceof N.InputError?error.message:'Revise as entradas.'));}
  }
  const fmt=n=>n===null||n===undefined?'Não aplicável':n.toLocaleString('pt-BR',{maximumFractionDigits:9});
  function status(r) {return r.category?`Categoria ${r.category} — vaso de pressão`:({covered:'Tanque abrangido — sem categoria I–V',excluded:'Exclusão específica da NR-13',not_covered:'Critérios de abrangência não atendidos',review_required:'Enquadramento pendente de análise'})[r.status];}
  function init() {
    const parent=$('nr13Fields');
    const a=card(parent,'01 • Família e premissas do equipamento');
    field(a.grid,'nrProfile','Família do equipamento','text',[['','Selecionar família'],...N.CATALOG.map(p=>[p.id,p.name])]);
    field(a.grid,'nrHead','Geometria dos tampos','text',[['','Não caracterizada'],...N.HEADS.map(h=>h.slice(0,2))]).required=false;
    field(a.grid,'nrMaterialKind','Natureza construtiva','text',[['','Selecionar'],['metal','Metálico'],['prfv','PRFV'],['other','Outro material'],['unknown','Não confirmado']]);
    field(a.grid,'nrSupport','Apoio / instalação do tanque','text',[['','Selecionar'],['ground','Fundo apoiado no solo / fundação contínua'],['legs','Pernas, sapatas ou pedestais'],['saddles','Selas'],['buried','Enterrado'],['structural','Estrutural de embarcação / plataforma'],['unknown','Não confirmado']]);
    field(a.grid,'nrTankDefinition','Definição construtiva do tanque','text',[['','Selecionar'],['yes','Confirmado: estático, não enterrado, costado vertical'],['unknown','Construção especial / não confirmada']]);
    field(a.grid,'nrSource','Fonte dos dados e da identificação do equipamento','textarea');
    const details=el('details');details.append(el('summary','Premissas de cálculo e limites desta família'));const premises=el('div');premises.id='nrPremises';details.append(premises);a.c.append(details);
    const b=card(parent,'02 • Fluido e condições máximas de operação');
    field(b.grid,'nrFluid','Critério determinante do fluido — considerar todos os perigos','text',[
      ['','Selecionar critério'],['flammable','Inflamável'],['combustible','Combustível — informar temperatura'],['toxic','Tóxico — informar limite de tolerância'],['hydrogen','Hidrogênio'],['acetylene','Acetileno'],['steam','Vapor de água'],['asphyxiant','Gás asfixiante simples'],['air','Ar comprimido'],['other','Outros — comprovadamente fora de A, B e C'],['mixture','Mistura — classe fundamentada pelo avaliador'],['documented','Classe previamente documentada']]);
    field(b.grid,'nrFluidTemperature','Temperatura do fluido combustível (°C)','decimal');
    field(b.grid,'nrToxicLimit','Limite de tolerância do fluido tóxico (ppm)','decimal');
    field(b.grid,'nrFluidClass','Classe documentada / da mistura','text',[['','Selecionar'],['A','Classe A'],['B','Classe B'],['C','Classe C'],['D','Classe D']]);
    field(b.grid,'nrFluidSource','Fundamentação do fluido: FDS, composição, concentração e condições','textarea');
    field(b.grid,'nrRegime','Regime de pressão','text',[['','Selecionar'],['positive','Pressão positiva'],['vacuum','Exclusivamente vácuo'],['both','Pressão positiva e vácuo']]);
    field(b.grid,'nrPressure','Módulo da pressão máxima de operação','decimal');
    field(b.grid,'nrPressureUnit','Unidade de pressão manométrica','text',[['kPa','kPa'],['bar','bar'],['MPa','MPa']]);
    b.c.append(el('p','Use pressão máxima de operação, não PMTA nem pressão de projeto. Em regime alternado, informar o maior módulo e fundamentar os extremos na fonte. O campo usa módulo positivo; 0 é admitido para tanque atmosférico.','small'));
    field(b.grid,'nrVolume','Volume interno do vaso / câmara','decimal');
    field(b.grid,'nrVolumeUnit','Unidade de volume / capacidade','text',[['m3','m³'],['L','litros']]);
    field(b.grid,'nrDiameter','Diâmetro interno do vaso','decimal');
    field(b.grid,'nrDiameterUnit','Unidade de diâmetro','text',[['mm','mm'],['m','m']]);
    const c=card(parent,'03 • Revisão de abrangência');
    field(c.grid,'nrExclusion','Revisão das exclusões do item 13.2.2','text',[['','Selecionar'],['unknown','Revisão pendente'],['none','Nenhuma exclusão adicional aplicável, conforme revisão'],...N.EXCLUSIONS.map(([key,label])=>[key,`13.2.2(${key}) — ${label}`])]);
    c.c.append(el('p','Diâmetro interno < 150 mm, vaso de PRFV, vácuo exclusivo de pequeno módulo, tanques enterrados/estruturais e apoios específicos são tratados pelos campos acima. Dutos, caldeiras, tubulações, aquecedores e outros equipamentos exigem avaliação própria.','small'));
    const live=el('div',undefined,'notice');live.id='nrLive';live.setAttribute('role','status');parent.append(live);
    $('pmtaTask').addEventListener('change',()=>sync());
    parent.addEventListener('change',()=>sync());parent.addEventListener('input',preview);sync(false);
  }
  function example() {return {tag:'V-001-NR13-EXEMPLO',service:'Ar comprimido',material:'Aço carbono — exemplo',pmtaTask:'nr13',nrProfile:'cylindrical',nrHead:'elliptical',nrMaterialKind:'metal',nrSource:'Exemplo didático das imagens: D interno 1500 mm, volume geométrico 7,068583471 m³. Sem validar ativo real.',nrFluid:'air',nrFluidSource:'Ar comprimido sem outro perigo determinante — hipótese didática.',nrRegime:'positive',nrPressure:'8',nrPressureUnit:'bar',nrVolume:'7,068583471',nrVolumeUnit:'m3',nrDiameter:'1500',nrDiameterUnit:'mm',nrExclusion:'none'};}
  function render(r) {
    $('resultTitle').textContent='Enquadramento NR-13 e premissas';
    const hero=el('div',undefined,'card hero-result attention');hero.append(el('span','Enquadramento indicativo','badge'),el('div',status(r),'metric'),el('p',r.profile));$('resultMetrics').append(hero);
    if(r.fluidClass) hero.append(el('p',`Classe do fluido ${r.fluidClass}${r.group?` • Grupo de potencial de risco ${r.group}`:''}${r.pvMPaM3!==null?` • P·V = ${fmt(r.pvMPaM3)} MPa·m³`:''}`));
    $('chartTitle').textContent='Premissas e código de cálculo';$('chart').replaceChildren(el('p',r.codeRoute),el('p',r.calculationStatus));const list=el('ul');r.premises.forEach(t=>list.append(el('li',t)));$('chart').append(list);
    $('inspectionNote').textContent=(r.requirements||['Confirmar dados, tipo e critérios pendentes com o responsável técnico.']).join('\n\n');
    const rows=[['Família',r.profile],['Abrangência',r.scope==='covered'?'Abrangido pelos critérios informados':status(r)],['Classe do fluido',r.fluidClass||'Pendente / não aplicável'],['Grupo de potencial de risco',r.group||'Não atribuído'],['Categoria do vaso',r.category||'Não atribuída'],['Pressão máxima de operação — módulo',`${fmt(r.pressureKPa)}${r.pressureKPa===undefined?'':' kPa'}`],['Volume / capacidade',`${fmt(r.volumeM3)}${r.volumeM3===undefined?'':' m³'}`],['P·V para abrangência (> 8 kPa·m³, quando aplicável)',r.pvKPaM3===null?'Não aplicável':`${fmt(r.pvKPaM3)} kPa·m³`],['P·V para grupo de risco',r.pvMPaM3===null?'Não aplicável':`${fmt(r.pvMPaM3)} MPa·m³`],...r.criteria];
    if(r.intervals) {
      const y=v=>v===null?'A critério, conforme norma':`${v} anos`;
      rows.push(['Tabela 2 — sem SPIE: externo / interno',`${y(r.intervals.withoutSPIE.external)} / ${y(r.intervals.withoutSPIE.internal)}`],['Tabela 2 — com SPIE certificado: externo / interno',`${y(r.intervals.withSPIE.external)} / ${y(r.intervals.withSPIE.internal)}`],['Aplicação dos prazos','Limites gerais de referência; não definem a próxima inspeção. Avaliar condições especiais.']);
    }
    rows.push(['Referência de dimensionamento a confirmar',r.codeRoute],['Cálculo estrutural disponível',r.calculationStatus],...r.premises.map((t,i)=>[`Premissa ${i+1}`,t]));
    return rows;
  }
  root.IntegrityNR13UI={init,sync,selected,preview,example,render};
})(globalThis);
