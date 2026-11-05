'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Policy = require('../lib/rti-treatment-policy.cjs');

test('reference versions the accepted bands without claiming a complete or active policy', () => {
  const reference = Policy.getAcceptedTreatmentBands();
  assert.equal(reference.schema, Policy.SCHEMA);
  assert.equal(reference.representationVersion, 1);
  assert.equal(reference.decision.reference, 'decision-20261021');
  assert.equal(reference.decision.acceptanceScope, 'treatment_bands_only');
  assert.equal(reference.decision.completeMatrixApproval, 'not_established_by_this_reference');
  for (const key of ['policyId', 'policyVersion', 'documentId', 'documentRevision', 'classification', 'due']) assert.equal(reference[key], null);
  assert.equal(reference.activation, false);
  assert.equal(reference.canCalculateDue, false);
  assert.equal(reference.deadlineAnchor.event, 'inspection_completed');
  assert.equal(reference.deadlineAnchor.basis, 'declared_inspection_end_date');
  assert.equal(reference.deadlineAnchor.endTime, null);
  assert.equal(reference.deadlineAnchor.timeRule, null);
  assert.equal(reference.deadlineAnchor.hourCountingRule, null);
  assert.equal(reference.bands.length, 8);
});

test('strict upper limits retain their operators and original units without conversions', () => {
  for (const [score, id, value, unit] of [[25, 'score-25', 24, 'hour'], [20, 'score-20', 72, 'hour'], [15, 'score-15-16', 14, 'day'], [16, 'score-15-16', 14, 'day'], [10, 'score-10-12', 4, 'week'], [11, 'score-10-12', 4, 'week'], [12, 'score-10-12', 4, 'week']]) {
    const result = Policy.referenceForScore(score);
    assert.equal(result.status, 'reference_only');
    assert.equal(result.band.id, id);
    assert.deepEqual(result.band.duration, { kind: 'upper_bound', operator: '<', value, unit });
    assert.equal(result.band.purpose, 'treatment_reference');
    assert.equal(result.due, null);
  }
});

test('ranges preserve both month bounds without selecting a duration or interpreting boundary/calendar rules', () => {
  for (const [scores, min, max] of [[[8, 9], 1, 3], [[5, 6], 3, 6], [[3, 4], 6, 24]]) {
    for (const score of scores) {
      const result = Policy.referenceForScore(score);
      assert.deepEqual(result.band.duration, { kind: 'range', minimum: min, maximum: max, unit: 'month', boundaryRule: null, selectionRule: null });
      assert.equal(result.classification, null);
      assert.equal(result.canCalculateDue, false);
      assert.equal(result.due, null);
    }
  }
});

test('scores one and two retain monitoring greater than 24 months without authorizing repair deferral', () => {
  for (const score of [1, 2]) {
    const result = Policy.referenceForScore(score);
    assert.equal(result.band.purpose, 'monitoring_reference_only');
    assert.deepEqual(result.band.duration, { kind: 'lower_bound', operator: '>', value: 24, unit: 'month' });
    assert.equal(result.band.treatmentDeferralAuthorized, false);
    assert.equal(result.canCalculateDue, false);
    assert.equal(result.classification, null);
  }
});

test('unlisted scores remain pending rather than choosing a nearest or lower band', () => {
  for (const score of [7, 13, 14, 17, 18, 19, 21, 22, 23, 24]) {
    const result = Policy.referenceForScore(score);
    assert.equal(result.status, 'score_without_accepted_band');
    assert.equal(result.score, score);
    assert.equal(result.band, null);
    assert.ok(result.blockingReasons.includes('accepted_band_missing'));
    assert.equal(result.classification, null);
    assert.equal(result.due, null);
  }
});

test('missing and invalid input never becomes zero, a low score or a technical approval', () => {
  for (const score of [undefined, null]) {
    const result = Policy.referenceForScore(score);
    assert.equal(result.status, 'pending_score');
    assert.equal(result.score, null);
    assert.equal(result.band, null);
  }
  for (const score of [0, -1, 26, 1.5, NaN, Infinity, -Infinity, '', '1', true, [], {}, new Number(1), new Date('2026-10-21')]) {
    const result = Policy.referenceForScore(score);
    assert.equal(result.status, 'invalid_score');
    assert.equal(result.score, null);
    assert.equal(result.band, null);
    assert.equal(result.classification, null);
    assert.equal(result.activation, false);
  }
});

test('caller-supplied approval, due, calendar or policy overrides cannot activate or alter the reference', () => {
  const overrides = { score: 25, activation: true, approved: true, policyId: 'fake', policyVersion: 'fake', due: '2026-10-22', calendar: '30-day-months' };
  const asScore = Policy.referenceForScore(overrides);
  assert.equal(asScore.status, 'invalid_score');
  assert.equal(asScore.band, null);
  const extraArgument = Policy.referenceForScore(25, overrides);
  assert.equal(extraArgument.activation, false);
  assert.equal(extraArgument.canCalculateDue, false);
  assert.equal(extraArgument.due, null);
  assert.deepEqual(extraArgument.band.duration, { kind: 'upper_bound', operator: '<', value: 24, unit: 'hour' });
  assert.equal(Policy.getAcceptedTreatmentBands().policyId, null);
});

test('the exported reference, nested bands and lookup results remain deeply immutable', () => {
  const reference = Policy.getAcceptedTreatmentBands(), result = Policy.referenceForScore(5);
  for (const value of [Policy, reference, reference.decision, reference.deadlineAnchor, reference.bands, reference.bands[0], reference.bands[0].duration, result, result.band, result.blockingReasons]) assert.equal(Object.isFrozen(value), true);
  for (const change of [() => { reference.activation = true; }, () => { reference.bands[0].duration.operator = '<='; }, () => reference.bands.pop(), () => { result.band.duration.minimum = 0; }, () => { result.due = '2026-10-22'; }, () => result.blockingReasons.pop()]) assert.throws(change, TypeError);
  assert.equal(Policy.referenceForScore(5).band.duration.minimum, 3);
  assert.equal(Policy.referenceForScore(25).band.duration.operator, '<');
});

test('lookup is deterministic and supplies no date, timestamp, risk category or calculated interval', () => {
  for (let score = 1; score <= 25; score++) {
    const result = Policy.referenceForScore(score);
    assert.deepEqual(result, Policy.referenceForScore(score));
    assert.equal(result.activation, false);
    assert.equal(result.canCalculateDue, false);
    assert.equal(result.classification, null);
    assert.equal(result.due, null);
    assert.equal(Object.hasOwn(result, 'calculatedDuration'), false);
    assert.equal(Object.hasOwn(result, 'issuedAt'), false);
    assert.equal(Object.hasOwn(result, 'approvedBy'), false);
    assert.equal(JSON.stringify(result).includes('2026-10-22'), false);
  }
});

test('corrosion guidance has a separate versioned source without an invented approval date or risk matrix', () => {
  const reference = Policy.getCorrosionTreatmentGuidance();
  assert.equal(reference.schema, Policy.CORROSION_SCHEMA);
  assert.notEqual(reference.schema, Policy.SCHEMA);
  assert.notEqual(reference.referenceId, Policy.getAcceptedTreatmentBands().referenceId);
  assert.equal(reference.representationVersion, 1);
  assert.equal(reference.source, 'requester_corrosion_guidance');
  assert.equal(reference.scope, 'corrosion_treatment_guidance_only');
  assert.equal(reference.guidance.length, 4);
  assert.equal(Object.hasOwn(reference, 'acceptedOn'), false);
  assert.equal(Object.hasOwn(reference, 'approvedAt'), false);
  assert.equal(Object.hasOwn(reference, 'approvedBy'), false);
  for (const key of ['policyId', 'policyVersion', 'score', 'pof', 'cof', 'classification', 'due']) assert.equal(reference[key], null);
  assert.equal(reference.activation, false);
  assert.equal(reference.canCalculateDue, false);
  assert.equal(reference.operationalActionAuthorized, false);
  assert.equal(reference.deadlineAnchor.event, 'inspection_completed');
  assert.equal(reference.deadlineAnchor.basis, 'declared_inspection_end_date');
  assert.equal(reference.deadlineAnchor.endTime, null);
  assert.equal(reference.deadlineAnchor.hourCountingRule, null);
  assert.equal(reference.itemSpecificReviewRequired, true);
  assert.equal(reference.recommendationOverrideAuthorized, false);
});

test('explicit light and medium guidance preserve independent month ranges without choosing dates', () => {
  for (const [intensity, canonical, minimum, maximum] of [['leve', 'leve', 6, 12], ['media', 'media', 3, 6], ['média', 'media', 3, 6], [' MÉDIA ', 'media', 3, 6]]) {
    const result = Policy.lookupIntensity(intensity);
    assert.equal(result.status, 'requires_item_specific_review');
    assert.equal(result.referenceOnly, true);
    assert.equal(result.itemSpecificReviewRequired, true);
    assert.equal(result.recommendationOverrideAuthorized, false);
    assert.equal(result.inputStatus, 'matched');
    assert.equal(result.intensity, canonical);
    assert.equal(result.guidance.action, 'Tratar e pintar.');
    assert.deepEqual(result.guidance.duration, { kind: 'range', minimum, maximum, unit: 'month', boundaryRule: null, selectionRule: null, calendarRule: null });
    assert.equal(result.score, null);
    assert.equal(result.due, null);
    assert.equal(result.activation, false);
  }
});

test('severe guidance preserves one day without equating it to 24 hours or an exact calendar date', () => {
  const result = Policy.lookupIntensity('severa');
  assert.equal(result.guidance.action, 'Substituir.');
  assert.deepEqual(result.guidance.duration, { kind: 'stated_duration', value: 1, unit: 'day', calendarRule: null, countingRule: null });
  assert.equal(result.due, null);
  assert.equal(result.canCalculateDue, false);
  assert.equal(result.operationalActionAuthorized, false);
  assert.ok(result.blockingReasons.includes('calendar_and_inspection_time_rule_not_linked'));
});

test('urgent guidance is immediate reference only; interdiction and removal require human risk decisions', () => {
  const result = Policy.lookupIntensity('urgente');
  assert.equal(result.guidance.action, 'Substituir imediatamente.');
  assert.deepEqual(result.guidance.duration, { kind: 'immediate_reference', value: null, unit: null, operationalDefinition: null });
  assert.deepEqual(result.guidance.conditionalDispositions, [
    { action: 'Interdição', riskAssessmentRequired: true, humanAuthorityRequired: true, authorized: false },
    { action: 'Remoção', riskAssessmentRequired: true, humanAuthorityRequired: true, authorized: false },
  ]);
  assert.equal(result.operationalActionAuthorized, false);
  assert.equal(result.due, null);
  assert.equal(result.score, null);
  assert.ok(result.blockingReasons.includes('risk_assessment_and_human_authority_not_linked'));
});

test('missing, invalid, photograph-like and catalogue-code intensities stay pending without a light default', () => {
  for (const intensity of [undefined, null, '', '  ']) {
    const result = Policy.lookupIntensity(intensity);
    assert.equal(result.status, 'pending_guidance');
    assert.equal(result.inputStatus, 'missing');
    assert.equal(result.intensity, null);
    assert.equal(result.guidance, null);
    assert.ok(result.blockingReasons.includes('intensity_missing'));
  }
  for (const intensity of [0, 1, 25, NaN, true, [], {}, { intensity: 'leve' }, new String('leve'), 'moderada', 'F.02', 'F.03', 'N/A', 'Sem Visual', 'sem visual', 'foto de corrosão leve']) {
    const result = Policy.lookupIntensity(intensity);
    assert.equal(result.status, 'pending_guidance');
    assert.equal(result.inputStatus, 'invalid');
    assert.equal(result.guidance, null);
    assert.equal(result.intensity, null);
    assert.equal(result.score, null);
    assert.equal(result.classification, null);
    assert.equal(result.due, null);
    assert.equal(result.activation, false);
    assert.ok(result.blockingReasons.includes('intensity_invalid'));
  }
});

test('score three-four and light corrosion are distinct references and never merged or inferred from one another', () => {
  const light = Policy.lookupIntensity('leve');
  for (const score of [3, 4]) {
    const band = Policy.referenceForScore(score);
    assert.equal(band.band.duration.minimum, 6);
    assert.equal(band.band.duration.maximum, 24);
    assert.equal(light.guidance.duration.minimum, 6);
    assert.equal(light.guidance.duration.maximum, 12);
    assert.notEqual(band.referenceId, light.referenceId);
    assert.equal(Object.hasOwn(band, 'intensity'), false);
    assert.equal(light.score, null);
  }
  assert.equal(Policy.lookupIntensity(3).guidance, null);
  assert.equal(Policy.referenceForScore('leve').band, null);
});

test('corrosion guidance and lookup results are immutable and cannot be activated by caller flags', () => {
  const reference = Policy.getCorrosionTreatmentGuidance();
  const result = Policy.lookupIntensity('urgente', { activation: true, score: 25, pof: 5, cof: 5, due: '2026-10-22', authorized: true });
  for (const value of [reference, reference.guidance, reference.guidance[0], reference.guidance[0].duration, result, result.guidance, result.guidance.conditionalDispositions, result.guidance.conditionalDispositions[0], result.blockingReasons]) assert.equal(Object.isFrozen(value), true);
  for (const change of [() => { reference.activation = true; }, () => { result.score = 25; }, () => { result.guidance.conditionalDispositions[0].authorized = true; }, () => { reference.guidance[0].duration.maximum = 24; }, () => { result.due = '2026-10-22'; }]) assert.throws(change, TypeError);
  assert.equal(result.activation, false);
  assert.equal(result.score, null);
  assert.equal(result.pof, null);
  assert.equal(result.cof, null);
  assert.equal(result.due, null);
  assert.equal(result.operationalActionAuthorized, false);
  assert.equal(Policy.lookupIntensity({ intensity: 'urgente', authorized: true }).guidance, null);
});

test('guidance never extracts intensity from LVT text or replaces an item-specific recommendation', () => {
  const item = Object.freeze({ recommendation: 'AÇÃO ESPECÍFICA SOMENTE SINTÉTICA: substituir componente e conferir material.', condition: 'SOMENTE SINTÉTICO: corrosão leve a média em componentes distintos.' });
  for (const text of [item.condition, item.recommendation, 'leve a média', 'corrosão severa', 'N/A; leve', 'Sem Visual; urgente']) {
    const result = Policy.lookupIntensity(text);
    assert.equal(result.status, 'pending_guidance');
    assert.equal(result.guidance, null);
    assert.equal(result.score, null);
  }
  const result = Policy.lookupIntensity('leve', item);
  assert.equal(result.status, 'requires_item_specific_review');
  assert.equal(result.recommendationOverrideAuthorized, false);
  assert.equal(result.itemSpecificReviewRequired, true);
  assert.equal(Object.hasOwn(result, 'recommendation'), false);
  assert.equal(item.recommendation, 'AÇÃO ESPECÍFICA SOMENTE SINTÉTICA: substituir componente e conferir material.');
  assert.equal(Policy.lookupIntensity(item).guidance, null);
});

test('the anchor is the declared final inspection date without inventing end time, midnight or next-day counting', () => {
  for (const reference of [Policy.getAcceptedTreatmentBands(), Policy.getCorrosionTreatmentGuidance()]) {
    assert.deepEqual(reference.deadlineAnchor, {
      event: 'inspection_completed', basis: 'declared_inspection_end_date', source: 'requester_inspection_end_date_guidance', endTime: null, timeRule: null, hourCountingRule: null,
    });
  }
  const claimedDates = { inspectionStartDate: '2026-10-20', inspectionEndDate: '2026-10-23', endTime: '00:00', due: '2026-10-24', countFromNextDay: true };
  for (const result of [Policy.referenceForScore(25, claimedDates), Policy.lookupIntensity('severa', claimedDates)]) {
    assert.equal(result.deadlineAnchorEvent, 'inspection_completed');
    assert.equal(result.due, null);
    assert.equal(result.canCalculateDue, false);
    assert.equal(Object.hasOwn(result, 'endTime'), false);
    assert.equal(Object.hasOwn(result, 'countFromNextDay'), false);
  }
});
