(function (root, factory) {
  const catalog = root.IntegrityNR13?.CATALOG ||
    (typeof module === "object" && module.exports ? require("./nr13.js").CATALOG : []);
  const api = factory(catalog);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresAssetCards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (catalog) {
  "use strict";
  const records = (value) => Array.isArray(value) ? value : [];
  const nonempty = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
  const scopes = {
    covered: "Enquadrado conforme registro revisado",
    not_covered: "Fora do escopo conforme registro revisado",
    excluded: "Exclusão conforme registro revisado",
    pending: "Enquadramento pendente",
  };
  function operation(asset) {
    const reason = nonempty(asset.operationReason) || nonempty(asset.operationEvidence) || "Motivo não informado";
    switch (asset.operation) {
      case "em_operacao":
        return { label: "Em operação", tone: "green", reason: null, animated: true };
      case "fora_de_operacao":
        return { label: "Fora de operação", tone: "red", reason, animated: true };
      case "descontinuado":
        return { label: "Descontinuado", tone: "red", reason, animated: true };
      default:
        return { label: "Operação não informada", tone: "neutral", reason: null, animated: false };
    }
  }
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validConfirmationDate(value) {
    return validDate(value) || typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
  }
  function sourceValue(value) {
    return ["string", "number", "boolean"].includes(typeof value) ? value : null;
  }
  function describeRti(record = {}) {
    record = record || {};
    // A source date, deadline or imported status is never a current confirmation.
    // Legacy records without explicit currentness stay unknown as well.
    const confirmed = record.currentness === "confirmed_current" && ["aberta", "encerrada"].includes(record.status) &&
      validConfirmationDate(record.currentnessConfirmedAt) && !!nonempty(record.currentnessEvidence),
      currentness = confirmed ? "confirmed_current" : record.currentness === "historical" ? "historical" : "unknown",
      sourceStatus = sourceValue(record.sourceStatus),
      sourceDate = sourceValue(record.sourceDate),
      open = confirmed && record.status === "aberta",
      reportedOpen = !confirmed && (record.status === "aberta" ||
        typeof sourceStatus === "string" && ["aberta", "aberto", "open"].includes(sourceStatus.trim().toLocaleLowerCase("pt-BR"))),
      currentnessLabel = confirmed ? "Situação atual conforme confirmação registrada" : reportedOpen
        ? "Alerta RTI reportado na fonte; situação atual não confirmada"
        : "Histórico de RTI da fonte; situação atual não confirmada";
    return {
      currentness,
      open,
      reportedOpen,
      currentnessLabel,
      statusLabel: confirmed ? record.status === "aberta" ? "Aberta com confirmação atual" : record.status === "encerrada"
        ? "Encerrada conforme confirmação registrada" : "Situação confirmada não reconhecida"
        : sourceStatus !== null ? String(sourceStatus) : record.status === "atualidade_desconhecida"
          ? "Situação da fonte não informada" : nonempty(record.status) || "Situação da fonte não informada",
      sourceStatus,
      sourceDate,
      sourceDateMissingReason: sourceValue(record.sourceDateMissingReason),
      confirmedAt: confirmed ? record.currentnessConfirmedAt : null,
      confirmationEvidence: confirmed ? record.currentnessEvidence : null,
    };
  }
  function nextDeadline(id, state) {
    const latestByType = new Map();
    for (const deadline of records(state.deadline))
      if (id && deadline?.assetId === id)
        latestByType.set(deadline.type || "sem_tipo", deadline);
    // A recorded overdue deadline remains visible; no new interval or due date is calculated.
    const deadline = [...latestByType.values()]
      .filter((item) => validDate(item.due))
      .sort((a, b) => a.due.localeCompare(b.due))[0];
    return deadline ? { ...deadline } : null;
  }
  function classificationCompatibility(asset, classification) {
    if (!classification) return { compatible: false, family: null };
    if (classification.classificationMethod === "automatic_nr13") return {
      compatible: classification.assetType === asset.type && Boolean(classification.source?.sourceId) && classification.ruleVersion === "NR13-2022/2026.1",
      family: asset.type === "vaso" ? "vessel" : asset.type === "tanque" ? "tank" : asset.type === "caldeira" ? "boiler" : "other",
    };
    if (classification.classificationMethod === "documented") return {
      compatible: classification.assetType === asset.type && Boolean(classification.source?.sourceId) && Boolean(nonempty(classification.basis)) && Boolean(nonempty(classification.responsible)),
      family: asset.type === "vaso" ? "vessel" : asset.type === "tanque" ? "tank" : asset.type === "caldeira" ? "boiler" : "other",
    };
    const result = classification.result || {},
      inputId = nonempty(classification.inputs?.nrProfile),
      resultId = nonempty(result.profileId),
      ids = [inputId, resultId].filter(Boolean),
      profiles = ids.map((id) => records(catalog).find((profile) => profile.id === id));
    if (!ids.length || profiles.some((profile) => !profile) || (inputId && resultId && inputId !== resultId))
      return { compatible: false, family: null };
    const family = profiles[0].family;
    if (profiles.some((profile) => profile.family !== family) || (result.family && result.family !== family))
      return { compatible: false, family: null };
    const expected = asset.type === "vaso" ? "vessel" : asset.type === "tanque" ? "tank" :
      ["linha", "segmento", "valvula", "outro"].includes(asset.type) ? "other" : null;
    return { compatible: expected !== null && family === expected, family };
  }
  function technicalValue(asset, key, sheetKey) {
    const field = asset.technical?.[key], value = field?.value;
    if (["string", "number"].includes(typeof value) && String(value).trim())
      return [String(value).trim(), nonempty(field.unit)].filter(Boolean).join(" ");
    return nonempty(asset.datasheet?.[sheetKey]);
  }
  function describe(asset = {}, state = {}) {
    asset = asset || {};
    state = state || {};
    const id = nonempty(asset.id),
      history = records(state.rti).filter((item) => id && item?.assetId === id).map((item) => ({ ...item })),
      items = history.filter((item) => describeRti(item).open),
      unconfirmedItems = history.filter((item) => describeRti(item).currentness !== "confirmed_current"),
      reportedItems = unconfirmedItems.filter((item) => describeRti(item).reportedOpen),
      classifications = records(state.classification).filter((item) => id && item?.assetId === id),
      latest = classifications.at(-1) || null,
      documented = classifications.filter(item => item.classificationMethod === "documented").at(-1),
      // An incomplete automatic check does not revoke a sourced documentary classification.
      classification = latest?.classificationMethod === "automatic_nr13" && latest.result?.scope === "pending" &&
        documented?.reviewStatus === "revisado" && classificationCompatibility(asset, documented).compatible ? documented : latest,
      result = classification?.result || {},
      reviewed = classification?.reviewStatus === "revisado" || classification?.classificationMethod === "automatic_nr13" && classification?.reviewStatus === "calculado",
      { compatible, family } = classificationCompatibility(asset, classification),
      scope = reviewed && compatible && Object.hasOwn(scopes, result.scope) ? result.scope : "pending",
      documentedCategory = nonempty(result.category),
      categoryApplicable = reviewed && compatible && scope === "covered" &&
        (asset.type === "vaso" && family === "vessel" && ["I", "II", "III", "IV", "V"].includes(documentedCategory) || asset.type === "caldeira" && family === "boiler" && ["A", "B"].includes(documentedCategory)),
      deadline = nextDeadline(id, state),
      rawFluid = asset.technical?.fluid?.value,
      fluid = ["string", "number", "boolean"].includes(typeof rawFluid) && String(rawFluid).trim() ? String(rawFluid).trim() : "Não informado";
    let scopeLabel = scopes[scope];
    if (classification && !compatible) scopeLabel = "Dados de enquadramento incompatíveis com o ativo";
    else if (classification?.reviewStatus === "devolvido") scopeLabel = "Enquadramento devolvido para correção";
    else if (classification && !reviewed) scopeLabel = "Enquadramento pendente de revisão";
    if (compatible && classification?.classificationMethod === "automatic_nr13") scopeLabel = "Cálculo automático · " + scopeLabel;
    if (compatible && reviewed && classification?.classificationMethod === "documented")
      scopeLabel = ({ covered: "Enquadrado NR-13 · conforme documento", not_covered: "Fora do escopo · conforme documento", excluded: "Exclusão · conforme documento", pending: "Enquadramento a confirmar · conforme documento" })[scope];
    if (compatible && reviewed && classification?.classificationMethod === "documented" && /\bplano\b|inspection plan/i.test(classification.reference || ""))
      scopeLabel = scopeLabel.replace("conforme documento", "conforme plano");
    const documents = records(state.document).filter(item => id && item?.assetId === id && item.recordClass !== "classification"),
      inspections = records(state.inspection).filter(item => id && item?.assetId === id),
      pending = records(asset.bookPending).map(nonempty).filter(Boolean);
    return {
      operation: operation(asset),
      rti: {
        open: items.length > 0,
        items,
        history,
        reportedOpen: reportedItems.length > 0,
        reportedItems,
        unconfirmedItems,
        currentnessLabel: unconfirmedItems.length ? reportedItems.length
          ? "Alerta RTI reportado na fonte; situação atual não confirmada"
          : "Histórico de RTI da fonte; situação atual não confirmada"
          : history.length ? "Situação atual conforme confirmação registrada" : "Nenhuma RTI vinculada",
        label: [items.length ? `${items.length} RTI${items.length === 1 ? " aberta" : "s abertas"} com confirmação atual` : null,
          unconfirmedItems.length ? `${unconfirmedItems.length} RTI${unconfirmedItems.length === 1 ? " de fonte com situação atual não confirmada" : "s de fonte com situação atual não confirmada"}` : null]
          .filter(Boolean).join(" · ") || (history.length ? "Sem RTI aberta conforme confirmação registrada" : "Nenhuma RTI vinculada"),
      },
      nr13: {
        scope,
        scopeLabel,
        reviewed,
        compatible,
        classificationId: classification?.id || null,
        method: classification?.classificationMethod || null,
        reference: nonempty(classification?.reference),
        basis: nonempty(classification?.basis),
        source: classification?.source || null,
        categoryApplicable,
        category: categoryApplicable ? documentedCategory : null,
        categoryLabel: categoryApplicable ? documentedCategory : asset.type === "tanque" && compatible
          ? "Não se aplica à categoria I–V de vasos" : "Pendente de confirmação",
        fluid,
        fluidClass: reviewed && compatible && ["A", "B", "C", "D"].includes(result.fluidClass) ? result.fluidClass : null,
        operatingPressure: technicalValue(asset, "operationPressure", "Pressão de projeto / operação / MAOP"),
        pressureClass: technicalValue(asset, "pressureClass", "Classe de pressão"),
        volume: technicalValue(asset, "volume", "Volume nominal"),
        nextInspection: deadline?.due || "Pendente",
        nextInspectionDate: deadline?.due || null,
        nextInspectionRecord: deadline,
      },
      book: { pending, documentCount: documents.length, inspectionCount: inspections.length,
        statusLabel: "Conformidade a verificar", inspectionLabel: inspections.length ? "Consultar histórico registrado" : "Histórico de inspeções pendente" },
      moduleOwner: asset.type === "valvula" ? "valvulas" : ["linha", "segmento"].includes(asset.type) ? "integridade" : null,
    };
  }
  return Object.freeze({ describe, describeRti });
});
