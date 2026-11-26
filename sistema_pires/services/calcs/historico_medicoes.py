"""Seleção explícita de histórico e requisito. Não aprova nenhum registro."""
from collections import defaultdict
from dataclasses import dataclass, field
from django.db.models import Q
from sistema_pires import models as m
from .calculos_espessura import mm_fraction


def warning(code, message):
    return {"code": code, "message": message}


def latest_reading_review(reading):
    events = list(reading.reviews.all())
    return max(events, key=lambda event: event.sequence) if events else None


@dataclass
class ExecutionReading:
    execution_id: object
    rows: list
    reading: object = None
    review: object = None
    series_review: object = None
    warnings: list = field(default_factory=list)

    @property
    def history_eligible(self):
        return bool(self.reading and self.review and self.review.comparable and self.series_review
                    and self.series_review.decision == m.MeasurementSeriesRevision.Decision.COMPARABLE
                    and not self.warnings)


def comparability_review(reading, events):
    day = m.measurement_date(reading.measured_at)
    matches = [event for event in events if event.point_revision_id == reading.point_revision_id and event.effective_on <= day]
    if not matches:
        return None, [warning("SERIES_REVIEW_MISSING", "Falta revisão de comparabilidade aplicável à revisão física e data.")]
    event = max(matches, key=lambda obj: obj.sequence)
    problems = []
    if event.decision != m.MeasurementSeriesRevision.Decision.COMPARABLE:
        problems.append(warning("SERIES_NOT_COMPARABLE", "Série pendente ou não comparável; não reutilizar taxas antigas."))
    if reading.method_reference and reading.method_reference != event.method_reference:
        problems.append(warning("METHOD_CHANGED", "Método sem equivalência documentada na revisão de comparabilidade."))
    if reading.original_resolution is not None:
        resolution = mm_fraction(reading.original_resolution, reading.unit)
        if event.resolution_mm is None or resolution != mm_fraction(event.resolution_mm):
            problems.append(warning("RESOLUTION_CHANGED", "Resolução sem equivalência documentada."))
    if reading.service_conditions and reading.service_conditions != event.service_conditions:
        problems.append(warning("SERVICE_CHANGED", "Condições de serviço sem equivalência documentada."))
    return event, problems


def select_execution_readings(series):
    rows = list(m.ThicknessReading.objects.filter(series=series).select_related(
        "position__point__asset", "point_revision", "execution", "requirement"
    ).prefetch_related("reviews").order_by("measured_at", "sequence", "id"))
    events = list(series.reviews.all())
    by_execution = defaultdict(list)
    for reading in rows:
        by_execution[reading.execution_id].append(reading)
    groups = []
    for execution_id, members in by_execution.items():
        group = ExecutionReading(execution_id=execution_id, rows=members)
        reviews = {row.pk: latest_reading_review(row) for row in members}
        by_id = {row.pk: row for row in members}
        replaced = set()
        for row in members:
            # Uma correção aprovada no passado não pode ressuscitar o original
            # silenciosamente quando a própria correção é invalidada.
            ever_approved = any(e.decision == "valid" and e.correction_approved for e in row.reviews.all())
            if row.corrects_id and ever_approved:
                replaced.add(row.corrects_id)
        candidates = []
        for row in members:
            review = reviews[row.pk]
            if row.pk in replaced:
                continue
            if review is None or review.decision == "pending":
                group.warnings.append(warning("READING_PENDING", f"Leitura {row.pk} ainda não validada; conferir antes de usar o conjunto como histórico."))
                continue
            if review.decision == "invalid":
                continue
            if row.corrects_id and not review.correction_approved:
                group.warnings.append(warning("CORRECTION_PENDING", f"Correção {row.pk} não aprovada; não substitui automaticamente o original."))
                continue
            if review.decision != "valid" or not review.representative:
                continue
            candidates.append(row)
        branches = defaultdict(list)
        conflict = False
        for candidate in candidates:
            root = candidate
            seen = set()
            while root.corrects_id:
                if root.pk in seen or root.corrects_id not in by_id:
                    conflict = True
                    break
                seen.add(root.pk)
                root = by_id[root.corrects_id]
            branches[root.pk].append(candidate.pk)
        conflict = conflict or any(len(children) > 1 for children in branches.values())
        if conflict:
            group.warnings.append(warning("CORRECTION_CONFLICT", "Há correções concorrentes aprovadas; seleção bloqueada para revisão."))
        if candidates and not conflict:
            group.reading = min(candidates, key=lambda row: (mm_fraction(row.value, row.unit), row.measured_at, str(row.pk)))
            group.review = reviews[group.reading.pk]
            group.series_review, issues = comparability_review(group.reading, events)
            group.warnings += issues
            if not group.review.comparable:
                group.warnings.append(warning("READING_NOT_COMPARABLE", "Leitura sem comparabilidade validada; apenas resultado dimensional disponível."))
        elif not group.warnings:
            group.warnings.append(warning("NO_REPRESENTATIVE_READING", "Execução sem leitura válida e representativa."))
        groups.append(group)
    return groups


def select_references(current, groups):
    day = m.measurement_date(current.reading.measured_at)
    earlier = [g for g in groups if g.reading and m.measurement_date(g.reading.measured_at) < day]
    eligible = [g for g in earlier if g.history_eligible]
    problems = []
    previous = initial = None
    if eligible:
        latest_day = max(m.measurement_date(g.reading.measured_at) for g in eligible)
        candidates = [g for g in eligible if m.measurement_date(g.reading.measured_at) == latest_day]
        if len(candidates) == 1:
            previous = candidates[0]
        else:
            problems.append(warning("PREVIOUS_AMBIGUOUS", "Mais de uma execução válida no último dia histórico; revisão necessária para selecionar a referência."))
    baseline = [g for g in eligible if g.review.baseline_approved]
    if baseline:
        first_day = min(m.measurement_date(g.reading.measured_at) for g in baseline)
        candidates = [g for g in baseline if m.measurement_date(g.reading.measured_at) == first_day]
        if len(candidates) == 1:
            initial = candidates[0]
        else:
            problems.append(warning("BASELINE_AMBIGUOUS", "Mais de uma referência inicial aprovada na mesma data; revisão necessária."))
    # Não atravessar uma quebra/pendência intermediária para continuar usando taxa antiga.
    for group in groups:
        dates = [m.measurement_date(row.measured_at) for row in group.rows]
        if group.history_eligible or not dates:
            continue
        if all(item["code"] == "NO_REPRESENTATIVE_READING" for item in group.warnings):
            continue  # Leituras explicitamente invalidadas não viram referência nem quebra física.

        anchor = m.measurement_date(previous.reading.measured_at) if previous else None
        if anchor and anchor < max(dates) < day:
            previous = None
            problems.append(warning("INTERMEDIATE_HISTORY_PENDING", "Há execução intermediária não resolvida; taxa curta suspensa."))
        anchor = m.measurement_date(initial.reading.measured_at) if initial else None
        if anchor and anchor < max(dates) < day:
            initial = None
            problems.append(warning("LONG_COMPARABILITY_PENDING", "Há quebra ou pendência de comparabilidade desde a referência inicial."))
    for name, reference in (("short", previous), ("long", initial)):
        if reference is None:
            continue
        ref_day = m.measurement_date(reference.reading.measured_at)
        events = m.MeasurementSeriesRevision.objects.filter(
            series_id=current.reading.series_id, effective_on__gt=ref_day,
            effective_on__lte=day).order_by("sequence")
        decisions = {}
        for event in events:
            decisions[(event.point_revision_id, event.effective_on)] = event.decision
        if any(decision != m.MeasurementSeriesRevision.Decision.COMPARABLE for decision in decisions.values()):
            problems.append(warning("SERIES_BREAK_REVIEW", "Existe quebra/pendência documentada entre as medições; não atravessar a descontinuidade para reutilizar a taxa."))
            if name == "short":
                previous = None
            else:
                initial = None
    return previous, initial, problems


def select_requirement(position, measured_on):
    candidates = list(m.ThicknessRequirement.objects.filter(
        company_id=position.company_id, asset_id=position.point.asset_id,
    ).filter(Q(point__isnull=True) | Q(point_id=position.point_id)).filter(
        Q(position__isnull=True) | Q(position_id=position.pk)
    ).order_by("valid_from", "id"))
    approved = [r for r in candidates if r.approved_at and r.approved_by_id and r.valid_from and r.valid_from <= measured_on]
    superseded = {r.supersedes_id for r in approved if r.supersedes_id}
    active = [r for r in approved if r.pk not in superseded and (r.valid_until is None or r.valid_until >= measured_on)]
    levels = defaultdict(list)
    for req in active:
        levels[2 if req.position_id else (1 if req.point_id else 0)].append(req)
    if any(len(rows) > 1 for rows in levels.values()):
        return None, [warning("REQUIREMENT_CONFLICT", "Requisitos aprovados sobrepostos no mesmo escopo; não escolher silenciosamente uma revisão.")], candidates
    if not active:
        return None, [warning("REQUIREMENT_PENDING", "Nenhum requisito vigente e aprovado para a posição/ponto/ativo.")], candidates
    selected = levels[max(levels)][0]
    limit = max(mm_fraction(r.required_thickness, r.unit) for r in active)
    if mm_fraction(selected.required_thickness, selected.unit) < limit:
        return None, [warning("REQUIREMENT_LIMIT_CONFLICT", "O requisito específico contraria limite mais restritivo aplicável ao ativo/ponto.")], candidates
    return selected, [], candidates
