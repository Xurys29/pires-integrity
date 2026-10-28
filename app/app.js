'use strict';
const $ = id => document.getElementById(id);
const C = IntegrityCalc;
const R = IntegrityRisk, RiskUI = IntegrityRiskUI;
const N = IntegrityNR13, NRUI = IntegrityNR13UI;
const APP_VERSION = '0.6.0';
const assessmentNote = 'Subsídio técnico para análise e decisão do cliente e de seu responsável técnico. Resultados e recomendações indicativos; sem aprovação técnica, liberação operacional ou definição automática de intervalo de inspeção.';
let mode = null, snapshot = null, report = '';
const sharedDrafts = {}, exampleHints = {};
const CalculatorReport = window.PiresCalculatorReportUI;
const sections = ['auth', 'home', 'calculators', 'calculator', 'results', 'history', 'passwordReset', 'emailVerification', 'accessDenied'];
const sources = {
  life: [
    { title: 'Método PI de projeção linear de espessura: perda / intervalo em dias corridos dividido por 365. Rastreabilidade documental na fonte informada pelo avaliador.' }
  ],
  pmta: [{ title: 'ASME VIII-1:2019, UG-27 e UG-32; aritmética de casco e elipsoidal 2:1 conferida. Verificação normativa integral pendente.' }],
  risk: [{ title: 'Matriz PI — Pires Integrity • Configuração Rev. 01 de 07/10/2026 • Classificação indicativa por probabilidade e consequência de falha.' }]
};
const pmtaFields = [
  ['operationPressure', 'Pressão de operação (bar manométrico)', 8],
  ['designPressure', 'Pressão de projeto (bar manométrico)', 10],
  ['temperature', 'Temperatura de projeto (°C)', 80],
  ['diameter', 'Diâmetro interno (mm)', 1500],
  ['length', 'Comprimento cilíndrico (mm)', 3500],
  ['shell', 'Espessura nominal do casco (mm)', 12.7],
  ['headThickness', 'Espessura nominal do tampo (mm)', 12.7],
  ['corrosionAllowance', 'Sobreespessura de corrosão (mm)', 3],
  ['efficiency', 'Eficiência de junta informada (E)', 0.85],
  ['stress', 'Tensão admissível na temperatura (MPa)', 138]
];
pmtaFields.forEach(([id, label]) => {
  const div = document.createElement('div'), l = document.createElement('label'), input = document.createElement('input');
  l.htmlFor = id; l.textContent = label; input.id = id; input.name = id; input.inputMode = 'decimal'; input.required = true;
  div.append(l, input); $('pmtaInputs').append(div);
});
function show(id) { sections.forEach(s => $(s).classList.toggle('hidden', s !== id)); window.scrollTo(0, 0); }
function message(title, text) { $('dialogTitle').textContent = title; $('dialogText').textContent = text; $('dialog').showModal(); }
function f(value, digits = 2) {
  if (value === null || value === undefined) return 'Indeterminado';
  if (value !== 0 && Math.abs(value) < 10 ** -digits) return value.toLocaleString('pt-BR', { maximumSignificantDigits: 4 });
  return value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function day(value) { return value.split('-').reverse().join('/'); }
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
$('closeDialog').onclick = () => $('dialog').close();
function clearWorkspace() {
  CalculatorReport.clear();
  document.querySelectorAll('form').forEach(form => form.reset());
  ['summary', 'checks', 'resultMetrics', 'chart', 'calculationRows'].forEach(id => $(id).replaceChildren());
  ['exampleHint', 'sourceNote', 'resultContext', 'downloadStatus', 'calcError', 'saveStatus', 'inspectionNote'].forEach(id => $(id).textContent = '');
  Object.keys(sharedDrafts).forEach(key => delete sharedDrafts[key]); Object.keys(exampleHints).forEach(key => delete exampleHints[key]);
  snapshot = null; report = ''; mode = null; syncControls(); NRUI.sync(false); RiskUI.reset();
}
document.querySelectorAll('.back').forEach(b => b.onclick = () => show('calculators'));
$('openCalculators').onclick = async () => { if (await PiresAccount.guard()) show('calculators'); };
$('backModules').onclick = () => show('home');
// The management pilot is served and bundled only in the local demonstration.
// Connected publication packages do not contain its data or files.
if (window.PIRES_CONFIG?.mode === 'demo') {
  $('assetsModule').classList.remove('module-planned');
  $('assetsModuleBadge').textContent = 'Piloto local';
  $('managementPlanned').classList.add('hidden');
  $('openManagement').classList.remove('hidden');
  $('assetsModuleNote').textContent = 'Dados demonstrativos salvos neste navegador. Sem envio ou compartilhamento.';
  $('openDiv3').classList.remove('hidden');
  $('openVesselMemorial').classList.remove('hidden');
}
function syncControls() {
  const initial = $('useInitial').checked;
  $('initialFields').disabled = !initial; $('initialFields').classList.toggle('hidden', !initial);
  const justify = $('ratePolicy').value !== 'max';
  $('justificationField').classList.toggle('hidden', !justify); $('justification').disabled = !justify; $('justification').required = justify;
  syncCodeRoute();
}
function syncCodeRoute() {
  const profile = $('pmtaCodeProfile').value;
  $('pmtaCodeStatus').textContent = profile === 'asme-viii-1'
    ? 'Motor parcial da Divisão 1. Edições conferidas: 2019 e 2023; informe a origem documental em Fonte de S, E e premissas.'
    : profile === 'asme-viii-3'
      ? 'Divisão 3: use o diagnóstico separado de KD-221.1:2025. As fórmulas UG da Divisão 1 ficam bloqueadas.'
      : 'Código sem motor estrutural validado nesta calculadora. Registre a base no book do ativo; cálculo automático pendente.';
  $('pmtaDiv3Link').classList.toggle('hidden', profile !== 'asme-viii-3' || window.PIRES_CONFIG?.mode !== 'demo');
}
$('pmtaCodeProfile').addEventListener('change', syncCodeRoute);
['useInitial', 'ratePolicy'].forEach(id => $(id).addEventListener('change', syncControls));
function invalidateResult(e) { $('calcError').textContent = ''; snapshot = null; report = ''; CalculatorReport.invalidate(); if (mode === 'risk') RiskUI.inputChanged(e.target.id); }
$('calcForm').addEventListener('input', invalidateResult);
$('calcForm').addEventListener('change', invalidateResult);
function open(kind) {
  CalculatorReport.clear();
  if (mode) sharedDrafts[mode] = ['tag', 'service', 'material'].map(id => $(id).value);
  mode = kind;
  ['tag', 'service', 'material'].forEach((id, i) => $(id).value = sharedDrafts[kind]?.[i] || '');
  ['life', 'pmta', 'risk'].forEach(k => { $(k + 'Fields').disabled = k !== kind; $(k + 'Fields').classList.toggle('hidden', k !== kind); });
  $('calcTitle').textContent = {life: 'Vida remanescente • ME', pmta: 'Equipamentos • NR-13 e PMTA', risk: 'Matriz PI — Pires Integrity'}[kind];
  $('calcIntro').textContent = {life: 'Calcule a taxa de corrosão e o prazo até a espessura de referência de um ponto de medição.', pmta: 'Identifique a família, confira a abrangência e a categoria NR-13 ou calcule pressões parciais dos componentes disponíveis.', risk: 'Fundamente a probabilidade e as consequências de falha para obter a classificação indicativa e recomendações técnicas.'}[kind];
  $('loadExample').textContent = {life: 'Carregar exemplo do relatório 2025', pmta: 'Carregar exemplo da planilha', risk: 'Carregar cenário didático'}[kind];
  $('calculate').textContent = kind === 'risk' ? 'Gerar classificação indicativa' : 'Calcular avaliação';
  $('exampleHint').textContent = exampleHints[kind] || ''; $('calcError').textContent = ''; snapshot = null; report = ''; syncControls(); NRUI.sync(kind === 'pmta'); show('calculator');
}
$('openLife').onclick = () => open('life'); $('openPmta').onclick = () => open('pmta'); $('edit').onclick = () => { $('calcError').textContent = ''; show('calculator'); };
$('openRisk').onclick = () => open('risk');
$('linkRisk').onclick = () => {
  if (!snapshot || snapshot.type !== 'life') return;
  const context = snapshot; open('risk'); RiskUI.attachLife(context);
  exampleHints.risk = ''; $('exampleHint').textContent = '';
};
RiskUI.init();
NRUI.init();
const today = new Date().toISOString().slice(0, 10);
['currentDate', 'previousDate', 'initialDate'].forEach(id => $(id).max = today);
$('loadExample').onclick = () => {
  CalculatorReport.clear();
  const values = mode === 'pmta' && NRUI.selected() ? NRUI.example() : mode === 'risk' ? RiskUI.example() : mode === 'life' ? {
    tag: 'EXEMPLO-ME-2025', service: 'Serviço não confirmado — exemplo numérico', material: 'Material não confirmado — exemplo numérico',
    point: 'Exemplo do quadro VIDA RESIDUAL', current: '3,6', previous: '5,8', minimum: '2',
    previousDate: '2016-01-06', currentDate: '2025-01-01', previousOrigin: 'nominal', minimumKind: 'reference',
    minimumSource: 'Modelo 2025, Relatório Fotográfico1!W26 — origem normativa não demonstrada',
    measurementSource: 'ANNEX 01 — Modelo 2025, Relatório Fotográfico1!W22:W25',
    mechanism: 'uniform', ratePolicy: 'max', assumptions: 'Exemplo: perda uniforme e serviço constante assumidos para demonstrar a fórmula; não confirmados pelo arquivo.'
  } : {
    ...Object.fromEntries(pmtaFields.map(([id, , value]) => [id, String(value)])),
    tag: 'V-001-EXEMPLO', service: 'Ar comprimido', material: 'SA-516 Gr.70 — exemplo', head: 'elliptical',
    pmtaCodeProfile: 'asme-viii-1', pmtaCodeEdition: '2023',
    pmtaSource: 'Imagens fornecidas: S = 138 MPa e E = 0,85; valores de exemplo, validação documental pendente.'
  };
  Object.entries(values).forEach(([id, value]) => $(id).value = value);
  if (mode === 'life') { $('useInitial').checked = false; $('comparable').checked = true; }
  exampleHints[mode] = {life: 'Dados numéricos do modelo 2025. TAG, serviço, material e mecanismo são identificados como exemplo / hipótese.', pmta: NRUI.selected() ? 'Cenário didático: ar comprimido, 8 bar e 7,068583471 m³; classe C, grupo 3, categoria III. Revisão de exclusões assumida para o exemplo.' : 'Dados do exemplo enviado na conversa. Resultado parcial, sem aprovação do vaso.', risk: 'Cenário inteiramente fictício: PoF 3; CoF pessoas 4, ambiente 2 e negócios 3. Classificação indicativa esperada: CAT2, 12 pontos.'}[mode];
  if (mode === 'risk') RiskUI.refreshPof();
  $('exampleHint').textContent = exampleHints[mode]; $('calcError').textContent = ''; snapshot = null; report = ''; syncControls(); NRUI.sync(mode === 'pmta');
};
function data() {
  const d = Object.fromEntries(new FormData($('calcForm')));
  if (mode === 'life') { d.comparable = $('comparable').checked; d.useInitial = $('useInitial').checked; d.asOf = new Date().toISOString().slice(0, 10); }
  if (mode === 'risk') { d.profile = R.PROFILE.id; d.linkedLife = RiskUI.context(); }
  if (mode === 'pmta' && !NRUI.selected()) {
    d.constructionCode = { profileId: d.pmtaCodeProfile, edition: d.pmtaCodeEdition, source: d.pmtaSource };
    delete d.pmtaCodeProfile; delete d.pmtaCodeEdition;
  }
  return d;
}
function prettyEntries() {
  return [...$('calcForm').querySelectorAll('input, select, textarea')].filter(el => el.name && !el.matches(':disabled')).map(el => {
    const value = el.type === 'checkbox' ? (el.checked ? 'Sim' : 'Não') : el.tagName === 'SELECT' ? el.selectedOptions[0].textContent : el.type === 'date' && el.value ? day(el.value) : el.value;
    return [el.labels[0]?.textContent.trim() || el.name, value];
  });
}
function metric(label, value, detail, hero = false, state = '') {
  const card = node('div', undefined, `card ${hero ? 'hero-result' : ''} ${state}`);
  card.append(node(hero ? 'span' : 'h2', label, hero ? 'badge' : ''), node('div', value, 'metric'));
  if (detail) card.append(node('p', detail)); return card;
}
function drawProjection(r, d) {
  $('chart').replaceChildren(); $('chartTitle').textContent = 'Projeção de espessura';
  if (r.remainingYears === null || r.remainingYears <= 0) { $('chart').append(node('p', 'Projeção indisponível para esta condição. Consulte a interpretação ao lado.')); return; }
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 360 240'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Projeção linear: ${f(r.current)} mm na medição atual até ${f(r.minimum)} mm em ${f(r.remainingYears)} anos.`);
  function shape(tag, attrs, text) { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v))); if (text) el.textContent = text; svg.append(el); }
  const left = 56, right = 328, top = 32, bottom = 180, span = r.current - r.minimum;
  const y = value => bottom - (value - (r.minimum - span * .18)) / (span * 1.36) * (bottom - top);
  const yCurrent = y(r.current), yMin = y(r.minimum);
  shape('line', { x1: left, x2: left, y1: top, y2: bottom, stroke: '#aebfc5' });
  shape('line', { x1: left, x2: right, y1: bottom, y2: bottom, stroke: '#aebfc5' });
  shape('line', { x1: left, x2: right, y1: yMin, y2: yMin, stroke: '#a74236', 'stroke-dasharray': '4 4' });
  shape('line', { x1: left, x2: right, y1: yCurrent, y2: yMin, stroke: '#194963', 'stroke-width': 3, 'stroke-dasharray': '8 4' });
  shape('circle', { cx: left, cy: yCurrent, r: 5, fill: '#194963' });
  shape('circle', { cx: right, cy: yMin, r: 5, fill: '#a74236' });
  const textStyle = { fill: '#143c55', 'font-family': 'system-ui', 'font-size': 15 };
  shape('text', { ...textStyle, x: left - 8, y: yCurrent + 4, 'text-anchor': 'end' }, f(r.current));
  shape('text', { ...textStyle, x: left - 8, y: yMin + 4, 'text-anchor': 'end' }, f(r.minimum));
  shape('text', { ...textStyle, x: 12, y: 20 }, 'mm');
  [0, .5, 1].forEach(v => shape('text', { ...textStyle, x: left + v * (right - left), y: 206, 'text-anchor': v === 1 ? 'end' : 'middle' }, f(v * r.remainingYears)));
  shape('text', { ...textStyle, x: 180, y: 233, 'text-anchor': 'middle' }, 'Anos desde a medição atual');
  $('chart').append(svg, node('p', `Medição de ${day(d.currentDate)} • Linha azul: projeção linear. Linha vermelha: referência mínima. Condições e taxa mantidas constantes.`, 'chart-legend'));
}
function renderLife(r, d) {
  const title = r.minimumKind === 'required' ? 'Vida remanescente estimada' : r.minimumKind === 'alert' ? 'Prazo até a espessura de alerta' : 'Prazo até a referência — hipótese';
  const statusText = {
    estimated: 'Estimativa linear', hypothesis: 'Estimativa com hipóteses', at_or_below_minimum: 'No limite ou abaixo da referência',
    inconsistent_history: 'Histórico requer conferência', mechanism_review: 'Mecanismo requer avaliação', no_positive_rate: 'Sem taxa positiva para projetar'
  }[r.status];
  $('resultTitle').textContent = 'Vida remanescente • Resultado';
  $('resultMetrics').append(metric(title, r.remainingYears === null ? 'Indeterminada' : `${f(r.remainingYears)} anos`, `${statusText}. ${r.model}`, true, r.status === 'at_or_below_minimum' ? 'critical' : r.status !== 'estimated' ? 'attention' : ''));
  const grid = node('div', undefined, 'metrics');
  grid.append(metric('Taxa adotada', `${f(r.adoptedRate, 4)} mm/ano`, r.remainingYears === null ? 'Valor aritmético; projeção suspensa.' : r.adoptedBasis === 'short' ? 'Histórico anterior → atual' : 'Histórico inicial → atual'),
    metric('Margem de espessura', `${f(r.margin, 3)} mm`, 'Atual − referência mínima'),
    metric('Prazo em meses', r.remainingMonths === null ? 'Indeterminado' : `${f(r.remainingMonths)} meses`, 'Meses equivalentes = anos × 12'));
  $('resultMetrics').append(grid); drawProjection(r, d);
  $('inspectionNote').textContent = 'Conferir localização dos pontos, calibração, incerteza e condições de superfície das medições de espessura. Confirmar o mecanismo de dano e a origem da espessura requerida com o responsável técnico antes de definir a técnica de END, o intervalo de inspeção ou uma recomendação de operação.';
  const rows = [
    ['Intervalo do histórico anterior (dias / 365)', `${f(r.interval.days, 0)} dias = ${f(r.interval.years, 6)} anos`],
    ['Perda no histórico anterior: e_anterior − e_atual', `${f(r.loss, 3)} mm`],
    ['Perda relativa à espessura anterior', `${f(r.lossPercent, 3)} %`],
    ['Taxa anterior → atual: (e_anterior − e_atual) / Δt', `${f(r.shortRate, 6)} mm/ano`]
  ];
  if (r.longInterval) rows.push(['Intervalo inicial → atual (dias / 365)', `${f(r.longInterval.days, 0)} dias = ${f(r.longInterval.years, 6)} anos`], ['Taxa inicial → atual: (e_inicial − e_atual) / Δt', `${f(r.longRate, 6)} mm/ano`]);
  rows.push(['Critério de seleção da taxa', { max: 'Maior taxa disponível — estimativa preliminar', short: 'Histórico anterior selecionado com justificativa', long: 'Histórico inicial selecionado com justificativa' }[r.policy]],
    ['Margem: e_atual − e_mínima', `${f(r.margin, 3)} mm`],
    ['Prazo: margem / taxa positiva adotada', r.remainingYears === null ? 'Indeterminado — consulte as verificações' : `${f(r.remainingYears, 6)} anos = ${f(r.remainingMonths, 6)} meses`]);
  return rows;
}
function renderPmta(r) {
  $('resultTitle').textContent = 'PMTA • Pré-cálculo dos componentes';
  $('resultMetrics').append(metric('Menor pressão calculada entre casco e tampo', `${f(r.componentPressure)} bar`, 'PMTA completa do vaso: pendente. Pressão manométrica, apenas para as premissas informadas.', true, 'attention'));
  const grid = node('div', undefined, 'metrics');
  grid.append(metric('Casco', `${f(r.shellPressure)} bar`, 'Menor resultado entre as duas equações'), metric('Tampo elipsoidal', `${f(r.headPressure)} bar`, 'Geometria 2:1'), metric('Volume geométrico', `${f(r.volume, 3)} m³`, 'Cilindro + dois tampos iguais'));
  $('resultMetrics').append(grid); $('chartTitle').textContent = 'Conferência de espessuras'; $('chart').replaceChildren();
  $('chart').append(node('p', `Casco: ${r.shellMeets ? 'atende' : 'não atende'} à espessura calculada de ${f(r.shellRequired, 3)} mm.`), node('p', `Tampo: ${r.headMeets ? 'atende' : 'não atende'} à espessura calculada de ${f(r.headRequired, 3)} mm.`), node('p', 'Comparação aritmética parcial. Não representa aprovação do projeto ou do equipamento.', 'small'));
  $('inspectionNote').textContent = 'Completar a avaliação dos componentes, das juntas e dos demais carregamentos, com documentação do código e edição aplicáveis. Para categorizar, use Enquadrar este vaso na NR-13 e complete fluido e exclusões. A pressão de teste e a liberação operacional permanecem fora deste pré-cálculo.';
  return [
    ['Pressão de projeto: bar / 10', `${f(r.pressure, 3)} MPa`],
    ['Casco — circunferencial: t = P·R / (S·E − 0,6·P)', `${f(r.circumferential, 3)} mm`],
    ['Casco — longitudinal: t = P·R / (2·S·E + 0,4·P)', `${f(r.longitudinal, 3)} mm`],
    ['Casco — espessura requerida: maior t + CA', `${f(r.shellRequired, 3)} mm`],
    ['Casco — espessura efetiva: nominal − CA', `${f(r.effectiveShell, 3)} mm`],
    ['Casco — P circunferencial = 10·S·E·t / (R + 0,6·t) [bar]', `${f(r.shellCircPressure, 3)} bar`],
    ['Casco — P longitudinal = 10·2·S·E·t / (R − 0,4·t) [bar]', `${f(r.shellLongPressure, 3)} bar`],
    ['Tampo — t = P·D / (2·S·E − 0,2·P)', `${f(r.headNet, 3)} mm`],
    ['Tampo — espessura requerida: t + CA', `${f(r.headRequired, 3)} mm`],
    ['Tampo — espessura efetiva: nominal − CA', `${f(r.effectiveHead, 3)} mm`],
    ['Tampo — P = 10·2·S·E·t / (D + 0,2·t) [bar]', `${f(r.headPressure, 3)} bar`],
    ['Menor pressão dos componentes − pressão de projeto', `${f(r.pressureMargin, 3)} bar`],
    ['Volume: π·D²·L / 4 + 2·π·D³ / 24 (D e L em metros)', `${f(r.volume, 6)} m³`],
    ['Demais verificações / PMTA completa do vaso', 'Pendentes']
  ];
}
$('calcForm').onsubmit = async e => {
  e.preventDefault();
  if (!await PiresAccount.guard()) return;
  $('calcError').textContent = '';
  try {
    const d = data();
    const isNR = mode === 'pmta' && NRUI.selected();
    if (mode === 'pmta' && !isNR) {
      const temp = Number(String(d.temperature).replace(',', '.'));
      if (!Number.isFinite(temp) || temp <= -273.15) throw new C.InputError('Temperatura de projeto inválida.');
    }
    const r = isNR ? N.assess(d) : mode === 'life' ? C.life(d) : mode === 'risk' ? R.assess(d) : C.pmta(d);
    const currentSources = isNR ? [N.SOURCE] : mode === 'pmta'
      ? [{ title: `${r.constructionCode.name}:${r.constructionCode.edition}; UG-27(c)(1)/(2), UG-32(c). Fonte: ${r.constructionCode.source}. Demais verificações pendentes.` }]
      : sources[mode];
    const entries = prettyEntries();
    $('resultMetrics').replaceChildren(); $('checks').replaceChildren(); $('summary').replaceChildren(); $('calculationRows').replaceChildren(); $('sourceNote').replaceChildren();
    $('resultContext').textContent = `${d.tag} • ${mode === 'life' ? d.point : mode === 'risk' ? d.riskPoint : d.service}`;
    $('linkRisk').classList.toggle('hidden', mode !== 'life');
    $('linkNR13').classList.toggle('hidden', mode !== 'pmta' || isNR);
    $('resultDetailGrid').classList.toggle('risk-detail', mode === 'risk');
    const rows = isNR ? NRUI.render(r) : mode === 'life' ? renderLife(r, d) : mode === 'risk' ? RiskUI.render(r, d) : renderPmta(r);
    r.warnings.forEach(w => $('checks').append(node('li', w)));
    if (mode === 'life') $('checks').append(node('li', `Referência mínima: ${d.minimumSource}`));
    rows.forEach(([label, value]) => { const tr = node('tr'); tr.append(node('td', label), node('td', value)); $('calculationRows').append(tr); });
    entries.forEach(([label, value]) => $('summary').append(node('dt', label), node('dd', value || 'Não informado')));
    $('sourceNote').append(node('strong', 'Referências do método: '));
    currentSources.forEach(s => { const link = node(s.url ? 'a' : 'span', s.title); if (s.url) { link.href = s.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; } $('sourceNote').append(node('br'), link); });
    snapshot = { version: APP_VERSION, engineVersion: isNR ? N.VERSION : mode === 'risk' ? R.PROFILE.rulesVersion : C.VERSION, createdAt: new Date().toISOString(), type: mode, inputs: d, results: r, sources: currentSources, note: assessmentNote, recommendations: $('inspectionNote').textContent };
    report = ['PIRES INTEGRIDADE — MEMÓRIA DE AVALIAÇÃO INDICATIVA', `Versão ${APP_VERSION} | ${snapshot.createdAt}`, $('resultTitle').textContent, snapshot.note,
      '\nENTRADAS', ...entries.map(([k, v]) => `${k}: ${v}`), '\nRESULTADOS', ...rows.map(([k, v]) => `${k}: ${v}`), '\nINTERPRETAÇÃO', ...r.warnings,
      '\nRECOMENDAÇÕES TÉCNICAS PARA ANÁLISE DO CLIENTE', snapshot.recommendations, '\nREFERÊNCIAS', ...currentSources.map(s => s.title + (s.url ? ` — ${s.url}` : ''))].join('\n');
    CalculatorReport.setResult(snapshot);
    $('downloadStatus').textContent = ''; PiresAccount.resultReady(); show('results');
  } catch (err) { snapshot = null; report = ''; CalculatorReport.invalidate(); $('calcError').textContent = err instanceof C.InputError || err instanceof R.InputError || err instanceof N.InputError ? err.message : 'Não foi possível calcular. Revise os dados de entrada.'; }
};
$('linkNR13').onclick = () => {
  if (!snapshot || snapshot.results.mode !== 'pmta') return;
  const previous = snapshot;
  $('pmtaTask').value='nr13';
  const values={nrProfile:'cylindrical',nrHead:'elliptical',nrRegime:'positive',nrPressure:previous.inputs.operationPressure,nrPressureUnit:'bar',nrVolume:String(previous.results.volume),nrVolumeUnit:'m3',nrDiameter:previous.inputs.diameter,nrDiameterUnit:'mm',nrFluid:'',nrFluidSource:'',nrExclusion:'unknown',nrMaterialKind:'unknown',nrSource:`Volume geométrico do pré-cálculo ${previous.createdAt}; confirmar volume interno e dimensões documentados. ${previous.inputs.pmtaSource}`};
  // The engine accepts 12 decimal places; preserve the geometric estimate explicitly.
  values.nrVolume=previous.results.volume.toFixed(12);
  Object.entries(values).forEach(([id,value])=>$(id).value=value);
  open('pmta');$('exampleHint').textContent='Pressão de operação, diâmetro e volume geométrico transferidos. Confirme material, classe do fluido, volume documentado e exclusões.';
};
function download(text, name, type) {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('downloadStatus').textContent = 'Download solicitado ao navegador.';
}
$('saveDraft').onclick = () => download(JSON.stringify({ version: APP_VERSION, type: mode, profile: mode === 'risk' ? R.PROFILE : undefined, inputs: data(), status: 'draft', note: assessmentNote }, null, 2), 'avaliacao-dados.json', 'application/json');
$('download').onclick = () => { if (report) download(report, 'memoria-calculo.txt', 'text/plain;charset=utf-8'); };
$('downloadJson').onclick = () => { if (snapshot) { try { const exported = ['pmta', 'life', 'nr13'].includes(snapshot.results.mode) ? { ...snapshot, reportMetadata: CalculatorReport.metadata() } : snapshot; download(JSON.stringify(exported, null, 2), 'calculo-integridade.json', 'application/json'); } catch (error) { $('downloadStatus').textContent = error.message; } } };

function loadAssessment(record, storageId) {
  if (record.inputs?.meBatch && storageId) { window.location.href = `me.html?assessment=${encodeURIComponent(storageId)}`; return; }
  if (!record || !['life', 'pmta', 'risk'].includes(record.type) || !record.inputs) throw new PiresCloud.CloudError('Registro incompatível com esta versão. Consulte a memória salva.');
  $('calcForm').reset(); RiskUI.reset(); open(record.type);
  CalculatorReport.restore(record.reportMetadata);
  if (record.type === 'pmta' && !record.inputs.pmtaTask) $('pmtaTask').value='pressure';
  if (record.type === 'risk' && record.inputs.linkedLife) RiskUI.attachLife(record.inputs.linkedLife);
  [...$('calcForm').elements].forEach(control => {
    if (!control.name || !Object.hasOwn(record.inputs, control.name)) return;
    const value = record.inputs[control.name];
    if (control.type === 'checkbox') control.checked = value === true;
    else if (typeof value === 'string' || typeof value === 'number') control.value = String(value);
  });
  if (record.type === 'pmta' && record.results?.mode === 'pmta') {
    const code = record.inputs.constructionCode;
    $('pmtaCodeProfile').value = code?.profileId || 'asme-viii-1';
    $('pmtaCodeEdition').value = code?.edition || '2019';
    if (code?.source) $('pmtaSource').value = code.source;
  }
  syncControls(); NRUI.sync(record.type === 'pmta'); if (record.type === 'risk') RiskUI.refreshPof();
  $('exampleHint').textContent = 'Dados recuperados do histórico. Confira as premissas e calcule novamente para obter uma avaliação na versão atual.';
}
void PiresAccount.init({ show, message, clear: clearWorkspace, result: () => ({ snapshot, report }), load: loadAssessment, download });
