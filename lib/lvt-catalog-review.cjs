'use strict';

// Offline review of a received JSON export. This module neither reads originals
// nor installs a catalogue, composes a checklist, approves phrases or opens RTIs.
const { createHash } = require('node:crypto');

const COLUMNS = Object.freeze({
  A: 'Item', B: 'Condição', C: 'Dano', D: 'Recomendação',
  E: 'Damage', F: 'Recommendation', G: 'Prazos', H: 'Deadlines',
});
const UNNAMED_COLUMN = 'coluna_I_sem_cabecalho';
const own = (value, key) => Object.hasOwn(value, key);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

function invalid(path, message) {
  const error = new TypeError(path + ': ' + message);
  error.code = 'invalid_lvt_catalog_payload';
  error.path = path;
  throw error;
}
function object(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'objeto obrigatório');
  return value;
}
function keys(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(path + '.' + key, 'campo não reconhecido');
}
function string(value, path, nonempty = false) {
  if (typeof value !== 'string' || nonempty && !value.trim()) invalid(path, 'texto' + (nonempty ? ' não vazio' : '') + ' obrigatório');
  return value;
}
function strings(value, path) {
  if (!Array.isArray(value)) invalid(path, 'lista de textos obrigatória');
  value.forEach((entry, index) => string(entry, path + '[' + index + ']'));
}
function rawPayload(input) {
  if (typeof input !== 'string' && !(input instanceof Uint8Array)) invalid('payload', 'forneça o texto JSON UTF-8 recebido ou seus bytes, não um objeto reserializado');
  if (typeof input === 'string' && !input.isWellFormed()) invalid('payload', 'Unicode inválido: preserve o texto recebido sem substituir caracteres');
  const bytes = Buffer.from(input);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { invalid('payload', 'UTF-8 inválido'); }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { invalid('payload', 'JSON inválido'); }
  return { bytes, parsed };
}
function placeholder(value) {
  return !value.trim() || /^(?:[-–—]|0(?:\.0+)?)$/.test(value.trim());
}
function explicitNoRecommendation(value) {
  const normalized = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .trim().replace(/[.!;:]+$/u, '').trim().replace(/\s+/gu, ' ');
  return ['sem recomendacao', 'sem recomendacoes', 'nenhuma recomendacao', 'nao se aplica', 'n/a', 'no recommendation', 'no recommendations', 'not applicable'].includes(normalized);
}
function duplicateGroups(entries, tuple) {
  const groups = new Map();
  for (const entry of entries) {
    const value = tuple(entry), key = JSON.stringify(value);
    if (!groups.has(key)) groups.set(key, { key: value, occurrences: [] });
    groups.get(key).occurrences.push({ payloadIndex: entry.payloadIndex, sourceRow: entry.source_row, sourceRecordId: entry.sourceRecordId });
  }
  return [...groups.values()].filter(group => group.occurrences.length > 1);
}

/**
 * Inspect the exact received JSON text/bytes without any I/O or activation.
 * The received-payload digest identifies only the supplied bytes; it does not
 * independently verify a Library original. The source.sha256 carried by the
 * payload remains a reported workbook hash, separate from the JSON digest.
 * Source-row IDs deliberately ignore phrase text: editing a phrase cannot
 * silently turn the same source coordinates into a different source identity.
 */
function reviewCatalogPayload(input) {
  const { bytes, parsed } = rawPayload(input);
  const payload = object(parsed, 'payload');
  keys(payload, ['source', 'scope', 'usage_limits', 'record_count', 'records'], 'payload');
  const source = object(payload.source, 'source');
  keys(source, ['filename', 'sheet', 'sha256', 'modified_time', 'revision_id', 'drive_id', 'url'], 'source');
  for (const field of ['filename', 'sheet', 'sha256']) string(source[field], 'source.' + field, true);
  if (!/^[a-f\d]{64}$/i.test(source.sha256)) invalid('source.sha256', 'SHA-256 relatado deve conter 64 caracteres hexadecimais');
  for (const field of ['modified_time', 'revision_id', 'drive_id', 'url']) {
    if (own(source, field) && source[field] !== null) string(source[field], 'source.' + field);
  }
  string(payload.scope, 'scope', true);
  strings(payload.usage_limits, 'usage_limits');
  if (!Array.isArray(payload.records)) invalid('records', 'lista obrigatória');
  if (!Number.isSafeInteger(payload.record_count) || payload.record_count < 0 || payload.record_count !== payload.records.length) invalid('record_count', 'contagem inteira deve coincidir com records.length');

  const entries = payload.records.map((record, payloadIndex) => {
    const path = 'records[' + payloadIndex + ']';
    object(record, path);
    keys(record, ['source_row', 'source_cells', 'original_fields', 'ambiguities'], path);
    if (!Number.isSafeInteger(record.source_row) || record.source_row < 1 || record.source_row > 1048576) invalid(path + '.source_row', 'linha Excel inteira válida obrigatória');
    const cells = object(record.source_cells, path + '.source_cells');
    keys(cells, [...Object.keys(COLUMNS), 'I'], path + '.source_cells');
    for (const column of Object.keys(COLUMNS)) {
      if (cells[column] !== column + record.source_row) invalid(path + '.source_cells.' + column, 'célula deve corresponder à coluna e à linha declaradas');
    }
    if (own(cells, 'I') && cells.I !== 'I' + record.source_row) invalid(path + '.source_cells.I', 'célula deve corresponder à coluna e à linha declaradas');
    const fields = object(record.original_fields, path + '.original_fields');
    keys(fields, [...Object.values(COLUMNS), UNNAMED_COLUMN], path + '.original_fields');
    for (const field of Object.values(COLUMNS)) string(fields[field], path + '.original_fields.' + field);
    if (own(fields, UNNAMED_COLUMN) && fields[UNNAMED_COLUMN] !== null) string(fields[UNNAMED_COLUMN], path + '.original_fields.' + UNNAMED_COLUMN);
    if (own(cells, 'I') && !own(fields, UNNAMED_COLUMN)) invalid(path + '.original_fields.' + UNNAMED_COLUMN, 'preserve o valor, inclusive null, da coluna I referenciada');
    if (!own(cells, 'I') && own(fields, UNNAMED_COLUMN) && fields[UNNAMED_COLUMN] !== null && fields[UNNAMED_COLUMN] !== '') invalid(path + '.source_cells.I', 'valor da coluna I exige sua célula de origem');
    strings(record.ambiguities, path + '.ambiguities');

    const cellIdentity = [...Object.keys(COLUMNS), 'I'].filter(column => own(cells, column)).map(column => [column, cells[column]]);
    const sourceRecordId = 'lvt-source-row-' + sha256(JSON.stringify([source.sha256.toLowerCase(), source.sheet, record.source_row, cellIdentity]));
    const flags = [];
    const gaps = Object.values(COLUMNS).filter(field => placeholder(fields[field]));
    if (gaps.length) flags.push({ code: 'source_field_gap', fields: gaps });
    if (explicitNoRecommendation(fields.Recomendação)) flags.push({ code: 'explicit_no_recommendation', fields: ['Recomendação'] });
    if (explicitNoRecommendation(fields.Recommendation)) flags.push({ code: 'explicit_no_recommendation', fields: ['Recommendation'] });
    if (placeholder(fields.Recomendação) || placeholder(fields.Recommendation)) flags.push({ code: 'recommendation_gap', fields: ['Recomendação', 'Recommendation'].filter(field => placeholder(fields[field])) });
    flags.push({ code: 'deadline_not_inferred', fields: ['Prazos', 'Deadlines'] });
    if (own(fields, UNNAMED_COLUMN) && fields[UNNAMED_COLUMN] !== null && fields[UNNAMED_COLUMN].trim()) flags.push({ code: 'unnamed_source_column', column: 'I' });
    if (record.ambiguities.length) flags.push({ code: 'source_ambiguities', count: record.ambiguities.length });
    return {
      payloadIndex, sourceRecordId, source_row: record.source_row,
      source_cells: clone(cells), original_fields: clone(fields), ambiguities: [...record.ambiguities],
      reviewStatus: 'pending_technical_review', flags,
    };
  });

  // Match raw text exactly. Normalization must not merge distinguishable source
  // phrases, and identical phrases at different coordinates remain separate rows.
  const exactDuplicates = duplicateGroups(entries, entry => ['Item', 'Condição', 'Dano', 'Recomendação'].map(field => entry.original_fields[field]));
  const sameConditionDamage = duplicateGroups(entries, entry => ['Item', 'Condição', 'Dano'].map(field => entry.original_fields[field]));
  const repeatedSourceAnchors = duplicateGroups(entries, entry => [entry.sourceRecordId]);
  for (const [groups, code] of [[exactDuplicates, 'duplicate_phrase_tuple'], [sameConditionDamage, 'repeated_item_condition_damage'], [repeatedSourceAnchors, 'repeated_source_anchor']]) {
    for (const group of groups) for (const occurrence of group.occurrences) entries[occurrence.payloadIndex].flags.push({ code, payloadIndexes: group.occurrences.map(entry => entry.payloadIndex) });
  }
  const metadataGaps = ['modified_time', 'revision_id', 'drive_id', 'url'].filter(field => !own(source, field) || source[field] === null || source[field] === '');
  return {
    mode: 'offline_review_only',
    provenance: {
      source: clone(source),
      reportedSourceHash: { sha256: source.sha256, status: 'reported_unverified', originalBytesVerified: false },
      receivedPayload: { sha256: sha256(bytes), byteLength: bytes.length, hashBasis: 'received_utf8_json_bytes', originalFileBytesVerified: false },
      metadataGaps,
    },
    scope: payload.scope, usage_limits: [...payload.usage_limits],
    phraseBank: {
      recordCount: entries.length,
      distinctSourceRowCount: new Set(entries.map(entry => entry.source_row)).size,
      itemLabels: [...new Set(entries.map(entry => entry.original_fields.Item))],
      entries,
    },
    duplicates: { exactPhraseTuples: exactDuplicates, itemConditionDamage: sameConditionDamage, sourceAnchors: repeatedSourceAnchors },
    checklistComposition: { status: 'pending', applicabilityStatus: 'pending', items: null },
    technicalReviewStatus: 'pending',
    limits: [
      'Banco de frases não é composição de checklist nem prova de aplicabilidade por TAG.',
      'Hash relatado na fonte e digest do payload recebido não verificam bytes originais.',
      'Textos, lacunas e duplicatas permanecem preservados para revisão técnica.',
      'Condição da fonte não define risco, aprovação ou situação atual de outro ativo.',
      'Coluna I sem cabeçalho permanece sem significado atribuído; não é disciplina.',
      'Nenhum prazo, aprovação, ação de RTI ou instalação de catálogo é inferido.',
    ],
  };
}

module.exports = Object.freeze({ reviewCatalogPayload });
