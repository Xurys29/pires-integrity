'use strict';

// Pure, versioned reference resolution. This does not install a catalogue, infer
// a classification from text, replace an item recommendation or calculate dates.
const { createHash } = require('node:crypto');
const { getCorrosionTreatmentGuidance } = require('./rti-treatment-policy.cjs');
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function invalid(message) {
  const error = new TypeError(message);
  error.code = 'invalid_rti_guidance_manifest';
  throw error;
}
function canonicalJson(value) {
  const stack = new Set();
  const visit = (entry, depth) => {
    if (depth > 40) invalid('JSON excede a profundidade permitida.');
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number' && Number.isFinite(entry)) return JSON.stringify(entry);
    if (!entry || typeof entry !== 'object' || stack.has(entry)) invalid('Valor não é JSON finito sem ciclos.');
    if (!Array.isArray(entry) && !object(entry)) invalid('Objeto JSON simples obrigatório.');
    if (Object.getOwnPropertySymbols(entry).length) invalid('Símbolos não são campos JSON.');
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    if (Object.values(descriptors).some(descriptor => !own(descriptor, 'value'))) invalid('Acessores não são campos JSON.');
    stack.add(entry);
    let result;
    if (Array.isArray(entry)) {
      if (Object.keys(entry).length !== entry.length || Object.keys(entry).some((key, index) => key !== String(index))) invalid('Lista JSON esparsa ou com campos adicionais.');
      result = '[' + entry.map(child => visit(child, depth + 1)).join(',') + ']';
    } else {
      const keys = Object.keys(entry).sort();
      if (keys.length !== Object.getOwnPropertyNames(entry).length) invalid('Campo JSON não enumerável.');
      result = '{' + keys.map(key => JSON.stringify(key) + ':' + visit(descriptors[key].value, depth + 1)).join(',') + '}';
    }
    stack.delete(entry);
    return result;
  };
  return visit(value, 0);
}
const clone = value => JSON.parse(canonicalJson(value));
const keysAre = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

const source = getCorrosionTreatmentGuidance();
const REGISTRY = freeze({
  schemaVersion: 1,
  registryId: 'pires-corrosion-guidance-registry',
  entries: source.guidance.map(entry => {
    const guidance = clone({
      referenceSource: source.source,
      scope: source.scope,
      intensity: entry.intensity,
      label: entry.label,
      actionReference: entry.action,
      durationReference: entry.duration,
      conditionalDispositions: entry.conditionalDispositions || [],
      deadlineAnchor: source.deadlineAnchor,
      operationalActionAuthorized: false,
      recommendationOverrideAuthorized: false,
      canCalculateDue: false,
      due: null,
      score: null,
      pof: null,
      cof: null,
      blockingReasons: source.blockingReasons,
    });
    return { ruleRef: {
      referenceId: source.referenceId,
      representationVersion: source.representationVersion,
      entryId: entry.intensity,
      contentHash: createHash('sha256').update(canonicalJson(guidance), 'utf8').digest('hex'),
    }, guidance };
  }),
});

function getRegistry() {
  return REGISTRY;
}
function safeEvidence(value) {
  if (!object(value)) return null;
  try { return clone(value); } catch { return null; }
}
function structuredSource(value) {
  return object(value) && Object.keys(value).length > 0;
}
function referenceEntry(ref) {
  if (!keysAre(ref, ['referenceId', 'representationVersion', 'entryId', 'contentHash']) || Object.keys(ref).length !== 4) return null;
  return REGISTRY.entries.find(entry => Object.keys(entry.ruleRef).every(key => entry.ruleRef[key] === ref[key])) || null;
}
function verifiedEvidence(evidence, condition, recommendation) {
  if (!keysAre(evidence, ['conditionSource', 'recommendationSource', 'reviewReference']) || Object.keys(evidence).length !== 3 || !nonempty(evidence.reviewReference) || [...evidence.reviewReference.trim()].length > 2000) return false;
  if (!structuredSource(evidence.conditionSource) || !structuredSource(evidence.recommendationSource) || !structuredSource(condition.source) || !structuredSource(recommendation.source)) return false;
  return canonicalJson(evidence.conditionSource) === canonicalJson(condition.source) && canonicalJson(evidence.recommendationSource) === canonicalJson(recommendation.source);
}

function resolveGuidance(item, conditionId, recommendationId) {
  const itemIdentity = object(item) ? Object.getOwnPropertyDescriptor(item, 'id') : null;
  const base = { schemaVersion: 1, status: 'pending_mapping', catalogItemId: typeof itemIdentity?.value === 'string' ? itemIdentity.value : null,
    conditionId: typeof conditionId === 'string' ? conditionId : null, recommendationId: typeof recommendationId === 'string' ? recommendationId : null,
    ruleRef: null, mappingEvidence: null, guidance: null, referenceOnly: true, canCalculateDue: false, due: null, score: null,
    operationalActionAuthorized: false, recommendationOverrideAuthorized: false };
  const result = (status, evidence = null, entry = null) => freeze({ ...base, status, mappingEvidence: evidence, ruleRef: entry ? entry.ruleRef : null, guidance: entry ? entry.guidance : null });
  if (!recommendationId) return result('not_selected');
  try {
    item = clone(item);
    if (!object(item) || !nonempty(item.id)) return result('invalid_reference');
    if (!nonempty(recommendationId) || !Array.isArray(item.recommendations)) return result('invalid_reference');
    const recommendations = item.recommendations.filter(choice => object(choice) && choice.id === recommendationId);
    if (recommendations.length !== 1) return result('invalid_reference');
    if (recommendations[0].requiresTreatment === false) return result('not_applicable');
    if (!nonempty(conditionId) || !Array.isArray(item.conditions)) return result('invalid_reference');
    const conditions = item.conditions.filter(choice => object(choice) && choice.id === conditionId);
    if (conditions.length !== 1) return result('invalid_reference');
    if (!own(item, 'guidanceBindings') || item.guidanceBindings === null) return result('pending_mapping');
    if (!Array.isArray(item.guidanceBindings) || item.guidanceBindings.some(binding => !object(binding) || !nonempty(binding.conditionId) || !nonempty(binding.recommendationId) || !nonempty(binding.mappingStatus))) return result('conflict');
    const matches = item.guidanceBindings.filter(binding => object(binding) && binding.conditionId === conditionId && binding.recommendationId === recommendationId);
    if (matches.length > 1) return result('conflict');
    if (!matches.length) return result('pending_mapping');
    const binding = matches[0], evidence = safeEvidence(binding.mappingEvidence);
    if (!keysAre(binding, ['conditionId', 'recommendationId', 'mappingStatus', 'ruleRef', 'mappingEvidence'])) return result('invalid_reference', evidence);
    if (binding.mappingStatus === 'conflict' || binding.mappingStatus === 'pending_specific_review') return result(binding.mappingStatus, evidence);
    if (binding.mappingStatus !== 'verified_link') return result('invalid_reference', evidence);
    const entry = referenceEntry(binding.ruleRef);
    if (!entry || !verifiedEvidence(evidence, conditions[0], recommendations[0])) return result('invalid_reference', evidence);
    return result('verified_link', evidence, entry);
  } catch {
    return result('invalid_reference');
  }
}

/**
 * Adds an explicit manifest of ID/source links to immutable item copies.
 * Existing declarations are preserved. Repeating an identical declaration is
 * idempotent; distinct declarations for the same pair remain an explicit conflict.
 */
function compileBindings(items, manifest) {
  const copy = clone(items), plan = clone(manifest);
  if (!Array.isArray(copy) || copy.length > 1000 || !keysAre(plan, ['schemaVersion', 'bindings']) || plan.schemaVersion !== 1 || !Array.isArray(plan.bindings) || plan.bindings.length > 5000) invalid('Manifesto explícito schemaVersion 1 e lista de itens obrigatórios.');
  const byId = new Map();
  for (const item of copy) {
    if (!object(item) || !nonempty(item.id) || byId.has(item.id)) invalid('Identidade única de item obrigatória.');
    if (own(item, 'guidanceBindings') && !Array.isArray(item.guidanceBindings)) invalid('guidanceBindings deve ser lista.');
    byId.set(item.id, item);
  }
  for (const row of plan.bindings) {
    if (!keysAre(row, ['catalogItemId', 'conditionId', 'recommendationId', 'status', 'mappingStatus', 'ruleRef', 'mappingEvidence']) || !nonempty(row.catalogItemId) || !nonempty(row.conditionId) || !nonempty(row.recommendationId)) invalid('Vínculo exige identidades explícitas.');
    const item = byId.get(row.catalogItemId);
    if (!item) invalid('Item declarado não existe nesta composição.');
    if (!Array.isArray(item.conditions) || !Array.isArray(item.recommendations) || item.conditions.filter(choice => choice?.id === row.conditionId).length !== 1 || item.recommendations.filter(choice => choice?.id === row.recommendationId).length !== 1) invalid('Escolhas declaradas não existem de forma única no item.');
    if (own(row, 'status') && own(row, 'mappingStatus') && row.status !== row.mappingStatus) invalid('Estados de vínculo contraditórios.');
    const mappingStatus = row.mappingStatus ?? row.status;
    if (!['verified_link', 'conflict', 'pending_specific_review'].includes(mappingStatus)) invalid('Estado do vínculo não reconhecido.');
    const binding = { conditionId: row.conditionId, recommendationId: row.recommendationId, mappingStatus, ruleRef: row.ruleRef ?? null, mappingEvidence: row.mappingEvidence ?? null };
    const resolved = resolveGuidance({ ...item, guidanceBindings: [binding] }, row.conditionId, row.recommendationId);
    if (mappingStatus === 'verified_link' && resolved.status !== 'verified_link') invalid('Referência ou fontes do vínculo não conferem.');
    item.guidanceBindings ||= [];
    const canonical = canonicalJson(binding);
    if (!item.guidanceBindings.some(existing => canonicalJson(existing) === canonical)) item.guidanceBindings.push(binding);
  }
  return freeze(copy);
}

module.exports = freeze({ getRegistry, resolveGuidance, compileBindings, canonicalJson });
