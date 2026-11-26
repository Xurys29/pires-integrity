"""Orquestração transacional para os models revisados. Escrita de demonstração: superusuário."""
import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP, localcontext
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone
from sistema_pires import models as m
from .calculos_espessura import ENGINE_VERSION, ReadingValue, calculate_thickness
from .historico_medicoes import select_execution_readings, select_references, select_requirement, warning

DECIMAL_FIELDS = ("margin_mm", "loss_percent", "short_rate_mm_year", "long_rate_mm_year", "triage_rate_mm_year")
LIFE_FIELDS = ("life_short_days", "life_long_days", "life_triage_days")


def record_snapshot(obj):
    if obj is None:
        return None
    data = {f.attname: getattr(obj, f.attname) for f in obj._meta.concrete_fields}
    return json.loads(json.dumps(data, default=str, ensure_ascii=False, sort_keys=True))


def require_actor(actor):
    if actor is None or not actor.is_active or not actor.is_superuser:
        raise PermissionDenied("Motor em demonstração: escrita exige superusuário ativo até o mapeamento dos perfis operacionais.")


def audit(actor, company_id, entity_type, entity_id, action, before=None, after=None):
    m.AuditEvent.objects.create(company_id=company_id, entity_type=entity_type, entity_id=entity_id,
        action=action, actor=actor, occurred_at=timezone.now(), before=before or {}, after=after or {},
        created_by=actor, updated_by=actor)


def reading_value(reading):
    return ReadingValue(reading.value, m.measurement_date(reading.measured_at), reading.unit, str(reading.pk))


def projection(text):
    if text is None:
        return None
    with localcontext() as ctx:
        ctx.prec = 100
        value = Decimal(text)
        out = value.quantize(Decimal("0.000000000000001"), rounding=ROUND_HALF_UP)
    if abs(out) >= Decimal("1e15") or (value != 0 and out == 0):
        raise ValueError("Resultado fora da resolução/faixa das colunas de consulta.")
    return out


def unique_warnings(items):
    return list({(item["code"], item["message"]): item for item in items}.values())


def _pending_result(problems):
    return {**dict.fromkeys((*DECIMAL_FIELDS, *LIFE_FIELDS)), "dimensional": "pending", "trend": "insufficient",
            "warnings": problems, "triage_reason": "", "display": {}, "exact": {}, "engine_version": ENGINE_VERSION}


def _calculate_group(group, groups, series, procedure, actor):
    current = group.reading or min(group.rows, key=lambda row: (row.measured_at, str(row.pk)))
    previous = initial = None
    req, req_problems, requirements = select_requirement(current.position, m.measurement_date(current.measured_at))
    problems = list(group.warnings) + req_problems
    if procedure.status != m.ThicknessProcedureVersion.Status.APPROVED:
        problems.append(warning("PROCEDURE_TEST", "Motor em modo de teste; procedimento não homologado para emissão operacional."))
    if group.reading:
        if group.history_eligible:
            previous, initial, ref_problems = select_references(group, groups)
            problems += ref_problems
        if current.requirement_id and (req is None or current.requirement_id != req.pk):
            req = None
            problems.append(warning("CAPTURED_REQUIREMENT_CONFLICT", "O requisito capturado na leitura difere do vigente selecionado; revisar sem alterar a leitura original."))
        result = calculate_thickness(current=reading_value(current),
            previous=reading_value(previous.reading) if previous else None,
            initial=reading_value(initial.reading) if initial else None,
            required=req.required_thickness if req else None, required_unit=req.unit if req else "mm")
        # Uma revisão não comparável não pode ser usada como FK de suporte às taxas.
        sr = group.series_review
        if sr and (sr.point_revision_id != current.point_revision_id or sr.effective_on > m.measurement_date(current.measured_at)):
            sr = None
    else:
        result = _pending_result(problems)
        req = None
        sr = None
    result["warnings"] = unique_warnings(problems + result["warnings"])
    day = m.measurement_date(current.measured_at)
    used_objects = [current, req, procedure, group.review, sr]
    for reference in (previous, initial):
        if reference:
            used_objects += [reference.reading, reference.review, reference.series_review]
    evidence_ids = set()
    for obj in used_objects + group.rows:
        if obj:
            for name in ("evidence_id", "source_evidence_id", "correction_evidence_id", "origin_evidence_id"):
                value = getattr(obj, name, None)
                if value:
                    evidence_ids.add(value)
    context = {
        "engine_version": ENGINE_VERSION, "date_convention": "dias civis no TIME_ZONE configurado / 365",
        "time_zone": settings.TIME_ZONE,
        "series": record_snapshot(series), "procedure": record_snapshot(procedure),
        "current": record_snapshot(current), "current_review": record_snapshot(group.review),
        "series_review": record_snapshot(sr),
        "previous": record_snapshot(previous.reading) if previous else None,
        "previous_review": record_snapshot(previous.review) if previous else None,
        "initial": record_snapshot(initial.reading) if initial else None,
        "initial_review": record_snapshot(initial.review) if initial else None,
        "requirement": record_snapshot(req),
        "requirement_candidates": [record_snapshot(r) for r in requirements if r.valid_from is None or r.valid_from <= day],
        "evidence_metadata": [record_snapshot(f) for f in m.StoredFile.objects.filter(pk__in=evidence_ids).order_by("pk")],
        "previous_series_review": record_snapshot(previous.series_review) if previous else None,
        "initial_series_review": record_snapshot(initial.series_review) if initial else None,
        # Preserva o fundamento da seleção e torna alterações/revisões detectáveis.
        "series_reviews": [record_snapshot(r) for r in series.reviews.filter(point_revision_id=current.point_revision_id, effective_on__lte=day).order_by("sequence")],
        "execution_readings": [record_snapshot(r) for r in group.rows],
        "execution_reviews": [record_snapshot(e) for r in group.rows for e in r.reviews.all()],
        "selection": "minimum_valid_representative" if group.reading else "pending_no_valid_selection",
        "problems": list(result["warnings"]),
    }
    fingerprint = hashlib.sha256(json.dumps(context, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    context["fingerprint"] = fingerprint
    old = current.calculations.order_by("-calculated_at", "-created_at").first()
    if old and old.engine_version == ENGINE_VERSION and old.input_snapshot.get("fingerprint") == fingerprint:
        return old, False
    fields = {name: None for name in (*DECIMAL_FIELDS, *LIFE_FIELDS)}
    dimensional = result["dimensional"]
    try:
        fields.update({name: projection(result[name]) for name in DECIMAL_FIELDS})
        fields.update({name: result[name] for name in LIFE_FIELDS})
        if any(value is not None and value > 9223372036854775807 for name, value in fields.items() if name in LIFE_FIELDS):
            raise ValueError("Vida em dias fora da faixa de armazenamento.")
    except (ValueError, ArithmeticError):
        # O resultado exato permanece no snapshot; nenhuma classificação baseada
        # em coluna arredondada é fabricada. Escalonar a revisão/armazenamento.
        fields = dict.fromkeys((*DECIMAL_FIELDS, *LIFE_FIELDS))
        dimensional = "pending"
        result["warnings"].append(warning("PROJECTION_RANGE", "Resultado exato preservado no snapshot; colunas de consulta fora da faixa/resolução."))
    calculation = m.ThicknessCalculation.objects.create(
        company_id=series.company_id, series=series, reading=current,
        reading_review=group.review if group.reading else None,
        initial_reading=initial.reading if initial else None, initial_review=initial.review if initial else None,
        previous_reading=previous.reading if previous else None, previous_review=previous.review if previous else None,
        series_review=sr, requirement=req, procedure=procedure, engine_version=ENGINE_VERSION,
        input_snapshot=context, result_snapshot=result, warnings=result["warnings"],
        dimensional=dimensional, trend=result["trend"], triage_reason=result["triage_reason"],
        supersedes=old, created_by=actor, updated_by=actor, **fields)
    audit(actor, series.company_id, "sistema_pires.thicknesscalculation", calculation.pk,
          "thickness.calculated", after={"reading_id": str(current.pk), "fingerprint": fingerprint,
          "supersedes": str(old.pk) if old else None, "requires_technical_review": True})
    _mark_documents_for_review(current, actor, calculation)
    return calculation, True


def _mark_documents_for_review(reading, actor, calculation):
    for revision in m.DocumentRevision.objects.select_for_update(no_key=True).filter(document__inspection_id=reading.execution.inspection_id):
        if revision.issued_at:
            # Não alterar o documento nem seu snapshot. A emissão de nova revisão
            # depende do fluxo documental e não recebe numeração inventada aqui.
            audit(actor, reading.company_id, "sistema_pires.documentrevision", revision.pk,
                "thickness.new_document_revision_required", after={"calculation_id": str(calculation.pk)})
        elif revision.status not in (m.DocumentRevision.Status.DRAFT, m.DocumentRevision.Status.SUPERSEDED):
            before = record_snapshot(revision)
            revision.status = m.DocumentRevision.Status.REVIEW
            revision.reviewed_by = None
            revision.approved_at = None
            revision.applicability_validated = False
            revision.decision = ""
            revision.updated_by = actor
            revision.version += 1
            revision.save()
            audit(actor, reading.company_id, "sistema_pires.documentrevision", revision.pk,
                  "thickness.document_review_required", before=before, after=record_snapshot(revision))


@transaction.atomic
def calculate_series(*, series_id, actor, procedure_id=None):
    """Retorna um resultado atual por execução da série e os avisos.

    Escritas concorrentes devem usar os serviços deste módulo, que bloqueiam a
    série. SQL/Admin sem o hook não participa desse protocolo de concorrência.
    """
    require_actor(actor)
    # Bloqueia apenas a tabela-base (sem SELECT FOR UPDATE com joins nullable).
    series = m.MeasurementSeries.objects.select_for_update(no_key=True).get(pk=series_id)
    if procedure_id is None:
        procedure_id = series.procedure_id
    if procedure_id is None:
        raise ValidationError("Selecione o procedimento na série de medição pelo Admin.")
    if series.procedure_id and str(procedure_id) != str(series.procedure_id):
        raise ValidationError("O procedimento informado difere do selecionado na série.")
    procedure = m.ThicknessProcedureVersion.objects.select_for_update(no_key=True).get(pk=procedure_id, company_id=series.company_id)
    if procedure.days_per_year != 365:
        raise ValidationError("Convenção incompatível: a versão do motor exige 365 dias/ano.")
    groups = select_execution_readings(series)
    results, created = [], 0
    for group in sorted(groups, key=lambda g: (min(r.measured_at for r in g.rows), str(g.execution_id))):
        calculation, is_new = _calculate_group(group, groups, series, procedure, actor)
        results.append(calculation)
        created += int(is_new)
    return {"calculations": results, "created": created, "engine_version": ENGINE_VERSION,
            "requires_technical_review": True}


@transaction.atomic
def register_reading(*, actor, procedure_id, **data):
    """Grava uma leitura bruta e recalcula a série; não a aprova automaticamente."""
    require_actor(actor)
    obj = m.ThicknessReading(**data)
    if not obj.series_id:
        raise ValidationError({"series": "O serviço exige série; histórico legado deve ser saneado separadamente."})
    series = m.MeasurementSeries.objects.select_for_update(no_key=True).get(pk=obj.series_id)
    if obj.company_id != series.company_id:
        raise ValidationError({"company": "Organização incompatível com a série."})
    if obj.requirement_id is None:
        position = m.MeasurementPosition.objects.select_related("point").get(pk=obj.position_id)
        req, problems, candidates = select_requirement(position, m.measurement_date(obj.measured_at))
        obj.requirement = req
    if "sequence" not in data:
        last = m.ThicknessReading.objects.filter(execution_id=obj.execution_id, position_id=obj.position_id).order_by("-sequence").first()
        obj.sequence = last.sequence + 1 if last else 1
    obj.created_by = obj.updated_by = actor
    obj.save()
    audit(actor, obj.company_id, "sistema_pires.thicknessreading", obj.pk, "thickness.reading_registered", after=record_snapshot(obj))
    return obj, calculate_series(series_id=series.pk, procedure_id=procedure_id, actor=actor)


@transaction.atomic
def register_reading_review(*, actor, procedure_id, **data):
    """Adiciona evento de revisão e recalcula dependências na mesma transação."""
    require_actor(actor)
    reading = m.ThicknessReading.objects.get(pk=data.get("reading_id") or data["reading"].pk)
    if not reading.series_id:
        raise ValidationError("Leitura legada ainda sem série; saneamento auditado necessário.")
    m.MeasurementSeries.objects.select_for_update(no_key=True).get(pk=reading.series_id)
    data.pop("sequence", None)
    if "company" not in data and "company_id" not in data:
        data["company_id"] = reading.company_id
    last = reading.reviews.order_by("-sequence").first()
    event = m.ThicknessReadingReview(**data, sequence=last.sequence + 1 if last else 1,
                                    created_by=actor, updated_by=actor)
    event.save()
    audit(actor, event.company_id, "sistema_pires.thicknessreadingreview", event.pk,
          "thickness.reading_reviewed", after=record_snapshot(event))
    return event, calculate_series(series_id=reading.series_id, procedure_id=procedure_id, actor=actor)


def configured_procedure(series_id):
    """Vínculo persistido, selecionado no Admin. Não utiliza settings."""
    return m.MeasurementSeries.objects.filter(pk=series_id).values_list("procedure_id", flat=True).first()


def affected_series(obj):
    if isinstance(obj, m.MeasurementSeries):
        return [obj.pk]
    if isinstance(obj, m.ThicknessReading):
        return [obj.series_id] if obj.series_id else []
    if isinstance(obj, m.ThicknessReadingReview):
        return [obj.reading.series_id] if obj.reading.series_id else []
    if isinstance(obj, m.MeasurementSeriesRevision):
        return [obj.series_id]
    if isinstance(obj, m.ThicknessRequirement):
        qs = m.MeasurementSeries.objects.filter(position__point__asset_id=obj.asset_id)
        if obj.point_id:
            qs = qs.filter(position__point_id=obj.point_id)
        if obj.position_id:
            qs = qs.filter(position_id=obj.position_id)
        return list(qs.values_list("pk", flat=True))
    if isinstance(obj, m.ThicknessProcedureVersion):
        return list(obj.measurement_series.values_list("pk", flat=True))
    return []


def admin_calculation_hook(request, obj):
    """Chamado pelo Admin dentro da transação de gravação; sem signals globais."""
    from django.contrib import messages
    relevant = isinstance(obj, (m.MeasurementSeries, m.ThicknessReading, m.ThicknessReadingReview,
                               m.MeasurementSeriesRevision, m.ThicknessRequirement, m.ThicknessProcedureVersion))
    if not relevant:
        return
    series_ids = affected_series(obj)
    if not series_ids and isinstance(obj, (m.ThicknessReading, m.ThicknessReadingReview)):
        messages.warning(request, "Leitura sem série: cálculo pendente de saneamento técnico.")
    for series_id in series_ids:
        procedure_id = configured_procedure(series_id)
        if procedure_id is None:
            messages.warning(request, f"Série {series_id}: selecione o campo Procedimento de medição na página da série para habilitar o cálculo automático.")
            continue
        try:
            result = calculate_series(series_id=series_id, procedure_id=procedure_id, actor=request.user)
        except (ObjectDoesNotExist, ValidationError, ValueError) as exc:
            messages.error(request, f"Registro salvo; cálculo da série {series_id} pendente: {exc}")
            continue
        messages.info(request, f"Série recalculada: {result['created']} novo(s) resultado(s). A aprovação técnica permanece pendente.")
