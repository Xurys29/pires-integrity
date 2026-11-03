'use strict';
// Synthetic JSON references only. These are not actual drawings, measurements,
// physical locations, original hashes, technical reviews or signature events.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Model = require('../lib/inspection-drawing-model.cjs');
const id = n => 'd0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const scope = { ownerId: id(1), contractId: id(2), systemId: id(3), assetId: id(4), lineId: id(5) };
  const item = { id: id(10), ...scope, lvtId: id(11), inspectionId: id(12) };
  const photo = { id: id(13), ...scope, lvtId: item.lvtId, lvtItemId: item.id };
  const rti = { id: id(14), ...scope, lvtId: item.lvtId, lvtItemId: item.id, photoIds: [photo.id] };
  return {
    snapshotId: id(20), scope,
    drawing: { documentId: id(6), sourceHash: 'a'.repeat(64), number: 'ISO-SYNTHETIC-NO-TECHNICAL-VALUE', revision: '00', sheet: '1/2' },
    coordinateFrame: { kind: 'normalized_2d', origin: 'top_left', xAxis: 'right', yAxis: 'down' },
    references: { contract: { id: scope.contractId, ownerId: scope.ownerId, assetIds: [scope.assetId] },
      asset: { id: scope.assetId, ownerId: scope.ownerId, systemId: scope.systemId, lineId: scope.lineId, tag: 'TAG-SYNTHETIC-ONLY' },
      line: { id: scope.lineId, ownerId: scope.ownerId, systemId: scope.systemId, assetId: scope.assetId, identifier: 'LINE-SYNTHETIC-ONLY' },
      items: [item], photos: [photo], rtis: [rti] },
    points: [{ id: id(15), label: 'POINT-SYNTHETIC-NO-ANGLE', position: { x: 0.25, y: 0.75 }, lvtItemId: item.id, photoIds: [photo.id], rtiIds: [rti.id] }],
    annotations: [{ id: id(16), source: 'field_survey', pointIds: [id(15)], text: 'SYNTHETIC discrepancy pending technical review' }],
    sketches: [{ id: id(17), source: 'field_survey', pointIds: [id(15)], drawing: { documentId: id(18), sourceHash: 'b'.repeat(64), number: 'SKETCH-SYNTHETIC-ONLY', revision: 'FIELD-00', sheet: '1/1' } }],
  };
}
function empty(input = fixture()) {
  input.references.items = []; input.references.photos = []; input.references.rtis = [];
  input.points = []; input.annotations = []; input.sketches = []; return input;
}
function rejects(input, pattern) {
  assert.throws(() => Model.createDrawingSnapshot(input), error => error.code === 'invalid_inspection_drawing' && (!pattern || pattern.test(error.message)));
}

test('snapshot preserves explicit declared scope, document identity, positions and pending provenance in independent frozen copies', () => {
  const input = fixture(), before = clone(input), snapshot = Model.createDrawingSnapshot(input);
  assert.equal(snapshot.schema, Model.SCHEMA); assert.equal(snapshot.modelVersion, 1); assert.equal(snapshot.modelRevision, 1);
  assert.equal(snapshot.previousSnapshot, null); assert.deepEqual(snapshot.content.scope, input.scope);
  assert.deepEqual(snapshot.content.drawing, input.drawing); assert.equal(snapshot.content.drawing.revision, '00');
  assert.deepEqual(snapshot.content.points[0].position, { x: 0.25, y: 0.75 });
  assert.equal(snapshot.provenance.originalBytesVerified, false); assert.equal(snapshot.provenance.sourceHashStatus, 'reported_unverified');
  assert.equal(snapshot.provenance.relationships, 'caller_declared_consistent_only');
  assert.equal(snapshot.status, 'field_survey_pending_review'); assert.equal(snapshot.approvedAsBuilt, false);
  assert.equal(snapshot.draft, true); assert.equal(snapshot.canIssue, false); assert.deepEqual(snapshot.signatures, []);
  assert.deepEqual(input, before); input.points[0].position.x = 0.99; input.drawing.revision = 'CHANGED';
  assert.equal(snapshot.content.points[0].position.x, 0.25); assert.equal(snapshot.content.drawing.revision, '00');
  assert.ok(Object.isFrozen(snapshot.content.points[0].position)); assert.ok(Object.isFrozen(snapshot.content.references.photos));
  assert.throws(() => { snapshot.content.points[0].position.x = 0.9; }, TypeError);
  const checked = Model.verifyDrawingSnapshot(snapshot); assert.deepEqual(checked, snapshot); assert.notEqual(checked, snapshot);
});

test('every drawing and sketch requires explicit document ID, reported hash, number, revision and sheet', () => {
  for (const target of ['drawing', 'sketch']) for (const key of ['documentId', 'sourceHash', 'number', 'revision', 'sheet']) {
    const input = fixture(), drawing = target === 'drawing' ? input.drawing : input.sketches[0].drawing;
    delete drawing[key]; rejects(input, new RegExp(key));
  }
  for (const value of ['', 'not-a-hash', 'f'.repeat(63), 'F'.repeat(64)]) { const input = fixture(); input.drawing.sourceHash = value; rejects(input, /sourceHash/); }
  for (const value of ['', ' ', 0, null]) { const input = fixture(); input.drawing.revision = value; rejects(input, /revision/); }
});

test('positions have no defaults: numeric bounds are explicit; unsupported angles, units, crops and rotations fail', () => {
  for (const position of [{ x: 0, y: 1 }, { x: 1, y: 0 }]) { const input = fixture(); input.points[0].position = position; assert.deepEqual(Model.createDrawingSnapshot(input).content.points[0].position, position); }
  for (const value of [NaN, Infinity, -Infinity, null, '0.25', -0.01, 1.01, undefined]) {
    const input = fixture(); input.points[0].position.x = value; rejects(input);
  }
  for (const key of ['x', 'y']) { const input = fixture(); delete input.points[0].position[key]; rejects(input, /position/); }
  for (const field of ['position', 'coordinateFrame']) { const input = fixture(); if (field === 'position') delete input.points[0].position; else delete input.coordinateFrame; rejects(input); }
  for (const change of [input => input.points[0].angle = 90, input => input.points[0].position.z = 0.3,
    input => input.coordinateFrame.rotation = 90, input => input.coordinateFrame.crop = [0, 0, 1, 1],
    input => input.coordinateFrame.kind = 'mm', input => input.coordinateFrame.origin = 'bottom_left']) { const input = fixture(); change(input); rejects(input); }
});

test('scope checks use IDs, reject C2/same-TAG contradictions and do not authenticate caller declarations', () => {
  for (const change of [input => input.scope.contractId = id(90), input => input.references.photos[0].contractId = id(90),
    input => input.references.rtis[0].ownerId = id(90), input => input.references.items[0].systemId = id(90),
    input => input.references.contract.assetIds = [], input => input.references.asset.lineId = id(90),
    input => input.references.line.assetId = id(90), input => input.scope.lineId = id(90)]) { const input = fixture(); change(input); rejects(input); }
  const c1 = fixture(), c2 = fixture(); c2.scope.contractId = id(90); c2.references.contract.id = id(90);
  for (const name of ['items', 'photos', 'rtis']) for (const row of c2.references[name]) row.contractId = id(90);
  const first = Model.createDrawingSnapshot(c1), sharedAsset = Model.createDrawingSnapshot(c2);
  assert.equal(first.content.scope.assetId, sharedAsset.content.scope.assetId); assert.equal(first.content.references.asset.tag, sharedAsset.content.references.asset.tag);
  assert.notEqual(first.contentDigest, sharedAsset.contentDigest);
  assert.equal(sharedAsset.provenance.relationships, 'caller_declared_consistent_only');
  c2.snapshotId = id(91); assert.throws(() => Model.reviseDrawingSnapshot(first, c2), /mesmo escopo/);
});

test('photo/RTI references require the exact item and LVT, including multiple executions of the same TAG', () => {
  for (const change of [input => input.references.photos[0].lvtId = id(80), input => input.references.photos[0].lvtItemId = id(80),
    input => input.references.rtis[0].lvtId = id(80), input => input.references.rtis[0].lvtItemId = id(80),
    input => input.points[0].lvtItemId = id(80), input => input.points[0].photoIds = [],
    input => input.points[0].rtiIds = [id(80)], input => input.references.rtis[0].photoIds = [id(80)]]) { const input = fixture(); change(input); rejects(input); }
  const input = fixture(), other = { ...input.references.items[0], id: id(30), lvtId: id(31), inspectionId: id(32) };
  input.references.items.push(other); input.references.photos.push({ ...input.references.photos[0], id: id(33), lvtItemId: other.id, lvtId: other.lvtId });
  input.points.push({ id: id(34), label: 'EXPLICIT-SECOND-EXECUTION', position: { x: 0.7, y: 0.2 }, lvtItemId: other.id, photoIds: [id(33)], rtiIds: [] });
  assert.equal(Model.createDrawingSnapshot(input).content.points.length, 2);
  input.points[0].photoIds.push(id(33)); rejects(input, /foto pertence a outro item/);
});

test('duplicate identities, missing links and unselected historical records are not silently copied', () => {
  for (const name of ['items', 'photos', 'rtis']) { const input = fixture(); input.references[name].push(clone(input.references[name][0])); rejects(input, /ID repetido/); }
  for (const name of ['points', 'annotations', 'sketches']) { const input = fixture(); input[name].push(clone(input[name][0])); rejects(input, /ID repetido/); }
  for (const name of ['photoIds', 'rtiIds']) { const input = fixture(); input.points[0][name].push(input.points[0][name][0]); rejects(input, /ID repetido/); }
  const input = fixture(); input.references.items.push({ ...input.references.items[0], id: id(66) }); rejects(input, /sem vínculo explícito/);
  const unknown = fixture(); unknown.annotations[0].pointIds = [id(88)]; rejects(unknown, /ponto explícito/);
  const sameLabel = fixture(); sameLabel.points.push({ ...clone(sameLabel.points[0]), id: id(67), label: '  ' + sameLabel.points[0].label + '  ' }); rejects(sameLabel, /rótulo de ponto repetido/);
});

test('one LVT has one declared inspection; different explicit LVTs remain permitted', () => {
  const input = fixture(), firstItem = input.references.items[0];
  const secondItem = { ...firstItem, id: id(40) };
  input.references.items.push(secondItem);
  input.points.push({ id: id(41), label: 'EXPLICIT-SECOND-ITEM', position: { x: 0.6, y: 0.4 }, lvtItemId: secondItem.id, photoIds: [], rtiIds: [] });
  const sameLvt = Model.createDrawingSnapshot(input);
  assert.equal(sameLvt.content.references.items.length, 2);
  assert.equal(new Set(sameLvt.content.references.items.map(item => item.lvtId)).size, 1);
  secondItem.inspectionId = id(42);
  rejects(input, /mesma LVT não pode declarar inspeções diferentes/);
  secondItem.lvtId = id(43);
  const distinctLvts = Model.createDrawingSnapshot(input);
  assert.equal(new Set(distinctLvts.content.references.items.map(item => item.lvtId)).size, 2);
  assert.equal(new Set(distinctLvts.content.references.items.map(item => item.inspectionId)).size, 2);
  assert.deepEqual(Model.verifyDrawingSnapshot(distinctLvts), distinctLvts);
  const contradictory = clone(distinctLvts); contradictory.content.references.items[1].lvtId = firstItem.lvtId;
  assert.throws(() => Model.verifyDrawingSnapshot(contradictory), error => error.code === 'invalid_inspection_drawing' && /mesma LVT não pode declarar inspeções diferentes/.test(error.message));
});

test('new document revision/sheet/hash requires explicit positions and keeps the complete previous snapshot untouched', () => {
  const oldInput = fixture(), old = Model.createDrawingSnapshot(oldInput), oldText = JSON.stringify(old), next = fixture();
  next.snapshotId = id(21); next.drawing.revision = '01'; next.drawing.sheet = '2/2'; next.drawing.sourceHash = 'c'.repeat(64);
  next.points[0].position = { x: 0.8, y: 0.1 };
  const revision = Model.reviseDrawingSnapshot(old, next);
  assert.equal(revision.modelRevision, 2); assert.equal(revision.content.drawing.revision, '01');
  assert.deepEqual(revision.content.points[0].position, { x: 0.8, y: 0.1 });
  assert.equal(JSON.stringify(old), oldText); assert.equal(JSON.stringify(revision.previousSnapshot), oldText);
  assert.deepEqual(revision.previousSnapshot.content.points[0].position, { x: 0.25, y: 0.75 });
  assert.equal(revision.previousSnapshot.content.drawing.sheet, '1/2'); assert.equal(revision.previousSnapshot.content.drawing.sourceHash, 'a'.repeat(64));
  assert.equal(revision.previousSnapshot.contentDigest, old.contentDigest); assert.notEqual(revision.previousSnapshot, old);
  next.points[0].position.x = 0.2; oldInput.points[0].position.y = 0.5;
  assert.equal(revision.content.points[0].position.x, 0.8); assert.equal(revision.previousSnapshot.content.points[0].position.y, 0.75);
  assert.deepEqual(Model.verifyDrawingSnapshot(revision), revision);
});

test('revision cannot inherit point arrays/positions or reset lineage; explicit unmarked new sheet remains pending', () => {
  const old = Model.createDrawingSnapshot(fixture());
  for (const key of ['points', 'coordinateFrame', 'annotations', 'sketches']) { const input = fixture(); input.snapshotId = id(21); delete input[key]; assert.throws(() => Model.reviseDrawingSnapshot(old, input), /obrigatório/); }
  const partial = fixture(); partial.snapshotId = id(21); delete partial.points[0].position; assert.throws(() => Model.reviseDrawingSnapshot(old, partial), /position/);
  const unchangedId = fixture(); assert.throws(() => Model.reviseDrawingSnapshot(old, unchangedId), /ID reutilizado/);
  const unmarked = empty(); unmarked.snapshotId = id(21); unmarked.drawing.revision = 'NEXT'; unmarked.drawing.sheet = 'NEW-SHEET';
  const revision = Model.reviseDrawingSnapshot(old, unmarked); assert.deepEqual(revision.content.points, []);
  assert.equal(revision.previousSnapshot.content.points.length, 1); assert.equal(revision.status, 'field_survey_pending_review'); assert.equal(revision.approvedAsBuilt, false);
});

test('annotations and sketch references remain field surveys and cannot introduce approval, issue or signatures', () => {
  for (const value of ['approved_as_built', 'as_built', 'approved', null]) {
    for (const name of ['annotations', 'sketches']) { const input = fixture(); input[name][0].source = value; rejects(input, /levantamento de campo/); }
  }
  for (const field of ['approved', 'approvedAsBuilt', 'asBuiltApproved', 'issued', 'signatures', 'technicalRevision']) {
    for (const target of ['input', 'drawing', 'annotation', 'sketch', 'point']) {
      const input = fixture(), record = { input, drawing: input.drawing, annotation: input.annotations[0], sketch: input.sketches[0], point: input.points[0] }[target];
      record[field] = true; rejects(input, /campo não reconhecido/);
    }
  }
  const snapshot = Model.createDrawingSnapshot(empty()); assert.equal(snapshot.canIssue, false); assert.deepEqual(snapshot.content.points, []); assert.deepEqual(snapshot.signatures, []);
});

test('digest detects content, frame and historical-position changes; it never asserts authenticity or a technical act', () => {
  const first = Model.createDrawingSnapshot(fixture()), input = fixture(); input.snapshotId = id(21); input.drawing.revision = '01';
  const second = Model.reviseDrawingSnapshot(first, input);
  for (const change of [record => record.content.points[0].position.x = 0.5,
    record => record.content.drawing.sheet = 'OTHER', record => record.contentDigest = 'sha256:' + '0'.repeat(64),
    record => record.previousSnapshot.content.points[0].position.x = 0.9,
    record => record.content.coordinateFrame.xAxis = 'left', record => record.modelRevision++,
    record => record.provenance.originalBytesVerified = true, record => record.approvedAsBuilt = true,
    record => record.signatures.push({ name: 'SYNTHETIC-NO-SIGNATURE' })]) {
    const tampered = clone(second); change(tampered); assert.throws(() => Model.verifyDrawingSnapshot(tampered), error => error.code === 'invalid_inspection_drawing');
  }
  // Anyone can compute another local hash. Success means structural consistency,
  // deliberately not identity, authenticity, authorization or technical approval.
  const selfDeclared = clone(first); selfDeclared.content.points[0].position.x = 0.6;
  const { contentDigest, ...body } = selfDeclared;
  const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
  selfDeclared.contentDigest = 'sha256:' + createHash('sha256').update(canonical(body)).digest('hex');
  const checked = Model.verifyDrawingSnapshot(selfDeclared); assert.equal(checked.content.points[0].position.x, 0.6);
  assert.equal(checked.provenance.originalBytesVerified, false); assert.equal(checked.canIssue, false); assert.deepEqual(checked.signatures, []);
});

test('malformed JSON objects, accessors, cycles, nonfinite values and oversized reference lists are rejected', () => {
  const circular = fixture(); circular.loop = circular; rejects(circular, /sem ciclos/);
  const accessor = fixture(); Object.defineProperty(accessor.points[0], 'angle', { enumerable: true, get() { throw Error('Getter must never run'); } }); rejects(accessor, /acessores/);
  const proto = fixture(); Object.setPrototypeOf(proto.drawing, { approved: true }); rejects(proto, /objeto JSON simples/);
  const sparse = fixture(); sparse.points = new Array(1); rejects(sparse, /esparsa/);
  const many = empty(); many.points = Array.from({ length: 1001 }, () => ({})); rejects(many, /até 1000/);
});

test('bounded lineage preserves twenty versions but refuses unbounded historical expansion', () => {
  let snapshot = Model.createDrawingSnapshot(empty());
  for (let revision = 2; revision <= 20; revision++) { const input = empty(); input.snapshotId = id(100 + revision); input.drawing.revision = 'LOCAL-' + revision; snapshot = Model.reviseDrawingSnapshot(snapshot, input); }
  assert.equal(snapshot.modelRevision, 20); assert.deepEqual(Model.verifyDrawingSnapshot(snapshot), snapshot);
  const input = empty(); input.snapshotId = id(200); assert.throws(() => Model.reviseDrawingSnapshot(snapshot, input), /20 snapshots/);
});

test('deep JSON, oversized arrays and cycles fail with a controlled code before recursive expansion', () => {
  let deep = { leaf: 'SYNTHETIC' };
  for (let index = 0; index < 10000; index++) deep = { next: deep };
  const input = fixture(); input.extra = deep;
  rejects(input, /profundidade máxima de 64/);
  const snapshot = clone(Model.createDrawingSnapshot(empty())); snapshot.extra = deep;
  assert.throws(() => Model.verifyDrawingSnapshot(snapshot), error => error.code === 'invalid_inspection_drawing' && /profundidade máxima de 64/.test(error.message));
  const huge = fixture(); huge.points = new Array(1000000); rejects(huge, /até 1000/);
  const cyclic = clone(Model.createDrawingSnapshot(empty())); cyclic.previousSnapshot = cyclic;
  assert.throws(() => Model.verifyDrawingSnapshot(cyclic), error => error.code === 'invalid_inspection_drawing' && /sem ciclos/.test(error.message));
  assert.throws(() => Model.reviseDrawingSnapshot(cyclic, fixture()), error => error.code === 'invalid_inspection_drawing' && /sem ciclos/.test(error.message));
});
