(function () {
  'use strict';
  const R = IntegrityRisk;
  const $ = id => document.getElementById(id);
  let linkedLife = null;
  const consequences = {
    safety: ['Sem lesão', 'Tratamento médico / primeiros socorros', 'Lesão registrável / afastamento', 'Lesão grave', 'Fatalidade / incapacidade permanente'],
    environment: ['Sem liberação reportável', 'Liberação pequena e contida, sem impacto externo', 'Derramamento localizado < 5 bbl, contido', 'Derramamento 5–50 bbl / impacto na costa', 'Liberação descontrolada > 50 bbl / explosão'],
    business: ['Custo / parada desprezível; sem impacto reputacional', 'Impacto menor de produção / preocupação menor de partes interessadas', 'Parada de trem / repercussão local', 'Parada de unidade / repercussão nacional', 'Parada de instalação / impacto internacional ou regulatório']
  };
  function element(tag, text, className) {
    const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n;
  }
  function num(n, digits = 2) { return n === null || n === undefined ? 'Indeterminado' : n.toLocaleString('pt-BR', { maximumFractionDigits: digits }); }
  function matrix(container, selected) {
    container.replaceChildren();
    const wrap = element('div', undefined, 'table-wrap'), table = element('table', undefined, 'risk-matrix');
    wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Matriz PI: rolagem horizontal');
    container.append(element('p', 'Deslize a matriz na horizontal para consultar todas as classes de probabilidade.', 'mobile-scroll-hint'));
    table.append(element('caption', 'Matriz PI — Pires Integrity • Pontuação = PoF × CoF'));
    const head = element('thead'), headings = element('tr');
    const corner = element('th', 'CoF ↓ / PoF →'); corner.scope = 'col'; headings.append(corner);
    R.PROBABILITIES.forEach(p => { const th = element('th', `${p.value} (${p.letter})`); th.scope = 'col'; th.append(element('small', p.label)); headings.append(th); });
    head.append(headings); table.append(head);
    const body = element('tbody');
    for (let cof = 5; cof >= 1; cof--) {
      const tr = element('tr'), th = element('th', String(cof)); th.scope = 'row'; tr.append(th);
      for (let pof = 1; pof <= 5; pof++) {
        const c = R.cell(pof, cof), active = selected && selected.pof === pof && selected.cof === cof;
        const td = element('td', undefined, `${c.className}${active ? ' risk-selected' : ''}`);
        td.append(element('strong', String(c.score)), element('small', c.label));
        if (active) td.append(element('span', 'Resultado', 'risk-marker'));
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body); wrap.append(table); container.append(wrap);
    container.append(element('p', 'CAT1 = muito alto • CAT2 = alto • CAT3 = moderado • CAT4 = baixo • CAT5 = muito baixo. O destaque representa o impacto governante.', 'small'));
  }
  function refreshPof() {
    const p = R.PROBABILITIES.find(p => String(p.value) === $('pof').value);
    $('pofHelp').textContent = p ? p.description : 'Selecione com base no dano, na progressão e nas evidências; não apenas no prazo de vida remanescente.';
  }
  function clearLinked(message = '') {
    linkedLife = null; $('riskLifeContext').replaceChildren(); $('riskLifeContext').classList.toggle('hidden', !message);
    if (message) $('riskLifeContext').append(element('p', message));
  }
  function init() {
    R.PROBABILITIES.forEach(p => $('pof').append(new Option(`${p.value} (${p.letter}) — ${p.label}`, String(p.value))));
    R.ELEMENTS.forEach(e => consequences[e.key].forEach((text, index) => $(e.field).append(new Option(`${index + 1} — ${text}`, String(index + 1)))));
    $('pof').addEventListener('change', refreshPof);
    $('riskDate').max = new Date().toISOString().slice(0, 10);
    matrix($('riskMatrixPreview'));
  }
  function example() {
    clearLinked();
    return {
      tag: 'EXEMPLO-RISCO-001', service: 'Serviço hipotético — cenário didático', material: 'Aço carbono — hipótese',
      riskPoint: 'Trecho de tubulação — exemplo', anomaly: 'Perda de espessura progressiva — cenário fictício.',
      evidence: 'Exemplo didático, sem relatório de campo associado.', assessor: 'Avaliador de demonstração',
      riskDate: new Date().toISOString().slice(0, 10), pof: '3', cofSafety: '4', cofEnvironment: '2', cofBusiness: '3',
      pofReason: 'Hipótese didática: dano moderado com progressão observada em inspeções sucessivas.',
      safetyReason: 'Hipótese didática: exposição de pessoas com potencial de lesão grave.',
      environmentReason: 'Hipótese didática: pequena liberação contida e sem impacto externo.',
      businessReason: 'Hipótese didática: possível parada de trem de produção e repercussão local.'
    };
  }
  function attachLife(snapshot) {
    $('riskFields').querySelectorAll('input, select, textarea').forEach(el => { el.value = ''; });
    linkedLife = JSON.parse(JSON.stringify(snapshot));
    const d = linkedLife.inputs, r = linkedLife.results;
    ['tag', 'service', 'material'].forEach(id => $(id).value = d[id]);
    $('riskPoint').value = d.point; $('evidence').value = d.measurementSource || '';
    $('riskDate').value = new Date().toISOString().slice(0, 10);
    const card = $('riskLifeContext'); card.replaceChildren(); card.classList.remove('hidden');
    card.append(element('h2', 'Cálculo de ME vinculado'),
      element('p', `${d.tag} • ${d.point} • Medição: ${d.currentDate}`),
      element('p', `Atual: ${num(r.current)} mm • Referência: ${num(r.minimum)} mm • Taxa: ${num(r.adoptedRate, 4)} mm/ano • Prazo até a referência: ${num(r.remainingMonths)} meses.`),
      element('p', `Natureza da referência: ${{required: 'requerida', alert: 'alerta', reference: 'não validada'}[r.minimumKind]}. ${r.hypothesis ? 'O cálculo contém hipóteses.' : ''} A PoF permanece sem seleção.`));
    const ul = element('ul'); r.warnings.forEach(w => ul.append(element('li', w))); card.append(ul);
    refreshPof();
  }
  function inputChanged(id) {
    if (linkedLife && ['tag', 'service', 'material', 'riskPoint'].includes(id)) clearLinked('Vínculo com ME removido porque a identificação foi alterada. Reabra o resultado de vida remanescente para vincular um novo cálculo.');
  }
  function render(r, d) {
    const g = r.governing, review = r.status === 'review_required';
    $('resultTitle').textContent = 'Matriz PI — Pires Integrity';
    const hero = element('div', undefined, `card hero-result ${review ? 'attention' : ''}`);
    hero.append(element('span', 'Matriz PI • Classificação indicativa', 'badge'),
      element('div', review ? 'Análise técnica requerida' : `${g.category} · ${g.label} · ${g.score}`, 'metric'),
      element('p', `${g.label === 'Muito alto' ? 'Prioridade imediata. ' : ''}Impacto governante: ${g.impactLabel}. ${r.probability.value} (${r.probability.letter}) × ${g.cof} = ${g.score}. Resultado da matriz: ${g.category} — ${g.label}.`),
      element('p', review ? 'O enquadramento requer avaliação específica. Classificação efetiva pendente da análise do cliente e de seu responsável técnico.' : 'Subsídio à análise e à decisão do cliente e de seu responsável técnico.'));
    $('resultMetrics').append(hero);
    const metrics = element('div', undefined, 'metrics');
    r.elements.forEach(e => {
      const card = element('div', undefined, 'card risk-impact');
      card.append(element('h2', R.ELEMENTS.find(x => x.key === e.key).label), element('div', String(e.score), 'metric'), element('span', `${e.category} • ${e.label}`, `risk-pill ${e.className}`), element('p', `PoF ${e.pof} × CoF ${e.cof}`));
      metrics.append(card);
    });
    $('resultMetrics').append(metrics);
    $('chartTitle').textContent = 'Matriz PI • 5 × 5'; matrix($('chart'), g);
    $('inspectionNote').textContent = r.issues.some(i => i.id === 'cof5')
      ? 'Recomenda-se avaliação prioritária da consequência catastrófica, com definição de medidas de controle, mitigação e responsáveis pelo cliente. Prazo de mitigação e intervalo de inspeção permanecem sujeitos à análise técnica.'
      : `${g.action} Prazo de mitigação e intervalo de inspeção permanecem pendentes de definição técnica.`;
    const rows = r.elements.map(e => [`${R.ELEMENTS.find(x => x.key === e.key).label}: PoF × CoF`, `${e.pof} × ${e.cof} = ${e.score} • ${e.category} ${e.label}`]);
    rows.push(['Impacto governante', `${R.ELEMENTS.find(e => e.key === g.key).label} • ${g.category} ${g.code}${g.score}`],
      ['Desempate', 'Pessoas → Meio ambiente → Negócios'], ['Perfil', `${r.profile.document} • Configuração Rev. ${r.profile.revision} • ${r.profile.date.split('-').reverse().join('/')}`],
      ['Classificação efetiva / aprovação', 'Pendente de revisão técnica'], ['Prazo de mitigação / intervalo de inspeção', 'Não definidos']);
    if (d.linkedLife) {
      const l = d.linkedLife;
      rows.push(['ME vinculado — TAG / ponto / data', `${l.inputs.tag} / ${l.inputs.point} / ${l.inputs.currentDate}`],
        ['ME — referência mínima e fonte', `${num(l.results.minimum)} mm (${l.results.minimumKind}) • ${l.results.minimumSource}`],
        ['ME — taxa / prazo até a referência', `${num(l.results.adoptedRate, 4)} mm/ano / ${num(l.results.remainingMonths)} meses`]);
      l.results.warnings.forEach(w => r.warnings.push(`ME vinculado: ${w}`));
    }
    return rows;
  }
  window.IntegrityRiskUI = { init, example, refreshPof, attachLife, inputChanged, clearLinked, render,
    context: () => linkedLife ? JSON.parse(JSON.stringify(linkedLife)) : null,
    reset: () => { clearLinked(); refreshPof(); } };
})();
