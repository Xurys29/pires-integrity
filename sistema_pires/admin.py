"""Admin da Pires: cadastros, navegação e rastreabilidade.

Compatível com os 60 models da revisão de 26/11/2026. Não executa cálculos,
assinaturas ou emissão. Escrita temporariamente restrita a superusuários;
perfis operacionais dependem dos serviços/permissões a definir.
"""
import hashlib
import json
import zipfile
from pathlib import PurePosixPath

from django import forms
from django.contrib import admin
from django.core.exceptions import NON_FIELD_ERRORS, ValidationError
from django.db import models as db_models
from django.utils import timezone
from django.utils.html import format_html
from django.urls import reverse

from . import models as m


admin.site.site_header = "Pires Integridade | Administração"
admin.site.site_title = "Pires Integridade"
admin.site.index_title = "Cadastros e rastreabilidade técnica"

AUDIT_FIELDS = ("id", "created_at", "updated_at", "created_by", "updated_by", "version")
SYSTEM_ONLY = {m.ThicknessCalculation, m.AuditEvent, m.OperationReceipt,
               m.RecordOrigin, m.RecordRelation, m.DocumentSignature, m.ReportDelivery, m.RTI}


def company_ids(request):
    return m.CompanyMembership.objects.filter(
        user=request.user, access_state=m.CompanyMembership.State.ACTIVE
    ).values_list("company_id", flat=True)


def scoped_queryset(queryset, request):
    if request.user.is_superuser:
        return queryset
    if queryset.model is m.Company:
        return queryset.filter(pk__in=company_ids(request))
    if issubclass(queryset.model, m.CompanyModel):
        return queryset.filter(company_id__in=company_ids(request))
    return queryset


def object_label(obj):
    if obj is None:
        return "—"
    if isinstance(obj, m.ThicknessProcedureVersion):
        return f"{obj.company.name} / {obj.code} / rev. {obj.revision} / {obj.get_status_display()}"
    if isinstance(obj, m.StoredFile):
        return obj.original_name
    if isinstance(obj, m.ThicknessReading):
        return f"{obj.position.point.code} / {obj.position.code}: {obj.value} {obj.unit}"
    if isinstance(obj, m.Inspection):
        return f"{obj.asset.tag} / {obj.get_modality_display()} / {str(obj.pk)[:8]}"
    if isinstance(obj, m.InspectionExecution):
        return f"{obj.inspection.asset.tag} / execução {obj.sequence}"
    if isinstance(obj, m.DocumentRevision):
        return f"{obj.document.code} / rev. {obj.revision}"
    if isinstance(obj, m.ThicknessRequirement):
        return f"{obj.asset.tag} / {obj.required_thickness} {obj.unit} / rev. {obj.revision}"
    for name in ("tag", "name", "original_name", "code", "reference", "title", "certificate_number", "item_key"):
        value = getattr(obj, name, None)
        if value:
            return str(value)
    if isinstance(obj, m.BaseModel):
        return f"{obj._meta.verbose_name} / {str(obj.pk)[:8]}"
    return str(obj)


def related_column(field):
    @admin.display(description=field.verbose_name, ordering=field.name)
    def column(obj):
        return object_label(getattr(obj, field.name))
    column.__name__ = f"label_{field.name}"
    return column


def serializable(value):
    """Snapshot apenas de dados persistidos; arquivos são representados pelo nome."""
    return json.loads(json.dumps(value, default=str, ensure_ascii=False))


def snapshot(obj):
    if obj is None:
        return {}
    return serializable({field.attname: getattr(obj, field.attname)
                         for field in obj._meta.concrete_fields})


def audit(request, obj, action, before=None):
    company_id = obj.pk if isinstance(obj, m.Company) else getattr(obj, "company_id", None)
    if company_id and not isinstance(obj, m.AuditEvent):
        m.AuditEvent.objects.create(
            company_id=company_id, entity_type=obj._meta.label_lower,
            entity_id=obj.pk, action=action, actor=request.user,
            occurred_at=timezone.now(), before=before or {}, after=snapshot(obj),
            created_by=request.user, updated_by=request.user,
        )


def stamp(request, obj, change):
    if not change:
        obj.created_by = request.user
    obj.updated_by = request.user
    if change:
        obj.version += 1


def locked(obj):
    if isinstance(obj, m.InspectionCatalogItem):
        return obj.catalog.status != m.InspectionCatalog.Status.DRAFT
    if isinstance(obj, m.InspectionCondition):
        return obj.item.catalog.status != m.InspectionCatalog.Status.DRAFT
    if isinstance(obj, m.InspectionRecommendation):
        return obj.condition.item.catalog.status != m.InspectionCatalog.Status.DRAFT
    if isinstance(obj, m.RiskBand):
        return bool(obj.matrix.approved_at)
    return bool(obj and (isinstance(obj, (m.ImmutableCompanyRecord, m.ThicknessReading, m.StoredFile))
                         or (obj.freeze_on and getattr(obj, obj.freeze_on))))


class DomainModelForm(forms.ModelForm):
    """Converte erros de campos fora do formulário em erros gerais legíveis."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            if isinstance(field, forms.ModelChoiceField):
                field.label_from_instance = object_label
        if isinstance(self.instance, m.MeasurementSeries) and "procedure" in self.fields:
            if self.instance.company_id:
                self.fields["procedure"].queryset = self.fields["procedure"].queryset.filter(company_id=self.instance.company_id)

    def _update_errors(self, errors):
        if hasattr(errors, "error_dict"):
            mapped = {}
            for name, messages in errors.error_dict.items():
                target = name if name in self.fields else NON_FIELD_ERRORS
                mapped.setdefault(target, []).extend(messages)
            errors = ValidationError(mapped)
        super()._update_errors(errors)


class PiresAdmin(admin.ModelAdmin):
    form = DomainModelForm
    readonly_fields = AUDIT_FIELDS
    list_per_page = 30
    list_select_related = True
    save_on_top = True
    show_full_result_count = False
    actions = None

    def get_queryset(self, request):
        return scoped_queryset(super().get_queryset(request), request)

    def get_list_display(self, request):
        columns = []
        for name in super().get_list_display(request):
            field = self.model._meta.get_field(name)
            columns.append(related_column(field) if isinstance(field, db_models.ForeignKey) else name)
        return tuple(columns)

    def has_add_permission(self, request):
        return request.user.is_superuser and super().has_add_permission(request)

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser and super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        # Evita cascatas, descarte de histórico e exclusão em lote pelo Admin.
        return False

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        kwargs["queryset"] = scoped_queryset(db_field.remote_field.model._default_manager.all(), request)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def get_readonly_fields(self, request, obj=None):
        fields = list(AUDIT_FIELDS)
        if self.model is m.Recommendation:
            fields += ["status", "opened_at", "withdrawn_at", "withdrawal_reason"]
        if self.model is m.DocumentRevision:
            fields += ["status", "data_snapshot", "calculation_snapshot", "calculation_version",
                       "reviewed_by", "approved_at", "issued_at", "applicability_validated"]
        if obj:
            if locked(obj):
                fields += [f.name for f in self.model._meta.concrete_fields]
            else:
                fields += [name.removesuffix("_id") for name in obj.immutable_fields]
                if isinstance(obj, m.CompanyModel):
                    fields.append("company")
                if isinstance(obj, m.MeasurementPoint):
                    fields.append("component")
        return tuple(dict.fromkeys(fields))

    def save_model(self, request, obj, form, change):
        if isinstance(obj, m.ThicknessReading) and not change and obj.requirement_id is None:
            from .services.calcs.historico_medicoes import select_requirement
            requirement, issues, candidates = select_requirement(obj.position, m.measurement_date(obj.measured_at))
            obj.requirement = requirement
        before = snapshot(self.model.objects.get(pk=obj.pk)) if change else {}
        stamp(request, obj, change)
        super().save_model(request, obj, form, change)
        audit(request, obj, "admin.change" if change else "admin.add", before)
        from .services.calcs.registro_medicoes import admin_calculation_hook
        admin_calculation_hook(request, obj)

    def save_formset(self, request, form, formset, change):
        for obj in formset.save(commit=False):
            exists = not obj._state.adding
            before = snapshot(type(obj).objects.get(pk=obj.pk)) if exists else {}
            # A empresa é sempre a do pai, nunca vem do navegador.
            obj.company_id = form.instance.pk if isinstance(form.instance, m.Company) else form.instance.company_id
            stamp(request, obj, exists)
            obj.save()
            audit(request, obj, "admin.inline.change" if exists else "admin.inline.add", before)
        formset.save_m2m()


class AppendOnlyAdmin(PiresAdmin):
    def has_change_permission(self, request, obj=None):
        return obj is None and super().has_change_permission(request, obj)


class SystemRecordAdmin(AppendOnlyAdmin):
    def has_add_permission(self, request):
        return False


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False
    show_change_link = True
    classes = ("collapse",)

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_queryset(self, request):
        return scoped_queryset(super().get_queryset(request), request).select_related()


class EditableInline(admin.TabularInline):
    """Apenas cadastros simples; registros técnicos são inlines de consulta."""
    extra = 0
    can_delete = False
    show_change_link = True

    def has_add_permission(self, request, obj=None):
        return request.user.is_superuser and super().has_add_permission(request, obj)

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser and super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        return False

    def get_queryset(self, request):
        return scoped_queryset(super().get_queryset(request), request)

    def get_formset(self, request, obj=None, **kwargs):
        parent = obj

        class BoundInlineForm(DomainModelForm):
            def __init__(self, *args, **form_kwargs):
                super().__init__(*args, **form_kwargs)
                if parent:
                    self.instance.company_id = parent.pk if isinstance(parent, m.Company) else parent.company_id
                for field in self.fields.values():
                    if isinstance(field, forms.ModelChoiceField):
                        field.queryset = scoped_queryset(field.queryset, request)
                        if parent and issubclass(field.queryset.model, m.CompanyModel):
                            field.queryset = field.queryset.filter(company_id=parent.company_id)
                if self.instance.pk and not self.instance._state.adding:
                    for name in self.instance.immutable_fields:
                        name = name.removesuffix("_id")
                        if name in self.fields:
                            self.fields[name].disabled = True

        kwargs["form"] = BoundInlineForm
        return super().get_formset(request, obj, **kwargs)


def inline(model, fk, fields, *, editable=False, title=None):
    base = EditableInline if editable else ReadOnlyInline
    attrs = {"model": model, "fk_name": fk, "fields": tuple(fields), "__module__": __name__}
    if not editable:
        columns = []
        for name in fields:
            field = model._meta.get_field(name)
            if isinstance(field, db_models.ForeignKey):
                method_name = f"label_{name}"
                def factory(f):
                    @admin.display(description=f.verbose_name)
                    def label(self, obj):
                        related = getattr(obj, f.name)
                        if related is None:
                            return "—"
                        url = reverse(f"admin:{related._meta.app_label}_{related._meta.model_name}_change", args=[related.pk])
                        return format_html('<a href="{}">{}</a>', url, object_label(related))
                    return label
                attrs[method_name] = factory(field)
                columns.append(method_name)
            else:
                columns.append(name)
        attrs["fields"] = tuple(columns)
    if title:
        attrs["verbose_name_plural"] = title
    return type(f"{model.__name__}_{fk}_Inline", (base,), attrs)


# Inlines de cadastro: relação simples, mesma organização, sem dados de aprovação.
UnitInline = inline(m.Unit, "client", ("name", "location", "active"), editable=True)
SystemInline = inline(m.System, "unit", ("name", "description", "active"), editable=True)
AssetInline = inline(m.Asset, "system", ("tag", "asset_type", "description", "active"), editable=True)
ComponentInline = inline(m.AssetComponent, "asset", ("code", "description", "nominal_thickness", "nominal_unit", "nominal_source", "active"), editable=True)

# Inlines técnicos são consultas com link para o registro completo.
ContractInline = inline(m.Contract, "client", ("reference", "title", "starts_on", "ends_on", "active"))
ProjectInline = inline(m.Project, "contract", ("code", "title", "active"))
CampaignInline = inline(m.Campaign, "project", ("code", "title", "coverage", "planned_start", "planned_end"))
ProjectAssetInline = inline(m.ProjectAsset, "project", ("asset", "module", "active"))
CampaignAssetInline = inline(m.CampaignAsset, "campaign", ("asset", "visual_required", "thickness_required", "inspector", "planned_at"))
InspectionInline = inline(m.Inspection, "asset", ("modality", "status", "planned_at", "inspected_at"))
ExecutionInline = inline(m.InspectionExecution, "inspection", ("sequence", "kind", "observed_at", "inspector", "status"))
PointInline = inline(m.MeasurementPoint, "asset", ("code", "display_name", "component", "active"))
PointRevisionInline = inline(m.MeasurementPointRevision, "point", ("revision", "effective_on", "sheet", "location"))
PositionInline = inline(m.MeasurementPosition, "point", ("code", "display_name", "angle_degrees", "active"))
SeriesInline = inline(m.MeasurementSeries, "position", ("code", "procedure", "started_on", "start_reason", "predecessor"))
SeriesReviewInline = inline(m.MeasurementSeriesRevision, "series", ("sequence", "point_revision", "decision", "effective_on", "reviewed_by"))
ReadingInline = inline(m.ThicknessReading, "execution", ("position", "series", "measured_at", "value", "unit", "sequence", "corrects"))
SeriesReadingInline = inline(m.ThicknessReading, "series", ("position", "measured_at", "value", "unit", "sequence"))
ReadingReviewInline = inline(m.ThicknessReadingReview, "reading", ("sequence", "decision", "representative", "comparable", "baseline_approved", "correction_approved", "reviewer"))
CalculationInline = inline(m.ThicknessCalculation, "reading", ("calculated_at", "dimensional", "trend", "margin_mm", "life_triage_days", "engine_version"))
CalculationReviewInline = inline(m.ThicknessCalculationReview, "calculation", ("sequence", "decision", "reviewer", "reviewed_at", "reinspection_on"))
RequirementInline = inline(m.ThicknessRequirement, "asset", ("point", "position", "revision", "required_thickness", "unit", "valid_from", "valid_until", "approved_at"))
IsometricInline = inline(m.Isometric, "asset", ("code", "title"))
IsometricRevisionInline = inline(m.IsometricRevision, "isometric", ("revision", "issued_on", "file", "notes"))
EquipmentInline = inline(m.ExecutionInstrument, "execution", ("instrument", "calibration", "purpose", "verified_at"))
CalibrationInline = inline(m.CalibrationRecord, "instrument", ("certificate_number", "calibrated_on", "valid_until", "issuer"))
InspectionItemInline = inline(m.InspectionItem, "execution", ("item_key", "component", "condition", "status"))
PhotoInline = inline(m.InspectionPhoto, "execution", ("purpose", "file", "caption", "reading", "finding"))
ReadingPhotoInline = inline(m.InspectionPhoto, "reading", ("purpose", "file", "caption"))
FindingInline = inline(m.Finding, "item", ("description", "requires_technical_review", "reviewed_at"))
RecommendationInline = inline(m.Recommendation, "finding", ("text", "status", "opened_at"))
RTIInline = inline(m.RTI, "recommendation", ("reference", "status", "due_at", "deadline_pending"))
RTIActionInline = inline(m.RTIAction, "rti", ("description", "responsible", "planned_at", "performed_at", "verified_at"))
DocumentInline = inline(m.TechnicalDocument, "asset", ("code", "title", "kind", "module"))
DocumentRevisionInline = inline(m.DocumentRevision, "document", ("revision", "status", "calculation_version", "issued_at"))
DocumentAttachmentInline = inline(m.DocumentAttachment, "revision", ("title", "file", "is_final_pdf"))
SignatureInline = inline(m.DocumentSignature, "revision", ("signer", "role", "signed_at", "method"))
DeliveryInline = inline(m.ReportDelivery, "revision", ("recipient_name", "delivered_at", "channel"))
QualificationInline = inline(m.Qualification, "professional", ("catalog", "level", "certificate_number", "valid_until", "verified_at"))
ProfessionalDocumentInline = inline(m.ProfessionalDocument, "professional", ("title", "document_type", "valid_until", "file"))
TeamInline = inline(m.TeamAssignment, "project", ("professional", "activity", "starts_on", "ends_on"))
CatalogItemInline = inline(m.InspectionCatalogItem, "catalog", ("item_key", "component", "description", "order"))
ConditionInline = inline(m.InspectionCondition, "item", ("code", "label", "description"))
CatalogRecommendationInline = inline(m.InspectionRecommendation, "condition", ("code", "text", "requires_action"))
RiskBandInline = inline(m.RiskBand, "matrix", ("score", "treatment", "lower_bound", "upper_bound", "unit"))


class StoredFileForm(DomainModelForm):
    """Calcula metadados antes da validação do model. Não publica URLs de mídia."""
    MAX_BYTES = 20 * 1024 * 1024

    def clean(self):
        cleaned = super().clean()
        upload = cleaned.get("file")
        if not self.instance._state.adding or not upload:
            return cleaned
        if upload.size > self.MAX_BYTES:
            self.add_error("file", "Máximo de 20 MiB por arquivo.")
            return cleaned
        data = upload.read()
        upload.seek(0)
        ext = PurePosixPath(upload.name.replace("\\", "/")).suffix.lower()
        mime = None
        if ext == ".pdf" and data.startswith(b"%PDF-"):
            mime = "application/pdf"
        elif ext == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
            mime = "image/png"
        elif ext in {".jpg", ".jpeg"} and data.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        elif ext == ".webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            mime = "image/webp"
        elif ext in {".txt", ".csv"}:
            try:
                data.decode("utf-8-sig")
                if b"\0" not in data:
                    mime = "text/csv" if ext == ".csv" else "text/plain"
            except UnicodeDecodeError:
                pass
        elif ext == ".xlsx":
            try:
                with zipfile.ZipFile(upload) as archive:
                    names = set(archive.namelist())
                    if "[Content_Types].xml" in names and "xl/workbook.xml" in names:
                        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            except (zipfile.BadZipFile, OSError):
                pass
            finally:
                upload.seek(0)
        if not mime:
            self.add_error("file", "Formato não reconhecido. Use PDF, PNG, JPEG, WebP, XLSX, CSV ou TXT UTF-8.")
            return cleaned
        self.instance.original_name = PurePosixPath(upload.name.replace("\\", "/")).name
        self.instance.mime_type = mime
        self.instance.size_bytes = len(data)
        self.instance.sha256 = hashlib.sha256(data).hexdigest()
        return cleaned


class StoredFileAdmin(PiresAdmin):
    form = StoredFileForm

    @admin.display(description="Arquivo armazenado (sem URL pública)")
    def file_reference(self, obj):
        return obj.file.name

    def get_fields(self, request, obj=None):
        fields = list(super().get_fields(request, obj))
        if obj:
            fields = [name for name in fields if name != "file"]
            if "file_reference" not in fields:
                fields.append("file_reference")
        return list(dict.fromkeys(fields))

    def get_readonly_fields(self, request, obj=None):
        computed = ("original_name", "mime_type", "size_bytes", "sha256", "verified_at")
        if obj:
            computed += ("file_reference",)
        return tuple(dict.fromkeys((*super().get_readonly_fields(request, obj), *computed)))


# (colunas, filtros, inlines). FKs pesquisáveis usam autocomplete sem extensões.
SPECS = {
    m.Company: (("name", "active"), ("active",), ()),
    m.Client: (("name", "company", "active"), ("active",), (UnitInline, ContractInline)),
    m.Unit: (("name", "client", "company", "active"), ("active",), (SystemInline,)),
    m.System: (("name", "unit", "company", "active"), ("active",), (AssetInline,)),
    m.Asset: (("tag", "asset_type", "system", "company", "active"), ("asset_type", "active"), (ComponentInline, PointInline, RequirementInline, IsometricInline, InspectionInline, DocumentInline)),
    m.AssetComponent: (("code", "asset", "nominal_thickness", "nominal_unit", "active"), ("active",), ()),
    m.Contract: (("reference", "client", "responsible_engineer", "active"), ("active",), (ProjectInline,)),
    m.Project: (("code", "title", "contract", "active"), ("active",), (ProjectAssetInline, CampaignInline, TeamInline)),
    m.Campaign: (("code", "project", "coverage", "planned_start", "planned_end"), ("coverage",), (CampaignAssetInline,)),
    m.Inspection: (("asset", "modality", "status", "planned_at", "inspected_at"), ("modality", "status"), (ExecutionInline,)),
    m.InspectionExecution: (("inspection", "sequence", "kind", "observed_at", "inspector", "status"), ("kind", "status"), (EquipmentInline, InspectionItemInline, ReadingInline, PhotoInline)),
    m.MeasurementPoint: (("code", "display_name", "asset", "component", "active"), ("active",), (PointRevisionInline, PositionInline)),
    m.MeasurementPosition: (("code", "display_name", "point", "angle_degrees", "active"), ("active",), (SeriesInline,)),
    m.MeasurementSeries: (("code", "position", "procedure", "started_on", "predecessor"), (), (SeriesReviewInline, SeriesReadingInline)),
    m.ThicknessReading: (("position", "series", "value", "unit", "measured_at", "origin", "sequence"), ("origin", "unit"), (ReadingReviewInline, ReadingPhotoInline, CalculationInline)),
    m.ThicknessReadingReview: (("reading", "sequence", "decision", "representative", "comparable", "baseline_approved", "reviewer"), ("decision", "baseline_approved", "correction_approved"), ()),
    m.MeasurementSeriesRevision: (("series", "sequence", "point_revision", "decision", "effective_on"), ("decision",), ()),
    m.ThicknessRequirement: (("asset", "point", "position", "required_thickness", "unit", "revision", "valid_from", "valid_until", "approved_at"), ("unit",), ()),
    m.ThicknessProcedureVersion: (("code", "revision", "status", "days_per_year", "approved_at"), ("status",), ()),
    m.ThicknessCalculation: (("reading", "dimensional", "trend", "margin_mm", "life_triage_days", "engine_version", "calculated_at"), ("dimensional", "trend"), (CalculationReviewInline,)),
    m.ThicknessCalculationReview: (("calculation", "sequence", "decision", "reviewer", "reviewed_at", "reinspection_on"), ("decision",), ()),
    m.Isometric: (("code", "asset", "title"), (), (IsometricRevisionInline,)),
    m.Instrument: (("code", "instrument_type", "manufacturer", "serial_number", "active"), ("instrument_type", "active"), (CalibrationInline,)),
    m.Professional: (("name", "registration_board", "registration_number", "active"), ("active",), (QualificationInline, ProfessionalDocumentInline)),
    m.InspectionCatalog: (("code", "revision", "title", "status"), ("status",), (CatalogItemInline,)),
    m.InspectionCatalogItem: (("catalog", "item_key", "component", "order"), (), (ConditionInline,)),
    m.InspectionCondition: (("item", "code", "label"), (), (CatalogRecommendationInline,)),
    m.InspectionItem: (("execution", "item_key", "component", "status"), ("status",), (FindingInline,)),
    m.Finding: (("item", "description", "requires_technical_review", "reviewed_at"), ("requires_technical_review",), (RecommendationInline,)),
    m.Recommendation: (("finding", "status", "opened_at", "technical_review_required"), ("status",), (RTIInline,)),
    m.RTI: (("reference", "status", "due_at", "deadline_pending", "immediate_action"), ("status", "deadline_pending", "immediate_action"), (RTIActionInline,)),
    m.RiskMatrixVersion: (("code", "revision", "title", "approved_at"), (), (RiskBandInline,)),
    m.TechnicalDocument: (("code", "asset", "kind", "module"), ("kind", "module"), (DocumentRevisionInline,)),
    m.DocumentRevision: (("document", "revision", "status", "issued_at"), ("status",), (DocumentAttachmentInline, SignatureInline, DeliveryInline)),
    m.StoredFile: (("original_name", "purpose", "mime_type", "size_bytes", "created_at"), ("purpose", "mime_type"), ()),
}


def register_models():
    # Modelos abstratos não aparecem em apps.get_models(). Todos os 60 concretos são registrados.
    for model in m.Company._meta.app_config.get_models():
        columns, filters, inlines = SPECS.get(model, (("id", "company", "created_at"), (), ()))
        if model in SYSTEM_ONLY:
            base = SystemRecordAdmin
        elif issubclass(model, m.ImmutableCompanyRecord):
            base = AppendOnlyAdmin
        elif model is m.StoredFile:
            base = StoredFileAdmin
        else:
            base = PiresAdmin
        text_fields = [field.name for field in model._meta.fields
                       if isinstance(field, (db_models.CharField, db_models.TextField))]
        search = ["=id", *text_fields]
        # Acrescenta identificadores legíveis dos relacionados sem alterar __str__ dos models.
        for field in model._meta.fields:
            if isinstance(field, db_models.ForeignKey) and issubclass(field.remote_field.model, m.BaseModel):
                for name in ("tag", "name", "code", "reference"):
                    if any(f.name == name for f in field.remote_field.model._meta.fields):
                        search.append(f"{field.name}__{name}")
                        break
        attrs = dict(
            __module__=__name__, list_display=columns, list_filter=filters,
            inlines=inlines, search_fields=tuple(search),
            autocomplete_fields=tuple(field.name for field in model._meta.fields
                                      if isinstance(field, db_models.ForeignKey)
                                      and field.name not in {"created_by", "updated_by"}
                                      and not (model is m.MeasurementSeries and field.name == "procedure")),
            ordering=("-created_at",),
        )
        admin.site.register(model, type(f"{model.__name__}Admin", (base,), attrs))


register_models()
