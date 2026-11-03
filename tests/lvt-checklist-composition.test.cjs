'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewCatalogPayload } = require('../lib/lvt-catalog-review.cjs');
const { LIMITS, composeChecklistDraft } = require('../lib/lvt-checklist-composition.cjs');

// All phrases, references and equipment below are small synthetic fixtures.
function row(sourceRow, overrides = {}) {
  return {
    source_row: sourceRow,
    source_cells: Object.fromEntries('ABCDEFGH'.split('').map(column => [column, column + sourceRow])),
    original_fields: {
      Item: 'Grupo SINTÉTICO A', 'Condição': 'Condição SINTÉTICA A', Dano: 'Frase SINTÉTICA A',
      'Recomendação': 'Recomendação SINTÉTICA A', Damage: 'SYNTHETIC phrase A', Recommendation: 'SYNTHETIC recommendation A',
      Prazos: '-', Deadlines: '-', coluna_I_sem_cabecalho: null,
    }, ambiguities: [], ...overrides,
  };
}
function payload(records = [row(2), row(3), row(4)]) {
  return {
    source: { filename: 'SYNTHETIC.xlsx', sheet: 'SYNTHETIC', sha256: 'a'.repeat(64), modified_time: '2026-11-03T00:00:00Z', revision_id: null },
    scope: 'Escopo SINTÉTICO para teste', usage_limits: ['Não aplicar em ativo real'], record_count: records.length, records,
  };
}
const raw = value => JSON.stringify(value);
function selection(review, index) {
  return { sourceRecordId: review.phraseBank.entries[index].sourceRecordId, payloadIndex: index };
}
function declaration(input, indices = [0, 1]) {
  const review = reviewCatalogPayload(input);
  return {
    version: 'COMPOSIÇÃO-SYNTHETIC-1',
    sourceRef: {
      reportedSha256: review.provenance.reportedSourceHash.sha256,
      sheet: review.provenance.source.sheet,
      receivedPayloadSha256: review.provenance.receivedPayload.sha256,
    },
    applicability: { equipment: 'Equipamento SINTÉTICO declarado', modality: 'Modalidade SINTÉTICA declarada', procedureReference: 'PROCEDIMENTO-SYNTHETIC', procedureRevision: 'REV-SYNTHETIC' },
    plannedItems: [{ key: 'ITEM-SYNTHETIC-A', label: 'Item planejado SINTÉTICO A', required: false, sourceRows: indices.map(index => selection(review, index)) }],
  };
}
function reject(input, plan, path) {
  assert.throws(() => composeChecklistDraft(input, plan), error => error.code === 'invalid_lvt_checklist_composition' && error.path === path);
}

test('explicit composition groups several phrase rows into one planned item without merging duplicates', () => {
  const input = raw(payload()), plan = declaration(input), result = composeChecklistDraft(input, plan), choices = result.plannedItems[0].choices;
  assert.equal(result.phraseBank.recordCount, 3);
  assert.equal(result.plannedItems.length, 1);
  assert.equal(result.plannedItems[0].required, false);
  assert.equal(choices.length, 2);
  assert.deepEqual(choices[0].original_fields, choices[1].original_fields);
  assert.notEqual(choices[0].id, choices[1].id);
  assert.notEqual(choices[0].sourceRowRef.sourceRecordId, choices[1].sourceRowRef.sourceRecordId);
  assert.deepEqual(choices.map(choice => choice.sourceRowRef.source_row), [2, 3]);
  assert.ok(choices.every(choice => choice.sourceFlags.some(flag => flag.code === 'duplicate_phrase_tuple')));
  assert.deepEqual(result.phraseBank.unselectedSourceRows.map(entry => entry.source_row), [4]);
  assert.equal(result.phraseBank.unselectedSourceRows[0].status, 'not_selected_for_this_draft');
});

test('no defaults turn phrase groups into mandatory inspection items', () => {
  const source = payload(); source.records[2].original_fields.Item = 'Outro grupo SINTÉTICO';
  const input = raw(source), plan = declaration(input, [2]);
  const result = composeChecklistDraft(input, plan);
  assert.equal(result.plannedItems.length, 1);
  assert.equal(result.plannedItems[0].choices.length, 1);
  assert.equal(result.phraseBank.selectedSourceRowCount, 1);
  assert.equal(result.plannedItems[0].required, false);
  delete plan.plannedItems[0].required;
  reject(input, plan, 'declaration.plannedItems[0].required');
});

test('composition, source-row and choice identities are deterministic and property-order independent', () => {
  const input = raw(payload()), plan = declaration(input), first = composeChecklistDraft(input, plan);
  assert.deepEqual(first, composeChecklistDraft(Buffer.from(input), plan));
  assert.deepEqual(first, composeChecklistDraft(new Uint8Array(Buffer.from(input)), plan));
  const reordered = JSON.parse(JSON.stringify(plan));
  reordered.applicability = Object.fromEntries(Object.entries(reordered.applicability).reverse());
  reordered.sourceRef = Object.fromEntries(Object.entries(reordered.sourceRef).reverse());
  assert.equal(composeChecklistDraft(input, reordered).compositionDigest, first.compositionDigest);
  assert.match(first.compositionDigest, /^[a-f\d]{64}$/);
  assert.match(first.plannedItems[0].id, /^lvt-planned-item-[a-f\d]{64}$/);
  assert.ok(first.plannedItems[0].choices.every(choice => /^lvt-choice-[a-f\d]{64}$/.test(choice.id)));
});

test('version, selected order, obligation, equipment and procedure changes alter the composition digest', () => {
  const input = raw(payload()), plan = declaration(input), digest = composeChecklistDraft(input, plan).compositionDigest;
  for (const mutate of [
    value => { value.version = 'COMPOSIÇÃO-SYNTHETIC-2'; },
    value => { value.plannedItems[0].sourceRows.reverse(); },
    value => { value.plannedItems[0].required = true; },
    value => { value.plannedItems[0].label = 'Outro rótulo SINTÉTICO'; },
    value => { value.applicability.equipment = 'Outro equipamento SINTÉTICO'; },
    value => { value.applicability.modality = 'Outra modalidade SINTÉTICA'; },
    value => { value.applicability.procedureReference = 'OUTRO-PROCEDIMENTO-SYNTHETIC'; },
    value => { value.applicability.procedureRevision = 'OUTRA-REV-SYNTHETIC'; },
  ]) {
    const changed = JSON.parse(JSON.stringify(plan)); mutate(changed);
    assert.notEqual(composeChecklistDraft(input, changed).compositionDigest, digest);
  }
});

test('source bytes and JSON formatting are bound to the explicit received-payload reference', () => {
  const source = payload(), input = raw(source), plan = declaration(input), initial = composeChecklistDraft(input, plan);
  source.records[0].original_fields.Dano = 'Conteúdo SINTÉTICO alterado';
  const changed = raw(source);
  reject(changed, plan, 'declaration.sourceRef.receivedPayloadSha256');
  const changedPlan = declaration(changed), changedDraft = composeChecklistDraft(changed, changedPlan);
  assert.equal(changedDraft.plannedItems[0].choices[0].sourceRowRef.sourceRecordId, initial.plannedItems[0].choices[0].sourceRowRef.sourceRecordId);
  assert.notEqual(changedDraft.plannedItems[0].choices[0].id, initial.plannedItems[0].choices[0].id);
  assert.notEqual(changedDraft.compositionDigest, initial.compositionDigest);
  reject(JSON.stringify(payload(), null, 2), plan, 'declaration.sourceRef.receivedPayloadSha256');
});

test('different source hashes, sheets or received payloads cannot be silently mixed', () => {
  const input = raw(payload()), plan = declaration(input);
  let other = JSON.parse(JSON.stringify(plan)); other.sourceRef.reportedSha256 = 'b'.repeat(64);
  reject(input, other, 'declaration.sourceRef.reportedSha256');
  other = JSON.parse(JSON.stringify(plan)); other.sourceRef.sheet = 'OTHER-SYNTHETIC';
  reject(input, other, 'declaration.sourceRef.sheet');
  other = JSON.parse(JSON.stringify(plan)); other.sourceRef.receivedPayloadSha256 = 'c'.repeat(64);
  reject(input, other, 'declaration.sourceRef.receivedPayloadSha256');
  other = JSON.parse(JSON.stringify(plan)); other.plannedItems[0].sourceRows[0].sourceRecordId = 'lvt-source-row-' + 'd'.repeat(64);
  reject(input, other, 'declaration.plannedItems[0].sourceRows[0].sourceRecordId');
});

test('unknown occurrences, wrong row IDs and duplicate selections are rejected explicitly', () => {
  const input = raw(payload()), plan = declaration(input);
  let other = JSON.parse(JSON.stringify(plan)); other.plannedItems[0].sourceRows[0].payloadIndex = 99;
  reject(input, other, 'declaration.plannedItems[0].sourceRows[0].payloadIndex');
  other = JSON.parse(JSON.stringify(plan)); other.plannedItems[0].sourceRows[0].payloadIndex = 1;
  reject(input, other, 'declaration.plannedItems[0].sourceRows[0].sourceRecordId');
  other = JSON.parse(JSON.stringify(plan)); other.plannedItems[0].sourceRows.push({ ...other.plannedItems[0].sourceRows[0] });
  reject(input, other, 'declaration.plannedItems[0].sourceRows[2].payloadIndex');
  other = JSON.parse(JSON.stringify(plan)); other.plannedItems[0].sourceRows[0].source_row = 999;
  reject(input, other, 'declaration.plannedItems[0].sourceRows[0].source_row');
});

test('repeated identical source anchor keeps separate payload occurrences as separate choices', () => {
  const input = raw(payload([row(2), row(2)])), result = composeChecklistDraft(input, declaration(input));
  const choices = result.plannedItems[0].choices;
  assert.equal(choices.length, 2);
  assert.equal(choices[0].sourceRowRef.sourceRecordId, choices[1].sourceRowRef.sourceRecordId);
  assert.notEqual(choices[0].id, choices[1].id);
  assert.deepEqual(choices.map(choice => choice.sourceRowRef.payloadIndex), [0, 1]);
  assert.ok(choices.every(choice => choice.sourceFlags.some(flag => flag.code === 'repeated_source_anchor')));
});

test('source reuse in different explicitly planned items retains distinct item/choice identities', () => {
  const input = raw(payload()), plan = declaration(input, [0]);
  plan.plannedItems.push({ ...JSON.parse(JSON.stringify(plan.plannedItems[0])), key: 'ITEM-SYNTHETIC-B', label: 'Outro item SINTÉTICO', required: true });
  const result = composeChecklistDraft(input, plan);
  assert.equal(result.plannedItems.length, 2);
  assert.notEqual(result.plannedItems[0].id, result.plannedItems[1].id);
  assert.notEqual(result.plannedItems[0].choices[0].id, result.plannedItems[1].choices[0].id);
  assert.equal(result.phraseBank.selectedSourceRowCount, 1);
  plan.plannedItems[1].key = plan.plannedItems[0].key;
  reject(input, plan, 'declaration.plannedItems[1].key');
});

test('applicability and internal version must be explicit for every nonempty draft', () => {
  const input = raw(payload()), plan = declaration(input);
  let missing = JSON.parse(JSON.stringify(plan)); missing.version = null;
  reject(input, missing, 'declaration.version');
  missing = JSON.parse(JSON.stringify(plan)); missing.applicability = null;
  reject(input, missing, 'declaration.applicability');
  for (const field of ['equipment', 'modality', 'procedureReference', 'procedureRevision']) {
    missing = JSON.parse(JSON.stringify(plan)); delete missing.applicability[field];
    reject(input, missing, 'declaration.applicability.' + field);
  }
  missing = JSON.parse(JSON.stringify(plan)); missing.plannedItems[0].sourceRows = [];
  reject(input, missing, 'declaration.plannedItems[0].sourceRows');
});

test('empty declaration remains pending and neither all phrases nor source groups become items', () => {
  const input = raw(payload()), plan = declaration(input); plan.plannedItems = []; plan.applicability = null; plan.version = null;
  const result = composeChecklistDraft(input, plan);
  assert.equal(result.status, 'pending');
  assert.equal(result.version, null);
  assert.equal(result.applicability.status, 'pending');
  assert.equal(result.applicability.declaration, null);
  assert.deepEqual(result.plannedItems, []);
  assert.equal(result.phraseBank.selectedSourceRowCount, 0);
  assert.equal(result.phraseBank.unselectedSourceRows.length, 3);
  assert.ok(result.blockers.includes('composition_empty'));
  const emptyInput = raw(payload([])), emptyPlan = declaration(emptyInput, []); emptyPlan.plannedItems = []; emptyPlan.applicability = null;
  assert.equal(composeChecklistDraft(emptyInput, emptyPlan).phraseBank.recordCount, 0);
});

test('recommendation absence, language gaps and unnamed column retain source evidence without actions', () => {
  const source = payload();
  source.records[0].original_fields.Recomendação = 'Sem recomendações.';
  source.records[0].original_fields.Recommendation = '-';
  source.records[0].source_cells.I = 'I2';
  source.records[0].original_fields.coluna_I_sem_cabecalho = 'VALOR-SYNTHETIC-SEM-CABEÇALHO';
  source.records[0].ambiguities = ['Ambiguidade SINTÉTICA pendente'];
  const input = raw(source), result = composeChecklistDraft(input, declaration(input, [0])), choice = result.plannedItems[0].choices[0];
  assert.deepEqual(choice.original_fields, source.records[0].original_fields);
  assert.deepEqual(choice.ambiguities, source.records[0].ambiguities);
  assert.equal(choice.recommendationHandling, 'no_automatic_action');
  assert.ok(choice.sourceFlags.some(flag => flag.code === 'explicit_no_recommendation'));
  assert.ok(choice.sourceFlags.some(flag => flag.code === 'recommendation_gap'));
  assert.ok(choice.sourceFlags.some(flag => flag.code === 'unnamed_source_column'));
  for (const key of ['deadline', 'discipline', 'risk', 'rti', 'approved', 'canActivate']) assert.equal(Object.hasOwn(choice, key), false);
});

test('all outputs distinguish declaration draft from blocked native source verification and approval', () => {
  const input = raw(payload()), result = composeChecklistDraft(input, declaration(input));
  assert.equal(result.mode, 'offline_composition_draft');
  assert.equal(result.status, 'draft');
  assert.equal(result.technicalReviewStatus, 'pending');
  assert.equal(result.applicability.status, 'declared_unverified');
  assert.deepEqual(result.sourceByteVerification, { status: 'blocked', originalBytesVerified: false });
  assert.equal(result.operationalUse, 'blocked');
  assert.equal(result.versionMeaning, 'internal_composition_version_not_technical_report_revision');
  assert.equal(result.provenance.reportedSourceHash.status, 'reported_unverified');
  assert.equal(result.provenance.receivedPayload.originalFileBytesVerified, false);
  assert.ok(result.blockers.includes('technical_composition_review_pending'));
  assert.ok(result.blockers.includes('source_byte_verification_blocked'));
  for (const key of ['approved', 'canActivate', 'technicalReportRevision', 'seed', 'sql']) assert.equal(Object.hasOwn(result, key), false);
});

test('reject forged review objects, altered raw fields and operational instruction fields', () => {
  const input = raw(payload()), plan = declaration(input), fake = reviewCatalogPayload(input);
  fake.phraseBank.entries[0].original_fields.Dano = 'CONTEÚDO-SYNTHETIC-FORJADO';
  assert.throws(() => composeChecklistDraft(fake, plan), { code: 'invalid_lvt_catalog_payload', path: 'payload' });
  let extra = JSON.parse(JSON.stringify(plan)); extra.canActivate = true;
  reject(input, extra, 'declaration.canActivate');
  extra = JSON.parse(JSON.stringify(plan)); extra.applicability.approved = true;
  reject(input, extra, 'declaration.applicability.approved');
  extra = JSON.parse(JSON.stringify(plan)); extra.plannedItems[0].deadline = '2027-01-01';
  reject(input, extra, 'declaration.plannedItems[0].deadline');
});

test('does not mutate caller declaration or supplied payload bytes', () => {
  const input = Buffer.from(raw(payload())), plan = declaration(input), before = Buffer.from(input), beforePlan = JSON.stringify(plan);
  const result = composeChecklistDraft(input, plan);
  assert.deepEqual(input, before);
  assert.equal(JSON.stringify(plan), beforePlan);
  result.plannedItems[0].choices[0].original_fields.Dano = 'Somente saída SINTÉTICA alterada';
  result.applicability.declaration.equipment = 'Somente saída';
  result.provenance.sourceMetadata.filename = 'SOMENTE-SAIDA.xlsx';
  assert.equal(JSON.stringify(plan), beforePlan);
  assert.notEqual(composeChecklistDraft(input, plan).plannedItems[0].choices[0].original_fields.Dano, result.plannedItems[0].choices[0].original_fields.Dano);
});

test('sparse declarations and inherited applicability cannot bypass explicit item/row validation', () => {
  const input = raw(payload());
  let plan = declaration(input); plan.plannedItems = new Array(1);
  reject(input, plan, 'declaration.plannedItems');
  plan = declaration(input); plan.plannedItems[0].sourceRows = new Array(1);
  reject(input, plan, 'declaration.plannedItems[0].sourceRows');
  plan = declaration(input); plan.applicability = Object.create(plan.applicability);
  reject(input, plan, 'declaration.applicability');
});

test('declaration accessors and symbols are rejected before any getter executes', () => {
  const input = raw(payload()); let called = 0;
  for (const target of ['required', 'sourceRef', 'hidden']) {
    const plan = declaration(input), holder = target === 'required' ? plan.plannedItems[0] : plan;
    Object.defineProperty(holder, target === 'required' ? 'required' : target, {
      enumerable: target !== 'hidden', get() { called++; throw Error('Getter must never execute'); },
    });
    assert.throws(() => composeChecklistDraft(input, plan), error => error.code === 'invalid_lvt_checklist_composition' && /accessor/.test(error.message));
    assert.equal(called, 0);
  }
  const plan = declaration(input); plan.plannedItems[0][Symbol('not-json')] = true;
  assert.throws(() => composeChecklistDraft(input, plan), error => error.code === 'invalid_lvt_checklist_composition' && /símbolos/.test(error.message));
});

test('non-JSON declaration state, proxy traps and cycles fail predictably', () => {
  const input = raw(payload());
  for (const value of [undefined, NaN, Infinity, 1n, () => true, new Date('2026-11-03'), new Map()]) {
    const plan = declaration(input); plan.extra = value;
    assert.throws(() => composeChecklistDraft(input, plan), error => error.code === 'invalid_lvt_checklist_composition');
  }
  const circular = declaration(input); circular.extra = circular;
  assert.throws(() => composeChecklistDraft(input, circular), error => error.code === 'invalid_lvt_checklist_composition' && /ciclo/.test(error.message));
  let traps = 0;
  const proxy = new Proxy(declaration(input), { ownKeys() { traps++; throw Error('Proxy must never execute'); } });
  assert.throws(() => composeChecklistDraft(input, proxy), error => error.code === 'invalid_lvt_checklist_composition');
  assert.equal(traps, 0);
  assert.throws(() => composeChecklistDraft(new Proxy({}, { getPrototypeOf() { traps++; throw Error('Proxy must never execute'); } }), declaration(input)), error => error.code === 'invalid_lvt_checklist_composition');
  assert.equal(traps, 0);
});

test('offline byte, depth and node bounds reject overload without truncation or RangeError', () => {
  const input = raw(payload()), plan = declaration(input);
  reject(' '.repeat(LIMITS.payloadBytes + 1), plan, 'payload');
  const large = declaration(input); large.extra = 'S'.repeat(LIMITS.declarationBytes + 1);
  assert.throws(() => composeChecklistDraft(input, large), error => error.code === 'invalid_lvt_checklist_composition' && /bytes/.test(error.message));
  const deep = declaration(input); let cursor = deep;
  for (let index = 0; index < 10000; index++) { cursor.extra = {}; cursor = cursor.extra; }
  assert.throws(() => composeChecklistDraft(input, deep), error => error.code === 'invalid_lvt_checklist_composition' && /profundidade/.test(error.message));
  const nodes = declaration(input); nodes.extra = Array.from({ length: 100 }, () => Array.from({ length: 1000 }, () => null));
  assert.throws(() => composeChecklistDraft(input, nodes), error => error.code === 'invalid_lvt_checklist_composition' && /nós JSON/.test(error.message));
});

test('source rows, planned item counts and total selections have explicit resource bounds', () => {
  const input = raw(payload()), plan = declaration(input);
  const rows = raw(payload(Array.from({ length: LIMITS.sourceRows + 1 }, (_, index) => row(index + 2))));
  reject(rows, plan, 'payload.records');
  const items = declaration(input); items.plannedItems = Array.from({ length: LIMITS.plannedItems + 1 }, () => null);
  reject(input, items, 'declaration.plannedItems');
  const choices = declaration(input); choices.plannedItems = Array.from({ length: LIMITS.choices / 2 + 1 }, (_, index) => ({ ...choices.plannedItems[0], key: 'SYNTHETIC-' + index }));
  reject(input, choices, 'declaration.plannedItems[' + LIMITS.choices / 2 + '].sourceRows');
});
