"use strict";
// Synthetic layout artifacts only. Never imports fixtures into the asset database.
const fs = require("node:fs"),
  path = require("node:path"),
  { jsPDF } = require("jspdf");
const { fixture } = require("../tests/calculator-pdf.fixture.cjs"),
  compact = require("../app/compact-report-pdf.js"),
  full = require("../app/calculator-pdf.js"),
  ME = require("../app/me-pdf.js"),
  batch = require("../app/me-batch.js");
const dir = path.resolve(__dirname, "../output/relatorios");
fs.mkdirSync(dir, { recursive: true });
const meta = {
  reportNumber: "AMOSTRA-PMTA",
  revision: "00",
  fictitious: true,
  notes:
    "Amostra sintética exclusiva para conferência visual. Não representa cliente, cadastro ou inspeção real.",
};
const pmta = compact.createPdf(fixture(), meta, jsPDF);
fs.writeFileSync(
  path.join(dir, "PMTA-layout-2-paginas.pdf"),
  Buffer.from(pmta.doc.output("arraybuffer")),
);
const vr = full.createPdf(
  fixture("life"),
  { ...meta, reportNumber: "AMOSTRA-VIDA" },
  jsPDF,
);
fs.writeFileSync(
  path.join(dir, "Vida-residual-layout.pdf"),
  Buffer.from(vr.doc.output("arraybuffer")),
);
const inputs = fixture("life").inputs,
  points = Array.from({ length: 2 }, (_, i) => ({
    name: "P" + (i + 1),
    location: "Localização sintética para teste de layout",
    mechanism: "uniform",
    layout: "four",
    readings: ["0°", "90°", "180°", "270°"].map((position) => ({
      ...inputs,
      position,
      minimumSource: "Referência sintética, exclusiva do ensaio de layout",
    })),
  }));
const model = {
  metadata: {
    tag: "AMOSTRA-ME",
    reportNumber: "AMOSTRA-ME",
    service: "SINTÉTICO - NÃO É INSPEÇÃO",
    material: "Premissa de teste",
    inspector: "Não informado",
    instrument: "Não informado",
    calibration: "Não informado",
    procedure: "Amostra visual",
    orientation: "Quatro geratrizes sintéticas",
    drawing: "Não informado",
    verdict: "PENDENTE DE VALIDAÇÃO",
  },
  demo: true,
  generatedAt: new Date().toISOString(),
  result: batch.assess(points, "2026-10-21"),
  recommendations: [
    "Amostra sintética; nenhum relatório de inspeção de cliente foi produzido.",
  ],
  provenance: { appVersion: "0.6.0", reviewId: "cloud-layout-1" },
};
const me = ME.create(model, jsPDF);
fs.writeFileSync(
  path.join(dir, "ME-layout-primeira-folha.pdf"),
  Buffer.from(me.output("arraybuffer")),
);
fs.writeFileSync(
  path.join(dir, "LEIA-ME.txt"),
  "PDFs sintéticos de conferência visual. Não contêm medições reais e não representam o cadastro importado. Não são relatórios de clientes, inspeções ou aprovações técnicas.\n",
);
console.log(
  JSON.stringify({
    pmtaPages: pmta.doc.getNumberOfPages(),
    vidaPages: vr.doc.getNumberOfPages(),
    mePages: me.getNumberOfPages(),
    output: dir,
  }),
);
