'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Registry = require('../lib/rti-guidance-registry.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const source = (row, column) => ({ sourceId: 'a'.repeat(64), fileHash: 'a'.repeat(64), locator: { sheet: 'SYNTHETIC', row, column } });
function item(id = 'ITEM-SYNTHETIC') {
  return { id, itemKey: 'F-SYNTHETIC', component: 'COMPONENTE SINTÉTICO', conditions: [{ id: 'COND-SYNTHETIC', text: 'Texto SINTÉTICO sem classificação automática.', source: source(2, 'C') }], recommendations: [{ id: 'REC-SYNTHETIC', text: 'AÇÃO ESPECÍFICA SINTÉTICA A PRESERVAR.', requiresTreatment: true, source: source(2, 'D') }] };
}
function binding(target, intensity = 'leve', status = 'verified_link') {
  return { conditionId: target.conditions[0].id, recommendationId: target.recommendations[0].id, mappingStatus: status,
    ruleRef: clone(Registry.getRegistry().entries.find(entry => entry.ruleRef.entryId === intensity).ruleRef),
    mappingEvidence: { conditionSource: clone(target.conditions[0].source), recommendationSource: clone(target.recommendations[0].source), reviewReference: 'REVISÃO DE MAPEAMENTO EXCLUSIVAMENTE SINTÉTICA' } };
}
function resolve(target) { return Registry.resolveGuidance(target, target.conditions[0].id, target.recommendations[0].id); }

test('registry projection hashes match the authoritative server registry without a date or risk calculation', () => {
  const result = Registry.getRegistry();
  assert.equal(result.schemaVersion, 1); assert.equal(result.registryId, 'pires-corrosion-guidance-registry');
  const hashes = { leve: '2fd5e70743ae27c05ec9b60ded0b684b61db772bf5426a8cf708fc6870c17338', media: '2a0f760da4e3623f00e46654e673a77f114d58135d430feda106b8381dc3f811', severa: 'e086459ffba3a5e98483b5a6f6f89e56c3f7598003eb58ea2538e823ee6d689e', urgente: '06a25bbb50cf91d4654300ca85d3e0a23bd32b874051b256810ef7904cc9ef9e' };
  assert.equal(result.entries.length, 4);
  for (const { ruleRef, guidance } of result.entries) {
    assert.equal(ruleRef.contentHash, hashes[ruleRef.entryId]);
    assert.equal(ruleRef.contentHash, createHash('sha256').update(Registry.canonicalJson(guidance)).digest('hex'));
    assert.equal(ruleRef.referenceId, 'pires-corrosion-treatment-guidance'); assert.equal(ruleRef.representationVersion, 1);
    assert.equal(guidance.deadlineAnchor.event, 'inspection_completed'); assert.equal(guidance.canCalculateDue, false); assert.equal(guidance.due, null);
    assert.equal(guidance.score, null); assert.equal(guidance.pof, null); assert.equal(guidance.cof, null);
    assert.equal(guidance.operationalActionAuthorized, false); assert.equal(guidance.recommendationOverrideAuthorized, false);
    assert.ok(Object.isFrozen(guidance.durationReference));
  }
});

test('canonical JSON deeply sorts object keys while preserving arrays and rejecting lossy input', () => {
  assert.equal(Registry.canonicalJson({ z: [{ y: 1, a: 2 }, 3], a: { d: false, b: null } }), '{"a":{"b":null,"d":false},"z":[{"a":2,"y":1},3]}');
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), { missing: undefined }, { x: () => 1 }, Array(1)]) assert.throws(() => Registry.canonicalJson(value));
  const cycle = {}; cycle.self = cycle; assert.throws(() => Registry.canonicalJson(cycle));
  let touched = false; const getter = { get source() { touched = true; return {}; } }; assert.throws(() => Registry.canonicalJson(getter)); assert.equal(touched, false);
});

test('only a unique explicit binding with known hash and matching source evidence yields verified_link', () => {
  const target = item(); target.guidanceBindings = [binding(target)];
  const original = clone(target), result = resolve(target);
  assert.deepEqual(Object.keys(result).sort(), ['schemaVersion', 'status', 'catalogItemId', 'conditionId', 'recommendationId', 'ruleRef', 'mappingEvidence', 'guidance', 'referenceOnly', 'canCalculateDue', 'due', 'score', 'operationalActionAuthorized', 'recommendationOverrideAuthorized'].sort());
  assert.equal(result.status, 'verified_link'); assert.equal(result.catalogItemId, target.id);
  assert.deepEqual(result.guidance, Registry.getRegistry().entries[0].guidance);
  assert.deepEqual(result.ruleRef, target.guidanceBindings[0].ruleRef);
  assert.deepEqual(result.mappingEvidence, target.guidanceBindings[0].mappingEvidence);
  assert.equal(result.referenceOnly, true); assert.equal(result.canCalculateDue, false); assert.equal(result.due, null); assert.equal(result.score, null);
  assert.equal(result.operationalActionAuthorized, false); assert.equal(result.recommendationOverrideAuthorized, false);
  assert.deepEqual(target, original); assert.ok(Object.isFrozen(result.mappingEvidence.conditionSource.locator));
  target.guidanceBindings[0].mappingEvidence.conditionSource.locator.row = 500;
  assert.equal(result.mappingEvidence.conditionSource.locator.row, 2);
});

test('property-order changes in JSON sources do not change evidence equality', () => {
  const target = item(); target.guidanceBindings = [binding(target)];
  const evidence = target.guidanceBindings[0].mappingEvidence;
  evidence.conditionSource = Object.fromEntries(Object.entries(evidence.conditionSource).reverse());
  evidence.recommendationSource.locator = Object.fromEntries(Object.entries(evidence.recommendationSource.locator).reverse());
  assert.equal(resolve(target).status, 'verified_link');
});

test('missing mapping, wrong pair and text-only clues remain pending without guessing', () => {
  const target = item(); target.conditions[0].text = 'corrosão leve média severa urgente';
  target.recommendations[0].text = 'tratar e pintar; substituir; N/A; Sem Visual';
  assert.equal(resolve(target).status, 'pending_mapping');
  target.guidanceBindings = [{ ...binding(target), conditionId: 'OTHER' }];
  assert.equal(resolve(target).status, 'pending_mapping');
  const empty = Registry.resolveGuidance(target, null, null); assert.equal(empty.status, 'not_selected');
  for (const result of [resolve(target), empty]) { assert.equal(result.guidance, null); assert.equal(result.ruleRef, null); assert.equal(result.score, null); }
});

test('multiple bindings and explicit conflict remain pending rather than choosing the first', () => {
  const target = item(); target.guidanceBindings = [binding(target), binding(target, 'severa')];
  assert.equal(resolve(target).status, 'conflict'); assert.equal(resolve(target).guidance, null); assert.equal(resolve(target).ruleRef, null);
  target.guidanceBindings = [binding(target, 'leve', 'conflict')];
  const conflict = resolve(target); assert.equal(conflict.status, 'conflict'); assert.equal(conflict.guidance, null); assert.equal(conflict.ruleRef, null);
  assert.deepEqual(conflict.mappingEvidence, target.guidanceBindings[0].mappingEvidence);
});

test('pending specific review preserves structured evidence without activating its raw reference', () => {
  const target = item(); target.guidanceBindings = [binding(target, 'urgente', 'pending_specific_review')];
  target.guidanceBindings[0].ruleRef.contentHash = 'f'.repeat(64);
  const result = resolve(target);
  assert.equal(result.status, 'pending_specific_review'); assert.equal(result.ruleRef, null); assert.equal(result.guidance, null);
  assert.deepEqual(result.mappingEvidence, target.guidanceBindings[0].mappingEvidence);
});

test('unknown references, version/hash changes and provenance substitutions cannot produce verified links', () => {
  const changes = [
    b => b.ruleRef.referenceId = 'fake', b => b.ruleRef.representationVersion = '1', b => b.ruleRef.representationVersion = 2,
    b => b.ruleRef.entryId = 'média', b => b.ruleRef.contentHash = 'f'.repeat(64), b => b.ruleRef.extra = true,
    b => b.mappingEvidence.conditionSource.locator.row = 5, b => b.mappingEvidence.recommendationSource.locator.column = 'H',
    b => b.mappingEvidence.reviewReference = '', b => b.mappingEvidence.reviewReference = ' ',
    b => b.mappingEvidence.conditionSource = {}, b => b.mappingEvidence.recommendationSource = null,
    b => b.guidance = { canCalculateDue: true, due: '2026-11-01' }, b => b.mappingStatus = 'approved',
  ];
  for (const change of changes) {
    const target = item(); target.guidanceBindings = [binding(target)]; change(target.guidanceBindings[0]);
    const result = resolve(target);
    assert.equal(result.status, 'invalid_reference'); assert.equal(result.ruleRef, null); assert.equal(result.guidance, null); assert.equal(result.due, null);
  }
});

test('malformed choices and missing source evidence are rejected without caller registry overrides', () => {
  const target = item(); target.guidanceBindings = [binding(target)];
  const external = clone(Registry.getRegistry()); external.entries[0].guidance.due = '2026-10-22';
  assert.equal(Registry.resolveGuidance(target, target.conditions[0].id, target.recommendations[0].id, external).due, null);
  target.conditions.push(clone(target.conditions[0])); assert.equal(resolve(target).status, 'invalid_reference'); target.conditions.pop();
  delete target.conditions[0].source; assert.equal(resolve(target).status, 'invalid_reference');
  assert.equal(Registry.resolveGuidance(null, 'x', 'y').status, 'invalid_reference');
  let touched = false; const unsafe = { get id() { touched = true; return 'fake'; } };
  assert.equal(Registry.resolveGuidance(unsafe, 'x', 'y').status, 'invalid_reference'); assert.equal(touched, false);
});

test('compilation is immutable, source-checked and idempotent without changing original phrases or declarations', () => {
  const original = [item(), item('OTHER-ITEM')], before = clone(original), b = binding(original[0]);
  const manifest = { schemaVersion: 1, bindings: [{ catalogItemId: original[0].id, ...b }] };
  const result = Registry.compileBindings(original, manifest);
  assert.deepEqual(original, before); assert.equal(result[0].recommendations[0].text, before[0].recommendations[0].text);
  assert.deepEqual(result[1], before[1]); assert.ok(Object.isFrozen(result[0].guidanceBindings[0]));
  assert.equal(resolve(result[0]).status, 'verified_link');
  assert.deepEqual(Registry.compileBindings(result, manifest), result);
  const second = { schemaVersion: 1, bindings: [{ catalogItemId: original[0].id, ...binding(original[0], 'severa') }] };
  const conflict = Registry.compileBindings(result, second);
  assert.equal(conflict[0].guidanceBindings.length, 2); assert.equal(resolve(conflict[0]).status, 'conflict');
  assert.equal(resolve(result[0]).status, 'verified_link');
});

test('compilation rejects missing IDs, incorrect sources and unknown policy declarations atomically', () => {
  for (const change of [row => row.catalogItemId = 'missing', row => row.conditionId = 'missing', row => row.recommendationId = 'missing', row => row.ruleRef.contentHash = '0'.repeat(64), row => row.mappingEvidence.conditionSource.locator.row = 99, row => row.mappingStatus = 'approved', row => row.recommendation = 'SILENT REWRITE']) {
    const original = [item()], before = clone(original), row = { catalogItemId: original[0].id, ...binding(original[0]) }; change(row);
    assert.throws(() => Registry.compileBindings(original, { schemaVersion: 1, bindings: [row] }), error => error.code === 'invalid_rti_guidance_manifest');
    assert.deepEqual(original, before);
  }
  assert.throws(() => Registry.compileBindings([item(), item()], { schemaVersion: 1, bindings: [] }));
  assert.throws(() => Registry.compileBindings([item()], { schemaVersion: 2, bindings: [] }));
});

test('selection and non-treatment statuses take precedence without guessing from recommendation text', () => {
  const target = item();
  for (const recommendationId of [null, undefined, '']) assert.equal(Registry.resolveGuidance(target, null, recommendationId).status, 'not_selected');
  target.recommendations[0].requiresTreatment = false;
  target.guidanceBindings = [binding(target), binding(target, 'urgente')];
  const result = resolve(target); assert.equal(result.status, 'not_applicable'); assert.equal(result.ruleRef, null); assert.equal(result.guidance, null);
  delete target.recommendations[0].requiresTreatment;
  target.recommendations[0].text = 'Sem recomendações'; delete target.guidanceBindings;
  assert.equal(resolve(target).status, 'pending_mapping');
});

test('null bindings are pending; malformed bindings are conflicts; neither may activate a rule', () => {
  const target = item(); target.guidanceBindings = null;
  assert.equal(resolve(target).status, 'pending_mapping');
  for (const bindings of [{}, 'bad', [null], [{}], [{ ...binding(target), mappingStatus: null }]]) {
    target.guidanceBindings = bindings;
    const result = resolve(target); assert.equal(result.status, 'conflict'); assert.equal(result.ruleRef, null); assert.equal(result.guidance, null);
  }
});

test('review references require trimmed content and at most 2000 characters', () => {
  const target = item(); target.guidanceBindings = [binding(target)];
  for (const value of ['', ' ', null, 1, 'x'.repeat(2001)]) {
    target.guidanceBindings[0].mappingEvidence.reviewReference = value;
    assert.equal(resolve(target).status, 'invalid_reference');
  }
  for (const value of ['x'.repeat(2000), '  ' + 'x'.repeat(2000) + '  ', '🙂'.repeat(2000)]) {
    target.guidanceBindings[0].mappingEvidence.reviewReference = value;
    assert.equal(resolve(target).status, 'verified_link');
  }
});

test('compiler translates manifest status to persisted mappingStatus and rejects contradictory states', () => {
  const target = item(), b = binding(target); b.status = b.mappingStatus; delete b.mappingStatus;
  const compiled = Registry.compileBindings([target], { schemaVersion: 1, bindings: [{ catalogItemId: target.id, ...b }] });
  assert.equal(compiled[0].guidanceBindings[0].mappingStatus, 'verified_link'); assert.equal(Object.hasOwn(compiled[0].guidanceBindings[0], 'status'), false);
  assert.equal(resolve(compiled[0]).status, 'verified_link');
  assert.throws(() => Registry.compileBindings([target], { schemaVersion: 1, bindings: [{ catalogItemId: target.id, ...b, mappingStatus: 'conflict' }] }), error => error.code === 'invalid_rti_guidance_manifest');
});
