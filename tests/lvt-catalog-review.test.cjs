'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { reviewCatalogPayload } = require('../lib/lvt-catalog-review.cjs');

// Small synthetic exports only. No customer phrases, Library contents or native
// source documents are fixtures for this offline review helper.
function row(sourceRow, overrides = {}) {
  return {
    source_row: sourceRow,
    source_cells: Object.fromEntries('ABCDEFGH'.split('').map(column => [column, column + sourceRow])),
    original_fields: {
      Item: 'Componente sintético A', 'Condição': 'Condição sintética A', Dano: 'Frase sintética A',
      'Recomendação': 'Recomendação sintética A', Damage: 'Synthetic phrase A', Recommendation: 'Synthetic recommendation A',
      Prazos: '-', Deadlines: '-', coluna_I_sem_cabecalho: null,
    },
    ambiguities: [], ...overrides,
  };
}
function fixture(records = [row(2)]) {
  return {
    source: { filename: 'SYNTHETIC.xlsx', sheet: 'SYNTHETIC', sha256: 'a'.repeat(64), modified_time: '2026-11-03T00:00:00Z', revision_id: null, drive_id: 'synthetic-source', url: 'https://example.invalid/synthetic-source' },
    scope: 'Escopo sintético somente para teste', usage_limits: ['Não utilizar como evidência técnica'], record_count: records.length, records,
  };
}
const review = payload => reviewCatalogPayload(JSON.stringify(payload));
const entry = result => result.phraseBank.entries[0];
function reject(payload, path) {
  assert.throws(() => review(payload), error => error.code === 'invalid_lvt_catalog_payload' && error.path === path);
}

test('offline review separates reported workbook hash from digest of exact received payload', () => {
  const input = JSON.stringify(fixture(), null, 2), bytes = Buffer.from(input), result = reviewCatalogPayload(bytes);
  assert.deepEqual(result, reviewCatalogPayload(new Uint8Array(bytes)));
  assert.deepEqual(result, reviewCatalogPayload(input));
  assert.equal(result.provenance.reportedSourceHash.sha256, 'a'.repeat(64));
  assert.equal(result.provenance.reportedSourceHash.status, 'reported_unverified');
  assert.equal(result.provenance.reportedSourceHash.originalBytesVerified, false);
  assert.equal(result.provenance.receivedPayload.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.provenance.receivedPayload.byteLength, bytes.length);
  assert.equal(result.provenance.receivedPayload.originalFileBytesVerified, false);
  assert.equal(result.provenance.receivedPayload.hashBasis, 'received_utf8_json_bytes');
  assert.notEqual(result.provenance.receivedPayload.sha256, result.provenance.reportedSourceHash.sha256);
  assert.equal(result.mode, 'offline_review_only');
  assert.equal(result.technicalReviewStatus, 'pending');
});

test('received formatting changes payload digest but not source-row identity or raw text', () => {
  const source = fixture(), compact = reviewCatalogPayload(JSON.stringify(source)), formatted = reviewCatalogPayload(JSON.stringify(source, null, 2));
  assert.notEqual(compact.provenance.receivedPayload.sha256, formatted.provenance.receivedPayload.sha256);
  assert.equal(entry(compact).sourceRecordId, entry(formatted).sourceRecordId);
  assert.deepEqual(entry(compact).original_fields, source.records[0].original_fields);
  assert.ok(compact.provenance.metadataGaps.includes('revision_id'));
});

test('source identity depends on reported hash, sheet, row and canonical cell coordinates', () => {
  const a = fixture(), original = entry(review(a)).sourceRecordId;
  const phraseEdit = fixture(); phraseEdit.records[0].original_fields.Dano = 'Outra frase sintética';
  assert.equal(entry(review(phraseEdit)).sourceRecordId, original);
  for (const changed of [fixture([row(3)]), { ...fixture(), source: { ...a.source, sheet: 'Outra aba sintética' } }, { ...fixture(), source: { ...a.source, sha256: 'b'.repeat(64) } }]) assert.notEqual(entry(review(changed)).sourceRecordId, original);
  const reordered = fixture(); reordered.records[0].source_cells = Object.fromEntries(Object.entries(reordered.records[0].source_cells).reverse());
  assert.equal(entry(review(reordered)).sourceRecordId, original);
  const upperHash = fixture(); upperHash.source.sha256 = upperHash.source.sha256.toUpperCase();
  assert.equal(entry(review(upperHash)).sourceRecordId, original);
  const withI = fixture(); withI.records[0].source_cells.I = 'I2';
  assert.notEqual(entry(review(withI)).sourceRecordId, original);
});

test('phrase bank is not expanded or inferred into applicable checklist items', () => {
  const result = review(fixture([row(2), row(3), row(4, { original_fields: { ...row(4).original_fields, Item: 'Componente sintético B' } })]));
  assert.equal(result.phraseBank.recordCount, 3);
  assert.equal(result.phraseBank.distinctSourceRowCount, 3);
  assert.deepEqual(result.phraseBank.itemLabels, ['Componente sintético A', 'Componente sintético B']);
  assert.deepEqual(result.checklistComposition, { status: 'pending', applicabilityStatus: 'pending', items: null });
  assert.equal(result.phraseBank.entries.every(value => value.reviewStatus === 'pending_technical_review'), true);
  for (const value of result.phraseBank.entries) for (const key of ['classification', 'risk', 'discipline', 'deadline', 'approved', 'actionable', 'rti']) assert.equal(Object.hasOwn(value, key), false);
});

test('exact phrase duplicates and repeated condition/damage keys preserve every source row', () => {
  const first = row(2), samePhrase = row(3), otherRecommendation = row(4);
  otherRecommendation.original_fields.Recomendação = 'Outra recomendação sintética';
  const result = review(fixture([first, samePhrase, otherRecommendation]));
  assert.equal(result.phraseBank.entries.length, 3);
  assert.equal(new Set(result.phraseBank.entries.map(value => value.sourceRecordId)).size, 3);
  assert.deepEqual(result.duplicates.exactPhraseTuples[0].occurrences.map(value => value.sourceRow), [2, 3]);
  assert.deepEqual(result.duplicates.itemConditionDamage[0].occurrences.map(value => value.sourceRow), [2, 3, 4]);
  assert.equal(result.duplicates.sourceAnchors.length, 0);
  assert.ok(result.phraseBank.entries[1].flags.some(value => value.code === 'duplicate_phrase_tuple'));
  assert.ok(result.phraseBank.entries[2].flags.some(value => value.code === 'repeated_item_condition_damage'));
});

test('repeated identical source anchor is reported without discarding payload occurrences', () => {
  const result = review(fixture([row(2), row(2)]));
  assert.equal(result.phraseBank.entries.length, 2);
  assert.equal(result.phraseBank.distinctSourceRowCount, 1);
  assert.equal(result.phraseBank.entries[0].sourceRecordId, result.phraseBank.entries[1].sourceRecordId);
  assert.deepEqual(result.duplicates.sourceAnchors[0].occurrences.map(value => value.payloadIndex), [0, 1]);
});

test('raw whitespace, punctuation, language gaps and source ambiguities remain visible', () => {
  const input = fixture(); input.records[0].original_fields.Dano = '  TEXTO SINTÉTICO\ncom espaçamento.  ';
  input.records[0].original_fields.Recommendation = '-';
  input.records[0].ambiguities = ['Ambiguidade sintética: tradução pendente'];
  const result = review(input), value = entry(result);
  assert.equal(value.original_fields.Dano, input.records[0].original_fields.Dano);
  assert.deepEqual(value.ambiguities, input.records[0].ambiguities);
  assert.ok(value.flags.some(flag => flag.code === 'recommendation_gap' && flag.fields.includes('Recommendation')));
  assert.ok(value.flags.some(flag => flag.code === 'source_ambiguities'));
  assert.equal(value.reviewStatus, 'pending_technical_review');
});

test('raw differences are not normalized into one phrase duplicate', () => {
  const first = row(2), spaced = row(3); spaced.original_fields.Dano += ' ';
  assert.equal(review(fixture([first, spaced])).duplicates.exactPhraseTuples.length, 0);
});

test('empty or no-recommendation source text never becomes an automatic action', () => {
  const cases = ['', '-', '—', 'Sem recomendações.', 'SEM RECOMENDAÇÃO', 'Não se aplica.'].map(text => ['Recomendação', text]);
  cases.push(['Recommendation', 'No Recommendations.'], ['Recommendation', 'Not applicable.']);
  for (const [field, text] of cases) {
    const input = fixture(); input.records[0].original_fields[field] = text;
    const result = review(input), value = entry(result);
    assert.equal(value.original_fields[field], text);
    assert.ok(value.flags.some(flag => ['recommendation_gap', 'explicit_no_recommendation'].includes(flag.code) && flag.fields.includes(field)));
    assert.equal(Object.hasOwn(value, 'actionable'), false);
    assert.equal(Object.hasOwn(result, 'rtis'), false);
    assert.equal(result.technicalReviewStatus, 'pending');
  }
});

test('deadline placeholders and literal date-like text do not produce a deadline', () => {
  const input = fixture([row(2), row(3)]); input.records[1].original_fields.Prazos = 'Prazo sintético: 999 dias';
  const result = review(input);
  assert.equal(result.phraseBank.entries[1].original_fields.Prazos, 'Prazo sintético: 999 dias');
  for (const value of result.phraseBank.entries) {
    assert.equal(Object.hasOwn(value, 'deadline'), false);
    assert.ok(value.flags.some(flag => flag.code === 'deadline_not_inferred'));
  }
});

test('column I without header stays raw and never becomes discipline or risk', () => {
  const input = fixture(); input.records[0].source_cells.I = 'I2';
  input.records[0].original_fields.coluna_I_sem_cabecalho = 'VALOR SINTÉTICO SEM CABEÇALHO';
  const value = entry(review(input));
  assert.equal(value.original_fields.coluna_I_sem_cabecalho, 'VALOR SINTÉTICO SEM CABEÇALHO');
  assert.ok(value.flags.some(flag => flag.code === 'unnamed_source_column' && flag.column === 'I'));
  assert.equal(Object.hasOwn(value, 'discipline'), false);
  assert.equal(Object.hasOwn(value, 'risk'), false);
});

test('schema validation rejects malformed source, counts, source cells and hidden approval fields', () => {
  let input = fixture(); input.source.sha256 = 'not-a-hash'; reject(input, 'source.sha256');
  input = fixture(); input.record_count = 2; reject(input, 'record_count');
  input = fixture(); input.records[0].source_cells.C = 'C3'; reject(input, 'records[0].source_cells.C');
  input = fixture(); delete input.records[0].source_cells.H; reject(input, 'records[0].source_cells.H');
  input = fixture(); input.records[0].source_row = 0; reject(input, 'records[0].source_row');
  input = fixture(); input.records[0].source_row = 1048577; reject(input, 'records[0].source_row');
  input = fixture(); input.records[0].approved = true; reject(input, 'records[0].approved');
  input = fixture(); input.source.originalBytesVerified = true; reject(input, 'source.originalBytesVerified');
  input = fixture(); input.records[0].original_fields.Recomendação = null; reject(input, 'records[0].original_fields.Recomendação');
  input = fixture(); input.records[0].ambiguities = [{}]; reject(input, 'records[0].ambiguities[0]');
  input = fixture(); input.usage_limits = 'not an array'; reject(input, 'usage_limits');
  input = fixture(); input.scope = []; reject(input, 'scope');
});

test('column I values require coherent coordinates and preserve explicit null', () => {
  const input = fixture(); input.records[0].source_cells.I = 'I2';
  assert.equal(entry(review(input)).original_fields.coluna_I_sem_cabecalho, null);
  input.records[0].source_cells.I = 'J2'; reject(input, 'records[0].source_cells.I');
  const missingCell = fixture(); missingCell.records[0].original_fields.coluna_I_sem_cabecalho = 'VALOR SINTÉTICO';
  reject(missingCell, 'records[0].source_cells.I');
  const missingValue = fixture(); missingValue.records[0].source_cells.I = 'I2'; delete missingValue.records[0].original_fields.coluna_I_sem_cabecalho;
  reject(missingValue, 'records[0].original_fields.coluna_I_sem_cabecalho');
});

test('received payload must be valid UTF-8 JSON bytes or text, not a parsed object', () => {
  assert.throws(() => reviewCatalogPayload(fixture()), { code: 'invalid_lvt_catalog_payload', path: 'payload' });
  assert.throws(() => reviewCatalogPayload(Buffer.from([0xff])), /UTF-8 inválido/);
  assert.throws(() => reviewCatalogPayload(JSON.stringify(fixture()).replace('Frase sintética A', '\ud800')), /Unicode inválido/);
  const unicode = fixture(); unicode.records[0].original_fields.Dano = 'SINTÉTICO 🔬 演示';
  assert.equal(entry(review(unicode)).original_fields.Dano, 'SINTÉTICO 🔬 演示');
  assert.throws(() => reviewCatalogPayload('{'), /JSON inválido/);
  assert.throws(() => reviewCatalogPayload('null'), /objeto obrigatório/);
});

test('review is deterministic and never mutates caller bytes or source fields', () => {
  const bytes = Buffer.from(JSON.stringify(fixture([row(2), row(3)]))), before = Buffer.from(bytes);
  const first = reviewCatalogPayload(bytes), second = reviewCatalogPayload(bytes);
  assert.deepEqual(first, second);
  assert.deepEqual(bytes, before);
  first.phraseBank.entries[0].original_fields.Dano = 'Alteração somente na saída';
  first.provenance.source.filename = 'Alterado somente na saída';
  assert.deepEqual(reviewCatalogPayload(bytes), second);
});

test('empty phrase bank remains pending and does not fabricate checklist items', () => {
  const result = review(fixture([]));
  assert.equal(result.phraseBank.recordCount, 0);
  assert.deepEqual(result.phraseBank.entries, []);
  assert.deepEqual(result.checklistComposition, { status: 'pending', applicabilityStatus: 'pending', items: null });
});
