"use strict";
// Synthetic grid positions, IDs and schematic labels only. No source drawing,
// physical dimension, inspection evidence, account, signature or certification.
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { webcrypto } = require("node:crypto"), Model = require("../prototypes/line-drawing/model.js");
const id = n => "e0000000-0000-4000-8000-" + String(n).padStart(12, "0"), clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const scope = { ownerId: id(1), contractId: id(2), systemId: id(3), assetId: id(4), lineId: id(5), tagLabel: "TAG-SYNTHETIC-LOCAL-ONLY" };
  return { scope, symbolLibraryVersion: Model.SYMBOL_LIBRARY_VERSION, grid: { columns: 40, rows: 40 },
    nodes: [{ id: id(10), x: 3, y: 4 }, { id: id(11), x: 10, y: 4 }, { id: id(12), x: 10, y: 12 }],
    segments: [{ id: id(20), fromNodeId: id(10), toNodeId: id(11) }, { id: id(21), fromNodeId: id(11), toNodeId: id(12) }],
    symbols: [{ id: id(30), kind: "valve", anchor: { kind: "segment", segmentId: id(20), ratio: 0.5 } }],
    inspectionPoints: [{ id: id(40), label: "POINT-SYNTHETIC", anchor: { kind: "node", nodeId: id(11) }, links: null }] };
}
function empty() { const value = fixture(); value.nodes = []; value.segments = []; value.symbols = []; value.inspectionPoints = []; return value; }
function withLinks() {
  const value = fixture(), { tagLabel, ...scope } = value.scope;
  value.inspectionPoints[0].links = { scope, lvtItemId: id(50), photoIds: [id(51)], rtiIds: [id(52)] }; return value;
}
async function rejected(promise, pattern) { await assert.rejects(promise, error => error.code === "invalid_line_drawing" && (!pattern || pattern.test(error.message))); }

test("UMD exports work in Node and a browser realm without module/require", async () => {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, fixtureText: JSON.stringify(empty()) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../prototypes/line-drawing/model.js"), "utf8"), context);
  assert.equal(vm.runInContext("PiresLineDrawingModel.SCHEMA", context), Model.SCHEMA);
  const browser = await vm.runInContext("PiresLineDrawingModel.createHistory(JSON.parse(fixtureText))", context);
  assert.equal(browser.snapshots.length, 1); assert.equal(browser.gridUnits, "none");
  assert.equal(browser.historyDigest, (await Model.createHistory(empty())).historyDigest);
  assert.equal(Object.isFrozen(Model), true); assert.equal(Object.isFrozen(Model.SYMBOLS[0]), true);
});

test("first local snapshot preserves explicit positions and declared TAG, with no units, source proof or certification", async () => {
  const input = fixture(), before = clone(input), history = await Model.createHistory(input), saved = history.snapshots[0];
  assert.deepEqual(input, before); assert.deepEqual(saved.content, before); assert.deepEqual(history.scope, input.scope);
  assert.equal(saved.internalRevision, 1); assert.equal(saved.previousSnapshotDigest, null);
  assert.match(history.historyDigest, /^sha256:[a-f0-9]{64}$/); assert.match(saved.snapshotDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(history.status, "local_schematic_draft"); assert.equal(history.gridUnits, "none");
  for (const field of ["canCertify", "canIssue", "approvedAsBuilt", "identityVerified", "declaredLinksVerified", "originalSourceVerified"]) assert.equal(history[field], false);
  assert.equal(history.declaredLinksMeaning, "tag_scoped_declarations_only"); assert.deepEqual(history.signatures, []);
  assert.equal(Object.hasOwn(saved.content, "sourceHash"), false); assert.equal(Object.isFrozen(saved.content.nodes[0]), true);
  assert.throws(() => { saved.content.nodes[0].x = 7; }, TypeError);
});

test("save is idempotent for unchanged canonical content and appends changes without rewriting old snapshots", async () => {
  const input = fixture(), first = await Model.createHistory(input), originalText = JSON.stringify(first);
  const reordered = Object.fromEntries(Object.entries(clone(input)).reverse());
  const same = await Model.saveDraft(first, reordered); assert.deepEqual(same, first); assert.equal(same.snapshots.length, 1);
  const changed = clone(input); changed.nodes[0].x = 4;
  const second = await Model.saveDraft(first, changed); assert.equal(second.snapshots.length, 2);
  assert.equal(second.snapshots[1].internalRevision, 2); assert.equal(second.snapshots[1].previousSnapshotDigest, first.snapshots[0].snapshotDigest);
  assert.deepEqual(second.snapshots[0], first.snapshots[0]); assert.equal(JSON.stringify(first), originalText);
  const returned = await Model.saveDraft(second, input); assert.equal(returned.snapshots.length, 3);
  assert.deepEqual(returned.snapshots[2].content, input); assert.equal(returned.snapshots[2].contentDigest, first.snapshots[0].contentDigest);
  assert.deepEqual(await Model.verifyHistory(returned), returned);
});

test("create/save capture caller copies before hashing awaits; later mutations cannot change saved content or history", async () => {
  const initial = fixture(), expected = clone(initial), creating = Model.createHistory(initial); initial.nodes[0].x = 30;
  const first = await creating; assert.deepEqual(first.snapshots[0].content, expected);
  const mutableHistory = clone(first), changed = fixture(); changed.nodes[0].x = 5;
  const saving = Model.saveDraft(mutableHistory, changed); changed.nodes[0].x = 35; mutableHistory.snapshots[0].content.nodes[0].x = 20;
  const second = await saving; assert.equal(second.snapshots[1].content.nodes[0].x, 5); assert.equal(second.snapshots[0].content.nodes[0].x, 3);
});

test("JSON export/import roundtrip verifies the complete scope and history, without mutating exported inputs", async () => {
  const first = await Model.createHistory(withLinks()), changed = withLinks(); changed.nodes[2].y = 15;
  const second = await Model.saveDraft(first, changed), text = await Model.exportJson(second), imported = await Model.importJson(text, second.scope);
  assert.deepEqual(imported, second); assert.equal(await Model.exportJson(imported), text); assert.equal(Object.isFrozen(imported.snapshots), true);
  await rejected(Model.importJson("{not JSON"), /JSON inválido/);
  await rejected(Model.importJson({ history: second }), /JSON UTF-8/);
  for (const key of ["ownerId", "contractId", "systemId", "assetId", "lineId", "tagLabel"]) {
    const expected = clone(second.scope); expected[key] = key === "tagLabel" ? "OTHER-TAG-SYNTHETIC" : id(99);
    await rejected(Model.importJson(text, expected), /escopo declarado divergente/);
    const foreign = withLinks(); foreign.scope[key] = expected[key]; foreign.inspectionPoints[0].links = null;
    await rejected(Model.saveDraft(second, foreign), /escopo declarado divergente/);
  }
});

test("TAG links are optional declarations; valid link scope passes and foreign contract/line declarations fail", async () => {
  const input = withLinks(), history = await Model.createHistory(input);
  assert.deepEqual(history.snapshots[0].content.inspectionPoints[0].links, input.inspectionPoints[0].links);
  for (const key of ["ownerId", "contractId", "systemId", "assetId", "lineId"]) { const wrong = withLinks(); wrong.inspectionPoints[0].links.scope[key] = id(99); await rejected(Model.createHistory(wrong), /escopo declarado divergente/); }
  const tagOnly = withLinks(); tagOnly.inspectionPoints[0].links.lvtItemId = null;
  const declared = await Model.createHistory(tagOnly); assert.equal(declared.declaredLinksMeaning, "tag_scoped_declarations_only"); assert.equal(declared.declaredLinksVerified, false);
  const duplicate = withLinks(); duplicate.inspectionPoints[0].links.photoIds.push(id(51)); await rejected(Model.createHistory(duplicate), /ID repetido/);
  const malformed = withLinks(); malformed.inspectionPoints[0].links.lvtItemId = "not-a-record-ID"; await rejected(Model.createHistory(malformed), /UUID/);
});

test("import with existing history accepts only its exact prefix, preventing local rollback/forks", async () => {
  const first = await Model.createHistory(fixture()), content = fixture(); content.nodes[0].x = 5;
  const second = await Model.saveDraft(first, content); content.nodes[0].x = 6; const third = await Model.saveDraft(second, content);
  await rejected(Model.importJson(await Model.exportJson(first), first.scope, second), /não pode substituir ou remover/);
  assert.deepEqual(await Model.importJson(await Model.exportJson(second), second.scope, second), second);
  assert.deepEqual(await Model.importJson(await Model.exportJson(third), second.scope, second), third);
  for (const invalidBaseline of [false, 0, ""]) await rejected(Model.importJson(await Model.exportJson(second), second.scope, invalidBaseline), /objeto obrigatório/);
  const forkContent = fixture(); forkContent.nodes[0].x = 8; let fork = await Model.createHistory(forkContent);
  forkContent.nodes[0].x = 9; fork = await Model.saveDraft(fork, forkContent);
  assert.equal(fork.snapshots.length, second.snapshots.length);
  assert.deepEqual(await Model.importJson(await Model.exportJson(fork)), fork); // Self-consistency is not authenticity.
  await rejected(Model.importJson(await Model.exportJson(fork), second.scope, second), /não pode substituir ou remover/);
  const currentCopy = clone(second), importing = Model.importJson(await Model.exportJson(third), second.scope, currentCopy);
  currentCopy.snapshots[0].content.nodes[0].x = 25; assert.deepEqual(await importing, third);
  const resumed = await Model.saveDraft(second, first.snapshots[0].content); assert.equal(resumed.snapshots.length, 3);
  assert.deepEqual(resumed.snapshots[0], first.snapshots[0]); assert.deepEqual(resumed.snapshots[2].content, first.snapshots[0].content);
});

test("points and figures require explicit existing node/segment anchors and finite schematic fractions", async () => {
  for (const ratio of [0, 1]) { const value = fixture(); value.symbols[0].anchor.ratio = ratio; await Model.createHistory(value); }
  for (const ratio of [null, "0.5", NaN, Infinity, -0.01, 1.01, undefined]) { const value = fixture(); value.symbols[0].anchor.ratio = ratio; await rejected(Model.createHistory(value)); }
  for (const change of [value => value.inspectionPoints[0].anchor.nodeId = id(99), value => value.symbols[0].anchor.segmentId = id(99),
    value => value.inspectionPoints[0].anchor = null, value => delete value.symbols[0].anchor.ratio,
    value => value.inspectionPoints[0].anchor = { kind: "world", x: 0, y: 0 }, value => value.inspectionPoints[0].anchor.angle = 90]) { const value = fixture(); change(value); await rejected(Model.createHistory(value)); }
});

test("grid and topology validate supplied cells/endpoints without inferring dimensions, intersection or extra nodes", async () => {
  const input = fixture(); input.nodes.push({ id: id(13), x: 3, y: 12 }); input.segments.push({ id: id(22), fromNodeId: id(10), toNodeId: id(12) });
  const saved = await Model.createHistory(input); assert.equal(saved.snapshots[0].content.nodes.length, 4); assert.equal(saved.snapshots[0].content.segments.length, 3);
  for (const change of [value => value.nodes[0].x = -1, value => value.nodes[0].x = 40, value => value.nodes[0].y = 0.5,
    value => value.nodes[0].x = "3", value => delete value.nodes[0].x, value => value.grid.columns = 201,
    value => value.grid.rows = 1, value => value.grid.unit = "mm", value => value.nodes.push({ ...value.nodes[0], id: id(13) }),
    value => value.segments[0].toNodeId = id(99), value => value.segments[0].toNodeId = value.segments[0].fromNodeId,
    value => value.segments.push({ id: id(23), fromNodeId: id(11), toNodeId: id(10) })]) { const value = fixture(); change(value); await rejected(Model.createHistory(value)); }
});

test("symbol library version is fixed per snapshot, unknown versions/types are rejected and shapes are not normative", async () => {
  for (const entry of Model.SYMBOLS) assert.equal(entry.source, "internal_schematic_non_normative");
  const first = await Model.createHistory(fixture()); assert.equal(first.snapshots[0].content.symbolLibraryVersion, Model.SYMBOL_LIBRARY_VERSION);
  const altered = fixture(); altered.nodes[0].y = 3; const second = await Model.saveDraft(first, altered);
  assert.equal(second.snapshots[0].content.symbolLibraryVersion, Model.SYMBOL_LIBRARY_VERSION);
  for (const version of ["future-unavailable", "normative-approved", null, undefined]) { const value = fixture(); value.symbolLibraryVersion = version; await rejected(Model.createHistory(value)); }
  const unknown = fixture(); unknown.symbols[0].kind = "certified-normative-valve"; await rejected(Model.createHistory(unknown), /biblioteca esquemática/);
});

test("history/old content tampering, removal, reordering, scope changes and fake certification are rejected", async () => {
  const first = await Model.createHistory(fixture()), changed = fixture(); changed.nodes[0].x = 5;
  const second = await Model.saveDraft(first, changed); changed.nodes[0].x = 6; const third = await Model.saveDraft(second, changed);
  for (const change of [value => value.snapshots[0].content.nodes[0].x = 7, value => value.snapshots[2].content.nodes[0].x = 7,
    value => value.snapshots.splice(1, 1), value => value.snapshots.shift(), value => value.snapshots.pop(), value => value.snapshots.reverse(),
    value => value.snapshots[2].previousSnapshotDigest = null, value => value.snapshots[0].content.scope.contractId = id(99),
    value => value.scope.contractId = id(99), value => value.historyDigest = "sha256:" + "0".repeat(64),
    value => value.approvedAsBuilt = true, value => value.originalSourceVerified = true, value => value.canCertify = true,
    value => value.signatures.push({ name: "SYNTHETIC-NO-ACT" }), value => value.snapshots[0].content.symbolLibraryVersion = "unknown"])
    { const tampered = clone(third); change(tampered); await rejected(Model.importJson(JSON.stringify(tampered))); }
  const recreated = await Model.createHistory(changed); assert.equal(recreated.snapshots.length, 1);
  assert.equal(recreated.identityVerified, false); assert.deepEqual(recreated.signatures, []); // A self-declared digest is not authentication.
});

test("duplicate IDs/point labels and unsupported source/approval fields do not enter content", async () => {
  for (const change of [value => value.inspectionPoints[0].id = value.nodes[0].id,
    value => value.inspectionPoints.push({ ...clone(value.inspectionPoints[0]), id: id(41), label: " " + value.inspectionPoints[0].label + " " }),
    value => value.approvedAsBuilt = true, value => value.sourceHash = "a".repeat(64), value => value.originalSourceVerified = true,
    value => value.symbols[0].certified = true, value => value.inspectionPoints[0].signature = "SYNTHETIC-NO-ACT",
    value => value.scope.contractId = null, value => value.scope.tagLabel = ""])
    { const input = fixture(); change(input); await rejected(Model.createHistory(input)); }
});

test("malformed/cyclic/getter/deep/oversized inputs fail with the model code without evaluating getters", async () => {
  const getter = fixture(); let called = 0; Object.defineProperty(getter.nodes[0], "x", { enumerable: true, get() { called++; return 3; } });
  await rejected(Model.createHistory(getter), /acessores/); assert.equal(called, 0);
  const cyclic = fixture(); cyclic.extra = cyclic; await rejected(Model.createHistory(cyclic), /sem ciclos/);
  let deep = {}; for (let i = 0; i < 10000; i++) deep = { child: deep }; const nested = fixture(); nested.extra = deep; await rejected(Model.createHistory(nested), /32 níveis/);
  const huge = fixture(); huge.nodes = new Array(1000000); await rejected(Model.createHistory(huge), /1000 elementos/);
  const sparse = fixture(); sparse.nodes = new Array(1); await rejected(Model.createHistory(sparse), /esparsa/);
  const excessive = empty(); excessive.nodes = Array.from({ length: 501 }, (_, n) => ({ id: id(1000 + n), x: n % 40, y: Math.floor(n / 40) })); await rejected(Model.createHistory(excessive), /limite 500/);
  await rejected(Model.importJson(" ".repeat(Model.LIMITS.bytes + 1)), /até 8 MiB/);
});

test("history bound refuses an additional revision instead of deleting or rewriting saved snapshots", async () => {
  let history = await Model.createHistory(empty());
  for (let revision = 2; revision <= Model.LIMITS.snapshots; revision++) { const content = empty(); content.grid.columns = revision % 2 ? 40 : 41; history = await Model.saveDraft(history, content); }
  assert.equal(history.snapshots.length, Model.LIMITS.snapshots); const text = await Model.exportJson(history);
  const changed = empty(); changed.grid.columns = 42; await rejected(Model.saveDraft(history, changed), /não sobrescreva revisões/);
  assert.equal(await Model.exportJson(history), text); assert.equal((await Model.importJson(text)).snapshots[0].internalRevision, 1);
});
