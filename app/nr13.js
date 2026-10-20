(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IntegrityNR13 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0.0';
  const SOURCE = { title: 'NR-13 — texto oficial consolidado, Portarias MTP 1.846/2022 e 4.219/2022; consulta em 08/10/2026',
    url: 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/nr-13-atualizada-2023-b.pdf' };
  const CATEGORIES = { A: ['I','I','II','III','III'], B: ['I','II','III','IV','IV'], C: ['I','II','III','IV','V'], D: ['II','III','IV','V','V'] };
  const INTERVALS = { I: [1,3,3,6], II: [2,4,4,8], III: [3,6,5,10], IV: [4,8,6,12], V: [5,10,7,null] };
  const COMMON = ['Código de construção, edição, fabricante, ano e documentação do equipamento',
    'Fluido, composição, FDS, temperatura e condições máximas/mínimas de operação e projeto',
    'Geometria, dimensões, materiais, espessuras e mapa de medições por componente',
    'Corrosão interna/externa, tolerâncias, mecanismos de dano e histórico de serviço',
    'Juntas, eficiência, exames de fabricação, reparos e dispositivos de proteção',
    'Bocais, conexões, suportes, carregamentos, fundação e condições de teste'];
  const CATALOG = [
    { id:'cylindrical', family:'vessel', name:'Vaso cilíndrico / reservatório pressurizado', code:'ASME VIII-1, se aplicável ao projeto', refs:'UG-16, UG-21 a UG-32, UG-98', inputs:['Orientação, diâmetro interno, comprimento entre tangentes e trechos do casco','Geometria de cada tampo e espessura mínima após conformação','S na temperatura, E por junta, CA e dimensões corroídas'], capability:'PMTA parcial disponível somente para cilindro com dois tampos elipsoidais 2:1 iguais.' },
    { id:'sphere', family:'vessel', name:'Vaso esférico / esfera de armazenamento', code:'ASME VIII-1, se aplicável', refs:'UG-27(d), UG-28(d)', inputs:['Raio interno/externo, espessura por região, juntas e colunas','Pressão interna/externa, cargas dos apoios e aberturas'], capability:'Enquadramento NR-13 disponível; dimensionamento esférico pendente.' },
    { id:'cone', family:'vessel', name:'Vaso com seções cônicas / toricônicas', code:'ASME VIII-1, se aplicável', refs:'UG-32, UG-33, Apêndice 1-5', inputs:['Diâmetros nas transições, semiângulo, comprimentos, raios de concordância','Espessuras e reforços nas junções; condições de apoio'], capability:'Enquadramento disponível; cálculo das transições e reforços pendente.' },
    { id:'jacket', family:'vessel', name:'Vaso encamisado / múltiplas câmaras', code:'ASME VIII-1, se aplicável', refs:'UG-19, Apêndice 9', inputs:['Dados de cada câmara, volumes e pressões diferenciais coincidentes','Casos de partida, parada, teste e falha entre câmaras'], capability:'Avaliar cada câmara com documentação própria; enquadramento global exige análise técnica.' },
    { id:'exchanger', family:'vessel', name:'Trocador de calor / casco e tubos', code:'ASME VIII-1, se aplicável', refs:'UG-19, Parte UHX quando aplicável', inputs:['Dados separados de casco/tubos, espelhos, tubos, juntas e expansão térmica','Pressões/temperaturas diferenciais, volumes por câmara e arranjo'], capability:'Avaliar cada câmara; cálculo de espelho e conjunto pendente. Placas corrugadas gaxetadas/brasadas: exclusão específica.' },
    { id:'mobile', family:'vessel', name:'Recipiente móvel (não transportável pressurizado)', code:'Código de construção documentado', refs:'NR-13 13.2.1(d) e glossário', inputs:['Comprovação da distinção entre móvel e transportável','Pressão, volume, geometria e condições de movimentação'], capability:'Enquadramento por 13.2.1(d); recipientes transportáveis têm tratamento distinto.' },
    { id:'special', family:'vessel', name:'Vaso de geometria especial / não circular', code:'Código e método específico a confirmar', refs:'ASME VIII-1 U-2(g), Apêndice 13 quando aplicável', inputs:['Desenho completo, reforços, vínculos e método de análise','Condições de contorno e justificativa do modelo'], capability:'Enquadramento NR-13 por dados documentados; cálculo estrutural específico pendente.' },
    { id:'atmospheric', family:'tank', name:'Tanque metálico atmosférico', code:'API 650 ou outro código compatível documentado', refs:'NR-13 13.2.1(f), 13.7 e glossário', inputs:['Diâmetro externo, capacidade nominal, altura e nível máximo','Fundo, costado por anel, teto fixo/flutuante, fundação e ancoragem','Densidade do produto, vento, sismo, recalques e respiros'], capability:'Enquadramento disponível; dimensionamento de tanque por API 650 ainda não implementado.' },
    { id:'low_pressure', family:'tank', name:'Tanque metálico de baixa pressão', code:'API 620 ou outro código compatível documentado', refs:'NR-13 13.2.1(f), 13.7 e glossário', inputs:['Pressões máxima/mínima, temperatura, geometria e nível','Costado, fundo, teto, ancoragens e dispositivos de alívio'], capability:'Dimensionamento por API 620 pendente. Confirmar definição de tanque: pressão inferior a 103 kPa e demais condições do glossário.' },
    { id:'refrigerated', family:'tank', name:'Tanque refrigerado / criogênico', code:'API 620 / API 625 ou código específico documentado', refs:'NR-13 13.7 e glossário, conforme enquadramento', inputs:['Sistema de contenção, barreiras, isolamento, material e temperatura mínima','Contração térmica, fundação, boil-off e cenários de alívio'], capability:'Enquadramento depende da construção real; cálculo térmico/estrutural específico pendente.' },
    { id:'horizontal_tank', family:'tank', name:'Tanque horizontal de armazenamento', code:'Código específico da construção', refs:'NR-13 13.2.2(n) e glossário', inputs:['Posição, apoio, pressão, documentação que distingue tanque e vaso','Dimensões do corpo, tampos e selas'], capability:'Tanques sobre selas são excluídos por 13.2.2(n); esta exclusão não se transfere automaticamente a vasos de pressão.' },
    { id:'buried', family:'tank', name:'Tanque enterrado', code:'Código específico da construção/instalação', refs:'NR-13 13.2.2(n), 13.2.3', inputs:['Profundidade, solo, lençol freático, proteção anticorrosiva e cargas externas'], capability:'Exclusão NR-13 específica; permanece o dever de inspeção e manutenção.' },
    { id:'structural', family:'tank', name:'Tanque estrutural de embarcação / plataforma', code:'Regras aplicáveis à estrutura naval', refs:'NR-13 13.2.2(l), 13.2.3', inputs:['Integração estrutural, compartimentos, cargas, revestimentos e regras de classe'], capability:'Exclusão específica; tanque independente a bordo não é automaticamente tanque estrutural.' },
    { id:'nonmetal', family:'other', name:'Tanque não metálico / PRFV', code:'Código específico do material e construção', refs:'NR-13 13.2.1(f), 13.2.2(j), 13.2.3', inputs:['Material, laminado, processo de fabricação, pressão e mecanismos de degradação'], capability:'Não aplicar equações de vaso metálico; vaso em PRFV tem exclusão específica.' },
    { id:'vent', family:'other', name:'Respiro / dispositivo contra sobrepressão e vácuo', code:'API 2000 para aplicações compatíveis; código do equipamento', refs:'NR-13 13.7.2.1–2', inputs:['Vazões de enchimento/esvaziamento, respiração térmica e cenários de emergência','Pressões de ajuste, contrapressão, propriedades do fluido e capacidade certificada','Arranjo, perdas de carga, descarga e corta-chamas quando aplicável'], capability:'Acessório: não recebe categoria de vaso. Dimensionamento de vazão de alívio ainda não implementado.' },
    { id:'unknown', family:'other', name:'Outro equipamento / enquadramento a confirmar', code:'A definir pelo responsável técnico', refs:'NR-13 13.2 e glossário', inputs:['Folha de dados, desenhos, finalidade e condições de operação'], capability:'Caldeiras, tubulações e equipamentos não identificados exigem análise própria; não atribuir categoria I–V por analogia.' }
  ];
  const EXCLUSIONS = [
    ['a','Transportável, destinado ao transporte de produtos, reservatório portátil ou extintor'],
    ['b','Vaso destinado à ocupação humana'],['c','Vaso integrante de sistema auxiliar de pacote de máquinas'],
    ['m','Vaso/acumulador submarino de produção ou exploração de petróleo'],['o','Panela de cocção'],
    ['p','Acumulador ou bloco hidráulico'],['r','Trocador de placas corrugadas gaxetadas ou brasadas']
  ];
  const HEADS = [
    ['elliptical','Elipsoidal 2:1','UG-32(c): diâmetro, profundidade, espessura mínima após conformação, S, E, CA e t_s/L. Pré-cálculo parcial disponível.'],
    ['elliptical_general','Elipsoidal de outra proporção','Apêndice 1-4: diâmetro, profundidade e fator geométrico; cálculo pendente.'],
    ['hemispherical','Hemisférico','UG-32(e): raio, espessura, S/E e junta de ligação; cálculo pendente.'],
    ['torispherical','Torisférico','UG-32(d) / Apêndice 1-4: raio da coroa, raio de concordância, diâmetro e limites geométricos; cálculo pendente.'],
    ['flat','Plano','UG-34: forma, dimensões livres, fixação, coeficientes e cargas de parafusos quando aplicáveis; cálculo pendente.'],
    ['conical','Cônico / toricônico','UG-32(f)/(g), Apêndice 1-5: ângulo, diâmetros, transições, raios e reforços; cálculo pendente.'],
    ['mixed','Tampos diferentes / outra geometria','Caracterizar cada extremidade e suas ligações separadamente; cálculo específico pendente.']
  ];
  class InputError extends Error {}
  function text(value, label) { if (typeof value !== 'string' || !value.trim()) throw new InputError(`Informe ${label}.`); return value.trim(); }
  function choice(value, allowed, label) { if (!allowed.includes(value)) throw new InputError(`Selecione ${label}.`); return value; }
  // Decimal rational comparisons preserve strict legal thresholds without rounding P.V.
  function decimal(value, label, zero = false) {
    if (!['string','number'].includes(typeof value)) throw new InputError(`Informe ${label}.`);
    const s = String(value).trim().replace(',', '.');
    if (!/^\d{1,12}(?:\.\d{1,12})?$/.test(s)) throw new InputError(`${label}: use número não negativo, sem unidade ou separador de milhar, até 12 casas decimais.`);
    const [a,b=''] = s.split('.'), n = BigInt(a+b), d = 10n ** BigInt(b.length);
    if (!zero && n === 0n) throw new InputError(`${label} deve ser maior que zero.`);
    return { n, d };
  }
  function scale(q, n, d=1) { return { n:q.n*BigInt(n), d:q.d*BigInt(d) }; }
  function number(q) { return Number(q.n)/Number(q.d); }
  function compare(q,n,d=1) { const x=q.n*BigInt(d)-BigInt(n)*q.d; return x<0n?-1:x>0n?1:0; }
  function pressure(value,unit) { const q=decimal(value,'o módulo da pressão máxima de operação',true); choice(unit,['kPa','MPa','bar'],'a unidade de pressão'); return unit==='MPa'?scale(q,1000):unit==='bar'?scale(q,100):q; }
  function volume(value,unit) { const q=decimal(value,'o volume / capacidade'); choice(unit,['m3','L'],'a unidade de volume'); return unit==='L'?scale(q,1,1000):q; }
  function dimension(value,unit) { const q=decimal(value,'o diâmetro'); choice(unit,['mm','m'],'a unidade de diâmetro'); return unit==='m'?scale(q,1000):q; }
  function fluid(input) {
    const criterion=choice(input.nrFluid,['flammable','combustible','toxic','hydrogen','acetylene','steam','asphyxiant','air','other','mixture','documented'],'o critério determinante do fluido');
    text(input.nrFluidSource,'a fundamentação da classe do fluido (FDS, composição e condições)');
    if (['flammable','hydrogen','acetylene'].includes(criterion)) return 'A';
    if (criterion==='combustible') {
      const s=String(input.nrFluidTemperature??'').trim().replace(',','.');
      if (!/^-?\d+(?:\.\d+)?$/.test(s) || !Number.isFinite(Number(s)) || Number(s)<=-273.15) throw new InputError('Informe a temperatura do fluido combustível em °C.');
      return Number(s)>=200?'A':'B';
    }
    if (criterion==='toxic') return compare(decimal(input.nrToxicLimit,'o limite de tolerância em ppm',true),20)<=0?'A':'B';
    if (['steam','asphyxiant','air'].includes(criterion)) return 'C';
    if (criterion==='other') return 'D';
    return choice(input.nrFluidClass,['A','B','C','D'],'a classe fundamentada da mistura / do fluido');
  }
  function riskGroup(pv) {
    // Official consolidated PDF prints strict inequalities; do not invent equality assignment.
    if ([[1,1],[5,2],[30,1],[100,1]].some(([n,d])=>compare(pv,n,d)===0)) return null;
    return compare(pv,100)>0?1:compare(pv,30)>0?2:compare(pv,5,2)>0?3:compare(pv,1)>0?4:5;
  }
  function assess(input) {
    const profile=CATALOG.find(p=>p.id===input.nrProfile);
    if (!profile) throw new InputError('Selecione a família do equipamento.');
    text(input.nrSource,'a fonte dos dados e da identificação do equipamento');
    const warnings=['Enquadramento indicativo fundamentado nos dados declarados. Categoria NR-13, classe do fluido e Matriz PI são classificações distintas.'];
    const result={version:VERSION, mode:'nr13', profileId:profile.id, family:profile.family, profile:profile.name,
      status:'review_required', scope:'pending', category:null, group:null, fluidClass:null,
      pvKPaM3:null, pvMPaM3:null, intervals:null, criteria:[], references:[SOURCE],
      premises:[...COMMON,...profile.inputs], codeRoute:profile.code, calculationStatus:profile.capability, warnings};
    const head=profile.family==='vessel' && HEADS.find(h=>h[0]===input.nrHead);
    if(head) result.premises.push(`Tampo ${head[1]}: ${head[2]}`);
    const excluded=(clause,reason)=>{result.status='excluded';result.scope='excluded';result.criteria.push([clause,reason]);warnings.push('13.2.3: a exclusão não dispensa inspeção e manutenção, sob responsabilidade técnica e conforme fabricante/códigos aplicáveis.');return result;};
    if (profile.family==='other') {warnings.push(profile.capability);result.criteria.push(['13.2 / glossário','Tipo exige referência própria; categoria I–V não atribuída.']);return result;}
    if (profile.id==='buried') return excluded('13.2.2(n)','Tanque enterrado.');
    if (profile.id==='structural') return excluded('13.2.2(l)','Tanque estrutural de embarcação ou plataforma.');
    if (profile.family==='tank') {
      const support=choice(input.nrSupport,['ground','legs','saddles','buried','structural','unknown'],'o apoio / instalação do tanque');
      if (['legs','saddles','buried'].includes(support)) return excluded('13.2.2(n)','Tanque enterrado ou sobre pernas, sapatas, pedestais ou selas.');
      if (support==='structural') return excluded('13.2.2(l)','Tanque estrutural de embarcação ou plataforma.');
      if (support==='unknown') {warnings.push('Confirmar instalação e apoio antes de enquadrar.');return result;}
      if (profile.id==='horizontal_tank') {warnings.push('Construção horizontal exige análise da definição do glossário e confirmação de tanque versus vaso.');return result;}
      if (input.nrTankDefinition!=='yes') {warnings.push('Confirmar as características da definição de tanque do glossário antes de enquadrar.');return result;}
    }
    const exception=choice(input.nrExclusion,['none','unknown',...EXCLUSIONS.map(e=>e[0])],'a revisão das exclusões de 13.2.2');
    if (!['none','unknown'].includes(exception)) {
      if (profile.family!=='vessel') throw new InputError('A exclusão de vaso selecionada não se aplica automaticamente a um tanque. Revise o tipo.');
      return excluded(`13.2.2(${exception})`,EXCLUSIONS.find(e=>e[0]===exception)[1]);
    }
    if (exception==='unknown') {warnings.push('Revisão das exclusões pendente; não há categoria atribuída.');return result;}
    const material=choice(input.nrMaterialKind,['metal','prfv','other','unknown'],'a natureza construtiva');
    if (profile.family==='vessel' && material==='prfv') return excluded('13.2.2(j)','Vaso fabricado em PRFV, inclusive sob vácuo.');
    if (material==='unknown') {warnings.push('Confirmar material construtivo.');return result;}
    if (profile.family==='tank' && material!=='metal') {result.scope='not_covered';result.status='not_covered';result.criteria.push(['13.2.1(f)','Não é tanque metálico.']);warnings.push('Avaliar o código específico do material e o dever de inspeção/manutenção.');return result;}
    const diameter=dimension(input.nrDiameter,input.nrDiameterUnit);
    if (profile.family==='vessel' && compare(diameter,150)<0) return excluded('13.2.2(f)','Diâmetro interno inferior a 150 mm, independentemente da classe do fluido.');
    const fluidClass=fluid(input);result.fluidClass=fluidClass;
    warnings.push('A classe pressupõe avaliação de todos os perigos. Para misturas, fundamentar o maior risco considerando toxicidade, inflamabilidade e concentração (13.5.1.1.2).');
    const v=volume(input.nrVolume,input.nrVolumeUnit), p=pressure(input.nrPressure,input.nrPressureUnit);
    result.volumeM3=number(v);result.pressureKPa=number(p);result.diameterMM=number(diameter);
    if (profile.family==='tank') {
      if (compare(p,103)>=0) {warnings.push('Pressão informada não é inferior a 103 kPa: confirmar tipo e código; a definição de tanque do glossário não foi satisfeita.');return result;}
      result.criteria.push(['Glossário','Tanque metálico estático, não enterrado; construção vertical e pressão inferior a 103 kPa declaradas.']);
      const conditions=[['13.2.1(f) — diâmetro externo > 3 m',compare(diameter,3000)>0],['13.2.1(f) — capacidade nominal > 20 m³',compare(v,20)>0],['13.2.1(f) — fluido A ou B',['A','B'].includes(fluidClass)]];
      result.criteria.push(...conditions.map(([label,ok])=>[label,ok?'Atendido':'Não atendido']));
      result.scope=conditions.every(([,ok])=>ok)?'covered':'not_covered';result.status=result.scope;
      warnings.push('Tanques de armazenamento não recebem as categorias I–V da Tabela 1 de vasos de pressão.');
      warnings.push('Respiradouro/respiro: verificar proteção contra sobrepressão e vácuo e manutenção dos dispositivos, conforme 13.7.2 e código aplicável.');
      result.requirements=result.scope==='covered'?[
        '13.7.1.1: programa/plano de inspeção considerando fluido, operação, mecanismos de dano e consequências.',
        '13.7.1.2: folhas de dados, projetos de alteração/reparo, relatórios, registro de segurança e certificados aplicáveis.',
        '13.7.2: identificação e dispositivos contra sobrepressão/vácuo; manutenção e inspeção de dispositivos e corta-chamas quando aplicáveis.',
        '13.7.3: inspeções e programa com intervalos definidos pelo responsável técnico conforme códigos; observar datas e condições de aplicação da inspeção inicial.'
      ]:['Critérios de 13.2.1(f) não satisfeitos pelos dados informados. Avaliar os deveres de inspeção/manutenção e demais normas aplicáveis.'];
      return result;
    }
    const regime=choice(input.nrRegime,['positive','vacuum','both'],'o regime de pressão');
    if (compare(p,0)===0) throw new InputError('Pressão manométrica nula: confirme se o equipamento é tanque atmosférico; não categorizar como vaso por esta entrada.');
    if (regime==='vacuum' && compare(p,5)<=0 && fluidClass!=='A') return excluded('13.2.2(s)','Exclusivamente vácuo de módulo ≤ 5 kPa, sem fluido classe A.');
    const pvK={n:p.n*v.n,d:p.d*v.d}, pv=scale(pvK,1,1000);
    result.pvKPaM3=number(pvK);result.pvMPaM3=number(pv);
    const covered=fluidClass==='A'||compare(pvK,8)>0;
    result.criteria.push([profile.id==='mobile'?'13.2.1(d)':'13.2.1(b)/(c)',fluidClass==='A'?'Fluido classe A; abrangência independe de P·V, ressalvadas exclusões.':`P·V ${covered?'>':'≤'} 8 kPa·m³.`]);
    if (!covered) {result.scope='not_covered';result.status='not_covered';warnings.push('Não atende ao critério de abrangência informado; manter avaliação de inspeção/manutenção conforme 13.2.3.');return result;}
    result.scope='covered';result.group=riskGroup(pv);
    if (result.group===null) {
      warnings.push('P·V coincide exatamente com 1, 2,5, 30 ou 100 MPa·m³. O texto consolidado consultado usa desigualdades estritas e não resolve a igualdade. Confirmar o enquadramento com o PLH e a fonte oficial; categoria não atribuída automaticamente.');
      return result;
    }
    result.status='classified';result.category=CATEGORIES[fluidClass][result.group-1];
    result.intervals={withoutSPIE:{external:INTERVALS[result.category][0],internal:INTERVALS[result.category][1]},withSPIE:{external:INTERVALS[result.category][2],internal:INTERVALS[result.category][3]},basis:'Tabela 2 / 13.5.4.5 — limites gerais de referência em anos, não data de próxima inspeção'};
    result.criteria.push(['13.5.1.1.3 / Tabela 1',`Classe ${fluidClass}; grupo ${result.group}; categoria ${result.category}.`]);
    result.requirements=[
      '13.5.1.2: proteção contra sobrepressão/vácuo, controle de bloqueio inadvertido e indicação de pressão; sistemas intrinsicamente protegidos dependem de parecer do PLH.',
      '13.5.1.3–7: placa, TAG/categoria visíveis, prontuário, registro de segurança, projetos de alteração/reparo, relatórios e certificados dos dispositivos.',
      '13.5.4: inspeções inicial, periódica e extraordinária, observadas condições e exceções específicas.'
    ];
    if (['I','II'].includes(result.category)) result.requirements.push('13.5.3.1–2: manual de operação e capacitação do operador da unidade de processo nas condições previstas pela NR.');
    warnings.push('Os prazos da Tabela 2 são referências gerais. SPIE deve ser certificado. Regimes especiais, temperatura inferior a 0 °C sem deterioração, enchimentos/catalisadores, ausência de código, IBR/INI e condições do ativo exigem análise própria; não foi fixado intervalo de inspeção.');
    if (['jacket','exchanger'].includes(profile.id)) warnings.push('Este resultado se refere somente à câmara/volume informados; não categoriza automaticamente todo o conjunto.');
    return result;
  }
  return { VERSION, SOURCE, CATALOG, COMMON, EXCLUSIONS, HEADS, InputError, assess, fluid };
});
