"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  { jsPDF } = require("jspdf");
const { Store } = require("../lib/asset-store.cjs");
test("PDF de controle mantém página/item, ignora itens vazios e não cria contrato, relatório ou aprovação", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pires-pdf-")),
    file = path.join(dir, "fixture.pdf"),
    s = new Store(path.join(dir, "test.sqlite"));
  t.after(() => {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(8);
  doc.text("AMOSTRA - Execution Control", 320, 65);
  doc.text("EMPRESA FIXTURE - LOCAL FIXTURE", 330, 78);
  doc.text("REF OS-000-00", 330, 90);
  doc.setFontSize(4);
  for (const [text, x] of [
    ["Item", 41],
    ["TAG", 70],
    ["P&ID", 122],
    ["Module", 169],
    ["System", 205],
    ["Comments", 427],
  ])
    doc.text(text, x, 123);
  for (let item = 1; item <= 3; item++) {
    const y = 140 + (item - 1) * 13.2;
    doc.text(String(item), 42, y);
    if (item < 3) {
      doc.text("LINHA-FIXTURE-" + item, 62, y);
      doc.text("13/12/2024", 236, y);
      doc.text("14/12/2024", 278, y);
      doc.text("1,0", 320, y);
      doc.text("1,0", 345, y);
      doc.text("1,0", 365, y);
      doc.text("100%", 384, y);
    }
  }
  const bytes = Buffer.from(doc.output("arraybuffer"));
  fs.writeFileSync(file, bytes);
  const read = spawnSync(
    "python",
    [path.resolve(__dirname, "../lib/pdf-control.py"), file],
    { encoding: "utf8" },
  );
  assert.equal(read.status, 0, read.stderr);
  const wb = JSON.parse(read.stdout);
  assert.equal(wb.metadata.companyName, "EMPRESA FIXTURE");
  assert.equal(wb.metadata.system, "AMOSTRA");
  assert.equal(wb.sheets[0].rows.length, 3);
  const src = s.source("controle-fixture.pdf", bytes, wb),
    body = {
      sourceId: src.id,
      sourceIdentity: "fonte-fixture-estavel",
      companyName: wb.metadata.companyName,
      unit: "Unidade confirmada do teste",
      system: wb.metadata.system,
      systemEvidence: "Confirmação exclusiva do teste",
      brandName: "Nome atual confirmado no teste",
      brandEvidence: "Confirmação explícita de teste",
    };
  const p = s.preview(body);
  assert.equal(p.rows.length, 2);
  assert.ok(p.warnings.some((w) => w.includes("Item 3")));
  const r = s.commitPreview(p.id, "Operador fixture", true),
    assets = s.list(r.company.id, "asset");
  assert.equal(r.company.name, "EMPRESA FIXTURE");
  assert.equal(r.company.displayName, body.brandName);
  assert.ok(
    assets.every(
      (a) =>
        a.source.page === 1 &&
        a.source.sheet === null &&
        a.source.row === null &&
        a.source.item &&
        Object.keys(a.technical).length === 0 &&
        a.technicalCondition === "nao_avaliado",
    ),
  );
  assert.equal(s.list(r.company.id, "inspection").length, 4);
  assert.ok(
    s
      .list(r.company.id, "inspection")
      .every((i) => i.done === "2024-12-14" && !i.contractId),
  );
  for (const kind of ["contract", "document", "revision", "rti", "deadline"])
    assert.equal(s.list(r.company.id, kind).length, 0);
  const again = s.commitPreview(
    s.preview({ ...body, companyId: r.company.id }).id,
    "Operador fixture",
    true,
  );
  assert.equal(again.inserted, 0);
  assert.equal(again.unchanged, 2);
  assert.equal(s.list(r.company.id, "inspection").length, 4);
});
