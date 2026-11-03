'use strict';

// Pure offline JSON references. No files, originals, geometry, API, permissions,
// physical identity, authentication, signatures or technical approval are checked.
const { createHash } = require('node:crypto');
const SCHEMA = 'pires-inspection-drawing-reference-v1';
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
const SCOPE = ['ownerId', 'contractId', 'systemId', 'assetId', 'lineId'];
const CONTENT = ['scope', 'drawing', 'coordinateFrame', 'references', 'points', 'annotations', 'sketches'];
const SNAPSHOT = ['schema', 'modelVersion', 'snapshotId', 'modelRevision', 'previousSnapshot', 'content', 'draft', 'status', 'approvedAsBuilt', 'canIssue', 'signatures', 'provenance', 'contentDigest'];
const MAX_BYTES = 8 * 1024 * 1024, MAX_HISTORY = 20, MAX_ROWS = 1000, MAX_JSON_DEPTH = 64;
const own = (value, key) => Object.hasOwn(value, key);

function invalid(path, message) {
  const error = new TypeError(path + ': ' + message);
  error.code = 'invalid_inspection_drawing'; error.path = path; throw error;
}
function canonical(value, path = 'input', ancestors = new Set(), depth = 0) {
  if (depth > MAX_JSON_DEPTH) invalid(path, 'JSON excede profundidade máxima de 64 níveis');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    if (!value.isWellFormed()) invalid(path, 'Unicode inválido');
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || ancestors.has(value)) invalid(path, 'somente JSON finito, sem ciclos');
  const array = Array.isArray(value);
  if (array && value.length > MAX_ROWS) invalid(path, 'lista excede o limite de até 1000 referências');
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (!array && proto !== Object.prototype && proto !== null) invalid(path, 'somente objeto JSON simples');
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !('value' in descriptors[key]))) invalid(path, 'acessores e símbolos não são aceitos');
  ancestors.add(value);
  let result;
  if (array) {
    if (Object.keys(value).length !== value.length) invalid(path, 'lista esparsa ou com propriedades extras');
    result = '[' + Array.from({ length: value.length }, (_, index) => canonical(descriptors[index]?.value, path + '[' + index + ']', ancestors, depth + 1)).join(',') + ']';
  } else result = '{' + Object.keys(descriptors).sort().map(key => JSON.stringify(key) + ':' + canonical(descriptors[key].value, path + '.' + key, ancestors, depth + 1)).join(',') + '}';
  ancestors.delete(value); return result;
}
function copy(value) {
  const text = canonical(value);
  if (Buffer.byteLength(text) > MAX_BYTES) invalid('input', 'referências excedem 8 MiB');
  return JSON.parse(text);
}
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
function object(value, path, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'objeto obrigatório');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(path + '.' + key, 'campo não reconhecido');
  for (const key of allowed) if (!own(value, key)) invalid(path + '.' + key, 'campo explícito obrigatório');
  return value;
}
function text(value, path) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) invalid(path, 'texto explícito não vazio de até 512 caracteres obrigatório');
}
function id(value, path) { if (typeof value !== 'string' || !UUID.test(value)) invalid(path, 'UUID canônico minúsculo obrigatório'); }
function rows(value, path) {
  if (!Array.isArray(value) || value.length > MAX_ROWS) invalid(path, 'lista explícita de até 1000 referências obrigatória');
  const seen = new Set();
  value.forEach((row, index) => { id(row?.id, path + '[' + index + '].id'); if (seen.has(row.id)) invalid(path, 'ID repetido'); seen.add(row.id); });
  return value;
}
function ids(value, path) {
  if (!Array.isArray(value) || value.length > MAX_ROWS) invalid(path, 'lista explícita de IDs obrigatória');
  const seen = new Set();
  value.forEach((entry, index) => { id(entry, path + '[' + index + ']'); if (seen.has(entry)) invalid(path, 'ID repetido'); seen.add(entry); });
  return value;
}
function scopeRecord(row, scope, path, extra) {
  object(row, path, ['id', ...SCOPE, ...extra]); id(row.id, path + '.id');
  for (const key of SCOPE) if (row[key] !== scope[key]) invalid(path + '.' + key, 'referência fora do escopo declarado');
}
function drawing(value, path) {
  object(value, path, ['documentId', 'sourceHash', 'number', 'revision', 'sheet']);
  id(value.documentId, path + '.documentId');
  if (typeof value.sourceHash !== 'string' || !/^[a-f\d]{64}$/.test(value.sourceHash)) invalid(path + '.sourceHash', 'SHA-256 relatado de 64 caracteres hexadecimais minúsculos obrigatório');
  for (const key of ['number', 'revision', 'sheet']) text(value[key], path + '.' + key);
}
function validateContent(content) {
  object(content, 'content', CONTENT);
  const { scope, references, points, annotations, sketches } = content;
  object(scope, 'scope', SCOPE); for (const key of SCOPE) id(scope[key], 'scope.' + key);
  drawing(content.drawing, 'drawing');
  const frame = object(content.coordinateFrame, 'coordinateFrame', ['kind', 'origin', 'xAxis', 'yAxis']);
  for (const [key, value] of Object.entries({ kind: 'normalized_2d', origin: 'top_left', xAxis: 'right', yAxis: 'down' })) if (frame[key] !== value) invalid('coordinateFrame.' + key, 'frame normalizado explícito incompatível; nenhuma transformação é inferida');
  object(references, 'references', ['contract', 'asset', 'line', 'items', 'photos', 'rtis']);
  const contract = object(references.contract, 'references.contract', ['id', 'ownerId', 'assetIds']);
  if (contract.id !== scope.contractId || contract.ownerId !== scope.ownerId) invalid('references.contract', 'contrato/cliente divergentes');
  if (!ids(contract.assetIds, 'references.contract.assetIds').includes(scope.assetId)) invalid('references.contract.assetIds', 'TAG não declarada no escopo do contrato');
  const asset = object(references.asset, 'references.asset', ['id', 'ownerId', 'systemId', 'lineId', 'tag']);
  if (asset.id !== scope.assetId || asset.ownerId !== scope.ownerId || asset.systemId !== scope.systemId || asset.lineId !== scope.lineId) invalid('references.asset', 'TAG/linha/sistema/cliente divergentes');
  text(asset.tag, 'references.asset.tag');
  const line = object(references.line, 'references.line', ['id', 'ownerId', 'systemId', 'assetId', 'identifier']);
  if (line.id !== scope.lineId || line.ownerId !== scope.ownerId || line.systemId !== scope.systemId || line.assetId !== scope.assetId) invalid('references.line', 'declaração de linha divergente');
  text(line.identifier, 'references.line.identifier');
  const inspectionByLvt = new Map();
  const itemMap = new Map(rows(references.items, 'references.items').map((item, index) => {
    const path = 'references.items[' + index + ']'; scopeRecord(item, scope, path, ['lvtId', 'inspectionId']); id(item.lvtId, path + '.lvtId'); id(item.inspectionId, path + '.inspectionId');
    if (inspectionByLvt.has(item.lvtId) && inspectionByLvt.get(item.lvtId) !== item.inspectionId) invalid(path + '.inspectionId', 'a mesma LVT não pode declarar inspeções diferentes');
    inspectionByLvt.set(item.lvtId, item.inspectionId); return [item.id, item];
  }));
  const photoMap = new Map(rows(references.photos, 'references.photos').map((photo, index) => {
    const path = 'references.photos[' + index + ']'; scopeRecord(photo, scope, path, ['lvtId', 'lvtItemId']);
    const item = itemMap.get(photo.lvtItemId); if (!item || photo.lvtId !== item.lvtId) invalid(path, 'foto não pertence ao item/LVT declarados'); return [photo.id, photo];
  }));
  const rtiMap = new Map(rows(references.rtis, 'references.rtis').map((rti, index) => {
    const path = 'references.rtis[' + index + ']'; scopeRecord(rti, scope, path, ['lvtId', 'lvtItemId', 'photoIds']);
    const item = itemMap.get(rti.lvtItemId); if (!item || rti.lvtId !== item.lvtId) invalid(path, 'RTI não pertence ao item/LVT declarados');
    for (const photoId of ids(rti.photoIds, path + '.photoIds')) if (photoMap.get(photoId)?.lvtItemId !== item.id) invalid(path, 'foto da RTI pertence a outro item');
    return [rti.id, rti];
  }));
  const pointLabels = new Set();
  const pointMap = new Map(rows(points, 'points').map((point, index) => {
    const path = 'points[' + index + ']'; object(point, path, ['id', 'label', 'position', 'lvtItemId', 'photoIds', 'rtiIds']); text(point.label, path + '.label');
    if (pointLabels.has(point.label.trim())) invalid(path + '.label', 'rótulo de ponto repetido; a identificação deve ser inequívoca'); pointLabels.add(point.label.trim());
    object(point.position, path + '.position', ['x', 'y']);
    for (const axis of ['x', 'y']) if (typeof point.position[axis] !== 'number' || !Number.isFinite(point.position[axis]) || point.position[axis] < 0 || point.position[axis] > 1) invalid(path + '.position.' + axis, 'coordenada explicitamente fornecida deve ser número finito entre 0 e 1');
    if (!itemMap.has(point.lvtItemId)) invalid(path + '.lvtItemId', 'item LVT explícito não encontrado');
    for (const photoId of ids(point.photoIds, path + '.photoIds')) if (photoMap.get(photoId)?.lvtItemId !== point.lvtItemId) invalid(path, 'foto pertence a outro item');
    for (const rtiId of ids(point.rtiIds, path + '.rtiIds')) {
      const rti = rtiMap.get(rtiId); if (!rti || rti.lvtItemId !== point.lvtItemId) invalid(path, 'RTI pertence a outro item');
      if (rti.photoIds.some(photoId => !point.photoIds.includes(photoId))) invalid(path, 'as fotos da RTI vinculada exigem vínculos explícitos no mesmo ponto');
    }
    return [point.id, point];
  }));
  for (const [kind, list] of [['annotations', annotations], ['sketches', sketches]]) rows(list, kind).forEach((entry, index) => {
    const path = kind + '[' + index + ']'; object(entry, path, ['id', 'source', 'pointIds', kind === 'annotations' ? 'text' : 'drawing']);
    if (entry.source !== 'field_survey') invalid(path + '.source', 'somente levantamento de campo pendente de revisão');
    for (const pointId of ids(entry.pointIds, path + '.pointIds')) if (!pointMap.has(pointId)) invalid(path, 'ponto explícito não encontrado nesta revisão');
    if (kind === 'annotations') text(entry.text, path + '.text'); else drawing(entry.drawing, path + '.drawing');
  });
  // Every declaration is selected intentionally. No unlinked references from
  // another execution or historical package are silently copied into a snapshot.
  const selectedItems = new Set(points.map(point => point.lvtItemId));
  const selectedPhotos = new Set(points.flatMap(point => point.photoIds)), selectedRtis = new Set(points.flatMap(point => point.rtiIds));
  for (const [name, records, selected] of [['items', itemMap, selectedItems], ['photos', photoMap, selectedPhotos], ['rtis', rtiMap, selectedRtis]]) for (const key of records.keys()) if (!selected.has(key)) invalid('references.' + name, 'referência sem vínculo explícito a ponto');
  return content;
}
function digest(body) { return 'sha256:' + createHash('sha256').update(canonical(body)).digest('hex'); }
function bodyOf(snapshot) { const { contentDigest, ...body } = snapshot; return body; }
function validateSnapshot(snapshot, depth = 0, seen = new Set()) {
  if (depth >= MAX_HISTORY) invalid('previousSnapshot', 'cadeia excede 20 snapshots');
  object(snapshot, 'snapshot', SNAPSHOT); id(snapshot.snapshotId, 'snapshot.snapshotId');
  if (seen.has(snapshot.snapshotId)) invalid('snapshot.snapshotId', 'ID reutilizado na cadeia'); seen.add(snapshot.snapshotId);
  if (snapshot.schema !== SCHEMA || snapshot.modelVersion !== 1 || !Number.isSafeInteger(snapshot.modelRevision) || snapshot.modelRevision < 1) invalid('snapshot', 'schema/versão local inválidos');
  if (snapshot.draft !== true || snapshot.status !== 'field_survey_pending_review' || snapshot.approvedAsBuilt !== false || snapshot.canIssue !== false || !Array.isArray(snapshot.signatures) || snapshot.signatures.length) invalid('snapshot', 'referência offline não admite emissão, aprovação ou assinatura');
  object(snapshot.provenance, 'snapshot.provenance', ['originalBytesVerified', 'sourceHashStatus', 'relationships']);
  if (snapshot.provenance.originalBytesVerified !== false || snapshot.provenance.sourceHashStatus !== 'reported_unverified' || snapshot.provenance.relationships !== 'caller_declared_consistent_only') invalid('snapshot.provenance', 'originais e relações físicas não foram verificados');
  validateContent(snapshot.content);
  if (snapshot.previousSnapshot === null) { if (snapshot.modelRevision !== 1) invalid('snapshot.modelRevision', 'primeiro snapshot deve ter versão local 1'); }
  else {
    validateSnapshot(snapshot.previousSnapshot, depth + 1, seen);
    if (snapshot.modelRevision !== snapshot.previousSnapshot.modelRevision + 1 || canonical(snapshot.content.scope) !== canonical(snapshot.previousSnapshot.content.scope)) invalid('snapshot.previousSnapshot', 'cadeia exige mesmo escopo e versão local sequencial');
  }
  if (typeof snapshot.contentDigest !== 'string' || snapshot.contentDigest !== digest(bodyOf(snapshot))) invalid('snapshot.contentDigest', 'conteúdo/cadeia diverge do digest local; isto não é assinatura');
  return snapshot;
}

/**
 * Input requires snapshotId plus all CONTENT fields, including explicit empty
 * points/annotations/sketches arrays. References are caller-selected declarations,
 * never authorization or proof of the physical line. Multiple explicit LVTs may
 * be referenced: a packet for one execution must additionally match every item's
 * lvtId/inspectionId to that execution. Positions refer only to the
 * declared, uncropped/unrotated sheet; they do not encode angles or real distances.
 */
function make(input, previous) {
  const selected = copy(input); object(selected, 'input', ['snapshotId', ...CONTENT]); id(selected.snapshotId, 'input.snapshotId');
  const { snapshotId, ...content } = selected; validateContent(content);
  const body = { schema: SCHEMA, modelVersion: 1, snapshotId, modelRevision: previous ? previous.modelRevision + 1 : 1,
    previousSnapshot: previous, content, draft: true, status: 'field_survey_pending_review', approvedAsBuilt: false, canIssue: false, signatures: [],
    provenance: { originalBytesVerified: false, sourceHashStatus: 'reported_unverified', relationships: 'caller_declared_consistent_only' } };
  const result = { ...body, contentDigest: digest(body) }; validateSnapshot(result); return frozen(copy(result));
}
function createDrawingSnapshot(input) { return make(input, null); }
function verifyDrawingSnapshot(snapshot) { return frozen(validateSnapshot(copy(snapshot))); }
// Full new input is mandatory: points, positions, frame, annotations and sketch
// links are never inherited, transformed, reprojected or approved automatically.
function reviseDrawingSnapshot(previous, input) { return make(input, verifyDrawingSnapshot(previous)); }

module.exports = Object.freeze({ SCHEMA, createDrawingSnapshot, verifyDrawingSnapshot, reviseDrawingSnapshot });
