"""Motor puro de espessura. Sem Django, banco, aprovação ou prazo de reinspeção."""
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, localcontext
from fractions import Fraction

ENGINE_VERSION = "pires-thickness/1.0.0-test"
PRECISION = 60
DAYS_PER_YEAR = 365


@dataclass(frozen=True)
class ReadingValue:
    value: Decimal
    measured_on: date
    unit: str = "mm"
    identifier: str = ""

    def __post_init__(self):
        if not isinstance(self.value, Decimal) or not self.value.is_finite() or self.value <= 0:
            raise ValueError("Leitura deve ser Decimal finito e positivo; não use float.")
        if type(self.measured_on) is not date:
            raise ValueError("Informe a data civil da medição, não datetime.")
        if self.unit not in {"mm", "in"}:
            raise ValueError("Unidade não suportada: use mm ou in.")


def mm_fraction(value, unit="mm"):
    if not isinstance(value, Decimal) or not value.is_finite() or value <= 0:
        raise ValueError("Espessura deve ser Decimal finito e positivo.")
    if unit not in {"mm", "in"}:
        raise ValueError("Unidade não suportada.")
    return Fraction(value) * (Fraction(254, 10) if unit == "in" else 1)


def decimal_text(value):
    if value is None:
        return None
    with localcontext() as ctx:
        ctx.prec = PRECISION
        return format(Decimal(value.numerator) / Decimal(value.denominator), "f")


def exact_value(value):
    if value is None:
        return None
    return {"numerator": str(value.numerator), "denominator": str(value.denominator)}


def format_number(text, places):
    if text is None:
        return "—"
    with localcontext() as ctx:
        ctx.prec = max(PRECISION, len(str(text)) + places + 5)
        value = Decimal(text)
        rounded = value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    if rounded == 0:
        rounded = abs(rounded)
    if value != 0 and rounded == 0:
        limit = format(Decimal(1).scaleb(-places), f".{places}f").replace(".", ",")
        return f"{'+' if value > 0 else '-'}<{limit} (abaixo da resolução de exibição)"
    return format(rounded, f".{places}f").replace(".", ",")


def calculate_thickness(*, current, previous=None, initial=None, required=None, required_unit="mm"):
    """Classifica com frações exatas e arredonda apenas a representação.

    Vida inteira é piso da razão exata; evita 729 em vez de 730 por arredondamento
    intermediário da taxa. As referências já devem estar validadas pelo serviço.
    """
    if not isinstance(current, ReadingValue):
        raise ValueError("current deve ser ReadingValue.")
    for ref in (previous, initial):
        if ref is not None and (not isinstance(ref, ReadingValue) or ref.measured_on >= current.measured_on):
            raise ValueError("Referências devem ser de dia anterior ao atual.")
    if initial and previous and initial.measured_on > previous.measured_on:
        raise ValueError("Referência inicial não pode ser posterior à anterior.")
    cur = mm_fraction(current.value, current.unit)
    req = mm_fraction(required, required_unit) if required is not None else None
    margin = cur - req if req is not None else None
    loss = ((mm_fraction(initial.value, initial.unit) - cur) * 100 / mm_fraction(initial.value, initial.unit)) if initial else None
    short_days = (current.measured_on - previous.measured_on).days if previous else None
    long_days = (current.measured_on - initial.measured_on).days if initial else None
    short = (mm_fraction(previous.value, previous.unit) - cur) * DAYS_PER_YEAR / short_days if previous else None
    long = (mm_fraction(initial.value, initial.unit) - cur) * DAYS_PER_YEAR / long_days if initial else None
    positive = [rate for rate in (short, long) if rate is not None and rate > 0]
    triage = max(positive) if positive else None
    sources = [name for name, rate in (("short", short), ("long", long)) if triage is not None and rate == triage]
    dimensional = "pending" if margin is None else ("above" if margin > 0 else ("limit" if margin == 0 else "below"))
    rates = [r for r in (short, long) if r is not None]
    trend = "insufficient" if not rates else ("review" if any(r < 0 for r in rates) else ("loss" if positive else "zero"))
    warnings, notes = [], []
    def warn(code, message):
        warnings.append({"code": code, "message": message})
    if req is None:
        warn("REQUIREMENT_MISSING", "Espessura requerida ausente ou pendente.")
    if previous is None:
        warn("SHORT_HISTORY_INSUFFICIENT", "Histórico insuficiente para taxa curta.")
    if initial is None:
        warn("LONG_HISTORY_INSUFFICIENT", "Referência inicial aprovada não disponível.")
    if trend == "review":
        warn("COMPARABILITY_REVIEW", "Leitura atual maior que uma referência; revisar comparabilidade. A variação negativa foi preservada.")
    if any(r == 0 for r in rates):
        warn("ZERO_RATE", "Taxa zero: vida indeterminada para esse par; não significa vida infinita.")
    if dimensional == "limit":
        warn("AT_LIMIT", "No limite: saldo zero e sem projeção de vida futura.")
    elif dimensional == "below":
        warn("BELOW_REQUIRED", "Abaixo do requerido: alerta crítico e revisão técnica imediata.")
    same_pair = bool(previous and initial and (
        (previous.identifier and initial.identifier and previous.identifier == initial.identifier)
        or (not previous.identifier and not initial.identifier and previous == initial)))
    if same_pair:
        notes.append("Taxas curta e longa usam o mesmo par de medições.")
    def life(rate):
        if margin is None or margin <= 0 or rate is None or rate <= 0:
            return None
        exact_days = DAYS_PER_YEAR * margin / rate
        return exact_days.numerator // exact_days.denominator
    values = {"current_mm": cur, "required_mm": req, "margin_mm": margin, "loss_percent": loss,
              "short_rate_mm_year": short, "long_rate_mm_year": long, "triage_rate_mm_year": triage}
    result = {name: decimal_text(value) for name, value in values.items()}
    result.update({"engine_version": ENGINE_VERSION, "days_per_year": DAYS_PER_YEAR,
                   "dimensional": dimensional, "trend": trend, "short_interval_days": short_days,
                   "long_interval_days": long_days, "same_pair": same_pair,
                   "triage_sources": sources, "adopted_rate_mm_year": None,
                   "triage_reason": "Maior taxa positiva comparável, apenas para triagem; adoção depende do responsável técnico." if triage else "",
                   "life_short_days": life(short), "life_long_days": life(long), "life_triage_days": life(triage),
                   "warnings": warnings, "notes": notes,
                   "exact": {name: exact_value(value) for name, value in values.items()},
                   "reference_for_loss": initial.identifier if initial else None})
    result["display"] = {name: format_number(result[name], 3 if "rate" in name else 2) for name in values}
    for name in ("life_short_days", "life_long_days", "life_triage_days"):
        result["display"][name] = "—" if result[name] is None else ("<1 dia" if result[name] == 0 else f"{result[name]} dias")
    return result
