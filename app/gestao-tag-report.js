(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresGestaoTagReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const SCHEMA = "pires-tag-visual-conference-v1", UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024, MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024, MAX_TOTAL_PIXELS = 134217728;
  const scopeKeys = ["ownerId", "contractId", "systemId", "assetId", "inspectionId", "executionId"];
  const outcomes = new Set(["pending", "good_condition", "treatment_required", "technical_review"]);
  const own = (value, key) => Object.hasOwn(value, key);
  function canonical(value, ancestors = new Set(), budget = { remaining: 5 * 1024 * 1024 }, exact = false) {
    const spend = (length) => { budget.remaining -= length; if (budget.remaining < 0) throw Error("Recorte excede o limite de conferência."); };
    const take = (text) => { spend(text.length); return text; };
    if (typeof value === "string" && value.length > budget.remaining) throw Error("Recorte excede o limite de conferência.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return take(JSON.stringify(value));
    if (typeof value === "number" && Number.isFinite(value)) return take(JSON.stringify(value));
    if (!value || typeof value !== "object" || ancestors.has(value)) throw Error("O recorte deve conter somente dados JSON sem ciclos.");
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (!array && proto !== Object.prototype && proto !== null || Reflect.ownKeys(descriptors).some((key) => !("value" in descriptors[key]))) throw Error("Objeto de conferência inválido.");
    ancestors.add(value);
    const keys = array ? null : Object.keys(descriptors).sort().filter((key) => (exact || key !== "generatedAt") && descriptors[key].value !== undefined);
    spend(2 + Math.max(0, (array ? value.length : keys.length) - 1));
    const result = array ? "[" + Array.from({ length: value.length }, (_, i) => descriptors[i]?.value === undefined ? take("null") : canonical(descriptors[i].value, ancestors, budget, exact)).join(",") + "]"
      : "{" + keys.map((key) => take(JSON.stringify(key) + ":") + canonical(descriptors[key].value, ancestors, budget, exact)).join(",") + "}";
    ancestors.delete(value); return result;
  }
  const clone = (value) => JSON.parse(canonical(value));
  const exactJSON = (value) => canonical(value, new Set(), { remaining: 5 * 1024 * 1024 }, true), cloneExact = (value) => JSON.parse(exactJSON(value));
  function deepFreeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
  async function hash(value) {
    const crypto = root.crypto || (typeof require === "function" ? require("node:crypto").webcrypto : null);
    if (!crypto?.subtle) throw Error("A conferência de integridade do conteúdo está indisponível.");
    const serialized = hasBinding(field(field(value, "content"), "execution")) ? exactJSON(value) : canonical(value);
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized)));
    return "sha256:" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function collection(value, name) {
    if (!Array.isArray(value) || value.length > 2000) throw Error("Coleção de conferência inválida: " + name);
    const ids = new Set();
    for (const row of value) { if (!row || !UUID.test(row.id || "") || ids.has(row.id)) throw Error("Identidade ausente ou repetida em " + name); ids.add(row.id); }
    return value;
  }
  const field = (record, key) => record && typeof record === "object" ? Object.getOwnPropertyDescriptor(record, key)?.value : undefined;
  function arrayShape(rows, name) { if (!Array.isArray(rows)) throw Error("Coleção de conferência inválida: " + name); return rows; }
  function select(rows, predicate, name, limit = 2000) {
    const result = [];
    for (let index = 0; index < rows.length; index++) { const row = field(rows, String(index)); if (predicate(row)) { if (result.length >= limit) throw Error("Coleção do recorte excede o limite: " + name); result.push(row); } }
    return result;
  }
  function exact(rows, id, name) {
    const found = select(rows, (row) => field(row, "id") === id, name, 1);
    if (!found.length) throw Error(name + " não encontrado pelo ID explícito."); return found[0];
  }
  function selectedIdentities(rows, selected, name) {
    const ids = new Set();
    for (const row of selected) { const id = field(row, "id"); if (!UUID.test(id || "") || ids.has(id)) throw Error("Identidade ausente ou repetida em " + name); ids.add(id); }
    const seen = new Set();
    for (let index = 0; index < rows.length; index++) { const id = field(field(rows, String(index)), "id"); if (ids.has(id)) { if (seen.has(id)) throw Error("ID selecionado colide com outro registro em " + name); seen.add(id); } }
  }
  function sameScope(record, scope, required = []) {
    for (const key of ["ownerId", "contractId", "systemId", "assetId", "inspectionId", "executionId"])
      if (required.includes(key) ? record[key] !== scope[key] : record[key] !== undefined && record[key] !== null && record[key] !== scope[key]) throw Error("Registro fora do escopo: " + key);
    if (record.clientId && record.clientId !== scope.ownerId || record.module && record.module !== "integridade") throw Error("Registro pertence a outro cliente ou módulo.");
  }
  const sorted = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  function outcomeOf(execution) {
    if (execution.outcome === undefined || execution.outcome === null) return "pending";
    if (!outcomes.has(execution.outcome)) throw Error("Resultado declarado da inspeção inválido.");
    return execution.outcome;
  }
  const sameIds = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id));
  function coverageOf(content, photoMap) {
    const coverage = content.execution.coverage;
    if (coverage === undefined || coverage === null) return null;
    // The saved textarea may contain LF/CR/TAB; preserve them as in the form.
    if (!coverage || typeof coverage !== "object" || Array.isArray(coverage) || Object.keys(coverage).some((key) => !["extent", "description", "photoIds"].includes(key))
      || !["declared_section", "declared_entire_line"].includes(coverage.extent) || typeof coverage.description !== "string" || !coverage.description.trim() || coverage.description.length > 2000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(coverage.description) || !Array.isArray(coverage.photoIds) || coverage.photoIds.length > 1000 || new Set(coverage.photoIds).size !== coverage.photoIds.length) throw Error("Cobertura exige trecho ou linha integral explicitamente declarados, descrição e fotos selecionadas.");
    const selected = new Set((content.execution.answers || []).flatMap((answer) => answer.photoIds || []));
    for (const id of coverage.photoIds) if (!UUID.test(id || "") || !selected.has(id) || !photoMap.has(id)) throw Error("Foto de cobertura não pertence às respostas da mesma TAG e inspeção.");
    return coverage;
  }
  function validatePoints(content, itemMap, photoMap) {
    const points = content.points || [], pointMap = new Map(collection(points, "pontos de campo").map((point) => [point.id, point]));
    const pointKeys = new Set(["id", "version", "kind", "recordClass", ...scopeKeys, "clientId", "module", "lvtId", "lvtItemId", "campaignId", "label", "photoIds", "drawingReference", "locationStatus", "source", "createdAt", "createdBy", "updatedAt", "updatedBy"]);
    for (const point of points) {
      sameScope(point, content.scope, ["contractId", "systemId", "assetId", "inspectionId", "executionId"]);
      if (Object.keys(point).some((key) => !pointKeys.has(key)) || point.recordClass !== "field_point_reference" || point.kind && point.kind !== "document" || point.lvtId !== content.execution.id || !itemMap.has(point.lvtItemId) || point.campaignId !== content.execution.campaignId
        || typeof point.label !== "string" || !point.label.trim() || point.label.length > 200 || /[\u0000-\u001f\u007f]/.test(point.label)
        || point.drawingReference !== null || point.locationStatus !== "pending_drawing_reference" || !Array.isArray(point.photoIds) || new Set(point.photoIds).size !== point.photoIds.length) throw Error("Referência de campo sem identidade, escopo ou estado documental válido.");
      for (const id of point.photoIds) if (!photoMap.has(id) || photoMap.get(id).lvtItemId !== point.lvtItemId) throw Error("Foto do ponto pertence a outro item ou execução.");
    }
    const check = (row, itemId, comparePhotos = false) => {
      if (!row.pointId) { if (row.pointLinkStatus === "linked_field_reference") throw Error("Referência de ponto declarada vinculada sem ID canônico."); return null; }
      const point = pointMap.get(row.pointId);
      if (!point || point.lvtItemId !== itemId || row.pointLabel !== point.label || row.pointLinkStatus !== "linked_field_reference" || row.pointVersion !== point.version) throw Error("Vínculo ou versão do ponto diverge da referência de campo canônica.");
      if (comparePhotos && !sameIds(row.photoIds, point.photoIds)) throw Error("Fotos selecionadas do item divergem da referência de campo.");
      return point;
    };
    for (const answer of content.execution.answers || []) {
      const shell = content.execution.items.find((entry) => entry.catalogItemId === answer.catalogItemId), item = shell && itemMap.get(shell.lvtItemId);
      if (!item) continue;
      const point = check(answer, item.id, true); check(item, item.id, true);
      if ((answer.pointId || null) !== (item.pointId || null) || (answer.pointLabel || null) !== (item.pointLabel || null) || (answer.pointLinkStatus || null) !== (item.pointLinkStatus || null)) throw Error("Ponto salvo do item diverge da resposta da execução.");
      if (answer.requiresTreatment === true && answer.actionabilityStatus === "catalog_declared" && !point) throw Error("Tratativa exige referência de ponto de campo canônica; localização no desenho continua pendente.");
    }
    for (const row of [...content.findings, ...content.rtis]) {
      check(row, row.lvtItemId);
      if (row.photoIds !== undefined) for (const id of row.photoIds) if (!photoMap.has(id) || photoMap.get(id).lvtItemId !== row.lvtItemId) throw Error("Evidência de achado ou RTI pertence a outro item ou execução.");
    }
    return pointMap;
  }
  const bindingKeys = ["catalogBindingId", "catalogHash", "catalogVersion"];
  const hasBinding = (execution) => bindingKeys.some((key) => field(execution, key) !== undefined && field(execution, key) !== null);
  function validateCatalogBinding(content) {
    const { execution, catalog, catalogBinding: binding, scope, inspection, asset } = content;
    if (!hasBinding(execution)) { if (binding !== undefined) throw Error("Metadados de vínculo sem ponteiros explícitos na execução."); return null; }
    const metadataKeys = ["status", "id", "catalogId", "contentHash", "versionLabel", "procedureReference", "selectedAt", "selectedBy", "selectionVersion", "scope"],
      catalogKeys = ["id", "tenantId", "ownerId", "status", "versionLabel", "procedureReference", "applicability", "items", "source", "verifiedAt"],
      pinnedScopeKeys = ["ownerId", "inspectionId", "contractId", "systemId", "assetId", "inspectionType", "assetType"];
    if (!binding || Object.keys(binding).some((key) => !metadataKeys.includes(key)) || metadataKeys.some((key) => !own(binding, key))
      || binding.status !== "pinned" || !UUID.test(binding.id || "") || binding.id !== execution.catalogBindingId || !UUID.test(binding.catalogId || "") || binding.catalogId !== execution.catalogId
      || !/^[a-f0-9]{64}$/.test(binding.contentHash || "") || binding.contentHash !== execution.catalogHash || typeof binding.versionLabel !== "string" || !binding.versionLabel.trim() || binding.versionLabel !== execution.catalogVersion
      || typeof binding.procedureReference !== "string" || !binding.procedureReference.trim() || !UUID.test(binding.selectedBy || "") || typeof binding.selectedAt !== "string" || !Number.isFinite(Date.parse(binding.selectedAt)) || !Number.isSafeInteger(binding.selectionVersion) || binding.selectionVersion < 1 || binding.selectionVersion > inspection.version
      || !binding.scope || Object.keys(binding.scope).some((key) => !pinnedScopeKeys.includes(key)) || pinnedScopeKeys.some((key) => !own(binding.scope, key))) throw Error("Vínculo imutável do catálogo ausente ou divergente dos ponteiros salvos da execução.");
    for (const key of ["ownerId", "inspectionId", "contractId", "systemId", "assetId"]) if (binding.scope[key] !== scope[key]) throw Error("Vínculo do catálogo pertence a outro escopo de inspeção.");
    if (binding.scope.inspectionType !== inspection.type || binding.scope.assetType !== asset.type || Object.keys(catalog).some((key) => !catalogKeys.includes(key)) || catalogKeys.some((key) => !own(catalog, key))
      || catalog.id !== binding.catalogId || catalog.ownerId !== scope.ownerId || !UUID.test(catalog.tenantId || "") || catalog.status !== "verified" || catalog.versionLabel !== binding.versionLabel || catalog.procedureReference !== binding.procedureReference
      || !catalog.applicability || typeof catalog.applicability !== "object" || Array.isArray(catalog.applicability) || !catalog.source || typeof catalog.source !== "object" || Array.isArray(catalog.source) || typeof catalog.verifiedAt !== "string" || !Number.isFinite(Date.parse(catalog.verifiedAt))) throw Error("Snapshot fixado do catálogo diverge do vínculo, procedimento ou escopo da inspeção.");
    // contentHash is PostgreSQL's opaque JSON token. Equality here cross-checks
    // saved SQL responses; this helper does not recompute it using JS ordering.
    return binding;
  }
  function validateContent(content) {
    const { scope, company, contract, system, asset, inspection, execution, items, photos, findings, rtis, catalog, recordVersions } = content;
    if (!scope || scopeKeys.some((key) => !UUID.test(scope[key] || ""))) throw Error("Identifique cliente, contrato, sistema, TAG, inspeção e execução por ID.");
    if (company?.id !== scope.ownerId || contract?.id !== scope.contractId || system?.id !== scope.systemId || asset?.id !== scope.assetId || inspection?.id !== scope.inspectionId || execution?.id !== scope.executionId) throw Error("Identidades canônicas divergentes.");
    sameScope(asset, scope, ["systemId"]); sameScope(inspection, scope, ["contractId", "systemId", "assetId"]); sameScope(execution, scope, ["contractId", "systemId", "assetId", "inspectionId"]);
    if (inspection.type !== "visual" || execution.type !== "visual" || execution.recordClass !== "field_lvt" || execution.executionVersion !== 1 || inspection.module !== "integridade") throw Error("Este rascunho aceita somente a execução visual explícita; espessura tem documento separado.");
    if (inspection.campaignId !== execution.campaignId || execution.inspectorProfessionalId && inspection.assigneeProfessionalId !== execution.inspectorProfessionalId) throw Error("Campanha ou responsável diverge da atividade.");
    validateCatalogBinding(content);
    const shells = execution.items || [], answers = execution.answers || [];
    if (!Array.isArray(shells) || !Array.isArray(answers) || shells.length > 1000 || answers.length > 1000) throw Error("Itens ou respostas inválidos.");
    const shellIds = new Set(), catalogIds = new Set(), answerIds = new Set(), outcome = outcomeOf(execution);
    for (const shell of shells) { if (!UUID.test(shell.lvtItemId || "") || !shell.catalogItemId || shellIds.has(shell.lvtItemId) || catalogIds.has(shell.catalogItemId)) throw Error("Identidade do item da execução inválida."); shellIds.add(shell.lvtItemId); catalogIds.add(shell.catalogItemId); }
    const itemMap = new Map(collection(items, "itens").map((item) => [item.id, item])), photoMap = new Map(collection(photos, "fotos").map((photo) => [photo.id, photo]));
    if (itemMap.size !== shellIds.size) throw Error("Item da execução ausente do recorte salvo.");
    for (const shell of shells) { const item = itemMap.get(shell.lvtItemId); if (!item || item.catalogItemId !== shell.catalogItemId || item.lvtId !== execution.id || item.itemKey !== shell.itemKey) throw Error("Item não pertence à execução visual selecionada."); sameScope(item, scope, ["contractId", "systemId", "assetId", "inspectionId"]); }
    for (const row of [...collection(photos, "fotos"), ...collection(findings, "achados"), ...collection(rtis, "RTIs")]) {
      sameScope(row, scope, ["contractId", "systemId", "assetId", "inspectionId"]);
      if (!itemMap.has(row.lvtItemId) || row.lvtId !== execution.id || row.campaignId !== execution.campaignId) throw Error("Foto, achado ou RTI não pertence ao item da execução selecionada.");
      if (row.kind === "finding" && row.executionId !== execution.id) throw Error("Achado sem vínculo à execução selecionada.");
    }
    const findingMap = new Map(findings.map((row) => [row.id, row]));
    for (const rti of rtis) if (!findingMap.has(rti.findingId) || findingMap.get(rti.findingId).lvtItemId !== rti.lvtItemId) throw Error("RTI sem achado canônico do mesmo item.");
    let treatmentCount = 0;
    for (const answer of answers) {
      if (!catalogIds.has(answer.catalogItemId) || answerIds.has(answer.catalogItemId) || typeof answer.notCovered !== "boolean" || !Array.isArray(answer.photoIds)) throw Error("Resposta sem identidade ou escolha explícita."); answerIds.add(answer.catalogItemId);
      const shell = shells.find((entry) => entry.catalogItemId === answer.catalogItemId), item = itemMap.get(shell.lvtItemId), definition = catalog.items?.find((entry) => entry.id === answer.catalogItemId);
      if (catalog.status !== "verified" || catalog.id !== execution.catalogId || !definition || answer.itemKey !== item.itemKey) throw Error("Resposta não corresponde ao catálogo da execução.");
      if ((item.conditionId || null) !== (answer.conditionId || null) || (item.recommendationId || null) !== (answer.recommendationId || null)) throw Error("Escolhas salvas do item divergem da execução.");
      if (answer.notCovered && (answer.conditionId || answer.recommendationId)) throw Error("Condição não contemplada não admite escolha presumida.");
      if (answer.conditionId && !definition.conditions?.some((entry) => entry.id === answer.conditionId) || answer.recommendationId && (!answer.conditionId || !definition.recommendations?.some((entry) => entry.id === answer.recommendationId && (!Array.isArray(entry.conditionIds) || entry.conditionIds.includes(answer.conditionId))))) throw Error("Escolha fora do catálogo conferido.");
      const condition = definition.conditions?.find((entry) => entry.id === answer.conditionId), recommendation = definition.recommendations?.find((entry) => entry.id === answer.recommendationId);
      if (condition && (item.description !== condition.text || canonical(item.conditionSource || null) !== canonical(condition.source || null))) throw Error("O catálogo diverge da condição e fonte salvas. Encaminhe para revisão técnica.");
      for (const [choice, key] of [[condition, "supportsGoodCondition"], [recommendation, "requiresTreatment"]]) if (choice && choice[key] !== undefined && choice[key] !== null && typeof choice[key] !== "boolean") throw Error("Classificação técnica do catálogo deve ser explícita ou permanecer pendente.");
      const supportsGood = typeof condition?.supportsGoodCondition === "boolean" ? condition.supportsGoodCondition : null,
        declaredTreatment = typeof recommendation?.requiresTreatment === "boolean" ? recommendation.requiresTreatment : null,
        // Existing selected recommendations conservatively retain their RTI.
        // Effective action=true does not turn unknown curation into approval.
        requiresTreatment = !recommendation ? null : declaredTreatment === null ? true : declaredTreatment,
        actionabilityStatus = !recommendation ? "not_selected" : declaredTreatment === null ? "legacy_unclassified" : "catalog_declared";
      if (recommendation && declaredTreatment === null && ["good_condition", "treatment_required"].includes(outcome)) throw Error("O resultado exige classificação de tratativa explícita na curadoria do catálogo.");
      if (supportsGood !== null || own(answer, "conditionSupportsGoodCondition") || own(item, "conditionSupportsGoodCondition")) if (answer.conditionSupportsGoodCondition !== supportsGood || item.conditionSupportsGoodCondition !== supportsGood) throw Error("A classificação de boas condições salva diverge da curadoria do catálogo.");
      if (declaredTreatment !== null || own(answer, "requiresTreatment") || own(item, "requiresTreatment") || own(answer, "actionabilityStatus") || own(item, "actionabilityStatus")) {
        if (answer.requiresTreatment !== requiresTreatment || item.requiresTreatment !== requiresTreatment || answer.actionabilityStatus !== actionabilityStatus || item.actionabilityStatus !== actionabilityStatus) throw Error("A classificação de tratativa salva diverge da curadoria do catálogo.");
      }
      if (recommendation) {
        if (requiresTreatment === false) {
          if (item.recommendation !== recommendation.text || canonical(item.recommendationSource || null) !== canonical(recommendation.source || null)) throw Error("A escolha sem tratativa e sua fonte divergem do texto salvo no item.");
        } else {
          treatmentCount++;
          const finding = findings.find((entry) => entry.lvtItemId === item.id && entry.recommendationId === recommendation.id), rti = rtis.find((entry) => entry.lvtItemId === item.id && entry.findingId === finding?.id && entry.recommendationId === recommendation.id);
          if (!answer.photoIds.length || !finding || !rti || finding.recommendation !== recommendation.text || rti.recommendation !== recommendation.text || canonical(finding.recommendationSource || null) !== canonical(recommendation.source || null) || canonical(rti.recommendationSource || null) !== canonical(recommendation.source || null)) throw Error("A recomendação e fonte salvas divergem do catálogo ou de seus vínculos.");
          if (declaredTreatment === true && (!answer.pointId || finding.pointId !== answer.pointId || rti.pointId !== answer.pointId)) throw Error("Tratativa sem a mesma referência de ponto na resposta, achado e RTI.");
          if (declaredTreatment === true && (finding.requiresTreatment !== true || rti.requiresTreatment !== true || finding.actionabilityStatus !== "catalog_declared" || rti.actionabilityStatus !== "catalog_declared" || rti.recommendationWithdrawn !== false || !sameIds(finding.photoIds, answer.photoIds) || !sameIds(rti.photoIds, answer.photoIds))) throw Error("Tratativa ativa diverge da classificação ou das fotos selecionadas no item e na RTI.");
        }
      }
      for (const id of answer.photoIds) if (!photoMap.has(id) || photoMap.get(id).lvtItemId !== item.id) throw Error("Foto selecionada pertence a outro item ou execução.");
    }
    validatePoints(content, itemMap, photoMap);
    const coverage = coverageOf(content, photoMap);
    if (outcome === "treatment_required" && !treatmentCount) throw Error("Resultado com tratativa exige ao menos uma recomendação acionável do catálogo.");
    if (outcome === "good_condition") {
      if (!shells.length || answers.length !== shells.length || answers.some((answer) => {
        const definition = catalog.items?.find((entry) => entry.id === answer.catalogItemId), condition = definition?.conditions?.find((entry) => entry.id === answer.conditionId), recommendation = definition?.recommendations?.find((entry) => entry.id === answer.recommendationId);
        return answer.notCovered || !condition || condition.supportsGoodCondition !== true || answer.conditionSupportsGoodCondition !== true || recommendation && recommendation.requiresTreatment !== false;
      }) || execution.technicalReviewRequired === true || rtis.length) throw Error("Boas condições exigem todas as condições compatíveis explicitamente conferidas, sem tratativa, RTI ou pendência técnica desta execução.");
      if (!execution.observedOn || !/^\d{4}-\d{2}-\d{2}$/.test(execution.observedOn) || !Number.isFinite(Date.parse(execution.observedOn + "T00:00:00Z")) || new Date(execution.observedOn + "T00:00:00Z").toISOString().slice(0, 10) !== execution.observedOn) throw Error("Boas condições exigem a data declarada da inspeção realizada.");
      if (!coverage || !coverage.photoIds.length) throw Error("Boas condições exigem cobertura explicitamente declarada e ao menos uma foto vinculada.");
    }
    const versioned = [[contract, "contract"], [asset, "asset"], [inspection, "inspection"], [execution, "lvt"], ...items.map((row) => [row, "lvt_item"]), ...photos.map((row) => [row, "photo"]), ...findings.map((row) => [row, "finding"]), ...rtis.map((row) => [row, "rti"]), ...(content.points || []).map((row) => [row, "document"])];
    for (const [row, kind] of versioned) { const versions = recordVersions.filter((entry) => entry.id === row.id); if (!Number.isSafeInteger(row.version) || row.version < 1 || versions.length !== 1 || versions[0].kind !== kind || versions[0].version !== row.version) throw Error("Versão salva não conferida: " + kind); }
    if (canonical(content).length > 5 * 1024 * 1024) throw Error("Recorte excede o limite de conferência.");
    return content;
  }
  async function freeze(input) {
    // The system response may contain many other TAGs. Scan IDs without copying
    // their payloads; JSON validation and resource limits apply to this recorte.
    const scope = clone(field(input, "scope")), snapshot = field(input, "snapshot"), detailRaw = field(input, "detail"), reportScope = field(snapshot, "reportScope");
    if (field(snapshot, "snapshotVersion") !== 1 || field(reportScope, "ownerId") !== scope?.ownerId || field(reportScope, "contractId") !== scope?.contractId || field(reportScope, "systemId") !== scope?.systemId || !["contract_system", "contract_campaign"].includes(field(reportScope, "mode"))) throw Error("Snapshot não comprova o contrato e sistema solicitados.");
    const rows = {};
    for (const name of ["assets", "inspections", "lvts", "lvtItems", "photos", "findings", "rtis", "recordVersions"]) rows[name] = arrayShape(field(snapshot, name), name);
    const inspectionRaw = field(detailRaw, "inspection"), executionRaw = field(detailRaw, "execution");
    if (!inspectionRaw || !executionRaw) throw Error("Execução salva e versões canônicas são obrigatórias.");
    const inspection = clone(exact(rows.inspections, scope.inspectionId, "Inspeção")), execution = clone(exact(rows.lvts, scope.executionId, "Execução visual"));
    sameScope(inspection, scope, ["contractId", "systemId", "assetId"]); sameScope(execution, scope, ["contractId", "systemId", "assetId", "inspectionId"]);
    if (field(inspectionRaw, "id") !== inspection.id || field(executionRaw, "id") !== execution.id || field(inspectionRaw, "version") !== inspection.version || field(executionRaw, "version") !== execution.version) throw Error("A execução mudou durante a consulta. Atualize antes de conferir.");
    // Approval-like display fields are never trusted by this draft. Functional
    // execution data, however, must agree with the saved canonical snapshot.
    for (const key of [...scopeKeys, "module", "campaignId", "recordClass", "executionVersion", "type", "status", "catalogId", ...bindingKeys, "items", "answers", "observedOn", "inspector", "inspectorProfessionalId", "technicalReviewRequired", "outcome", "coverage"])
      if (canonical(field(executionRaw, key) ?? null) !== canonical(field(execution, key) ?? null)) throw Error("Conteúdo da execução diverge do snapshot salvo; atualize a conferência.");
    const shells = arrayShape(field(executionRaw, "items") || [], "itens da execução"), answers = arrayShape(field(executionRaw, "answers") || [], "respostas da execução");
    if (shells.length > 1000 || answers.length > 1000) throw Error("Itens ou respostas da execução excedem o limite.");
    const shellIds = new Set(shells.map((item) => field(item, "lvtItemId"))), usedCatalogIds = new Set([...shells, ...answers].map((item) => field(item, "catalogItemId")));
    const items = select(rows.lvtItems, (row) => shellIds.has(field(row, "id")) || field(row, "lvtId") === execution.id || field(row, "executionId") === execution.id, "itens");
    selectedIdentities(rows.lvtItems, items, "itens");
    const itemIds = new Set(items.map((item) => field(item, "id")));
    const children = (name) => { const selected = select(rows[name], (row) => itemIds.has(field(row, "lvtItemId")) || field(row, "lvtId") === execution.id || field(row, "executionId") === execution.id, name); selectedIdentities(rows[name], selected, name); return selected; };
    const photos = children("photos"), findings = children("findings"), rtis = children("rtis");
    const pointerIds = new Set([...answers, ...items, ...findings, ...rtis].map((row) => field(row, "pointId")).filter(Boolean)),
      pointRows = arrayShape(field(snapshot, "documents") || [], "documentos"), detailPointRows = arrayShape(field(detailRaw, "points") || [], "pontos da execução"),
      selectedPoint = (row) => pointerIds.has(field(row, "id")) || field(row, "recordClass") === "field_point_reference" && (field(row, "executionId") === execution.id || field(row, "lvtId") === execution.id || itemIds.has(field(row, "lvtItemId"))),
      points = select(pointRows, selectedPoint, "pontos de campo"), detailPoints = select(detailPointRows, selectedPoint, "pontos da execução");
    selectedIdentities(pointRows, points, "pontos de campo"); selectedIdentities(detailPointRows, detailPoints, "pontos da execução");
    if (points.length !== detailPoints.length) throw Error("Referências de campo ausentes do recorte canônico da execução.");
    for (const point of points) {
      const detailPoint = exact(detailPoints, field(point, "id"), "Ponto de campo");
      if (canonical(point) !== canonical(detailPoint)) throw Error("A referência de ponto mudou durante a consulta; atualize a conferência.");
    }
    const keptIds = new Set([scope.contractId, scope.assetId, scope.inspectionId, scope.executionId, ...items.map((row) => field(row, "id")), ...photos.map((row) => field(row, "id")), ...findings.map((row) => field(row, "id")), ...rtis.map((row) => field(row, "id")), ...points.map((row) => field(row, "id"))]);
    const catalogRaw = field(detailRaw, "catalog"), definitions = select(arrayShape(field(catalogRaw, "items") || [], "catálogo"), (row) => usedCatalogIds.has(field(row, "id")), "itens do catálogo", 1000);
    if (new Set(definitions.map((row) => field(row, "id"))).size !== definitions.length) throw Error("Definição selecionada do catálogo repetida.");
    const content = (hasBinding(execution) ? cloneExact : clone)({ scope, company: field(snapshot, "company"), contract: field(snapshot, "contract"), system: field(snapshot, "system"), asset: exact(rows.assets, scope.assetId, "TAG"), inspection: inspectionRaw, execution: executionRaw,
      items, photos, findings, rtis, catalog: catalogRaw ? { id: field(catalogRaw, "id"), status: field(catalogRaw, "status"), reason: field(catalogRaw, "reason"), source: field(catalogRaw, "source"), verifiedAt: field(catalogRaw, "verifiedAt"), items: definitions } : { status: "unavailable", items: [] },
      recordVersions: select(rows.recordVersions, (row) => keptIds.has(field(row, "id")), "versões", keptIds.size), sourceProvenance: [] });
    if (hasBinding(execution)) {
      const detailBinding = cloneExact(field(detailRaw, "catalogBinding")), bindingRows = arrayShape(field(snapshot, "catalogBindings"), "vínculos de catálogo"),
        pinned = cloneExact(exact(bindingRows, execution.catalogBindingId, "Vínculo de catálogo")), { catalog: pinnedCatalog, ...pinnedMetadata } = pinned;
      selectedIdentities(bindingRows, [pinned], "vínculos de catálogo");
      if (exactJSON(detailBinding) !== exactJSON(pinnedMetadata) || exactJSON(catalogRaw) !== exactJSON(pinnedCatalog)) throw Error("Vínculo ou snapshot integral do catálogo diverge da resposta canônica salva.");
      content.catalogBinding = detailBinding; content.catalog = cloneExact(catalogRaw);
    } else if (field(field(detailRaw, "catalogBinding"), "status") === "pinned") throw Error("Catálogo declarado fixado sem ponteiros explícitos da execução.");
    // Keep the old shape/digest for saved legacy conferences without points.
    if (points.length) content.points = clone(sorted(points));
    for (const name of ["items", "photos", "findings", "rtis", "recordVersions"]) content[name] = sorted(content[name]);
    const sourceIds = new Set();
    const sources = (value) => { if (!value || typeof value !== "object") return; if (typeof value.sourceId === "string") sourceIds.add(value.sourceId); Object.values(value).forEach(sources); };
    sources(content);
    const provenance = select(arrayShape(field(snapshot, "sourceProvenance") || [], "proveniências"), (source) => sourceIds.has(field(source, "sourceId")), "proveniências");
    if (new Set(provenance.map((source) => field(source, "sourceId"))).size !== provenance.length) throw Error("Proveniência selecionada repetida.");
    content.sourceProvenance = clone(provenance).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    validateContent(content);
    return deepFreeze({ schema: SCHEMA, version: 1, draft: true, canIssue: false, content, contentDigest: await hash({ schema: SCHEMA, content }), pending: pendingFor(content) });
  }
  function pendingFor(content) {
    const pending = [];
    if (content.catalog.status !== "verified" || !content.catalog.items?.length) pending.push("Catálogo de LVT com fontes conferidas indisponível; checklist pendente.");
    if (!content.execution.observedOn) pending.push("Data observada não informada.");
    if (!content.execution.inspector) pending.push("Responsável cadastrado não informado.");
    if (!content.items.length) pending.push("Nenhum item respondido nesta execução; ausência não significa condição boa.");
    for (const item of content.items) { const answer = content.execution.answers?.find((row) => row.catalogItemId === item.catalogItemId); if (!answer || !answer.conditionId && !answer.notCovered) pending.push("Item " + item.itemKey + ": resposta pendente."); if (answer?.notCovered) pending.push("Item " + item.itemKey + ": condição não contemplada; gestão técnica pendente."); }
    for (const rti of content.rtis) if (rti.deadlineReviewRequired) pending.push("RTI " + rti.id + ": prazo registrado pendente de revisão técnica.");
    // Previously saved generic conferences retain their old derived messages.
    // New outcomes are explicit declarations, never inferred from an empty RTI list.
    if (own(content.execution, "outcome") || own(content.execution, "coverage")) {
      if (outcomeOf(content.execution) === "pending") pending.push("Resultado da inspeção pendente; ausência de RTI não declara boas condições.");
      if (!content.execution.coverage) pending.push("Cobertura inspecionada ainda não declarada; nenhuma extensão integral foi inferida.");
      for (const answer of content.execution.answers || []) if (answer.recommendationId && (answer.actionabilityStatus === "legacy_unclassified" || answer.requiresTreatment !== true && answer.requiresTreatment !== false)) pending.push("Item " + answer.itemKey + ": escolha legada sem classificação de tratativa; revisão técnica pendente.");
      for (const rti of content.rtis) if (rti.recommendationWithdrawn || rti.technicalReviewRequired) pending.push("RTI " + rti.id + ": recomendação ou tratativa permanece pendente de gestão técnica; histórico preservado.");
      for (const point of content.points || []) pending.push("Ponto " + point.label + ": referência de campo registrada; localização no desenho pendente.");
    }
    return pending;
  }
  const clean = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  const present = (value, missing = "Pendente / não informado") => clean(value) || missing;
  const sourceText = (source) => source ? [source.fileName || source.sourceId, source.locator?.sheet, source.locator?.row && "linha " + source.locator.row, source.locator?.page && "página " + source.locator.page, source.locator?.section].filter(Boolean).join(" · ") || "Fonte não informada" : "Fonte não informada";
  function jpegScanData(bytes) {
    // jsPDF reads JPEG dimensions without decoding pixels. Require a complete
    // framed stream and nonempty scan data as well; the upload UI decodes and
    // normalizes photographs before they reach this draft helper.
    const invalid = () => { throw Error("Fotografia JPEG incompleta ou inválida para a cobertura declarada."); };
    if (bytes.length < 4 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cursor = 2, frame = 0, scans = 0, segments = 0;
    while (cursor < bytes.length) {
      if (++segments > 10000 || bytes[cursor++] !== 255) invalid();
      while (bytes[cursor] === 255) cursor++;
      const marker = bytes[cursor++];
      if (marker === 217) { if (cursor !== bytes.length || !frame || !scans) invalid(); return; }
      if (marker === 1) continue;
      if (marker === undefined || marker === 0 || marker === 216 || marker >= 208 && marker <= 215 || cursor + 2 > bytes.length) invalid();
      const length = view.getUint16(cursor), end = cursor + length;
      if (length < 2 || end > bytes.length - 2) invalid();
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (![192, 193, 194].includes(marker) || frame || length < 8 || bytes[cursor + 2] !== 8) invalid();
        frame = bytes[cursor + 7];
        if (![1, 3, 4].includes(frame) || length !== 8 + 3 * frame) invalid();
      }
      cursor = end;
      if (marker === 218) {
        const components = bytes[end - length + 2];
        if (!frame || !components || components > frame || length !== 6 + 2 * components) invalid();
        let payload = 0;
        for (; cursor < bytes.length; cursor++) {
          if (bytes[cursor] !== 255) { payload++; continue; }
          let next = cursor + 1; while (bytes[next] === 255) next++;
          if (bytes[next] === 0) { payload++; cursor = next; continue; }
          if (bytes[next] >= 208 && bytes[next] <= 215) { cursor = next; continue; }
          break;
        }
        if (!payload) invalid(); scans++;
      }
    }
    invalid();
  }
  async function createPdf(record, images = {}, options = {}, jsPDFctor) {
    const content = validateContent((hasBinding(field(record.content, "execution")) ? cloneExact : clone)(record.content));
    if (record.schema !== SCHEMA || record.contentDigest !== await hash({ schema: SCHEMA, content })) throw Error("O conteúdo congelado mudou. Gere nova conferência dos registros salvos.");
    const outcome = outcomeOf(content.execution), goodCondition = outcome === "good_condition", coverage = content.execution.coverage || null,
      imageOf = (id) => images instanceof Map ? images.get(id) : images[id], requiredImages = new Map();
    if (goodCondition) for (const id of coverage.photoIds) if (!imageOf(id)) throw Error("Boas condições exigem incorporar todas as fotos declaradas na cobertura; imagem ausente: " + id);
    const Ctor = jsPDFctor || root.PiresPDF?.jsPDF || root.jspdf?.jsPDF || root.jsPDF;
    if (typeof Ctor !== "function") throw Error("Gerador de PDF indisponível.");
    const doc = new Ctor({ unit: "mm", format: "a4", compress: true }), M = 16, WIDTH = 178, BOTTOM = 277;
    let y = 36, imageBytes = 0, decodedPixels = 0;
    const embeddedPhotoIds = [], pending = pendingFor(content);
    function checkedImage(image, mandatoryCoverage = false) {
      const bytes = image?.bytes;
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_IMAGE_BYTES || !["image/jpeg", "image/png"].includes(image.mime) || image.mime === "image/png" && ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) || image.mime === "image/jpeg" && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) throw Error("Foto fora dos limites ou do formato aceito para o item.");
      if (mandatoryCoverage && image.mime === "image/jpeg") jpegScanData(bytes);
      let properties; try { properties = doc.getImageProperties(bytes); } catch { throw Error("Fotografia inválida para a conferência da TAG."); }
      if (!properties.width || !properties.height || properties.width > 16000 || properties.height > 16000 || properties.width * properties.height > 16777216) throw Error("Dimensões da foto excedem o limite.");
      return { bytes, properties, mime: image.mime };
    }
    // Validate all mandatory evidence before writing any good-condition heading.
    if (goodCondition) {
      let requiredBytes = 0, requiredPixels = 0;
      for (const id of coverage.photoIds) {
        const image = checkedImage(imageOf(id), true); requiredImages.set(id, image);
        requiredBytes += image.bytes.byteLength; requiredPixels += image.properties.width * image.properties.height;
        if (requiredBytes > MAX_TOTAL_IMAGE_BYTES || requiredPixels > MAX_TOTAL_PIXELS) throw Error("As fotografias excedem o limite total de conferência; nenhum PDF foi salvo.");
      }
    }
    const font = (size = 10, bold = false) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(28, 54, 66); };
    function header() { font(15, true); doc.text("RASCUNHO DE CONFERÊNCIA", M, 15); font(9); const lines = doc.splitTextToSize("TAG " + present(content.asset.tag) + " | inspeção visual individual", WIDTH); doc.text(lines, M, 23); const separator = 28 + (lines.length - 1) * 4; doc.setDrawColor(175, 191, 198); doc.line(M, separator, 194, separator); y = separator + 8; }
    function room(height) { if (y + height > BOTTOM) { if (doc.getNumberOfPages() >= 250) throw Error("Rascunho excede o limite de páginas."); doc.addPage(); header(); } }
    function paragraph(value, bold = false, size = 10) { font(size, bold); const lines = doc.splitTextToSize(present(value), WIDTH); for (const line of lines) { room(5); font(size, bold); doc.text(line, M, y); y += 5; } y += 2; }
    function heading(value) { room(13); y += 3; paragraph(value, true, 12); }
    const generatedAt = options.generatedAt || new Date().toISOString();
    if (!Number.isFinite(Date.parse(generatedAt))) throw Error("Data de geração do rascunho inválida.");
    doc.setProperties({ title: "Rascunho de conferência - " + present(content.asset.tag), subject: "Conferência individual sem emissão ou assinatura técnica", creator: "Pires - conferência genérica de TAG" });
    header();
    paragraph("SEM EMISSÃO, APROVAÇÃO OU ASSINATURA TÉCNICA", true);
    paragraph("Layout genérico para conferir registros salvos. Não reproduz um modelo documental fornecido.");
    paragraph("Número de relatório técnico: pendente. Revisão técnica: pendente. Revisão/aprovação PLH e assinaturas: pendentes.");
    paragraph("Imagens anexadas não comprovam assinatura ou ato técnico. Gerar este arquivo não encerra RTIs.");
    heading("Identificação do recorte");
    for (const [label, value] of [["Cliente", content.company.name], ["Contrato / projeto", content.contract.name], ["Sistema", content.system.name], ["TAG", content.asset.tag], ["Identificação", content.asset.identification || content.asset.description], ["Inspeção", content.scope.inspectionId], ["Execução visual / LVT", content.scope.executionId], ["Versão salva da execução", content.execution.version], ["Data observada declarada", content.execution.observedOn], ["Responsável cadastrado na execução (sem assinatura)", content.execution.inspector]]) paragraph(label + ": " + present(value));
    paragraph("IDs internos do recorte: cliente " + content.scope.ownerId + " | contrato " + content.scope.contractId + " | sistema " + content.scope.systemId + " | ativo " + content.scope.assetId, false, 8);
    paragraph("Geração desta cópia de conferência: " + generatedAt);
    paragraph("Digest do conteúdo e versões (não é assinatura, número ou revisão técnica): " + record.contentDigest, false, 8);
    if (content.catalogBinding) {
      paragraph("Catálogo fixado explicitamente nesta inspeção: " + content.catalogBinding.catalogId + " · versão " + content.catalogBinding.versionLabel, true, 9);
      paragraph("Procedimento de referência declarado: " + content.catalogBinding.procedureReference);
      paragraph("Vínculo imutável: " + content.catalogBinding.id + " · versão da seleção " + content.catalogBinding.selectionVersion + " · seleção em " + content.catalogBinding.selectedAt, false, 8);
      paragraph("Token do snapshot PostgreSQL: " + content.catalogBinding.contentHash + ". Conferência de igualdade entre respostas salvas; este token não é assinatura nem aprovação técnica.", false, 8);
    }
    heading("Resultado e cobertura declarados");
    paragraph("Resultado informado: " + ({ pending: "Pendente; ausência de RTI não declara boas condições", good_condition: "Boas condições declaradas para a cobertura informada", treatment_required: "Tratativa requerida", technical_review: "Gestão técnica pendente" })[outcome], true);
    if (!own(content.execution, "outcome") || content.execution.outcome === null) paragraph("Registro legado sem classificação explícita de resultado. Este rascunho não o promove a boas condições.");
    if (coverage) {
      paragraph("Cobertura DECLARADA pelo inspetor: " + (coverage.extent === "declared_section" ? "trecho declarado" : "linha integral declarada"), true);
      paragraph("Limites / extensão inspecionada informados: " + coverage.description);
      paragraph("Fotos selecionadas como evidência da cobertura: " + coverage.photoIds.join(", "), false, 8);
      paragraph("A extensão foi declarada, sem inferência automática das imagens. Foto parcial não comprova por si só a inspeção da linha integral.");
    } else paragraph("Cobertura não declarada. Nenhum trecho ou linha integral é presumido a partir das fotos.");
    if (goodCondition) paragraph("Nenhuma RTI desta execução. A declaração permanece sujeita à revisão técnica; campanhas e próximas inspeções continuam no planejamento.");
    heading("Itens, escolhas e evidências");
    for (const item of content.items) {
      const answer = content.execution.answers?.find((row) => row.catalogItemId === item.catalogItemId), definition = content.catalog.items?.find((row) => row.id === item.catalogItemId), condition = definition?.conditions?.find((row) => row.id === answer?.conditionId), recommendation = definition?.recommendations?.find((row) => row.id === answer?.recommendationId);
      heading("Item " + present(item.itemKey) + " · " + present(item.component));
      paragraph("ID do item: " + item.id, false, 8);
      const point = (content.points || []).find((entry) => entry.id === item.pointId);
      if (point) { paragraph("Ponto de campo informado: " + point.label + " · ID " + point.id + " · versão " + point.version, false, 9); paragraph("Localização no isométrico: pendente. A referência de campo não atribui posição ou geometria ao desenho."); }
      paragraph("Condição selecionada: " + (answer?.notCovered ? "Não contemplada; gestão técnica pendente" : present(condition ? item.description : null, "Resposta pendente; nenhuma condição presumida")));
      if (condition) paragraph("Fonte da condição: " + sourceText(condition.source), false, 8);
      const savedFinding = content.findings.find((row) => row.lvtItemId === item.id && row.recommendationId === answer?.recommendationId);
      paragraph("Recomendação selecionada: " + present(recommendation ? recommendation.requiresTreatment === false ? item.recommendation : savedFinding?.recommendation : null, "Não selecionada; ausência não significa aprovação"));
      if (recommendation) paragraph("Fonte da recomendação: " + sourceText(recommendation.source), false, 8);
      if (recommendation?.requiresTreatment === false) paragraph("Escolha documental sem tratativa: não cria nova RTI.");
      else if (recommendation && recommendation.requiresTreatment !== true) paragraph("Escolha legada sem classificação de tratativa: revisão técnica pendente.");
      for (const photo of content.photos.filter((row) => row.lvtItemId === item.id)) {
        paragraph("Foto do mesmo item " + present(item.itemKey) + " · ID " + photo.id + " · " + present(photo.caption), false, 9);
        const image = imageOf(photo.id);
        if (!image) { pending.push("Foto " + photo.id + ": imagem não carregada nesta cópia."); paragraph("Imagem pendente nesta cópia; vínculo preservado."); continue; }
        const checked = requiredImages.get(photo.id) || checkedImage(image), bytes = checked.bytes, p = checked.properties;
        imageBytes += bytes.byteLength; decodedPixels += p.width * p.height;
        if (imageBytes > MAX_TOTAL_IMAGE_BYTES || decodedPixels > MAX_TOTAL_PIXELS) throw Error("As fotografias excedem o limite total de conferência; nenhum PDF foi salvo.");
        const width = Math.min(WIDTH, 95 * p.width / p.height), height = width * p.height / p.width; room(height + 4); doc.addImage(bytes, checked.mime === "image/png" ? "PNG" : "JPEG", M, y, width, height); y += height + 4; embeddedPhotoIds.push(photo.id);
        paragraph("Fonte da foto: " + sourceText(photo.source), false, 8);
      }
      for (const rti of content.rtis.filter((row) => row.lvtItemId === item.id)) {
        paragraph("RTI vinculada (ID interno): " + rti.id, true);
        paragraph("Recomendação registrada na RTI: " + present(rti.recommendation));
        if (rti.recommendationWithdrawn) paragraph("Recomendação retirada no rascunho; RTI preservada para gestão técnica.");
        paragraph("Prazo manual registrado: " + present(rti.due, "Não definido"));
        paragraph("Prazo histórico na fonte: " + present(rti.sourceDue, "Não informado"));
        paragraph("Marco observado declarado: " + present(rti.deadlineAnchor?.date, "Pendente"));
        if (rti.deadlineReviewRequired) paragraph("Prazo registrado exige revisão técnica após alteração da base.");
        paragraph("Nenhum prazo é calculado neste rascunho. A fonte histórica não confirma a situação atual.", false, 9);
      }
    }
    if (goodCondition && coverage.photoIds.some((id) => !embeddedPhotoIds.includes(id))) throw Error("Boas condições sem todas as fotos de cobertura incorporadas; nenhum PDF foi salvo.");
    heading("Pendências para conferência");
    for (const value of pending.length ? [...new Set(pending)] : ["Conferir conteúdo, fontes e evidências. A ausência de pendências automáticas não aprova a inspeção."]) paragraph(value);
    paragraph("Relatório técnico individual, revisão, assinaturas e emissão permanecem pendentes.", true);
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) { doc.setPage(page); font(8); doc.text("Conferência genérica · sem emissão técnica · " + page + "/" + pages, M, 289); }
    return { doc, filename: "conferencia-" + String(content.asset.tag || "TAG").replace(/[^a-z0-9_-]/gi, "_").slice(0, 70) + "-" + content.scope.inspectionId + ".pdf",
      metadata: deepFreeze({ schema: SCHEMA, draft: true, canIssue: false, technicalNumber: null, technicalRevision: null, technicalApproval: "pending", signatures: [], contentDigest: record.contentDigest, scope: content.scope, outcome,
        ...(content.catalogBinding ? { catalogBinding: content.catalogBinding } : {}),
        outcomeStatus: !own(content.execution, "outcome") || content.execution.outcome === null ? "legacy_unclassified" : "declared_pending_technical_review", coverage: coverage ? { ...coverage, basis: "inspector_declared_not_inferred_from_photos" } : null,
        pointReferences: (content.points || []).map((point) => ({ id: point.id, version: point.version, label: point.label, locationStatus: point.locationStatus })), embeddedPhotoIds, pending: [...new Set(pending)] }) };
  }
  return Object.freeze({ SCHEMA, freeze, createPdf });
});
