'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Cards = require('../app/gestao-asset-cards.js');
const id = n => 'c1000000-0000-4000-8000-' + String(n).padStart(12, '0');
function field(extra = {}) {
  return { id: id(1), assetId: id(2), contractId: id(3), inspectionId: id(4), executionId: id(5), lvtItemId: id(6), findingId: id(7),
    originType: 'field_recommendation', requiresTreatment: true, actionabilityStatus: 'catalog_declared', status: 'aberta', currentness: 'unknown',
    sourceDate: '2026-10-28', deadlineAnchor: { event: 'inspection_performed', date: '2026-10-28', inspectionId: id(4), executionId: id(5), executionVersion: 3 },
    title: 'TRATATIVA SOMENTE FIXTURE', photoIds: [id(8)], ...extra };
}
test('late field treatment is open for follow-up without inventing current physical confirmation or due date', () => {
  const rti = field(), before = JSON.stringify(rti), summary = Cards.describeRti(rti), card = Cards.describe({ id: rti.assetId, type: 'linha' }, { rti: [rti] });
  assert.equal(summary.followupOpen, true); assert.equal(summary.open, false); assert.equal(summary.currentness, 'unknown');
  assert.equal(summary.confirmedAt, null); assert.equal(summary.reportedOpen, false); assert.match(summary.currentnessLabel, /atualidade física não confirmada/);
  assert.equal(card.rti.open, true); assert.deepEqual(card.rti.items, [rti]); assert.deepEqual(card.rti.fieldFollowupItems, [rti]);
  assert.match(card.rti.label, /1 RTI de campo aberta para acompanhamento/); assert.doesNotMatch(card.rti.label, /com confirmação atual/);
  assert.equal(rti.due, undefined); assert.equal(JSON.stringify(rti), before);
});
test('historical imports and bare legacy open labels do not become field follow-up', () => {
  for (const extra of [{ originType: 'historical_rti_document' }, { originType: 'documented_recommendation' }, { originType: undefined }, { requiresTreatment: false }, { requiresTreatment: undefined }]) {
    const rti = field(extra), summary = Cards.describeRti(rti); assert.equal(summary.followupOpen, false); assert.equal(summary.open, false);
    assert.equal(Cards.describe({ id: rti.assetId }, { rti: [rti] }).rti.open, false);
  }
});
test('field follow-up requires canonical execution/inspection anchor and preserves unresolved legacy review', () => {
  for (const extra of [{ deadlineAnchor: null }, { deadlineAnchor: { ...field().deadlineAnchor, date: null } }, { deadlineAnchor: { ...field().deadlineAnchor, inspectionId: id(99) } }, { executionId: id(99) }, { findingId: null }])
    assert.equal(Cards.describeRti(field(extra)).followupOpen, false);
  assert.equal(Cards.describeRti(field({ requiresTreatment: null, actionabilityStatus: 'legacy_unclassified' })).followupOpen, true);
  assert.equal(Cards.describeRti(field({ recommendationWithdrawn: true, technicalReviewRequired: true })).followupOpen, true);
  assert.equal(Cards.describeRti(field({ status: 'encerrada' })).followupOpen, false);
});
test('mixed queue counts each field RTI once and keeps unrelated TAG and physical confirmations separate', () => {
  const current = field({ id: id(11), currentness: 'confirmed_current', currentnessConfirmedAt: '2026-11-03T10:00:00Z', currentnessEvidence: 'CONFIRMAÇÃO SOMENTE FIXTURE' }), late = field(), history = field({ id: id(12), originType: 'historical_rti_document', sourceStatus: 'aberta' }), other = field({ id: id(13), assetId: id(99) });
  const summary = Cards.describe({ id: late.assetId }, { rti: [current, late, history, other] }).rti;
  assert.deepEqual(summary.items.map(r => r.id), [current.id, late.id]); assert.equal(summary.fieldFollowupItems.length, 1); assert.equal(summary.reportedItems.length, 1);
  assert.match(summary.label, /1 RTI aberta com confirmação atual/); assert.match(summary.label, /1 RTI de campo aberta para acompanhamento/);
  assert.match(summary.label, /1 RTI de fonte com situação atual não confirmada/); assert.equal(summary.history.length, 3);
});
