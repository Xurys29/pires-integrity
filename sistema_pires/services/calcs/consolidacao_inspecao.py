"""Consolidado de triagem, sem média de resultados ou conclusão automática."""


def summarize_calculations(calculations, *, expected_position_ids=None):
    calculations = list(calculations)
    priority = {'above':0, 'pending':1, 'limit':2, 'below':3}
    worst = max((c.dimensional for c in calculations), key=lambda state: priority[state], default='pending')
    recorded = {str(c.reading.position_id) for c in calculations}
    validated = {str(c.reading.position_id) for c in calculations if c.reading_review_id}
    expected = None if expected_position_ids is None else {str(pk) for pk in expected_position_ids}
    missing = None if expected is None else sorted(expected-recorded)
    unresolved = [str(c.pk) for c in calculations if c.warnings or c.dimensional=='pending']
    pending = bool(unresolved or expected is None or missing or not calculations)
    return {
        'worst_dimensional':worst,
        'critical':worst=='below',
        'at_limit':worst=='limit',
        'has_pending':pending,
        'technical_conclusion':None,
        'requires_technical_review':True,
        'unresolved_calculation_ids':unresolved,
        'coverage':{'expected':None if expected is None else len(expected),
                    'recorded':len(recorded), 'validated':len(validated),
                    'missing_position_ids':missing},
        'note':'Condição dimensional mais crítica, sem média. Cobertura esperada precisa ser informada pelo escopo da inspeção.',
    }
