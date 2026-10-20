(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PiresConstructionCode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PROFILES = Object.freeze([
    { id: 'unknown', name: 'Código de construção ainda não confirmado', division: '', family: 'any', capability: 'documentary' },
    { id: 'asme-viii-1', name: 'ASME BPVC Section VIII, Division 1', division: '1', family: 'vessel', capability: 'partial-div1', clauses: ['UG-27', 'UG-32', 'UG-98'] },
    { id: 'asme-viii-2', name: 'ASME BPVC Section VIII, Division 2', division: '2', family: 'vessel', capability: 'documentary' },
    { id: 'asme-viii-3', name: 'ASME BPVC Section VIII, Division 3', division: '3', family: 'vessel', capability: 'partial-div3', clauses: ['KG-101', 'KG-310', 'KG-311', 'KG-323', 'KD-100', 'KD-221.1', 'KS-320'] },
    { id: 'asme-b31-3', name: 'ASME B31.3', division: '', family: 'piping', capability: 'documentary' },
    { id: 'other', name: 'Outro código de construção documentado', division: '', family: 'any', capability: 'documentary' }
  ].map(profile => Object.freeze({ ...profile, clauses: Object.freeze(profile.clauses || []) })));
  class InputError extends Error {}
  function text(value, label, max = 240) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > max) throw new InputError(`${label}: informe texto com até ${max} caracteres.`);
    return value.trim();
  }
  const clean = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\u2010-\u2015]/g, '-');
  function nameProfile(name) {
    const n = clean(name);
    if (/\bb31\s*[.:-]\s*3\b/.test(n)) return 'asme-b31-3';
    if (!/\basme\b|\bbpvc\b/.test(n) || !/\bviii\b|section\s*8\b|secao\s*8\b/.test(n)) return '';
    const match = n.match(/(?:div(?:ision|isao|is[ií]on)?\.?\s*|viii\s*[-/]\s*)(iii\b|ii\b|i\b|[123]\b)/);
    if (!match) return 'ambiguous-asme-viii';
    const division = { i: '1', ii: '2', iii: '3' }[match[1]] || match[1];
    return `asme-viii-${division}`;
  }
  function identify(input) {
    if (typeof input === 'string') input = { name: input };
    if (input === undefined || input === null) input = {};
    if (typeof input !== 'object' || Array.isArray(input)) throw new InputError('Código de construção inválido.');
    const declared = text(input.profileId, 'Perfil do código', 40), name = text(input.name, 'Nome do código'), edition = text(input.edition, 'Edição do código', 120), source = text(input.source, 'Fonte do código', 2000);
    let division = input.division === undefined || input.division === null ? '' : String(input.division).trim();
    division = ({ I: '1', II: '2', III: '3' })[division.toUpperCase()] || division;
    if (division && !['1', '2', '3'].includes(division)) throw new InputError('Divisão do código inválida.');
    if (declared && !PROFILES.some(profile => profile.id === declared)) throw new InputError('Perfil de código desconhecido.');
    const detected = nameProfile(name);
    if (declared && !['unknown', 'other'].includes(declared) && name && !detected) throw new InputError('O nome informado não corresponde ao perfil normativo selecionado.');
    let profileId = declared || (detected && detected !== 'ambiguous-asme-viii' ? detected : detected && division ? `asme-viii-${division}` : name ? 'other' : 'unknown');
    if (detected && detected !== 'ambiguous-asme-viii' && declared && declared !== detected) throw new InputError('O nome e o perfil do código indicam normas diferentes.');
    const profile = PROFILES.find(item => item.id === profileId);
    if (division && profile.division !== division) throw new InputError('A divisão informada diverge do perfil do código.');
    if (detected === 'ambiguous-asme-viii' && !profile.division) profileId = 'unknown';
    const selected = PROFILES.find(item => item.id === profileId);
    return { profileId, name: name || selected.name, division: selected.division, edition, source };
  }
  function assertDiv1(input) {
    const code = identify(input);
    if (code.profileId !== 'asme-viii-1') throw new InputError('Este motor usa ASME VIII, Divisão 1 (UG-27 / UG-32). O código declarado exige seu próprio memorial; não use estas equações para Divisão 2, Divisão 3 ou tubulações B31.3.');
    return code;
  }
  function assertDiv3_2025(input) {
    const code = identify(input);
    if (code.profileId !== 'asme-viii-3' || code.edition !== '2025') throw new InputError('O diagnóstico KD-221.1 disponível usa exclusivamente ASME VIII, Divisão 3, edição 2025. Preserve a edição de construção do equipamento e use o memorial correspondente.');
    return code;
  }
  return Object.freeze({ VERSION: '1.0.0', PROFILES, InputError, identify, normalize: identify, assertDiv1, assertDiv3_2025 });
});
