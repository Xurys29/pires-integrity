"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { describe, describeRti } = require("../app/gestao-asset-cards.js");
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const asset = (extra = {}) => ({ id: "asset-test", type: "vaso", operation: "nao_informado", technical: {}, ...extra });
const classification = (extra = {}) => ({
  id: "classification-test", assetId: "asset-test", reviewStatus: "revisado",
  inputs: { nrProfile: "cylindrical" },
  result: { profileId: "cylindrical", family: "vessel", scope: "covered", category: "III", fluidClass: "B" }, ...extra,
});
const currentRti = (extra = {}) => ({
  currentness: "confirmed_current", currentnessConfirmedAt: "2026-10-26T00:00:00Z",
  currentnessEvidence: "Confirmação explícita somente da fixture isolada", ...extra,
});
test("operação verde e RTI vermelha são indicadores independentes, sem alterar registros", () => {
  const input = freeze(asset({ operation: "em_operacao" })), state = freeze({ rti: [
    currentRti({ id: "open", assetId: input.id, status: "aberta", title: "RTI fixture", due: null }),
    currentRti({ id: "closed", assetId: input.id, status: "encerrada", title: "RTI fixture encerrada" }),
    currentRti({ id: "other", assetId: "outro-ativo", status: "aberta" }),
  ] });
  const result = describe(input, state);
  assert.deepEqual(result.operation, { label: "Em operação", tone: "green", reason: null, animated: true });
  assert.equal(result.rti.open, true);
  assert.equal(result.rti.label, "1 RTI aberta com confirmação atual");
  assert.deepEqual(result.rti.items.map((r) => r.id), ["open"]);
  assert.deepEqual(result.rti.history.map((r) => r.id), ["open", "closed"]);
  assert.equal(result.nr13.category, null);
});
test("fora de operação e descontinuação são vermelhos com motivo explícito ou ausente", () => {
  const off = describe(asset({ operation: "fora_de_operacao", operationEvidence: "Parada documentada na fonte fixture" }), {});
  assert.equal(off.operation.tone, "red");
  assert.equal(off.operation.animated, true);
  assert.equal(off.operation.reason, "Parada documentada na fonte fixture");
  assert.equal(off.rti.open, false);
  const discontinued = describe(asset({ operation: "descontinuado", operationReason: "Descontinuação documentada", operationEvidence: "Outro documento" }), {});
  assert.equal(discontinued.operation.label, "Descontinuado");
  assert.equal(discontinued.operation.reason, "Descontinuação documentada");
  const absent = describe(asset({ operation: "fora_de_operacao", operationSource: "fora_de_operacao" }), {});
  assert.equal(absent.operation.reason, "Motivo não informado");
});
test("operação desconhecida é neutra e RTI encerrada não mantém alerta ativo", () => {
  const result = describe(asset({ operation: "valor não reconhecido" }), {
    rti: [{ id: "closed", assetId: "asset-test", status: "encerrada" }],
  });
  assert.equal(result.operation.tone, "neutral");
  assert.equal(result.operation.animated, false);
  assert.equal(result.rti.open, false);
  assert.match(result.rti.label, /situação atual não confirmada/);
  assert.equal(result.rti.history.length, 1);
});
test("NR13 exibe somente categoria documentada e revisada, sem confundir fluido e classe", () => {
  const input = freeze(asset({ technical: { fluid: { value: "Produto documentado fixture", source: "Ficha fixture" } } })),
    state = freeze({ classification: [classification()] });
  const result = describe(input, state).nr13;
  assert.equal(result.scope, "covered");
  assert.equal(result.reviewed, true);
  assert.equal(result.categoryApplicable, true);
  assert.equal(result.category, "III");
  assert.equal(result.fluid, "Produto documentado fixture");
  assert.equal(result.fluidClass, "B");
  assert.equal(result.nextInspection, "Pendente");
  assert.equal(describe(asset(), { classification: [classification({ reviewStatus: "pendente" })] }).nr13.category, null);
  assert.equal(describe(asset(), { classification: [classification({ reviewStatus: "devolvido" })] }).nr13.scope, "pending");
  assert.equal(describe(asset(), { classification: [classification({ result: { profileId: "cylindrical", family: "vessel", scope: "excluded", category: "III" } })] }).nr13.category, null);
});
test("tanque não herda categoria de vaso nem classificação incompatível", () => {
  const tank = asset({ type: "tanque" }), mismatch = describe(tank, { classification: [classification()] }).nr13;
  assert.equal(mismatch.compatible, false);
  assert.equal(mismatch.scope, "pending");
  assert.equal(mismatch.categoryApplicable, false);
  assert.equal(mismatch.category, null);
  assert.match(mismatch.scopeLabel, /incompatíveis/);
  const recorded = classification({ inputs: { nrProfile: "atmospheric" }, result: { profileId: "atmospheric", family: "tank", scope: "covered", category: "III", fluidClass: "A" } }),
    proper = describe(tank, { classification: [recorded] }).nr13;
  assert.equal(proper.scope, "covered");
  assert.equal(proper.reviewed, true);
  assert.equal(proper.category, null);
  assert.match(proper.categoryLabel, /Não se aplica/);
  assert.equal(describe(asset({ type: "caldeira" }), { classification: [classification()] }).nr13.category, null);
  assert.equal(describe(asset({ type: "valvula" }), { classification: [classification()] }).moduleOwner, "valvulas");
});
test("próxima inspeção usa apenas prazo registrado do próprio ativo, preservando vencidos", () => {
  const result = describe(asset(), { classification: [classification()], deadline: [
    { id: "old", assetId: "asset-test", type: "interna", due: "2027-02-01" },
    { id: "current", assetId: "asset-test", type: "interna", due: "2028-02-01" },
    { id: "overdue", assetId: "asset-test", type: "externa", due: "2024-02-29", clause: "Referência fixture" },
    { id: "other", assetId: "outro-ativo", type: "externa", due: "2020-01-01" },
    { id: "invalid", assetId: "asset-test", type: "outra", due: "2025-02-29" },
  ] }).nr13;
  assert.equal(result.nextInspection, "2024-02-29");
  assert.equal(result.nextInspectionRecord.id, "overdue");
  assert.equal(describe(asset(), { classification: [classification({ result: { intervals: { withoutSPIE: { external: 1 } } } })] }).nr13.nextInspection, "Pendente");
});
test("campos ausentes permanecem pendentes e perfil mais recente não revisado não vira aprovação", () => {
  const empty = describe(null, null);
  assert.equal(empty.operation.tone, "neutral");
  assert.equal(empty.nr13.scope, "pending");
  assert.equal(empty.nr13.category, null);
  assert.equal(empty.nr13.fluid, "Não informado");
  assert.equal(empty.nr13.nextInspection, "Pendente");
  const current = describe(asset(), { classification: [classification(), classification({ id: "new", reviewStatus: "pendente" })] }).nr13;
  assert.equal(current.category, null);
  assert.equal(current.classificationId, "new");
});
test("UMD publica descritor no navegador sem executar o motor NR13", () => {
  const context = { IntegrityNR13: { CATALOG: [{ id: "cylindrical", family: "vessel" }], assess() { throw Error("Não chamar assess"); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../app/gestao-asset-cards.js"), "utf8"), context);
  assert.equal(typeof context.PiresAssetCards.describe, "function");
  assert.equal(context.PiresAssetCards.describe(asset(), { classification: [classification()] }).nr13.category, "III");
  assert.equal(typeof context.PiresAssetCards.describeRti, "function");
});
test("enquadramento documentado permanece independente de book e inspeções ausentes", () => {
  const input = freeze(asset({ type: "tanque", bookPending: ["Histórico de inspeções a localizar", "FDS a confirmar"],
    technical: { fluid: { value: "Clean Diesel" } },
    datasheet: { "Pressão de projeto / operação / MAOP": "Atmosférica", "Volume nominal": "112,5 m³" } }));
  const documented = classification({ classificationMethod: "documented", assetType: "tanque", source: { sourceId: "fixture-source" },
    reference: "Plano fixture", responsible: "Responsável documentado fixture", basis: "Declaração literal da fonte fixture",
    result: { scope: "covered", category: null } });
  const result = describe(input, freeze({ classification: [documented] }));
  assert.equal(result.nr13.scope, "covered");
  assert.match(result.nr13.scopeLabel, /conforme plano/);
  assert.equal(result.book.inspectionCount, 0);
  assert.equal(result.book.pending.length, 2);
  assert.equal(result.book.statusLabel, "Conformidade a verificar");
  assert.equal(result.nr13.operatingPressure, "Atmosférica");
  assert.equal(result.nr13.pressureClass, null);
  assert.equal(result.nr13.fluidClass, null);
  assert.equal(result.nr13.category, null);
  assert.equal(result.nr13.nextInspectionDate, null);
});
test("cálculo incompleto posterior não revoga enquadramento do plano nem encerra pendências", () => {
  const input = freeze(asset({ type: "tanque", bookPending: ["Histórico pendente"] }));
  const doc = classification({ id: "plan", classificationMethod: "documented", assetType: "tanque", source: { sourceId: "fixture-source" },
    reference: "Plano de inspeção fixture", responsible: "Responsável fixture", basis: "Indicação NR-13 da fonte", result: { scope: "covered" } });
  const auto = classification({ id: "auto", classificationMethod: "automatic_nr13", assetType: "tanque", ruleVersion: "NR13-2022/2026.1", source: { sourceId: "fixture-source" }, reviewStatus: "calculado", result: { scope: "pending", missing: ["Critério dimensional"] } });
  const result = describe(input, freeze({ classification: [doc, auto] }));
  assert.equal(result.nr13.classificationId, "plan");
  assert.equal(result.nr13.scopeLabel, "Enquadrado NR-13 · conforme plano");
  assert.deepEqual(result.book.pending, ["Histórico pendente"]);
  assert.equal(auto.result.scope, "pending");
  assert.equal(describe(input, { classification: [{ ...doc, reviewStatus: "devolvido" }, auto] }).nr13.classificationId, "auto");
  assert.equal(describe(input, { classification: [doc, { ...doc, id: "revision", result: { scope: "pending" } }, auto] }).nr13.scope, "pending");
});
test("pressão preserva zero e unidade sem inferir classe mecânica ou de fluido", () => {
  const result = describe(asset({ technical: { operationPressure: { value: 0, unit: "kPa" }, pressureClass: { value: "150", unit: "ASME" } } })).nr13;
  assert.equal(result.operatingPressure, "0 kPa");
  assert.equal(result.pressureClass, "150 ASME");
  assert.equal(result.fluidClass, null);
});
test("book conta apenas registros do próprio ativo sem declarar conformidade pela quantidade", () => {
  const result = describe(asset(), { document: [{ assetId: "other" }, { assetId: "asset-test" }, { assetId: "asset-test", recordClass: "classification" }], inspection: [{ assetId: "other" }] });
  assert.equal(result.book.documentCount, 1);
  assert.equal(result.book.inspectionCount, 0);
  assert.equal(result.book.statusLabel, "Conformidade a verificar");
});
test("status aberto legado ou importado não comprova RTI aberta hoje, nem com prazo futuro", () => {
  for (const marker of [undefined, "unknown", "historical", "unexpected"]) {
    const record = freeze({ id: "source-only", assetId: "asset-test", status: "aberta", currentness: marker,
      sourceStatus: " ABERTA ", sourceDate: "30/07/2024", due: "2099-12-31", createdAt: "2026-10-26T00:00:00Z",
      openingEvidence: "Abertura documentada na fonte fixture antiga", source: { sourceId: "fixture-source", locator: { sheet: "Fonte fixture", row: 16 } } });
    const result = describe(asset({ operation: "em_operacao" }), freeze({ rti: [record] }));
    assert.equal(result.operation.tone, "green");
    assert.equal(result.rti.open, false);
    assert.equal(result.rti.reportedOpen, true);
    assert.equal(result.rti.items.length, 0);
    assert.deepEqual(result.rti.reportedItems, [record]);
    assert.deepEqual(result.rti.history, [record]);
    assert.match(result.rti.currentnessLabel, /Alerta RTI reportado na fonte; situação atual não confirmada/);
    const detail = describeRti(record);
    assert.equal(detail.sourceStatus, " ABERTA ");
    assert.equal(detail.sourceDate, "30/07/2024");
    assert.equal(detail.currentness, marker === "historical" ? "historical" : "unknown");
    assert.equal(detail.confirmedAt, null);
  }
});
test("importação mantém situação desconhecida e data ausente sem inventar abertura nem encerrar histórico", () => {
  const record = freeze({ id: "unknown-source", assetId: "asset-test", status: "atualidade_desconhecida", currentness: "unknown",
    sourceStatus: "CONCLUÍDO NA FONTE FIXTURE", sourceDate: null, sourceDateMissingReason: "Documento fixture sem data de situação",
    closedAt: "2024-07-30", closureEvidence: "Texto histórico da fixture" });
  const result = describe(asset(), freeze({ rti: [record] })), detail = describeRti(record);
  assert.equal(result.rti.open, false);
  assert.equal(result.rti.reportedOpen, false);
  assert.equal(result.rti.history.length, 1);
  assert.equal(result.rti.unconfirmedItems.length, 1);
  assert.match(result.rti.label, /situação atual não confirmada/);
  assert.match(detail.currentnessLabel, /situação atual não confirmada/);
  assert.equal(detail.statusLabel, record.sourceStatus);
  assert.equal(detail.sourceDate, null);
  assert.equal(detail.sourceDateMissingReason, record.sourceDateMissingReason);
});
test("confirmação atual exige marcador, data válida e evidência explícita sem usar dados da fonte", () => {
  const base = { id: "guarded", assetId: "asset-test", status: "aberta", sourceStatus: "ABERTA", sourceDate: "2026-10-26" };
  for (const incomplete of [
    { currentness: "confirmed_current" },
    { currentness: "confirmed_current", currentnessConfirmedAt: "2026-10-26" },
    { currentness: "confirmed_current", currentnessEvidence: "Evidência da fixture" },
    currentRti({ currentnessConfirmedAt: "2025-02-29" }),
    currentRti({ currentnessConfirmedAt: "2026-10-26T24:00:00Z" }),
    currentRti({ currentnessEvidence: "  " }),
    currentRti({ status: "status não reconhecido" }),
  ]) {
    const record = { ...base, ...incomplete }, detail = describeRti(record);
    assert.equal(detail.open, false);
    assert.equal(detail.currentness, "unknown");
    assert.equal(describe(asset(), { rti: [record] }).rti.open, false);
  }
  assert.equal(describeRti(currentRti(base)).open, true);
  assert.equal(describeRti(currentRti({ ...base, status: "encerrada" })).open, false);
  assert.equal(describeRti(currentRti({ ...base, status: "encerrada" })).reportedOpen, false);
});
test("RTI atual confirmada e histórico desconhecido coexistem sem apagar avisos nem duplicar identidade", () => {
  const open = currentRti({ id: "current", assetId: "asset-test", status: "aberta" }),
    historical = { id: "historic", assetId: "asset-test", status: "atualidade_desconhecida", currentness: "historical", sourceStatus: "ABERTA", sourceDate: "2024-07-30" },
    unmatched = currentRti({ id: "unmatched", assetId: null, status: "aberta" }),
    state = freeze({ rti: [open, historical, unmatched] }), result = describe(asset(), state);
  assert.equal(result.rti.open, true);
  assert.equal(result.rti.reportedOpen, true);
  assert.deepEqual(result.rti.items.map((record) => record.id), ["current"]);
  assert.deepEqual(result.rti.reportedItems.map((record) => record.id), ["historic"]);
  assert.deepEqual(result.rti.history.map((record) => record.id), ["current", "historic"]);
  assert.match(result.rti.label, /1 RTI aberta com confirmação atual/);
  assert.match(result.rti.label, /1 RTI de fonte com situação atual não confirmada/);
  assert.equal(state.rti.length, 3);
});
