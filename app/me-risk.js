(function (root, factory) {
  const risk = typeof module === 'object' && module.exports ? require('./risk.js') : root.IntegrityRisk;
  const api = factory(root, risk);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PiresMERisk = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, R) {
  'use strict';
  if (!R || typeof R.assess !== 'function') throw Error('Carregue a Matriz PI antes da avaliação de risco de ME.');

  const FIELDS = Object.freeze([
    ['riskPoint', 'Ponto / componente avaliado', 240, 'text'],
    ['anomaly', 'Anomalia observada', 1000, 'textarea'],
    ['evidence', 'Evidência de inspeção', 1000, 'textarea'],
    ['assessor', 'Avaliador da Matriz PI', 240, 'text'],
    ['riskDate', 'Data da avaliação de risco', 10, 'date'],
    ['pof', 'Probabilidade de falha (PoF)', 1, 'rating'],
    ['cofSafety', 'Consequência para pessoas', 1, 'rating'],
    ['cofEnvironment', 'Consequência para o meio ambiente', 1, 'rating'],
    ['cofBusiness', 'Consequência para negócios', 1, 'rating'],
    ['pofReason', 'Justificativa da probabilidade', 1000, 'textarea'],
    ['safetyReason', 'Justificativa — pessoas', 1000, 'textarea'],
    ['environmentReason', 'Justificativa — meio ambiente', 1000, 'textarea'],
    ['businessReason', 'Justificativa — negócios', 1000, 'textarea']
  ].map(Object.freeze));
  // Same qualitative consequence descriptions used by the standalone Matriz PI UI.
  const CONSEQUENCES = Object.freeze({
    cofSafety: Object.freeze(['Sem lesão', 'Tratamento médico / primeiros socorros', 'Lesão registrável / afastamento', 'Lesão grave', 'Fatalidade / incapacidade permanente']),
    cofEnvironment: Object.freeze(['Sem liberação reportável', 'Liberação pequena e contida, sem impacto externo', 'Derramamento localizado < 5 bbl, contido', 'Derramamento 5–50 bbl / impacto na costa', 'Liberação descontrolada > 50 bbl / explosão']),
    cofBusiness: Object.freeze(['Custo / parada desprezível; sem impacto reputacional', 'Impacto menor de produção / preocupação menor de partes interessadas', 'Parada de trem / repercussão local', 'Parada de unidade / repercussão nacional', 'Parada de instalação / impacto internacional ou regulatório'])
  });
  function text(value, label, maxLength) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > maxLength) throw new R.InputError(`${label}: informe até ${maxLength} caracteres.`);
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
  }
  function rating(value, label) {
    if (value === undefined || value === null || value === '') return '';
    if (!['number', 'string'].includes(typeof value) || !/^[1-5]$/.test(String(value))) throw new R.InputError(`${label}: selecione de 1 a 5.`);
    return String(value);
  }
  function date(value) {
    if (!value) return '';
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > new Date().toISOString().slice(0, 10)) {
      throw new R.InputError('Data da avaliação inválida ou futura.');
    }
    return value;
  }
  function normalize(value) {
    const source = value === undefined || value === null ? {} : value;
    if (typeof source !== 'object' || Array.isArray(source)) throw new R.InputError('Avaliação de risco de ME inválida.');
    if (source.enabled !== undefined && typeof source.enabled !== 'boolean') throw new R.InputError('A seleção da Matriz PI deve ser verdadeira ou falsa.');
    const draft = { enabled: source.enabled === true };
    for (const [key, label, maxLength, kind] of FIELDS) {
      draft[key] = kind === 'rating' ? rating(source[key], label) : text(source[key], label, maxLength);
      if (kind === 'date') draft[key] = date(draft[key]);
    }
    return draft;
  }
  function assess(value, metadata) {
    const draft = normalize(value);
    if (!draft.enabled) return null;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new R.InputError('Identificação do ativo indisponível para a Matriz PI.');
    const input = {
      ...draft, profile: R.PROFILE.id,
      tag: text(metadata.tag, 'TAG', 240),
      service: text(metadata.service, 'Serviço', 1000),
      material: text(metadata.material, 'Material', 1000)
    };
    // The evaluator chooses PoF explicitly. Thickness, life and the ME verdict
    // never set a probability, consequence, approval or mitigation deadline.
    return { input, result: R.assess(input) };
  }
  function create(host, options = {}) {
    if (!host || typeof host.replaceChildren !== 'function') throw Error('Área da Matriz PI indisponível.');
    const document = host.ownerDocument || root.document;
    if (!document || typeof document.createElement !== 'function') throw Error('Documento da avaliação de risco indisponível.');
    const prefix = String(options.prefix || 'me-risk').replace(/[^a-zA-Z0-9_-]/g, '-');
    let state = normalize(options.value);
    const controls = new Map();
    const element = (tag, textValue, className) => {
      const node = document.createElement(tag);
      if (textValue !== undefined) node.textContent = textValue;
      if (className) node.className = className;
      return node;
    };
    const wrapper = element('div', undefined, 'me-risk-assessment');
    wrapper.append(element('h3', 'Recomendações da Matriz PI'));
    const toggleLabel = element('label', undefined, 'check'), toggle = element('input');
    toggle.type = 'checkbox'; toggle.id = `${prefix}-enabled`; toggleLabel.htmlFor = toggle.id;
    toggleLabel.append(toggle, element('span', 'Avaliar com a Matriz PI')); wrapper.append(toggleLabel);
    wrapper.append(element('p', 'Selecione a probabilidade e as consequências com suas justificativas. As recomendações usam a mesma Matriz PI do módulo de integridade. A vida remanescente isoladamente não define a probabilidade de falha.'));
    const panel = element('fieldset', undefined, 'point');
    panel.append(element('legend', `${R.PROFILE.document} — revisão ${R.PROFILE.revision}`));
    const grid = element('div', undefined, 'grid'); panel.append(grid);
    const pofHelp = element('p'); pofHelp.id = `${prefix}-pof-help`; pofHelp.setAttribute('aria-live', 'polite');
    for (const [key, labelText, maxLength, kind] of FIELDS) {
      const label = element('label', labelText);
      const input = element(kind === 'textarea' ? 'textarea' : kind === 'rating' ? 'select' : 'input');
      input.id = `${prefix}-${key}`; label.htmlFor = input.id; input.required = true;
      if (kind === 'rating') {
        const empty = element('option', 'Selecione'); empty.value = ''; input.append(empty);
        const values = key === 'pof' ? R.PROBABILITIES.map(p => `${p.value} (${p.letter}) — ${p.label}`) : CONSEQUENCES[key].map((description, index) => `${index + 1} — ${description}`);
        values.forEach((description, index) => { const option = element('option', description); option.value = String(index + 1); input.append(option); });
      } else if (kind === 'textarea') { input.rows = 3; input.maxLength = maxLength; }
      else { input.type = kind; input.maxLength = maxLength; if (kind === 'date') { input.min = '1900-01-01'; input.max = new Date().toISOString().slice(0, 10); } }
      if (key === 'pof') input.setAttribute('aria-describedby', pofHelp.id);
      const changed = () => {
        state[key] = input.value;
        if (key === 'pof') refreshPof();
        if (typeof options.onChange === 'function') options.onChange();
      };
      input.addEventListener(kind === 'rating' || kind === 'date' ? 'change' : 'input', changed);
      label.append(input); grid.append(label); controls.set(key, input);
    }
    panel.append(pofHelp, element('p', 'Classificação indicativa para análise do cliente e de seu responsável técnico. Prazo de mitigação e intervalo de inspeção dependem dessa análise.')); wrapper.append(panel);
    function refreshPof() {
      const probability = R.PROBABILITIES.find(p => String(p.value) === state.pof);
      pofHelp.textContent = probability ? probability.description : 'A probabilidade permanece sem seleção até a avaliação da condição, do mecanismo de dano e das evidências.';
    }
    function refresh() {
      toggle.checked = state.enabled; panel.hidden = !state.enabled; panel.disabled = !state.enabled;
      for (const [key, control] of controls) control.value = state[key];
      refreshPof();
    }
    toggle.addEventListener('change', () => {
      state.enabled = toggle.checked; refresh();
      if (typeof options.onChange === 'function') options.onChange();
    });
    host.replaceChildren(wrapper); refresh();
    return {
      getValue: () => normalize(state),
      setValue: value => { const next = normalize(value); state = next; refresh(); },
      clear: () => { state = normalize(); refresh(); },
      assess: metadata => assess(state, metadata)
    };
  }
  return { normalize, assess, create, FIELDS, CONSEQUENCES };
});
