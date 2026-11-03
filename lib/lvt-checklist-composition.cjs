'use strict';

// Pure, offline composition declaration. No engineering applicability rule,
// catalogue installation, source-byte verification or technical approval occurs.
const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { reviewCatalogPayload } = require('./lvt-catalog-review.cjs');
const own = (value, key) => Object.hasOwn(value, key);
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const APPLICABILITY_FIELDS = ['equipment', 'modality', 'procedureReference', 'procedureRevision'];
// Processing bounds only; these are not inspection/checklist applicability rules.
const LIMITS = Object.freeze({ payloadBytes: 8 * 1024 * 1024, declarationBytes: 1024 * 1024,
  depth: 32, nodes: 50000, arrayLength: 1000, sourceRows: 1000, plannedItems: 1000, choices: 1000 });
const TYPED_ARRAY = Object.getPrototypeOf(Uint8Array.prototype);
const typedValue = (input, key) => Object.getOwnPropertyDescriptor(TYPED_ARRAY, key).get.call(input);

function invalid(path, message) {
  const error = new TypeError(path + ': ' + message);
  error.code = 'invalid_lvt_checklist_composition';
  error.path = path;
  throw error;
}
// Descriptor-based copying never reads a caller getter or invokes toJSON.
// Reject unsupported state before any declaration field is consumed.
function jsonSnapshot(input, path, maxBytes) {
  let bytes = 0, nodes = 0;
  const ancestors = new Set();
  const add = (value, currentPath) => {
    bytes += Buffer.byteLength(value);
    if (bytes > maxBytes) invalid(currentPath, 'JSON excede limite de ' + maxBytes + ' bytes; nenhum dado foi truncado');
    return value;
  };
  const encodedText = (value, currentPath) => {
    if (!value.isWellFormed()) invalid(currentPath, 'Unicode inválido');
    if (Buffer.byteLength(value) > maxBytes - bytes) invalid(currentPath, 'texto excede limite de bytes; nenhum dado foi truncado');
    return add(JSON.stringify(value), currentPath);
  };
  function visit(value, currentPath, depth) {
    if (depth > LIMITS.depth) invalid(currentPath, 'profundidade JSON excede ' + LIMITS.depth);
    if (++nodes > LIMITS.nodes) invalid(currentPath, 'quantidade de nós JSON excede ' + LIMITS.nodes);
    if (value === null || typeof value === 'boolean') return add(JSON.stringify(value), currentPath);
    if (typeof value === 'string') return encodedText(value, currentPath);
    if (typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value), currentPath);
    if (!value || typeof value !== 'object' || isProxy(value)) invalid(currentPath, 'somente valores JSON finitos, sem proxies');
    if (ancestors.has(value)) invalid(currentPath, 'ciclo não é JSON');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) invalid(currentPath, 'somente objeto/lista JSON simples');
    if (array && Object.getOwnPropertyDescriptor(value, 'length').value > LIMITS.arrayLength) invalid(currentPath, 'lista excede ' + LIMITS.arrayLength + ' referências');
    const names = Reflect.ownKeys(value);
    if (names.length > LIMITS.nodes - nodes) invalid(currentPath, 'quantidade de nós JSON excede ' + LIMITS.nodes);
    if (names.some(key => typeof key !== 'string')) invalid(currentPath, 'símbolos não são JSON');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of names) if (!own(descriptors[key], 'value')) invalid(currentPath + '.' + key, 'accessor não é aceito; getter/setter não foi executado');
    ancestors.add(value);
    let result;
    if (array) {
      const length = descriptors.length.value;
      if (names.length !== length + 1) invalid(currentPath, 'lista esparsa ou com propriedades extras');
      const values = []; add('[', currentPath);
      for (let index = 0; index < length; index++) {
        if (!own(descriptors, index) || !descriptors[index].enumerable) invalid(currentPath + '[' + index + ']', 'ocorrência JSON ausente');
        if (index) add(',', currentPath);
        values.push(visit(descriptors[index].value, currentPath + '[' + index + ']', depth + 1));
      }
      add(']', currentPath); result = '[' + values.join(',') + ']';
    } else {
      const values = []; add('{', currentPath);
      for (const key of names.sort()) {
        if (!descriptors[key].enumerable) invalid(currentPath + '.' + key, 'propriedade não enumerável não é JSON');
        if (values.length) add(',', currentPath);
        const name = encodedText(key, currentPath); add(':', currentPath);
        values.push(name + ':' + visit(descriptors[key].value, currentPath + '.' + key, depth + 1));
      }
      add('}', currentPath); result = '{' + values.join(',') + '}';
    }
    ancestors.delete(value); return result;
  }
  return JSON.parse(visit(input, path, 0));
}
function boundedReview(input) {
  if (isProxy(input)) invalid('payload', 'proxy não é um payload JSON recebido');
  let received = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > LIMITS.payloadBytes) invalid('payload', 'payload excede limite de bytes');
    if (!input.isWellFormed()) return reviewCatalogPayload(input);
  } else if (ArrayBuffer.isView(input) && input instanceof Uint8Array) {
    const length = typedValue(input, 'byteLength');
    if (length > LIMITS.payloadBytes) invalid('payload', 'payload excede limite de bytes');
    received = Buffer.from(new Uint8Array(typedValue(input, 'buffer'), typedValue(input, 'byteOffset'), length));
  } else return reviewCatalogPayload(input);
  let parsed;
  try { parsed = JSON.parse(typeof received === 'string' ? received : new TextDecoder('utf-8', { fatal: true }).decode(received)); }
  catch { return reviewCatalogPayload(received); }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.records) && parsed.records.length > LIMITS.sourceRows) invalid('payload.records', 'fonte excede ' + LIMITS.sourceRows + ' linhas; nenhum dado foi truncado');
  jsonSnapshot(parsed, 'payload', LIMITS.payloadBytes);
  return reviewCatalogPayload(received);
}
function object(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'objeto obrigatório');
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, 'objeto simples com declaração explícita obrigatório');
  return value;
}
function fields(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(path + '.' + key, 'campo não reconhecido');
}
function text(value, path) {
  if (typeof value !== 'string' || !value.trim() || !value.isWellFormed()) invalid(path, 'texto explícito não vazio e Unicode válido obrigatório');
  return value;
}
function hash(value, path) {
  if (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value)) invalid(path, 'SHA-256 explícito obrigatório');
  return value.toLowerCase();
}
function array(value, path, nonempty = false) {
  if (!Array.isArray(value) || nonempty && !value.length) invalid(path, 'lista explícita' + (nonempty ? ' não vazia' : '') + ' obrigatória');
  for (let index = 0; index < value.length; index++) if (!own(value, index)) invalid(path + '[' + index + ']', 'ocorrência ausente na lista');
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

/**
 * Declare selected source rows as choices of explicitly planned items.
 * rawJsonUtf8 is the received JSON text/bytes accepted by reviewCatalogPayload;
 * a caller-supplied review object is not accepted as proof of payload integrity.
 * version identifies this internal composition, never a report's technical
 * revision. All outputs remain drafts with original-byte verification blocked.
 */
function composeChecklistDraft(rawJsonUtf8, declaration) {
  declaration = jsonSnapshot(declaration, 'declaration', LIMITS.declarationBytes);
  const review = boundedReview(rawJsonUtf8);
  fields(declaration, ['version', 'sourceRef', 'applicability', 'plannedItems'], 'declaration');
  if (!own(declaration, 'version')) invalid('declaration.version', 'declare uma versão interna ou null enquanto vazia');
  if (declaration.version !== null) text(declaration.version, 'declaration.version');
  const ref = declaration.sourceRef;
  fields(ref, ['reportedSha256', 'sheet', 'receivedPayloadSha256'], 'declaration.sourceRef');
  const sourceRef = {
    reportedSha256: hash(ref.reportedSha256, 'declaration.sourceRef.reportedSha256'),
    sheet: text(ref.sheet, 'declaration.sourceRef.sheet'),
    receivedPayloadSha256: hash(ref.receivedPayloadSha256, 'declaration.sourceRef.receivedPayloadSha256'),
  };
  if (sourceRef.reportedSha256 !== review.provenance.reportedSourceHash.sha256.toLowerCase()) invalid('declaration.sourceRef.reportedSha256', 'fonte relatada não corresponde ao payload recebido');
  if (sourceRef.sheet !== review.provenance.source.sheet) invalid('declaration.sourceRef.sheet', 'aba não corresponde ao payload recebido');
  if (sourceRef.receivedPayloadSha256 !== review.provenance.receivedPayload.sha256) invalid('declaration.sourceRef.receivedPayloadSha256', 'digest não corresponde aos bytes JSON recebidos; refaça a revisão');

  array(declaration.plannedItems, 'declaration.plannedItems');
  if (!own(declaration, 'applicability')) invalid('declaration.applicability', 'declare aplicabilidade ou null enquanto vazia');
  let applicability = null;
  if (declaration.applicability !== null) {
    fields(declaration.applicability, APPLICABILITY_FIELDS, 'declaration.applicability');
    applicability = {};
    for (const field of APPLICABILITY_FIELDS) applicability[field] = text(declaration.applicability[field], 'declaration.applicability.' + field);
  }
  if (declaration.plannedItems.length && declaration.version === null) invalid('declaration.version', 'itens planejados exigem versão interna declarada');
  if (declaration.plannedItems.length && applicability === null) invalid('declaration.applicability', 'itens planejados exigem equipamento, modalidade e procedimento/revisão declarados');

  const entries = review.phraseBank.entries, selected = new Set(), plannedKeys = new Set();
  let choiceCount = 0;
  const plannedItems = declaration.plannedItems.map((planned, itemIndex) => {
    const path = 'declaration.plannedItems[' + itemIndex + ']';
    fields(planned, ['key', 'label', 'required', 'sourceRows'], path);
    text(planned.key, path + '.key'); text(planned.label, path + '.label');
    if (plannedKeys.has(planned.key)) invalid(path + '.key', 'chave de item planejado repetida');
    plannedKeys.add(planned.key);
    if (typeof planned.required !== 'boolean') invalid(path + '.required', 'obrigatoriedade deve ser declarada explicitamente');
    array(planned.sourceRows, path + '.sourceRows', true);
    choiceCount += planned.sourceRows.length;
    if (choiceCount > LIMITS.choices) invalid(path + '.sourceRows', 'composição excede ' + LIMITS.choices + ' escolhas; nenhum dado foi truncado');
    const itemSelections = new Set();
    const choices = planned.sourceRows.map((selection, choiceIndex) => {
      const choicePath = path + '.sourceRows[' + choiceIndex + ']';
      fields(selection, ['sourceRecordId', 'payloadIndex'], choicePath);
      text(selection.sourceRecordId, choicePath + '.sourceRecordId');
      if (!Number.isSafeInteger(selection.payloadIndex) || selection.payloadIndex < 0 || selection.payloadIndex >= entries.length) invalid(choicePath + '.payloadIndex', 'ocorrência desconhecida no payload revisado');
      const entry = entries[selection.payloadIndex];
      if (selection.sourceRecordId !== entry.sourceRecordId) invalid(choicePath + '.sourceRecordId', 'ID não corresponde à linha/ocorrência do payload revisado');
      if (itemSelections.has(selection.payloadIndex)) invalid(choicePath + '.payloadIndex', 'mesma ocorrência repetida no item; linhas duplicadas distintas possuem ocorrências próprias');
      itemSelections.add(selection.payloadIndex); selected.add(selection.payloadIndex);
      const sourceRowRef = {
        sourceRecordId: entry.sourceRecordId, payloadIndex: entry.payloadIndex,
        source_row: entry.source_row, source_cells: clone(entry.source_cells),
      };
      // Same phrase text at two source coordinates remains two separate choices.
      const id = 'lvt-choice-' + sha256(canonical({ sourceRef, plannedItemKey: planned.key, sourceRowRef, original_fields: entry.original_fields }));
      return {
        id, sourceRowRef, original_fields: clone(entry.original_fields),
        ambiguities: [...entry.ambiguities], sourceFlags: clone(entry.flags),
        technicalReviewStatus: 'pending', recommendationHandling: 'no_automatic_action',
      };
    });
    return {
      id: 'lvt-planned-item-' + sha256(canonical({ sourceRef, key: planned.key })),
      key: planned.key, label: planned.label, required: planned.required, choices,
    };
  });

  const unselectedSourceRows = entries.filter(entry => !selected.has(entry.payloadIndex)).map(entry => ({
    sourceRecordId: entry.sourceRecordId, payloadIndex: entry.payloadIndex,
    source_row: entry.source_row, status: 'not_selected_for_this_draft',
  }));
  const identity = {
    formatVersion: 1, sourceRef, version: declaration.version, applicability,
    sourceMetadata: clone(review.provenance.source), sourceScope: review.scope,
    sourceUsageLimits: [...review.usage_limits], plannedItems,
  };
  return {
    mode: 'offline_composition_draft',
    status: plannedItems.length ? 'draft' : 'pending',
    version: declaration.version,
    versionMeaning: 'internal_composition_version_not_technical_report_revision',
    compositionDigest: sha256(canonical(identity)), digestBasis: 'canonical_declared_composition_v1',
    provenance: {
      sourceRef, sourceMetadata: clone(review.provenance.source),
      reportedSourceHash: clone(review.provenance.reportedSourceHash),
      receivedPayload: clone(review.provenance.receivedPayload),
    },
    applicability: { status: applicability === null ? 'pending' : 'declared_unverified', declaration: applicability },
    phraseBank: { recordCount: entries.length, selectedSourceRowCount: selected.size, unselectedSourceRows },
    plannedItems,
    technicalReviewStatus: 'pending',
    sourceByteVerification: { status: 'blocked', originalBytesVerified: false },
    operationalUse: 'blocked',
    blockers: ['source_byte_verification_blocked', 'technical_composition_review_pending', ...(plannedItems.length ? [] : ['composition_empty'])],
    limits: [
      'A composição usa somente escolhas declaradas; grupos e quantidade de frases não definem itens obrigatórios.',
      'Aplicabilidade declarada não comprova adequação técnica ao equipamento, modalidade ou procedimento.',
      'Linhas não selecionadas continuam no banco; nenhuma exclusão de aplicabilidade foi inferida.',
      'Duplicatas, textos, lacunas e ambiguidades da fonte permanecem rastreáveis.',
      'Versão e digest identificam o rascunho interno; não são revisão técnica, assinatura ou aprovação.',
      'Sem instalação, ativação, interpretação de recomendação como ação, prazo, risco ou disciplina inferidos.',
    ],
  };
}

module.exports = Object.freeze({ LIMITS, composeChecklistDraft });
