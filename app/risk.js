(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IntegrityRisk = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PROFILE = Object.freeze({
    id: 'pi-risk-matrix-v1', name: 'PI', revision: '01', date: '2026-10-07',
    document: 'Matriz PI — Pires Integrity', rulesVersion: '0.1.0',
    basis: 'Matriz qualitativa 5 × 5; classificação indicativa e recomendações técnicas para análise do cliente.'
  });
  const PROBABILITIES = Object.freeze([
    { value: 1, letter: 'E', label: 'Muito improvável', description: 'Dano superficial ou estável; considerar evidências de ausência de progressão.' },
    { value: 2, letter: 'D', label: 'Improvável', description: 'Dano menor a moderado, estável ou com progressão lenta e controlada.' },
    { value: 3, letter: 'C', label: 'Possível', description: 'Dano moderado com progressão; falha plausível antes do próximo ciclo de inspeção.' },
    { value: 4, letter: 'B', label: 'Provável', description: 'Dano severo ou deterioração acelerada. A condição e a tendência exigem avaliação de engenharia.' },
    { value: 5, letter: 'A', label: 'Muito provável', description: 'Falha iminente ou já presente, vazamento ativo, defeito passante ou dano crítico. A redação sobre vazamento também aparece no nível 4 e requer revisão técnica.' }
  ].map(Object.freeze));
  const LEVELS = Object.freeze({
    1: Object.freeze({ category: 'CAT1', label: 'Muito alto', className: 'risk-very-high', action: 'Ação imediata de mitigação; avaliar isolamento, parada ou reparo emergencial com a equipe responsável.' }),
    2: Object.freeze({ category: 'CAT2', label: 'Alto', className: 'risk-high', action: 'Mitigação urgente; definir medidas de redução de risco e o prazo com a equipe responsável.' }),
    3: Object.freeze({ category: 'CAT3', label: 'Moderado', className: 'risk-moderate', action: 'Planejar tratamento ou análise adicional e definir acompanhamento da anomalia.' }),
    4: Object.freeze({ category: 'CAT4', label: 'Baixo', className: 'risk-low', action: 'Avaliar monitoramento e tratamento no plano de manutenção e inspeção.' }),
    5: Object.freeze({ category: 'CAT5', label: 'Muito baixo', className: 'risk-very-low', action: 'Manter acompanhamento e revisar a avaliação quando houver mudança de condição.' })
  });
  const ELEMENTS = Object.freeze([
    Object.freeze({ key: 'safety', field: 'cofSafety', reason: 'safetyReason', label: 'Pessoas', code: 'RAS' }),
    Object.freeze({ key: 'environment', field: 'cofEnvironment', reason: 'environmentReason', label: 'Meio ambiente', code: 'RAE' }),
    Object.freeze({ key: 'business', field: 'cofBusiness', reason: 'businessReason', label: 'Negócios', code: 'RAB' })
  ]);
  class InputError extends Error {}
  function rating(value, label) {
    if (!['number', 'string'].includes(typeof value) || !/^[1-5]$/.test(String(value))) throw new InputError(`Selecione ${label}, de 1 a 5.`);
    return Number(value);
  }
  function required(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new InputError(`Informe ${label}.`);
    return value.trim();
  }
  function cell(pof, cof) {
    const probability = rating(pof, 'a probabilidade'), consequence = rating(cof, 'a consequência');
    const score = probability * consequence;
    // Classification verified against the private technical reference fixture.
    // Score 5 remains indicative and requires review; see the internal methodology.
    const level = score >= 20 ? 1 : score >= 10 ? 2 : score >= 5 ? 3 : score >= 3 ? 4 : 5;
    return { pof: probability, cof: consequence, score, ...LEVELS[level] };
  }
  function assess(input) {
    if (input.profile && input.profile !== PROFILE.id) throw new InputError('O perfil disponível é a Matriz PI.');
    const pof = rating(input.pof, 'a probabilidade de falha');
    ['tag', 'service', 'material', 'riskPoint', 'anomaly', 'evidence', 'assessor', 'pofReason'].forEach(key => required(input[key], {
      tag: 'a TAG', service: 'o serviço', material: 'o material', riskPoint: 'o ponto / componente', anomaly: 'a descrição da anomalia',
      evidence: 'a evidência de inspeção', assessor: 'o nome do avaliador', pofReason: 'a justificativa da probabilidade'
    }[key]));
    const date = required(input.riskDate, 'a data da avaliação');
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date || date < '1900-01-01' || date > new Date().toISOString().slice(0, 10)) throw new InputError('Data da avaliação inválida ou futura.');
    const elements = ELEMENTS.map(element => ({
      ...element, impactLabel: element.label, ...cell(pof, rating(input[element.field], `a consequência para ${element.label.toLowerCase()}`)),
      justification: required(input[element.reason], `a justificativa para ${element.label.toLowerCase()}`)
    }));
    // Tie priority: Safety > Environment > Business.
    const governing = elements.reduce((best, current) => current.score > best.score ? current : best);
    const issues = [];
    if (elements.some(element => element.score === 5)) issues.push({ id: 'score5', text: 'Pontuação 5: enquadramento indicativo como risco moderado (CAT3), sujeito à análise e validação técnica do cliente.' });
    if (elements.some(element => element.cof === 5)) issues.push({ id: 'cof5', text: 'Consequência catastrófica (CoF 5): recomenda-se análise técnica prioritária para confirmar o enquadramento e as medidas de mitigação. O resultado aritmético não encerra a avaliação.' });
    const warnings = [
      ...issues.map(issue => issue.text),
      'PoF selecionada pelo avaliador com base na condição, no mecanismo de dano e na progressão observada. A vida remanescente isoladamente não determina a probabilidade de falha.',
      'Prazo de mitigação e intervalo de inspeção sujeitos à análise técnica do cliente, considerando as condições operacionais e as evidências de inspeção.',
      'Resultado indicativo da Matriz PI; não constitui liberação para operação, categoria NR-13, prazo de inspeção ou avaliação aprovada.'
    ];
    if (['CAT1', 'CAT2'].includes(governing.category) || issues.some(issue => issue.id === 'cof5')) warnings.push('Recomenda-se análise prioritária pela equipe de integridade e pela gestão operacional do cliente para definição das medidas de controle e mitigação.');
    return {
      mode: 'risk', profile: { ...PROFILE }, status: issues.length ? 'review_required' : 'preliminary',
      probability: { ...PROBABILITIES[pof - 1] }, elements, governing, issues, warnings,
      effectiveCategory: null, approved: false, mitigationDueDate: null, inspectionInterval: null,
      classificationBasis: 'Consulta à Matriz PI; categoria indicativa, sujeita à análise técnica do cliente.',
      tiePriority: ['safety', 'environment', 'business']
    };
  }
  return { PROFILE, PROBABILITIES, ELEMENTS, LEVELS, InputError, cell, assess };
});
