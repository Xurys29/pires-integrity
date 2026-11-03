(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresGestaoTagReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const SCHEMA = "pires-tag-visual-conference-v1", UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024, MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024, MAX_TOTAL_PIXELS = 134217728;
  const scopeKeys = ["ownerId", "contractId", "systemId", "assetId", "inspectionId", "executionId"];
  function canonical(value, ancestors = new Set(), budget = { remaining: 5 * 1024 * 1024 }) {
    const spend = (length) => { budget.remaining -= length; if (budget.remaining < 0) throw Error("Recorte excede o limite de conferência."); };
    const take = (text) => { spend(text.length); return text; };
    if (typeof value === "string" && value.length > budget.remaining) throw Error("Recorte excede o limite de conferência.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return take(JSON.stringify(value));
    if (typeof value === "number" && Number.isFinite(value)) return take(JSON.stringify(value));
    if (!value || typeof value !== "object" || ancestors.has(value)) throw Error("O recorte deve conter somente dados JSON sem ciclos.");
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (!array && proto !== Object.prototype && proto !== null || Reflect.ownKeys(descriptors).some((key) => !("value" in descriptors[key]))) throw Error("Objeto de conferência inválido.");
    ancestors.add(value);
    const keys = array ? null : Object.keys(descriptors).sort().filter((key) => key !== "generatedAt" && descriptors[key].value !== undefined);
    spend(2 + Math.max(0, (array ? value.length : keys.length) - 1));
    const result = array ? "[" + Array.from({ length: value.length }, (_, i) => descriptors[i]?.value === undefined ? take("null") : canonical(descriptors[i].value, ancestors, budget)).join(",") + "]"
      : "{" + keys.map((key) => take(JSON.stringify(key) + ":") + canonical(descriptors[key].value, ancestors, budget)).join(",") + "}";
    ancestors.delete(value); return result;
  }
  const clone = (value) => JSON.parse(canonical(value));
  function deepFreeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
  async function hash(value) {
    const crypto = root.crypto || (typeof require === "function" ? require("node:crypto").webcrypto : null);
    if (!crypto?.subtle) throw Error("A conferência de integridade do conteúdo está indisponível.");
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value))));
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
  function validateContent(content) {
    const { scope, company, contract, system, asset, inspection, execution, items, photos, findings, rtis, catalog, recordVersions } = content;
    if (!scope || scopeKeys.some((key) => !UUID.test(scope[key] || ""))) throw Error("Identifique cliente, contrato, sistema, TAG, inspeção e execução por ID.");
    if (company?.id !== scope.ownerId || contract?.id !== scope.contractId || system?.id !== scope.systemId || asset?.id !== scope.assetId || inspection?.id !== scope.inspectionId || execution?.id !== scope.executionId) throw Error("Identidades canônicas divergentes.");
    sameScope(asset, scope, ["systemId"]); sameScope(inspection, scope, ["contractId", "systemId", "assetId"]); sameScope(execution, scope, ["contractId", "systemId", "assetId", "inspectionId"]);
    if (inspection.type !== "visual" || execution.type !== "visual" || execution.recordClass !== "field_lvt" || execution.executionVersion !== 1 || inspection.module !== "integridade") throw Error("Este rascunho aceita somente a execução visual explícita; espessura tem documento separado.");
    if (inspection.campaignId !== execution.campaignId || execution.inspectorProfessionalId && inspection.assigneeProfessionalId !== execution.inspectorProfessionalId) throw Error("Campanha ou responsável diverge da atividade.");
    const shells = execution.items || [], answers = execution.answers || [];
    if (!Array.isArray(shells) || !Array.isArray(answers) || shells.length > 1000 || answers.length > 1000) throw Error("Itens ou respostas inválidos.");
    const shellIds = new Set(), catalogIds = new Set(), answerIds = new Set();
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
    for (const answer of answers) {
      if (!catalogIds.has(answer.catalogItemId) || answerIds.has(answer.catalogItemId) || typeof answer.notCovered !== "boolean" || !Array.isArray(answer.photoIds)) throw Error("Resposta sem identidade ou escolha explícita."); answerIds.add(answer.catalogItemId);
      const shell = shells.find((entry) => entry.catalogItemId === answer.catalogItemId), item = itemMap.get(shell.lvtItemId), definition = catalog.items?.find((entry) => entry.id === answer.catalogItemId);
      if (catalog.status !== "verified" || catalog.id !== execution.catalogId || !definition || answer.itemKey !== item.itemKey) throw Error("Resposta não corresponde ao catálogo da execução.");
      if ((item.conditionId || null) !== (answer.conditionId || null) || (item.recommendationId || null) !== (answer.recommendationId || null)) throw Error("Escolhas salvas do item divergem da execução.");
      if (answer.notCovered && (answer.conditionId || answer.recommendationId)) throw Error("Condição não contemplada não admite escolha presumida.");
      if (answer.conditionId && !definition.conditions?.some((entry) => entry.id === answer.conditionId) || answer.recommendationId && (!answer.conditionId || !definition.recommendations?.some((entry) => entry.id === answer.recommendationId && (!Array.isArray(entry.conditionIds) || entry.conditionIds.includes(answer.conditionId))))) throw Error("Escolha fora do catálogo conferido.");
      const condition = definition.conditions?.find((entry) => entry.id === answer.conditionId), recommendation = definition.recommendations?.find((entry) => entry.id === answer.recommendationId);
      if (condition && (item.description !== condition.text || canonical(item.conditionSource || null) !== canonical(condition.source || null))) throw Error("O catálogo diverge da condição e fonte salvas. Encaminhe para revisão técnica.");
      if (recommendation) {
        const finding = findings.find((entry) => entry.lvtItemId === item.id && entry.recommendationId === recommendation.id), rti = rtis.find((entry) => entry.lvtItemId === item.id && entry.findingId === finding?.id && entry.recommendationId === recommendation.id);
        if (!answer.photoIds.length || !finding || !rti || finding.recommendation !== recommendation.text || rti.recommendation !== recommendation.text || canonical(finding.recommendationSource || null) !== canonical(recommendation.source || null) || canonical(rti.recommendationSource || null) !== canonical(recommendation.source || null)) throw Error("A recomendação e fonte salvas divergem do catálogo ou de seus vínculos.");
      }
      for (const id of answer.photoIds) if (!photoMap.has(id) || photoMap.get(id).lvtItemId !== item.id) throw Error("Foto selecionada pertence a outro item ou execução.");
    }
    const versioned = [[contract, "contract"], [asset, "asset"], [inspection, "inspection"], [execution, "lvt"], ...items.map((row) => [row, "lvt_item"]), ...photos.map((row) => [row, "photo"]), ...findings.map((row) => [row, "finding"]), ...rtis.map((row) => [row, "rti"])];
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
    const shells = arrayShape(field(executionRaw, "items") || [], "itens da execução"), answers = arrayShape(field(executionRaw, "answers") || [], "respostas da execução");
    if (shells.length > 1000 || answers.length > 1000) throw Error("Itens ou respostas da execução excedem o limite.");
    const shellIds = new Set(shells.map((item) => field(item, "lvtItemId"))), usedCatalogIds = new Set([...shells, ...answers].map((item) => field(item, "catalogItemId")));
    const items = select(rows.lvtItems, (row) => shellIds.has(field(row, "id")) || field(row, "lvtId") === execution.id || field(row, "executionId") === execution.id, "itens");
    selectedIdentities(rows.lvtItems, items, "itens");
    const itemIds = new Set(items.map((item) => field(item, "id")));
    const children = (name) => { const selected = select(rows[name], (row) => itemIds.has(field(row, "lvtItemId")) || field(row, "lvtId") === execution.id || field(row, "executionId") === execution.id, name); selectedIdentities(rows[name], selected, name); return selected; };
    const photos = children("photos"), findings = children("findings"), rtis = children("rtis");
    const keptIds = new Set([scope.contractId, scope.assetId, scope.inspectionId, scope.executionId, ...items.map((row) => field(row, "id")), ...photos.map((row) => field(row, "id")), ...findings.map((row) => field(row, "id")), ...rtis.map((row) => field(row, "id"))]);
    const catalogRaw = field(detailRaw, "catalog"), definitions = select(arrayShape(field(catalogRaw, "items") || [], "catálogo"), (row) => usedCatalogIds.has(field(row, "id")), "itens do catálogo", 1000);
    if (new Set(definitions.map((row) => field(row, "id"))).size !== definitions.length) throw Error("Definição selecionada do catálogo repetida.");
    const content = clone({ scope, company: field(snapshot, "company"), contract: field(snapshot, "contract"), system: field(snapshot, "system"), asset: exact(rows.assets, scope.assetId, "TAG"), inspection: inspectionRaw, execution: executionRaw,
      items, photos, findings, rtis, catalog: catalogRaw ? { id: field(catalogRaw, "id"), status: field(catalogRaw, "status"), reason: field(catalogRaw, "reason"), source: field(catalogRaw, "source"), verifiedAt: field(catalogRaw, "verifiedAt"), items: definitions } : { status: "unavailable", items: [] },
      recordVersions: select(rows.recordVersions, (row) => keptIds.has(field(row, "id")), "versões", keptIds.size), sourceProvenance: [] });
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
    return pending;
  }
  const clean = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  const present = (value, missing = "Pendente / não informado") => clean(value) || missing;
  const sourceText = (source) => source ? [source.fileName || source.sourceId, source.locator?.sheet, source.locator?.row && "linha " + source.locator.row, source.locator?.page && "página " + source.locator.page, source.locator?.section].filter(Boolean).join(" · ") || "Fonte não informada" : "Fonte não informada";
  async function createPdf(record, images = {}, options = {}, jsPDFctor) {
    const content = validateContent(clone(record.content));
    if (record.schema !== SCHEMA || record.contentDigest !== await hash({ schema: SCHEMA, content })) throw Error("O conteúdo congelado mudou. Gere nova conferência dos registros salvos.");
    const Ctor = jsPDFctor || root.PiresPDF?.jsPDF || root.jspdf?.jsPDF || root.jsPDF;
    if (typeof Ctor !== "function") throw Error("Gerador de PDF indisponível.");
    const doc = new Ctor({ unit: "mm", format: "a4", compress: true }), M = 16, WIDTH = 178, BOTTOM = 277;
    let y = 36, imageBytes = 0, decodedPixels = 0;
    const embeddedPhotoIds = [], pending = pendingFor(content);
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
    heading("Itens, escolhas e evidências");
    for (const item of content.items) {
      const answer = content.execution.answers?.find((row) => row.catalogItemId === item.catalogItemId), definition = content.catalog.items?.find((row) => row.id === item.catalogItemId), condition = definition?.conditions?.find((row) => row.id === answer?.conditionId), recommendation = definition?.recommendations?.find((row) => row.id === answer?.recommendationId);
      heading("Item " + present(item.itemKey) + " · " + present(item.component));
      paragraph("ID do item: " + item.id, false, 8);
      paragraph("Condição selecionada: " + (answer?.notCovered ? "Não contemplada; gestão técnica pendente" : present(condition ? item.description : null, "Resposta pendente; nenhuma condição presumida")));
      if (condition) paragraph("Fonte da condição: " + sourceText(condition.source), false, 8);
      const savedFinding = content.findings.find((row) => row.lvtItemId === item.id && row.recommendationId === answer?.recommendationId);
      paragraph("Recomendação selecionada: " + present(recommendation ? savedFinding?.recommendation : null, "Não selecionada; ausência não significa aprovação"));
      if (recommendation) paragraph("Fonte da recomendação: " + sourceText(recommendation.source), false, 8);
      for (const photo of content.photos.filter((row) => row.lvtItemId === item.id)) {
        paragraph("Foto do mesmo item " + present(item.itemKey) + " · ID " + photo.id + " · " + present(photo.caption), false, 9);
        const image = images instanceof Map ? images.get(photo.id) : images[photo.id];
        if (!image) { pending.push("Foto " + photo.id + ": imagem não carregada nesta cópia."); paragraph("Imagem pendente nesta cópia; vínculo preservado."); continue; }
        const bytes = image.bytes;
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_IMAGE_BYTES || !["image/jpeg", "image/png"].includes(image.mime) || image.mime === "image/png" && ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) || image.mime === "image/jpeg" && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) throw Error("Foto fora dos limites ou do formato aceito para o item.");
        const p = doc.getImageProperties(bytes);
        if (!p.width || !p.height || p.width > 16000 || p.height > 16000 || p.width * p.height > 16777216) throw Error("Dimensões da foto excedem o limite.");
        imageBytes += bytes.byteLength; decodedPixels += p.width * p.height;
        if (imageBytes > MAX_TOTAL_IMAGE_BYTES || decodedPixels > MAX_TOTAL_PIXELS) throw Error("As fotografias excedem o limite total de conferência; nenhum PDF foi salvo.");
        const width = Math.min(WIDTH, 95 * p.width / p.height), height = width * p.height / p.width; room(height + 4); doc.addImage(bytes, image.mime === "image/png" ? "PNG" : "JPEG", M, y, width, height); y += height + 4; embeddedPhotoIds.push(photo.id);
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
    heading("Pendências para conferência");
    for (const value of pending.length ? [...new Set(pending)] : ["Conferir conteúdo, fontes e evidências. A ausência de pendências automáticas não aprova a inspeção."]) paragraph(value);
    paragraph("Relatório técnico individual, revisão, assinaturas e emissão permanecem pendentes.", true);
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) { doc.setPage(page); font(8); doc.text("Conferência genérica · sem emissão técnica · " + page + "/" + pages, M, 289); }
    return { doc, filename: "conferencia-" + String(content.asset.tag || "TAG").replace(/[^a-z0-9_-]/gi, "_").slice(0, 70) + "-" + content.scope.inspectionId + ".pdf",
      metadata: deepFreeze({ schema: SCHEMA, draft: true, canIssue: false, technicalNumber: null, technicalRevision: null, technicalApproval: "pending", signatures: [], contentDigest: record.contentDigest, scope: content.scope, embeddedPhotoIds, pending: [...new Set(pending)] }) };
  }
  return Object.freeze({ SCHEMA, freeze, createPdf });
});
