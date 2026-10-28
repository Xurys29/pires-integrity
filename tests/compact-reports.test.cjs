"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { jsPDF } = require("jspdf");
const compact = require("../app/compact-report-pdf.js"),
  full = require("../legacy-cloud/app/calculator-pdf.js"),
  ME = require("../legacy-cloud/app/me-pdf.js"),
  batch = require("../app/me-batch.js"),
  { fixture } = require("./calculator-pdf.fixture.cjs");
function capture(rows) {
  return function (options) {
    const doc = new jsPDF(options),
      text = doc.text;
    doc.text = function (v, x, y, ...args) {
      rows.push({
        text: Array.isArray(v) ? v.join("\n") : v,
        x,
        y,
        page: doc.getNumberOfPages(),
      });
      return text.call(doc, v, x, y, ...args);
    };
    return doc;
  };
}
function model(count = 2) {
  const inputs = fixture("life").inputs;
  return {
    metadata: {
      tag: "TESTE-LAYOUT",
      reportNumber: "TESTE-ME",
      service: "AMOSTRA SINTÉTICA, SEM INSPEÇÃO REAL",
      verdict: "PENDENTE DE VALIDAÇÃO",
    },
    demo: true,
    generatedAt: "2026-10-21T12:00:00Z",
    result: batch.assess(
      Array.from({ length: count }, (_, i) => ({
        name: "P" + (i + 1),
        location: "Localização de teste",
        mechanism: "uniform",
        layout: "four",
        readings: ["0°", "90°", "180°", "270°"].map((position) => ({
          ...inputs,
          position,
          minimumSource: "Fonte sintética de teste",
        })),
      })),
      "2026-10-21",
    ),
    recommendations: ["Documento sintético exclusivo para conferir layout."],
  };
}
test("PMTA compacta tem duas páginas, preserva resultados, unidades e pendências sem alterar snapshot", () => {
  for (const changes of [{}, { shell: "5", headThickness: "5" }]) {
    const s = fixture("pmta", changes),
      before = JSON.stringify(s),
      rows = [],
      r = compact.createPdf(s, { fictitious: true }, capture(rows));
    assert.equal(r.metadata.pageCount, 2);
    assert.equal(JSON.stringify(s), before);
    const text = rows.map((r) => r.text).join("\n");
    assert.match(text, /P \[MPa\] = P \[bar\] \/ 10/);
    assert.match(text, /Espessura requerida casco \/ tampo/);
    assert.match(text, /PMTA completa do equipamento: Pendente/);
    assert.match(text, /sem declaração de\s+conformidade/i);
    assert.ok(rows.every((r) => r.y < 290));
    if (changes.shell) assert.match(text, /RESULTADO ARITMÉTICO INSUFICIENTE/);
  }
});
test("PMTA compacta recusa textos excessivos sem cortar dados silenciosamente", () => {
  assert.throws(
    () =>
      compact.createPdf(
        fixture(),
        { notes: "Texto comprido ".repeat(3000) },
        jsPDF,
      ),
    /duas páginas/,
  );
});
test("vida individual inicia histórico na segunda folha e mantém fórmulas e projeção", () => {
  const rows = [];
  full.createPdf(fixture("life"), {}, capture(rows));
  const first = rows
    .filter((r) => r.page === 1)
    .map((r) => r.text)
    .join("\n");
  assert.match(first, /Identificação e rastreabilidade/);
  assert.doesNotMatch(
    first,
    /Foto do equipamento não informada|Medições, histórico e premissas/,
  );
  assert.ok(rows.find((r) => r.text.includes("02 - Medições")).page >= 2);
});
test("ME limita resumo inicial a seis pontos e mantém todas as posições e rastreio nas folhas seguintes", () => {
  const m = model(10),
    rows = [],
    before = JSON.stringify(m);
  const doc = ME.create(m, capture(rows));
  assert.equal(JSON.stringify(m), before);
  const text = rows.map((r) => r.text).join("\n");
  assert.match(text, /6 de 10 pontos/);
  assert.match(text, /P10/);
  assert.ok(doc.getNumberOfPages() > 2);
  assert.equal(doc.getMESnapshot().snapshotId, ME.snapshot(m).snapshotId);
  assert.match(ME.snapshot(m).snapshotId, /^sha256:[a-f0-9]{64}$/);
  assert.ok(rows.every((r) => r.y < 210));
  assert.doesNotMatch(text, /APROVADO NA COMPARAÇÃO/);
});
