"use strict";
// Administrative payload preparation only. This module creates no public route,
// schema/function/grant and performs no network or database operation itself.
const { createHash } = require("node:crypto");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function invalid(message) { throw new TypeError(message); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(label + ": objeto obrigatório");
  return value;
}
function text(value, label, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(label + ": texto obrigatório ou limite excedido");
  return value;
}
function raw(value, label, max = 10000) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) invalid(label + ": texto original inválido");
  return value;
}
function keys(value, allowed, label) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(label + ": campo não permitido");
}
function date(value, label, required = false) {
  if ((value === undefined || value === null || value === "") && !required) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(label + ": data ISO explícita obrigatória");
  const parsed = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(label + ": data inválida");
  return value;
}
function cents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label + ": centavos inteiros não negativos dentro do limite seguro são obrigatórios");
  return value;
}
function cnpjPair(source, prefix) {
  const value = raw(source[prefix + "CnpjRaw"], prefix + "CnpjRaw", 200);
  const digits = value === null ? null : (value.replace(/\D/g, "") || null);
  if (source[prefix + "CnpjDigits"] !== undefined && source[prefix + "CnpjDigits"] !== digits) invalid(prefix + "CnpjDigits diverge da fonte original; não copie/corrija dados");
  // Removing punctuation is a search/display normalization, not checksum validation.
  return { [prefix + "CnpjRaw"]: value, [prefix + "CnpjDigits"]: digits };
}
function uuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) invalid(label + ": UUID explícito obrigatório");
  return value.toLowerCase();
}
function nullOnly(value, label) {
  if (value !== undefined && value !== null) invalid(label + ": ausente na evidência; deve permanecer null");
  return null;
}
function driveURI(value, sourceDocumentId) {
  text(value, "sourceURI", 2000);
  let url;
  try { url = new URL(value); } catch { invalid("sourceURI inválida"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !["drive.google.com", "docs.google.com"].includes(url.hostname)) invalid("sourceURI deve ser HTTPS do Drive, sem credenciais");
  const match = url.pathname.match(/^\/(?:file|document|spreadsheets|presentation)\/d\/([^/]+)(?:\/|$)/);
  const id = match?.[1] || (["/open", "/uc"].includes(url.pathname) ? url.searchParams.get("id") : null);
  if (id !== sourceDocumentId) invalid("sourceURI não corresponde ao sourceDocumentId explícito");
  return value;
}
function normalizeCommercialReference(input, { actorUserId } = {}) {
  object(input, "Referência comercial");
  keys(input, ["recordClass", "name", "modules", "assetIds", "moduleAssetIds", "operationalScopeStatus", "status", "commercial", "reference", "provenance", "userConfirmation", "signedNumber", "signedDate", "validity", "source"], "Referência comercial");
  const actor = uuid(actorUserId, "actorUserId");
  if (input.recordClass !== "commercial_reference" || input.operationalScopeStatus !== "pending" || input.status !== "close_confirmed_by_owner") invalid("Classe/status comercial explícitos obrigatórios");
  if (!Array.isArray(input.modules) || input.modules.length || !Array.isArray(input.assetIds) || input.assetIds.length || !input.moduleAssetIds || typeof input.moduleAssetIds !== "object" || Array.isArray(input.moduleAssetIds) || Object.keys(input.moduleAssetIds).length) invalid("Referência comercial não possui escopo operacional nem ativos");
  const money = object(input.commercial, "commercial");
  keys(money, ["currency", "amountCents", "stages", "issuerNameRaw", "issuerCnpjRaw", "issuerCnpjDigits", "customerNameRaw", "clientNameRaw", "customerCnpjRaw", "customerCnpjDigits", "serviceScopeRaw", "amountBasis", "sourceAmountRaw", "legalNameRaw", "issuerLegalNameRaw", "customerLegalNameRaw"], "commercial");
  if (money.currency !== "BRL") invalid("currency deve ser BRL");
  const amountCents = cents(money.amountCents, "amountCents");
  if (money.amountBasis !== undefined && money.amountBasis !== "owner_confirmed") invalid("amountBasis deve preservar confirmação do titular");
  if (!Array.isArray(money.stages)) invalid("stages deve ser array; vazio significa detalhamento não informado");
  const stages = money.stages.map((stage, index) => {
    object(stage, "stage"); keys(stage, ["position", "label", "amountCents"], "stage");
    if (stage.position !== undefined && stage.position !== index + 1) invalid("position deve preservar a ordem explícita das etapas");
    return { position: index + 1, label: raw(stage.label, "stage.label", 500), amountCents: cents(stage.amountCents, "stage.amountCents") };
  });
  if (stages.length && stages.reduce((sum, stage) => sum + BigInt(stage.amountCents), 0n) !== BigInt(amountCents)) invalid("Soma exata das etapas diverge do valor confirmado");
  const reference = object(input.reference, "reference");
  keys(reference, ["issuer", "number", "revision", "sourceDocumentId", "nature"], "reference");
  if (!["proposal", "critical_analysis"].includes(reference.nature)) invalid("reference.nature inválida");
  const sourceDocumentId = text(reference.sourceDocumentId, "sourceDocumentId", 300);
  const provenance = object(input.provenance, "provenance");
  keys(provenance, ["sourceURI", "documentDateRaw", "sourceDate", "originalBytesVerified", "fileHash", "materializationStatus", "locator", "sourceFieldEvidence", "readableTextVerified", "readableTextSha256", "readableTextHash", "sourceAmountRaw"], "provenance");
  if (provenance.originalBytesVerified !== false || provenance.fileHash !== null || !["not_materialized", "text_available_original_bytes_unverified"].includes(provenance.materializationStatus)) invalid("Sem bytes originais verificados não há hash nem alegação de verificação");
  const readableTextVerified = provenance.readableTextVerified === undefined ? false : provenance.readableTextVerified;
  const readableTextSha256 = provenance.readableTextSha256 === undefined ? (provenance.readableTextHash === undefined ? null : provenance.readableTextHash) : provenance.readableTextSha256;
  if (provenance.readableTextSha256 !== undefined && provenance.readableTextHash !== undefined && provenance.readableTextSha256 !== provenance.readableTextHash) invalid("Hashes de texto legível divergentes");
  if (money.customerNameRaw !== undefined && money.clientNameRaw !== undefined && money.customerNameRaw !== money.clientNameRaw) invalid("Nomes raw do cliente divergentes na mesma referência");
  if (typeof readableTextVerified !== "boolean" || (readableTextSha256 !== null && (!readableTextVerified || typeof readableTextSha256 !== "string" || !/^[a-f0-9]{64}$/.test(readableTextSha256)))) invalid("Hash do texto legível exige sua verificação explícita e não substitui hash dos bytes originais");
  const locator = provenance.locator === undefined || provenance.locator === null ? null : object(provenance.locator, "provenance.locator");
  if (locator && (JSON.stringify(locator).length > 5000 || Object.values(locator).some(value => value !== null && !["string", "number", "boolean"].includes(typeof value)))) invalid("provenance.locator deve preservar coordenadas escalares explícitas");
  const sourceFieldEvidence = provenance.sourceFieldEvidence === undefined ? [] : provenance.sourceFieldEvidence;
  if (!Array.isArray(sourceFieldEvidence)) invalid("sourceFieldEvidence inválido");
  const fieldEvidence = sourceFieldEvidence.map(item => {
    object(item, "sourceFieldEvidence item"); keys(item, ["field", "page"], "sourceFieldEvidence item");
    if (item.page !== undefined && item.page !== null && (!Number.isSafeInteger(item.page) || item.page < 1)) invalid("Página de evidência inválida");
    return { field: text(item.field, "field", 200), ...(item.page === undefined ? {} : { page: item.page }) };
  });
  const confirmation = object(input.userConfirmation, "userConfirmation");
  keys(confirmation, ["actorUserId", "confirmedDate", "confirmedAt", "statement", "evidenceRef", "proceedEvidenceRef"], "userConfirmation");
  if (uuid(confirmation.actorUserId, "userConfirmation.actorUserId") !== actor) invalid("Confirmação pertence a outro usuário");
  const issuer = text(reference.issuer, "reference.issuer", 500);
  return {
    recordClass: "commercial_reference", name: text(input.name, "name", 200), modules: [], assetIds: [], moduleAssetIds: {}, operationalScopeStatus: "pending", status: "close_confirmed_by_owner",
    commercial: { currency: "BRL", amountCents, stages, issuerNameRaw: text(money.issuerNameRaw, "issuerNameRaw", 500), ...cnpjPair(money, "issuer"), customerNameRaw: raw(money.customerNameRaw === undefined ? money.clientNameRaw : money.customerNameRaw, "customerNameRaw", 500), clientNameRaw: raw(money.clientNameRaw === undefined ? money.customerNameRaw : money.clientNameRaw, "clientNameRaw", 500), ...cnpjPair(money, "customer"), serviceScopeRaw: raw(money.serviceScopeRaw, "serviceScopeRaw"), amountBasis: "owner_confirmed", sourceAmountRaw: raw(money.sourceAmountRaw, "sourceAmountRaw", 500), legalNameRaw: raw(money.legalNameRaw, "legalNameRaw", 500), issuerLegalNameRaw: raw(money.issuerLegalNameRaw, "issuerLegalNameRaw", 500), customerLegalNameRaw: raw(money.customerLegalNameRaw, "customerLegalNameRaw", 500) },
    reference: { issuer, number: text(reference.number, "reference.number", 500), revision: raw(reference.revision, "reference.revision", 100), sourceDocumentId, nature: reference.nature },
    provenance: { sourceURI: driveURI(provenance.sourceURI, sourceDocumentId), documentDateRaw: raw(provenance.documentDateRaw, "documentDateRaw", 300), sourceDate: date(provenance.sourceDate, "sourceDate"), originalBytesVerified: false, fileHash: null, materializationStatus: provenance.materializationStatus, readableTextVerified, readableTextSha256, readableTextHash: readableTextSha256, sourceAmountRaw: raw(provenance.sourceAmountRaw, "provenance.sourceAmountRaw", 500), locator: locator === null ? null : { ...locator }, sourceFieldEvidence: fieldEvidence },
    userConfirmation: { actorUserId: actor, confirmedDate: date(confirmation.confirmedDate, "confirmedDate", true), confirmedAt: nullOnly(confirmation.confirmedAt, "confirmedAt"), statement: text(confirmation.statement, "statement"), evidenceRef: text(confirmation.evidenceRef, "evidenceRef", 500), proceedEvidenceRef: text(confirmation.proceedEvidenceRef, "proceedEvidenceRef", 500) },
    signedNumber: nullOnly(input.signedNumber, "signedNumber"), signedDate: nullOnly(input.signedDate, "signedDate"), validity: nullOnly(input.validity, "validity"), source: text(input.source, "source"),
  };
}
function sqlLiteral(value) { return "E'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'"; }
function buildAdministrativeImportSql({ tenantId, ownerId, actorUserId, records }) {
  const tenant = uuid(tenantId, "tenantId"), owner = uuid(ownerId, "ownerId"), actor = uuid(actorUserId, "actorUserId");
  if (!Array.isArray(records) || !records.length || records.length > 20) invalid("Lote comercial deve conter de 1 a 20 referências");
  const payload = JSON.stringify(records.map(record => normalizeCommercialReference(record, { actorUserId: actor })));
  const tag = "$commercial_" + createHash("sha256").update(payload).digest("hex").slice(0, 24) + "$";
  if (payload.includes(tag)) invalid("Delimitador SQL em conflito com dados");
  // For a reviewed administrative SQL operation by the existing authorized database
  // operator only. It grants nothing, impersonates no JWT and creates no stored function.
  return `DO ${tag}
DECLARE
 v_tenant uuid := ${sqlLiteral(tenant)}; v_owner uuid := ${sqlLiteral(owner)}; v_actor uuid := ${sqlLiteral(actor)};
 v_records jsonb := ${sqlLiteral(payload)}::jsonb; v_body jsonb; v_cap jsonb; v_key text; v_sum numeric;
BEGIN
 v_cap := pi_gestao_private.ga_access_for_actor(v_tenant,v_actor);
 IF v_cap->>'write' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Administrative commercial import denied' USING ERRCODE='42501'; END IF;
 PERFORM pi_access_private.tenant_write_guard();
 PERFORM 1 FROM pi_gestao_private.owners WHERE tenant_id=v_tenant AND id=v_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner outside exact tenant scope' USING ERRCODE='22023'; END IF;
 FOR v_body IN SELECT value FROM jsonb_array_elements(v_records) LOOP
   IF v_body->>'recordClass' IS DISTINCT FROM 'commercial_reference' OR v_body->>'status' IS DISTINCT FROM 'close_confirmed_by_owner'
    OR v_body->>'operationalScopeStatus' IS DISTINCT FROM 'pending' OR v_body->'modules'<>'[]'::jsonb OR v_body->'assetIds'<>'[]'::jsonb OR v_body->'moduleAssetIds'<>'{}'::jsonb
    OR v_body->'commercial'->>'currency' IS DISTINCT FROM 'BRL' OR jsonb_typeof(v_body->'commercial'->'amountCents') IS DISTINCT FROM 'number'
    OR (v_body->'commercial'->>'amountCents')::numeric<0 OR (v_body->'commercial'->>'amountCents')::numeric>9007199254740991
    OR trunc((v_body->'commercial'->>'amountCents')::numeric)<>(v_body->'commercial'->>'amountCents')::numeric
    OR v_body->'provenance'->>'originalBytesVerified' IS DISTINCT FROM 'false' OR v_body->'provenance'->'fileHash' IS DISTINCT FROM 'null'::jsonb
    OR v_body->'userConfirmation'->>'actorUserId' IS DISTINCT FROM v_actor::text
   THEN RAISE EXCEPTION 'Commercial payload validation failed' USING ERRCODE='22023'; END IF;
   SELECT sum((value->>'amountCents')::numeric) INTO v_sum FROM jsonb_array_elements(v_body->'commercial'->'stages');
   IF v_sum IS NOT NULL AND v_sum<>(v_body->'commercial'->>'amountCents')::numeric THEN RAISE EXCEPTION 'Commercial stage sum mismatch' USING ERRCODE='22023'; END IF;
   v_key := 'commercial:' || pi_gestao_private.ga_hash(jsonb_build_array(lower(btrim(v_body->'reference'->>'issuer')),v_body->'reference'->>'number',v_body->'reference'->>'revision',v_body->'reference'->>'sourceDocumentId'));
   PERFORM pi_gestao_private.ga_origin_put(v_tenant,v_owner,'contract',v_key,v_body,NULL,v_actor);
 END LOOP;
END
${tag};`;
}
module.exports = { normalizeCommercialReference, buildAdministrativeImportSql };
