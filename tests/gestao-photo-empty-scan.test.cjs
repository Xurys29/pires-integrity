"use strict";
// Actual Edge handler/validator/candidate SQL; Auth, transport, licensing and
// Storage are isolated fixtures. This does not validate Supabase production.
const { test } = require("node:test"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const { createScopedEdgeFixture } = require("./fixtures/gestao-scoped-edge.cjs");
const jpegFixtures = require("./fixtures/jpeg-scan-fixtures.json");

const photos = async (f) => (await f.db.query("select count(*)::int n from pi_gestao_private.records where kind='photo'")).rows[0].n;
function uploadJpeg(f, bytes) {
  const d = f.detail;
  return f.send("execution/" + d.inspection.id + "/items/" + d.execution.items[0].lvtItemId + "/photos/" + randomUUID(), undefined, {
    raw: bytes, headers: { "Content-Type": "image/jpeg", "X-Pires-Source-Name": "FOTO-EXCLUSIVAMENTE-SINTETICA.jpg", "X-Pires-Execution-Version": String(d.execution.version) },
  });
}
test("Edge/SQL: JPEG sem imagem não é armazenado nem satisfaz a foto obrigatória de boas condições", async (t) => {
  const f = await createScopedEdgeFixture(t), bytes = Buffer.from(jpegFixtures.baseline.base64, "base64");
  const sos = bytes.indexOf(Buffer.from([255, 218])), scanStart = sos + 2 + bytes.readUInt16BE(sos + 2);
  const empty = Buffer.concat([bytes.subarray(0, scanStart), Buffer.from([255, 217])]);
  const originalFiles = f.files.size, originalSources = (await f.db.query("select count(*)::int n from pi_gestao_private.sources")).rows[0].n;
  f.events.length = 0;
  const result = await uploadJpeg(f, empty);
  assert.equal(result.status, 400); assert.equal(result.data.code, "invalid_document_original");
  assert.equal(f.events.some((e) => ["serviceClient", "upload", "serviceRpc"].includes(e.kind)), false);
  assert.equal(f.files.size, originalFiles); assert.equal(await photos(f), 0);
  assert.equal((await f.db.query("select count(*)::int n from pi_gestao_private.sources")).rows[0].n, originalSources);
  const date = (await f.db.query("select current_date::text d")).rows[0].d;
  const saved = await f.send("execution-save", {
    inspectionId: f.inspection.id, expectedVersion: f.detail.execution.version, requestId: randomUUID(), observedOn: date, outcome: "good_condition",
    coverage: { extent: "declared_section", description: "TRECHO EXCLUSIVAMENTE SINTETICO", photoIds: [] },
    answers: [{ catalogItemId: "item-scoped-fixture", itemKey: "ITEM-SINTETICO", conditionId: "good-scoped", recommendationId: "none-scoped", notCovered: false, photoIds: [] }],
  });
  assert.equal(saved.status, 400); assert.equal(saved.data.code, "validation_failed");
  const detail = await f.send("execution/" + f.inspection.id);
  assert.equal(detail.data.execution.version, f.detail.execution.version); assert.equal(detail.data.execution.outcome, "pending");
});
test("Edge/SQL: fotos JPEG válidas baseline e progressivas com restart são preservadas no próprio item", async (t) => {
  const f = await createScopedEdgeFixture(t);
  for (const mode of ["baseline", "progressive"]) {
    const bytes = Buffer.from(jpegFixtures[mode].base64, "base64"), result = await uploadJpeg(f, bytes);
    assert.equal(result.status, 200, mode); assert.equal(result.data.linked, true);
    assert.equal(result.data.source.sha, jpegFixtures[mode].sha256); assert.equal(result.data.photo.lvtItemId, f.detail.execution.items[0].lvtItemId);
    const loaded = await f.send("execution/" + f.inspection.id + "/sources/" + result.data.source.sha);
    assert.equal(loaded.status, 200); assert.deepEqual(Buffer.from(await loaded.response.arrayBuffer()), bytes);
  }
  assert.equal(await photos(f), 2);
});
