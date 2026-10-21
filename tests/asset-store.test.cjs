"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store } = require("../lib/asset-store.cjs");
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pires-store-")),
    db = path.join(dir, "test.sqlite"),
    store = new Store(db);
  t.after(() => {
    try {
      store.close();
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, db };
}
const actor = "Operador do teste";
function seed(s) {
  const c = s.createCompany(
      "Empresa de teste isolado",
      "Fonte exclusiva do teste",
      actor,
    ),
    h = s.hierarchy(c.id, "Unidade T", "Sistema T", actor);
  const a = s.createAsset(
    c.id,
    {
      unitId: h.unit.id,
      systemId: h.system.id,
      tag: "TAG repetível",
      type: "vaso",
    },
    actor,
  );
  return { c, h, a };
}
function source(s, tag = "LINHA-T") {
  return s.source("fixture.xlsx", Buffer.from("fixture-" + tag), {
    sheets: [
      {
        name: "Aba conferida ",
        maxRow: 18,
        maxColumn: 3,
        rows: [
          { row: 1, values: ["Empresa de teste isolado"] },
          { row: 16, values: [tag, "segmento A", 8] },
          { row: 17, values: [tag, "segmento B", 9] },
          { row: 18, values: [null] },
        ],
      },
    ],
  });
}
function preview(s, src, c) {
  return s.preview({
    sourceId: src.id,
    sourceIdentity: "arquivo-estavel-teste",
    sheet: "Aba conferida ",
    companyName: "Empresa de teste isolado",
    companyCell: "A1",
    companyId: c,
    unit: "Unidade T",
    system: "Sistema T",
    systemEvidence: "Confirmação do teste, conteúdo conferido",
    start: 16,
    end: 18,
    type: "linha",
    mapping: { tag: "A", segment: "B", operationPressure: "C" },
    units: { operationPressure: "bar" },
  });
}
test("importação preserva repetições legítimas, unidades, origem e é idempotente após reabrir banco", (t) => {
  const { store: s, db } = setup(t);
  const c = s.createCompany(
      "Empresa de teste isolado",
      "Fonte do teste",
      actor,
    ),
    src = source(s);
  const p = preview(s, src, c.id);
  assert.equal(p.rows.length, 2);
  assert.ok(p.warnings.some((w) => w.includes("repetido")));
  assert.throws(() => s.commitPreview(p.id, actor, false), /Confirme/);
  const r = s.commitPreview(p.id, actor, true);
  assert.equal(r.inserted, 2);
  const rows = s.list(c.id, "asset");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].source.row, 16);
  assert.equal(rows[0].source.sheet, "Aba conferida ");
  assert.equal(rows[0].technical.operationPressure.unit, "bar");
  assert.equal(rows[0].operation, "nao_informado");
  const retry = s.commitPreview(preview(s, src, c.id).id, actor, true);
  assert.equal(retry.inserted, 0);
  assert.equal(retry.unchanged, 2);
  const second = new Store(db);
  assert.equal(second.list(c.id, "asset").length, 2);
  second.close();
});
test("nome da empresa, unidades, células com fórmula e mudanças na fonte são bloqueados sem gravação parcial", (t) => {
  const { store: s } = setup(t);
  const c = s.createCompany("Empresa de teste isolado", "Fonte", actor),
    src = source(s),
    p = preview(s, src, c.id);
  s.commitPreview(p.id, actor, true);
  const changed = source(s, "OUTRA-TAG"),
    p2 = preview(s, changed, c.id);
  assert.equal(p2.rows[0].action, "conflito");
  assert.throws(() => s.commitPreview(p2.id, actor, true), /revisão/);
  assert.equal(s.list(c.id, "asset").length, 2);
  assert.throws(
    () => s.preview({ ...p, companyName: "Nome presumido" }),
    /diverge/,
  );
  assert.throws(() => s.preview({ ...p, units: {} }), /unidade original/);
  const formulas = source(s, '=HYPERLINK("x")');
  assert.throws(() => preview(s, formulas, c.id), /fórmula/);
});
test("IDs de outra empresa não podem vincular ativos, contratos, documentos, inspeções ou anexos", (t) => {
  const { store: s } = setup(t),
    { c, h, a } = seed(s),
    other = s.createCompany("Outra empresa do teste", "Outra fonte", actor);
  assert.throws(() => s.get(other.id, a.id), /nesta empresa/);
  assert.throws(
    () =>
      s.contract(
        other.id,
        { name: "C", source: "Contrato", modules: ["nr13"], assetIds: [a.id] },
        actor,
      ),
    /nesta empresa/,
  );
  assert.throws(
    () =>
      s.bookItem(
        other.id,
        { assetId: a.id, type: "Prontuário", basis: "Aplicável" },
        actor,
      ),
    /nesta empresa/,
  );
  assert.throws(
    () =>
      s.createAsset(
        other.id,
        { tag: "X", type: "linha", unitId: h.unit.id, systemId: h.system.id },
        actor,
      ),
    /nesta empresa/,
  );
});
test("book exige etapas, anexo não aprova, nova revisão preserva e substitui somente ao ser aprovada", (t) => {
  const { store: s } = setup(t),
    { c, a } = seed(s);
  const d = s.bookItem(
    c.id,
    {
      assetId: a.id,
      type: "Relatório de inspeção",
      basis: "Critério específico documentado",
    },
    actor,
  );
  s.applicability(
    c.id,
    d.id,
    { status: "aplicavel", basis: "Critério específico conferido" },
    actor,
  );
  let r = s.revision(c.id, { documentId: d.id, revision: "00" }, actor);
  assert.throws(
    () =>
      s.transition(
        c.id,
        r.id,
        { status: "aprovado", reason: "Decisão" },
        actor,
      ),
    /Transição/,
  );
  for (const status of ["em_elaboracao", "em_revisao"])
    r = s.transition(c.id, r.id, { status, reason: "Etapa conferida" }, actor);
  assert.throws(
    () =>
      s.transition(
        c.id,
        r.id,
        { status: "aprovado", reason: "Revisado" },
        actor,
      ),
    /anexo/,
  );
  r = s.attach(
    c.id,
    r.id,
    {
      name: "teste.txt",
      base64: Buffer.from("Anexo de teste").toString("base64"),
    },
    actor,
  );
  assert.equal(r.status, "em_revisao");
  r = s.transition(
    c.id,
    r.id,
    { status: "devolvido", reason: "Corrigir referência" },
    actor,
  );
  for (const status of ["em_elaboracao", "em_revisao", "aprovado"])
    r = s.transition(
      c.id,
      r.id,
      { status, reason: "Evidência do teste" },
      actor,
    );
  assert.throws(
    () => s.attach(c.id, r.id, { name: "x", base64: "eA==" }, actor),
    /encerrada/,
  );
  let v = s.revision(c.id, { documentId: d.id, revision: "01" }, actor);
  assert.equal(s.get(c.id, r.id).status, "aprovado");
  v = s.attach(c.id, v.id, { name: "revisao.txt", base64: "eA==" }, actor);
  for (const status of ["em_elaboracao", "em_revisao", "aprovado"])
    v = s.transition(
      c.id,
      v.id,
      { status, reason: "Revisão concluída" },
      actor,
    );
  assert.equal(s.get(c.id, r.id).status, "substituido");
  assert.ok(s.history(c.id, r.id).length >= 8);
});
test("ativo e histórico sobrevivem a novo contrato; operação, condição técnica e RTI independentes", (t) => {
  const { store: s } = setup(t),
    { c, a } = seed(s);
  const b = {
    name: "Contrato teste 1",
    source: "Documento teste",
    modules: ["integridade", "rtis"],
    assetIds: [a.id],
  };
  const one = s.contract(c.id, b, actor);
  s.contract(c.id, { ...b, name: "Contrato teste 2" }, actor);
  s.updateOperation(
    c.id,
    a.id,
    { operation: "em_operacao", evidence: "Registro operacional" },
    actor,
  );
  s.rti(
    c.id,
    {
      assetId: a.id,
      contractId: one.id,
      title: "Pendência teste",
      source: "Fonte da RTI",
    },
    actor,
  );
  assert.equal(s.list(c.id, "asset").length, 1);
  assert.equal(s.get(c.id, a.id).technicalCondition, "nao_avaliado");
  assert.equal(s.get(c.id, a.id).operation, "em_operacao");
  assert.equal(s.metrics(c.id, one.id).openRTIs, 1);
  assert.equal(s.list(c.id, "rti")[0].due, null);
});
test("indicadores distinguem planejamento, execução, entrega e aprovação sem metas inventadas", (t) => {
  const { store: s } = setup(t),
    { c, a } = seed(s);
  const con = s.contract(
    c.id,
    {
      name: "Contrato teste",
      source: "Documento teste",
      modules: ["nr13"],
      assetIds: [a.id],
    },
    actor,
  );
  let m = s.metrics(c.id, con.id);
  assert.equal(m.planned, null);
  assert.equal(m.dailyTarget, null);
  assert.deepEqual(m.curve, []);
  const i = s.inspection(
    c.id,
    {
      assetId: a.id,
      contractId: con.id,
      module: "nr13",
      type: "externa",
      planned: "2026-01-01",
      planningSource: "Plano teste",
    },
    actor,
  );
  s.inspection(
    c.id,
    { ...i, done: "2026-01-02", executionSource: "Registro executado" },
    actor,
  );
  m = s.metrics(c.id, con.id, "nr13", "2026-01-02");
  assert.equal(m.executed, 1);
  assert.equal(m.expectedReports, 1);
  assert.equal(m.deliveredReports, 0);
  assert.equal(m.pendingReports, 1);
  const d = s.bookItem(
    c.id,
    { assetId: a.id, type: "Relatório de inspeção", basis: "Critério teste" },
    actor,
  );
  let r = s.revision(c.id, { documentId: d.id, revision: "00" }, actor);
  r = s.attach(c.id, r.id, { name: "teste.txt", base64: "eA==" }, actor);
  s.report(
    c.id,
    {
      inspectionId: i.id,
      revisionId: r.id,
      delivered: "2026-01-03",
      source: "Protocolo teste",
    },
    actor,
  );
  m = s.metrics(c.id, con.id);
  assert.equal(m.deliveredReports, 1);
  assert.equal(m.pendingReports, 0);
  assert.equal(s.get(c.id, r.id).status, "pendente");
});
test("enquadramento reutiliza motor e prazo exige revisão, referência e marco; não agenda automaticamente", (t) => {
  const { store: s } = setup(t),
    { c, a } = seed(s);
  const inputs = {
    nrProfile: "cylindrical",
    nrSource: "Fonte teste",
    nrHead: "elliptical",
    nrMaterialKind: "metal",
    nrExclusion: "none",
    nrFluid: "air",
    nrFluidSource: "Ar comprimido",
    nrDiameter: "1500",
    nrDiameterUnit: "mm",
    nrVolume: "7",
    nrVolumeUnit: "m3",
    nrPressure: "8",
    nrPressureUnit: "bar",
    nrRegime: "positive",
  };
  const r = s.classify(
    c.id,
    a.id,
    { inputs, evidence: "Documentação teste" },
    actor,
  );
  assert.deepEqual(r.result, require("../app/nr13.js").assess(inputs));
  const snapshot = {
    type: "pmta",
    engineVersion: require("../app/nr13.js").VERSION,
    inputs,
    results: r.result,
  };
  const imported = s.classify(
    c.id,
    a.id,
    { inputs, snapshot, evidence: "JSON salvo no teste" },
    actor,
  );
  assert.ok(imported.sourceSnapshotHash);
  assert.throws(
    () =>
      s.classify(
        c.id,
        a.id,
        {
          inputs,
          snapshot: { ...snapshot, results: { ...r.result, category: "I" } },
          evidence: "Snapshot adulterado",
        },
        actor,
      ),
    /diverge/,
  );
  assert.equal(s.list(c.id, "deadline").length, 0);
  const b = {
    assetId: a.id,
    classificationId: r.id,
    type: "externa",
    normVersion: "Versão documentada no teste",
    clause: "Item específico",
    basis: "Justificativa do responsável",
    conditions: "Condições documentadas",
    inputData: "Categoria e dados conferidos",
    start: "2026-01-01",
    due: "2027-01-01",
  };
  assert.throws(() => s.deadline(c.id, b, actor), /revisado/);
  const book = s.bookItem(
    c.id,
    {
      assetId: a.id,
      type: "Prontuário",
      basis: "Item para conferir",
      module: "nr13",
    },
    actor,
  );
  assert.throws(
    () =>
      s.applicability(
        c.id,
        book.id,
        {
          status: "aplicavel",
          basis: "Norma de teste",
          classificationId: r.id,
        },
        actor,
      ),
    /revisado/,
  );
  s.reviewClassification(
    c.id,
    r.id,
    { status: "revisado", reason: "Dados conferidos no teste" },
    actor,
  );
  s.applicability(
    c.id,
    book.id,
    {
      status: "aplicavel",
      basis: "Norma de teste, aplicabilidade conferida",
      classificationId: r.id,
    },
    actor,
  );
  const d = s.deadline(c.id, b, actor);
  assert.equal(d.due, "2027-01-01");
  assert.throws(
    () => s.deadline(c.id, { ...b, clause: "" }, actor),
    /obrigatório/,
  );
});
