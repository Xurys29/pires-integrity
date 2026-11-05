'use strict';

// Pure reference to treatment bands accepted by the requester on 2026-10-21.
// This is not an active risk matrix, a technical assessment or a deadline engine.
// The private decision evidence is retained by the coordinator, outside Git.
const SCHEMA = 'pires.rti.accepted-treatment-bands';
const CORROSION_SCHEMA = 'pires.rti.corrosion-treatment-guidance';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const BLOCKERS = freeze([
  'applicable_risk_policy_version_not_linked',
  'technical_assessment_and_authority_not_linked',
  'precedence_and_exact_duration_rule_not_linked',
  'calendar_and_inspection_time_rule_not_linked',
]);

const REFERENCE = freeze({
  schema: SCHEMA,
  referenceId: 'pires-rti-treatment-bands-20261021',
  representationVersion: 1,
  decision: {
    reference: 'decision-20261021',
    acceptedOn: '2026-10-21',
    acceptanceScope: 'treatment_bands_only',
    evidenceStatus: 'decision_evidence_reported_by_coordinator',
    completeMatrixApproval: 'not_established_by_this_reference',
  },
  policyId: null,
  policyVersion: null,
  documentId: null,
  documentRevision: null,
  activation: false,
  canCalculateDue: false,
  classification: null,
  due: null,
  deadlineAnchor: { event: 'inspection_completed', basis: 'declared_inspection_end_date', source: 'requester_inspection_end_date_guidance', endTime: null, timeRule: null, hourCountingRule: null },
  blockingReasons: BLOCKERS,
  bands: [
    { id: 'score-25', scores: { minimum: 25, maximum: 25 }, acceptedText: '25 <24h', purpose: 'treatment_reference', duration: { kind: 'upper_bound', operator: '<', value: 24, unit: 'hour' } },
    { id: 'score-20', scores: { minimum: 20, maximum: 20 }, acceptedText: '20 <72h', purpose: 'treatment_reference', duration: { kind: 'upper_bound', operator: '<', value: 72, unit: 'hour' } },
    { id: 'score-15-16', scores: { minimum: 15, maximum: 16 }, acceptedText: '15–16 <14 dias', purpose: 'treatment_reference', duration: { kind: 'upper_bound', operator: '<', value: 14, unit: 'day' } },
    { id: 'score-10-12', scores: { minimum: 10, maximum: 12 }, acceptedText: '10–12 <4 semanas', purpose: 'treatment_reference', duration: { kind: 'upper_bound', operator: '<', value: 4, unit: 'week' } },
    { id: 'score-8-9', scores: { minimum: 8, maximum: 9 }, acceptedText: '8–9 = 1–3 meses', purpose: 'treatment_reference', duration: { kind: 'range', minimum: 1, maximum: 3, unit: 'month', boundaryRule: null, selectionRule: null } },
    { id: 'score-5-6', scores: { minimum: 5, maximum: 6 }, acceptedText: '5–6 = 3–6 meses', purpose: 'treatment_reference', duration: { kind: 'range', minimum: 3, maximum: 6, unit: 'month', boundaryRule: null, selectionRule: null } },
    { id: 'score-3-4', scores: { minimum: 3, maximum: 4 }, acceptedText: '3–4 = 6–24 meses', purpose: 'treatment_reference', duration: { kind: 'range', minimum: 6, maximum: 24, unit: 'month', boundaryRule: null, selectionRule: null } },
    { id: 'score-1-2', scores: { minimum: 1, maximum: 2 }, acceptedText: '1–2 monitoramento >24 meses', purpose: 'monitoring_reference_only', duration: { kind: 'lower_bound', operator: '>', value: 24, unit: 'month' }, treatmentDeferralAuthorized: false },
  ],
});

function getAcceptedTreatmentBands() {
  return REFERENCE;
}

/**
 * Looks up the reported score only. This neither computes/validates PoF, CoF,
 * category, applicability or a technical assessment, nor chooses a duration.
 * No options/approval object is accepted; callers cannot activate this reference.
 */
function referenceForScore(score) {
  const missing = score === undefined || score === null;
  const valid = typeof score === 'number' && Number.isSafeInteger(score) && score >= 1 && score <= 25;
  const band = valid ? REFERENCE.bands.find(entry => score >= entry.scores.minimum && score <= entry.scores.maximum) || null : null;
  return freeze({
    schema: SCHEMA,
    referenceId: REFERENCE.referenceId,
    representationVersion: REFERENCE.representationVersion,
    acceptanceScope: REFERENCE.decision.acceptanceScope,
    status: missing ? 'pending_score' : !valid ? 'invalid_score' : !band ? 'score_without_accepted_band' : 'reference_only',
    score: valid ? score : null,
    band,
    activation: false,
    canCalculateDue: false,
    classification: null,
    due: null,
    deadlineAnchorEvent: REFERENCE.deadlineAnchor.event,
    blockingReasons: band ? BLOCKERS : freeze([missing ? 'score_missing' : valid ? 'accepted_band_missing' : 'score_invalid', ...BLOCKERS]),
  });
}

const CORROSION_BLOCKERS = freeze([
  'applicable_corrosion_criteria_not_linked',
  'risk_assessment_and_human_authority_not_linked',
  'exact_due_date_rule_not_linked',
  'calendar_and_inspection_time_rule_not_linked',
]);

// Separate requester guidance; no score conversion or approval date is implied.
// This must not be merged with the score-based bands above or a catalogue item.
const CORROSION_GUIDANCE = freeze({
  schema: CORROSION_SCHEMA,
  referenceId: 'pires-corrosion-treatment-guidance',
  representationVersion: 1,
  source: 'requester_corrosion_guidance',
  scope: 'corrosion_treatment_guidance_only',
  policyId: null,
  policyVersion: null,
  score: null,
  pof: null,
  cof: null,
  classification: null,
  due: null,
  activation: false,
  canCalculateDue: false,
  operationalActionAuthorized: false,
  itemSpecificReviewRequired: true,
  recommendationOverrideAuthorized: false,
  deadlineAnchor: { event: 'inspection_completed', basis: 'declared_inspection_end_date', source: 'requester_inspection_end_date_guidance', endTime: null, timeRule: null, hourCountingRule: null },
  blockingReasons: CORROSION_BLOCKERS,
  guidance: [
    { intensity: 'leve', label: 'Leve', action: 'Tratar e pintar.', duration: { kind: 'range', minimum: 6, maximum: 12, unit: 'month', boundaryRule: null, selectionRule: null, calendarRule: null } },
    { intensity: 'media', label: 'Média', action: 'Tratar e pintar.', duration: { kind: 'range', minimum: 3, maximum: 6, unit: 'month', boundaryRule: null, selectionRule: null, calendarRule: null } },
    { intensity: 'severa', label: 'Severa', action: 'Substituir.', duration: { kind: 'stated_duration', value: 1, unit: 'day', calendarRule: null, countingRule: null } },
    { intensity: 'urgente', label: 'Urgente', action: 'Substituir imediatamente.', duration: { kind: 'immediate_reference', value: null, unit: null, operationalDefinition: null }, conditionalDispositions: [
      { action: 'Interdição', riskAssessmentRequired: true, humanAuthorityRequired: true, authorized: false },
      { action: 'Remoção', riskAssessmentRequired: true, humanAuthorityRequired: true, authorized: false },
    ] },
  ],
});

function getCorrosionTreatmentGuidance() {
  return CORROSION_GUIDANCE;
}

/**
 * Returns the guidance for an explicitly supplied intensity label only. It does
 * not identify corrosion, interpret photographs/codes, choose a catalogue item,
 * assign a score or authorize a treatment, substitution or operational action.
 */
function lookupIntensity(intensity) {
  const text = typeof intensity === 'string' ? intensity.trim().toLowerCase() : null;
  const missing = intensity === undefined || intensity === null || text === '';
  const canonical = text === 'média' ? 'media' : text;
  const guidance = CORROSION_GUIDANCE.guidance.find(entry => entry.intensity === canonical) || null;
  return freeze({
    schema: CORROSION_SCHEMA,
    referenceId: CORROSION_GUIDANCE.referenceId,
    representationVersion: CORROSION_GUIDANCE.representationVersion,
    source: CORROSION_GUIDANCE.source,
    scope: CORROSION_GUIDANCE.scope,
    status: guidance ? 'requires_item_specific_review' : 'pending_guidance',
    referenceOnly: true,
    inputStatus: guidance ? 'matched' : missing ? 'missing' : 'invalid',
    intensity: guidance ? guidance.intensity : null,
    guidance,
    score: null,
    pof: null,
    cof: null,
    classification: null,
    due: null,
    activation: false,
    canCalculateDue: false,
    operationalActionAuthorized: false,
    itemSpecificReviewRequired: true,
    recommendationOverrideAuthorized: false,
    deadlineAnchorEvent: CORROSION_GUIDANCE.deadlineAnchor.event,
    blockingReasons: guidance ? CORROSION_BLOCKERS : freeze([missing ? 'intensity_missing' : 'intensity_invalid', ...CORROSION_BLOCKERS]),
  });
}

module.exports = freeze({ SCHEMA, CORROSION_SCHEMA, getAcceptedTreatmentBands, referenceForScore, getCorrosionTreatmentGuidance, lookupIntensity });
