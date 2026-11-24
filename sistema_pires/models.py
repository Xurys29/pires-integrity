"""Domínio Pires Integrity. Django 5.2+ e PostgreSQL.

Instalar como sistema_pires/models.py. Fluxos transacionais, autorização,
assinatura, sincronização e cálculos técnicos pertencem aos serviços.
"""

import uuid
from decimal import Decimal
from pathlib import PurePosixPath

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower

SHA256 = RegexValidator(r"^[0-9a-f]{64}$", "Informe um SHA-256 hexadecimal em minúsculas.")


def private_upload_path(instance, filename):
    """Nome sem dados pessoais. O storage configurado deve ser privado."""
    extension = PurePosixPath(filename.replace("\\", "/")).suffix.lower()[:12]
    return f"pires/{instance.company_id}/{instance.pk}/{uuid.uuid4().hex}{extension}"


def require_draft_catalog(catalog):
    status = InspectionCatalog.objects.values_list("status", flat=True).get(pk=catalog.pk)
    if status != InspectionCatalog.Status.DRAFT:
        raise ValidationError(
            "Catálogo verificado ou retirado exige uma nova versão para editar seu conteúdo."
        )


def same_reference(instance, field, expected_id):
    """Valida coerência entre relações que uma FK isolada não expressa."""
    actual_id = getattr(instance, f"{field}_id", None)
    if actual_id != expected_id:
        raise ValidationError({field: "Vínculo incompatível com o registro relacionado."})


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="%(app_label)s_%(class)s_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="%(app_label)s_%(class)s_updated",
    )
    version = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1)])
    immutable_fields = ()
    freeze_on = ""
    frozen_fields = ()

    class Meta:
        abstract = True
        constraints = [
            models.CheckConstraint(condition=Q(version__gte=1), name="%(app_label)s_%(class)s_ver"),
        ]

    def clean(self):
        super().clean()
        fields = self.immutable_fields
        if hasattr(self, "company_id"):
            fields = ("company_id", *fields)
        if self._state.adding:
            return
        frozen_fields = self.frozen_fields
        query_fields = tuple(
            dict.fromkeys((*fields, *frozen_fields, *([self.freeze_on] if self.freeze_on else [])))
        )
        if not query_fields:
            return
        previous = type(self).objects.filter(pk=self.pk).values(*query_fields).first()
        if previous and self.freeze_on and previous[self.freeze_on] is not None:
            for field in frozen_fields:
                if getattr(self, field) != previous[field]:
                    raise ValidationError(
                        {field.removesuffix("_id"): "Conteúdo congelado. Crie uma nova revisão."}
                    )
        if previous:
            for field in fields:
                if getattr(self, field) != previous[field]:
                    raise ValidationError({field.removesuffix("_id"): "Este vínculo é permanente."})

    def save(self, *args, **kwargs):
        # ModelForm e DRF não são os únicos chamadores de save().
        # update()/bulk_create()/SQL direto exigem validação própria nos serviços.
        self.full_clean()
        return super().save(*args, **kwargs)


class Company(BaseModel):
    name = models.CharField(max_length=200)
    legal_name = models.CharField(max_length=250, blank=True)
    registration_number = models.CharField(max_length=40, blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class CompanyModel(BaseModel):
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="%(class)s_records")

    class Meta(BaseModel.Meta):
        abstract = True

    def clean(self):
        super().clean()
        # Evita relacionar entidades de organizações distintas pelo save normal.
        for field in self._meta.fields:
            if not isinstance(field, models.ForeignKey) or field.name == "company":
                continue
            if not getattr(self, field.attname):
                continue
            try:
                related = getattr(self, field.name)
            except ObjectDoesNotExist:
                continue
            related_company = getattr(related, "company_id", None)
            if related_company and related_company != self.company_id:
                raise ValidationError({field.name: "O registro pertence a outra organização."})


class Role(models.TextChoices):
    MANAGER = "manager", "Gerente"
    ENGINEER = "engineer", "Engenheiro"
    ASSISTANT = "assistant", "Assistente"
    INSPECTOR = "inspector", "Inspetor"


class CompanyMembership(CompanyModel):
    class State(models.TextChoices):
        INVITED = "invited", "Convidado"
        ACTIVE = "active", "Ativo"
        SUSPENDED = "suspended", "Suspenso"
        REVOKED = "revoked", "Revogado"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="pires_memberships"
    )
    role = models.CharField(max_length=20, choices=Role.choices)
    access_state = models.CharField(max_length=12, choices=State.choices, default=State.INVITED)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pires_memberships_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    invitation_token_hash = models.CharField(max_length=64, blank=True, validators=[SHA256])
    invitation_expires_at = models.DateTimeField(null=True, blank=True)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["company", "user"], name="pi_membership_user"),
        ]


class PilotAccess(CompanyModel):
    membership = models.ForeignKey(
        CompanyMembership, on_delete=models.PROTECT, related_name="pilot_grants"
    )
    granted_at = models.DateTimeField()
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    reason = models.TextField()

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(expires_at__isnull=True) | Q(expires_at__gt=F("granted_at")),
                name="pi_pilot_dates",
            ),
        ]


class Professional(CompanyModel):
    membership = models.OneToOneField(
        CompanyMembership,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="professional",
    )
    name = models.CharField(max_length=200)
    job_title = models.CharField(max_length=150, blank=True)
    relationship = models.CharField(max_length=100, blank=True)
    professional_email = models.EmailField(blank=True)
    professional_phone = models.CharField(max_length=40, blank=True)
    registration_board = models.CharField(max_length=50, blank=True)
    registration_number = models.CharField(max_length=60, blank=True)
    integrity_level = models.CharField(max_length=80, blank=True)
    integrity_basis = models.TextField(blank=True)
    technical_state = models.CharField(max_length=60, blank=True)
    technical_basis = models.TextField(blank=True)
    availability_note = models.TextField(blank=True)
    login_validated_at = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)
    is_training_record = models.BooleanField(default=False)
    source = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.name


class StoredFile(CompanyModel):
    """Storage privado. MIME/tamanho/hash devem ser verificados no upload."""

    class Purpose(models.TextChoices):
        EVIDENCE = "evidence", "Evidência"
        QUALIFICATION = "qualification", "Qualificação"
        DOCUMENT = "document", "Documento"
        DRAWING = "drawing", "Desenho"
        CALIBRATION = "calibration", "Calibração"
        REFERENCE = "reference", "Referência"

    file = models.FileField(upload_to=private_upload_path, max_length=500)
    original_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=150)
    size_bytes = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64, validators=[SHA256], db_index=True)
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    verified_at = models.DateTimeField(null=True, blank=True)
    source = models.JSONField(default=dict, blank=True)


class QualificationCatalog(CompanyModel):
    code = models.CharField(max_length=50)
    title = models.CharField(max_length=200)
    meaning = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["company", "code"], name="pi_qual_code")
        ]


class Qualification(CompanyModel):
    professional = models.ForeignKey(
        Professional, on_delete=models.PROTECT, related_name="qualifications"
    )
    catalog = models.ForeignKey(
        QualificationCatalog, on_delete=models.PROTECT, related_name="qualifications"
    )
    method = models.CharField(max_length=100, blank=True)
    level = models.CharField(max_length=40, blank=True)
    scope = models.TextField(blank=True)
    issuer = models.CharField(max_length=200)
    certificate_number = models.CharField(max_length=100)
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pires_qualifications_verified",
    )
    evidence = models.ForeignKey(
        StoredFile, null=True, blank=True, on_delete=models.PROTECT, related_name="qualifications"
    )
    notes = models.TextField(blank=True)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(valid_from__isnull=True)
                | Q(valid_until__isnull=True)
                | Q(valid_until__gte=F("valid_from")),
                name="pi_qual_dates",
            )
        ]


class Client(CompanyModel):
    name = models.CharField(max_length=200)
    legal_name = models.CharField(max_length=250, blank=True)
    registration_number = models.CharField(max_length=40, blank=True)
    source = models.JSONField(default=dict, blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Unit(CompanyModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="units")
    name = models.CharField(max_length=200)
    location = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    immutable_fields = ("client_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["client", "name"], name="pi_unit_name")
        ]

    def __str__(self):
        return self.name


class System(CompanyModel):
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="systems")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    immutable_fields = ("unit_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["unit", "name"], name="pi_system_name")
        ]

    def __str__(self):
        return self.name


class Asset(CompanyModel):
    system = models.ForeignKey(System, on_delete=models.PROTECT, related_name="assets")
    tag = models.CharField(max_length=120)
    asset_type = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    segment = models.CharField(max_length=100, blank=True)
    operation = models.TextField(blank=True)
    technical_condition = models.TextField(blank=True)
    technical = models.JSONField(default=dict, blank=True)
    source = models.JSONField(default=dict, blank=True)
    active = models.BooleanField(default=True)
    # Movimentação de sistema/unidade requer fluxo futuro com histórico.
    immutable_fields = ("system_id", "tag")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            # Premissa: unicidade por organização, independente do cliente.
            models.UniqueConstraint(Lower("tag"), "company", name="pi_asset_tag"),
        ]

    @property
    def client(self):
        return self.system.unit.client

    def clean(self):
        self.tag = self.tag.strip()
        super().clean()
        if not self.tag:
            raise ValidationError({"tag": "Informe a TAG."})

    def __str__(self):
        return self.tag


class Contract(CompanyModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="contracts")
    reference = models.CharField(max_length=100)
    title = models.CharField(max_length=250)
    responsible_engineer = models.ForeignKey(
        Professional, null=True, blank=True, on_delete=models.PROTECT, related_name="contracts"
    )
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)
    immutable_fields = ("client_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["company", "reference"], name="pi_contract_ref"),
            models.CheckConstraint(
                condition=Q(starts_on__isnull=True)
                | Q(ends_on__isnull=True)
                | Q(ends_on__gte=F("starts_on")),
                name="pi_contract_dates",
            ),
        ]


class Project(CompanyModel):
    contract = models.ForeignKey(Contract, on_delete=models.PROTECT, related_name="projects")
    code = models.CharField(max_length=100)
    title = models.CharField(max_length=250)
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    scope_version = models.PositiveIntegerField(default=1)
    plan_version = models.PositiveIntegerField(default=1)
    assets = models.ManyToManyField(Asset, through="ProjectAsset", related_name="projects")
    immutable_fields = ("contract_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["contract", "code"], name="pi_project_code")
        ]


class Module(models.TextChoices):
    INTEGRITY = "integrity", "Integridade"
    NR13 = "nr13", "NR-13"
    VALVES = "valves", "Válvulas"


class ProjectAsset(CompanyModel):
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="asset_scope")
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="project_scope")
    module = models.CharField(max_length=20, choices=Module.choices)
    active = models.BooleanField(default=True)
    immutable_fields = ("project_id", "asset_id", "module")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["project", "asset", "module"], name="pi_project_asset")
        ]

    def clean(self):
        super().clean()
        if (
            self.project_id
            and self.asset_id
            and self.project.contract.client_id != self.asset.client.pk
        ):
            raise ValidationError({"asset": "Ativo de cliente diferente do contrato."})


class Campaign(CompanyModel):
    class Coverage(models.TextChoices):
        FULL = "full", "100%"
        SAMPLE = "sample", "Amostragem"

    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="campaigns")
    code = models.CharField(max_length=100)
    title = models.CharField(max_length=250)
    coverage = models.CharField(max_length=10, choices=Coverage.choices)
    sampling_criteria = models.TextField(blank=True)
    planned_start = models.DateField(null=True, blank=True)
    planned_end = models.DateField(null=True, blank=True)
    assets = models.ManyToManyField(Asset, through="CampaignAsset", related_name="campaigns")
    immutable_fields = ("project_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["project", "code"], name="pi_campaign_code"),
            models.CheckConstraint(
                condition=Q(planned_start__isnull=True)
                | Q(planned_end__isnull=True)
                | Q(planned_end__gte=F("planned_start")),
                name="pi_campaign_dates",
            ),
        ]


class CampaignAsset(CompanyModel):
    campaign = models.ForeignKey(Campaign, on_delete=models.PROTECT, related_name="asset_scope")
    project_asset = models.ForeignKey(
        ProjectAsset, on_delete=models.PROTECT, related_name="campaign_scope"
    )
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="campaign_scope")
    visual_required = models.BooleanField(default=False)
    thickness_required = models.BooleanField(default=False)
    selected = models.BooleanField(default=True)
    selection_reason = models.TextField(blank=True)
    inspector = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="campaign_assignments",
    )
    planned_at = models.DateTimeField(null=True, blank=True)
    immutable_fields = ("campaign_id", "project_asset_id", "asset_id")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["campaign", "project_asset"], name="pi_campaign_scope")
        ]

    def clean(self):
        super().clean()
        if self.project_asset_id:
            same_reference(self, "asset", self.project_asset.asset_id)
            if self.campaign_id and self.campaign.project_id != self.project_asset.project_id:
                raise ValidationError({"project_asset": "Escopo de outro projeto."})
        if self.selected and not (self.visual_required or self.thickness_required):
            raise ValidationError("Informe ao menos uma modalidade para o ativo selecionado.")


class TeamRequirement(CompanyModel):
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="team_requirements")
    title = models.CharField(max_length=200)
    activity = models.CharField(max_length=150)
    qualification = models.ForeignKey(
        QualificationCatalog,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="requirements",
    )
    minimum_level = models.CharField(max_length=40, blank=True)
    basis = models.TextField(blank=True)
    active = models.BooleanField(default=True)


class TeamAssignment(CompanyModel):
    professional = models.ForeignKey(
        Professional, on_delete=models.PROTECT, related_name="assignments"
    )
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="team_assignments")
    activity = models.CharField(max_length=150)
    starts_on = models.DateField()
    ends_on = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(ends_on__isnull=True) | Q(ends_on__gte=F("starts_on")),
                name="pi_assignment_dates",
            )
        ]


class ProfessionalDocument(CompanyModel):
    professional = models.ForeignKey(
        Professional, on_delete=models.PROTECT, related_name="documents"
    )
    title = models.CharField(max_length=250)
    document_type = models.CharField(max_length=100)
    issuer = models.CharField(max_length=200, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    file = models.ForeignKey(
        StoredFile, on_delete=models.PROTECT, related_name="professional_documents"
    )
    client = models.ForeignKey(
        Client,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="professional_documents",
    )
    unit = models.ForeignKey(
        Unit, null=True, blank=True, on_delete=models.PROTECT, related_name="professional_documents"
    )

    def clean(self):
        super().clean()
        if self.unit_id and self.client_id:
            same_reference(self, "client", self.unit.client_id)


class Inspection(CompanyModel):
    class Modality(models.TextChoices):
        VISUAL = "visual", "Visual"
        THICKNESS = "thickness", "Espessura"
        COMBINED = "combined", "Visual e espessura"

    class Status(models.TextChoices):
        PLANNED = "planned", "Planejada"
        IN_PROGRESS = "in_progress", "Em execução"
        SUBMITTED = "submitted", "Enviada para conferência"
        REVIEW = "review", "Em revisão técnica"
        RETURNED = "returned", "Devolvida"
        APPROVED = "approved", "Aprovada"
        ISSUED = "issued", "Emitida"
        DELIVERED = "delivered", "Entregue"
        CANCELLED = "cancelled", "Cancelada"

    campaign_asset = models.ForeignKey(
        CampaignAsset, on_delete=models.PROTECT, related_name="inspections"
    )
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="inspections")
    modality = models.CharField(max_length=12, choices=Modality.choices)
    planned_at = models.DateTimeField(null=True, blank=True)
    planning_source = models.JSONField(default=dict, blank=True)
    inspected_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Data-base aprovada para os prazos. Retornos precisam de decisão técnica.",
    )
    inspector = models.ForeignKey(
        Professional, null=True, blank=True, on_delete=models.PROTECT, related_name="inspections"
    )
    assigned_name_snapshot = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)
    source = models.JSONField(default=dict, blank=True)
    immutable_fields = ("campaign_asset_id", "asset_id", "modality")

    class Meta(CompanyModel.Meta):
        indexes = [
            models.Index(fields=["company", "status", "planned_at"], name="pi_inspection_plan")
        ]

    def clean(self):
        super().clean()
        if self.campaign_asset_id:
            same_reference(self, "asset", self.campaign_asset.asset_id)
            if not self.campaign_asset.selected:
                raise ValidationError(
                    {"campaign_asset": "O ativo não foi selecionado para inspeção."}
                )
            if (
                self.modality in (self.Modality.VISUAL, self.Modality.COMBINED)
                and not self.campaign_asset.visual_required
            ):
                raise ValidationError({"modality": "Visual fora do escopo."})
            if (
                self.modality in (self.Modality.THICKNESS, self.Modality.COMBINED)
                and not self.campaign_asset.thickness_required
            ):
                raise ValidationError({"modality": "Espessura fora do escopo."})


class InspectionCatalog(CompanyModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Rascunho"
        VERIFIED = "verified", "Verificado"
        RETIRED = "retired", "Retirado de uso"

    code = models.CharField(max_length=100)
    revision = models.CharField(max_length=30)
    title = models.CharField(max_length=250)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    source_file = models.ForeignKey(
        StoredFile,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="inspection_catalogs",
    )
    source = models.JSONField(default=dict, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="verified_catalogs",
    )
    immutable_fields = ("code", "revision")
    freeze_on = "verified_at"
    frozen_fields = ("title", "source_file_id", "source", "verified_at", "verified_by_id")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(
                fields=["company", "code", "revision"], name="pi_catalog_revision"
            )
        ]

    def clean(self):
        super().clean()
        if self.status != self.Status.DRAFT and not (self.verified_at and self.verified_by_id):
            raise ValidationError("Catálogo verificado exige data e responsável pela verificação.")
        if self.status == self.Status.DRAFT and self.verified_at:
            raise ValidationError(
                {"status": "Catálogo verificado deve manter o estado verificado ou retirado."}
            )


class InspectionCatalogItem(CompanyModel):
    catalog = models.ForeignKey(InspectionCatalog, on_delete=models.PROTECT, related_name="items")
    item_key = models.CharField(max_length=100)
    component = models.CharField(max_length=200)
    description = models.TextField()
    order = models.PositiveIntegerField(default=0)
    source = models.JSONField(default=dict, blank=True)
    immutable_fields = ("catalog_id",)

    class Meta(CompanyModel.Meta):
        ordering = ["order", "item_key"]
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["catalog", "item_key"], name="pi_catalog_item_key")
        ]

    def clean(self):
        super().clean()
        if self.catalog_id:
            require_draft_catalog(self.catalog)


class InspectionCondition(CompanyModel):
    item = models.ForeignKey(
        InspectionCatalogItem, on_delete=models.PROTECT, related_name="conditions"
    )
    code = models.CharField(max_length=80)
    label = models.CharField(max_length=100)
    description = models.TextField()
    source = models.JSONField(default=dict, blank=True)
    immutable_fields = ("item_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["item", "code"], name="pi_condition_code")
        ]

    def clean(self):
        super().clean()
        if self.item_id:
            require_draft_catalog(self.item.catalog)


class InspectionRecommendation(CompanyModel):
    """Texto do catálogo. Recommendation representa a ocorrência concreta."""

    condition = models.ForeignKey(
        InspectionCondition, on_delete=models.PROTECT, related_name="recommendations"
    )
    code = models.CharField(max_length=80)
    text = models.TextField()
    requires_action = models.BooleanField(default=True)
    deadline_basis = models.TextField(blank=True)
    source = models.JSONField(default=dict, blank=True)
    immutable_fields = ("condition_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["condition", "code"], name="pi_cat_recommend_code")
        ]

    def clean(self):
        super().clean()
        if self.condition_id:
            require_draft_catalog(self.condition.item.catalog)


class Isometric(CompanyModel):
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="isometrics")
    code = models.CharField(max_length=100)
    title = models.CharField(max_length=250)
    immutable_fields = ("asset_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["asset", "code"], name="pi_isometric_code")
        ]


class IsometricRevision(CompanyModel):
    isometric = models.ForeignKey(Isometric, on_delete=models.PROTECT, related_name="revisions")
    revision = models.CharField(max_length=30)
    file = models.ForeignKey(
        StoredFile, on_delete=models.PROTECT, related_name="isometric_revisions"
    )
    issued_on = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    immutable_fields = ("isometric_id", "revision", "file_id")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["isometric", "revision"], name="pi_isometric_revision")
        ]


class MeasurementPoint(CompanyModel):
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="measurement_points")
    code = models.CharField(max_length=80)
    active = models.BooleanField(default=True)
    immutable_fields = ("asset_id", "code")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["asset", "code"], name="pi_point_code")
        ]


class MeasurementPointRevision(CompanyModel):
    point = models.ForeignKey(MeasurementPoint, on_delete=models.PROTECT, related_name="revisions")
    revision = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    isometric_revision = models.ForeignKey(
        IsometricRevision,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="point_revisions",
    )
    sheet = models.CharField(max_length=40, blank=True)
    location = models.TextField()
    change_reason = models.TextField()
    effective_on = models.DateField()
    immutable_fields = (
        "point_id",
        "revision",
        "isometric_revision_id",
        "sheet",
        "location",
        "change_reason",
        "effective_on",
    )

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["point", "revision"], name="pi_point_revision")
        ]

    def clean(self):
        super().clean()
        if (
            self.point_id
            and self.isometric_revision_id
            and self.point.asset_id != self.isometric_revision.isometric.asset_id
        ):
            raise ValidationError({"isometric_revision": "Isométrico de outro ativo."})


class MeasurementPosition(CompanyModel):
    point = models.ForeignKey(MeasurementPoint, on_delete=models.PROTECT, related_name="positions")
    code = models.CharField(max_length=80, help_text="Ex.: 0°, 90°, superior, posição única.")
    angle_degrees = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    orientation_basis = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    immutable_fields = ("point_id", "code", "angle_degrees", "orientation_basis")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["point", "code"], name="pi_position_code"),
            models.CheckConstraint(
                condition=Q(angle_degrees__isnull=True)
                | (Q(angle_degrees__gte=0) & Q(angle_degrees__lt=360)),
                name="pi_position_angle",
            ),
        ]


class Instrument(CompanyModel):
    code = models.CharField(max_length=100)
    instrument_type = models.CharField(
        max_length=100, help_text="Aparelho, transdutor ou bloco de referência."
    )
    manufacturer = models.CharField(max_length=150, blank=True)
    model = models.CharField(max_length=150, blank=True)
    serial_number = models.CharField(max_length=100, blank=True)
    specifications = models.JSONField(default=dict, blank=True)
    active = models.BooleanField(default=True)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["company", "code"], name="pi_instrument_code")
        ]


class CalibrationRecord(CompanyModel):
    instrument = models.ForeignKey(
        Instrument, on_delete=models.PROTECT, related_name="calibrations"
    )
    certificate_number = models.CharField(max_length=100)
    calibrated_on = models.DateField()
    valid_until = models.DateField(null=True, blank=True)
    issuer = models.CharField(max_length=200)
    file = models.ForeignKey(
        StoredFile, on_delete=models.PROTECT, related_name="calibration_records"
    )
    immutable_fields = (
        "instrument_id",
        "certificate_number",
        "calibrated_on",
        "valid_until",
        "issuer",
        "file_id",
    )

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(valid_until__isnull=True) | Q(valid_until__gte=F("calibrated_on")),
                name="pi_calibration_dates",
            )
        ]


class InspectionExecution(CompanyModel):
    class Kind(models.TextChoices):
        INITIAL = "initial", "Inicial"
        RETURN = "return", "Retorno"
        COMPLEMENT = "complement", "Complementação"

    inspection = models.ForeignKey(Inspection, on_delete=models.PROTECT, related_name="executions")
    sequence = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    kind = models.CharField(max_length=15, choices=Kind.choices)
    observed_at = models.DateTimeField()
    inspector = models.ForeignKey(Professional, on_delete=models.PROTECT, related_name="executions")
    catalog = models.ForeignKey(
        InspectionCatalog,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="executions",
    )
    catalog_snapshot = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=20, choices=Inspection.Status.choices, default=Inspection.Status.IN_PROGRESS
    )
    service_order = models.CharField(max_length=100, blank=True)
    inspected_limits = models.TextField(blank=True)
    access_conditions = models.TextField(blank=True)
    procedure_reference = models.CharField(max_length=200, blank=True)
    procedure_revision = models.CharField(max_length=40, blank=True)
    test_conditions = models.JSONField(default=dict, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    technical_review = models.TextField(blank=True)
    source = models.JSONField(default=dict, blank=True)
    immutable_fields = ("inspection_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["inspection", "sequence"], name="pi_execution_sequence")
        ]


class ExecutionInstrument(CompanyModel):
    execution = models.ForeignKey(
        InspectionExecution, on_delete=models.PROTECT, related_name="equipment"
    )
    instrument = models.ForeignKey(Instrument, on_delete=models.PROTECT, related_name="uses")
    calibration = models.ForeignKey(
        CalibrationRecord, null=True, blank=True, on_delete=models.PROTECT, related_name="uses"
    )
    purpose = models.CharField(max_length=100)
    verification = models.TextField(blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="equipment_verifications",
    )

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(
                fields=["execution", "instrument", "purpose"], name="pi_execution_instrument"
            )
        ]

    def clean(self):
        super().clean()
        if self.calibration_id:
            same_reference(self, "instrument", self.calibration.instrument_id)


class InspectionItem(CompanyModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pendente"
        ANSWERED = "answered", "Respondido"
        TECHNICAL_PENDING = "technical_pending", "Revisão técnica pendente"

    execution = models.ForeignKey(
        InspectionExecution, on_delete=models.PROTECT, related_name="items"
    )
    item_key = models.CharField(max_length=100)
    catalog_item = models.ForeignKey(
        InspectionCatalogItem,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="execution_items",
    )
    condition = models.ForeignKey(
        InspectionCondition,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="execution_items",
    )
    point = models.ForeignKey(
        MeasurementPoint,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="inspection_items",
    )
    component = models.CharField(max_length=200, blank=True)
    uncatalogued_description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    source = models.JSONField(default=dict, blank=True)
    immutable_fields = ("execution_id", "item_key")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["execution", "item_key"], name="pi_execution_item")
        ]

    def clean(self):
        super().clean()
        if self.condition_id:
            same_reference(self, "catalog_item", self.condition.item_id)
        if self.execution_id and self.catalog_item_id:
            if self.catalog_item.catalog_id != self.execution.catalog_id:
                raise ValidationError({"catalog_item": "Item de catálogo diferente da execução."})
        if self.execution_id and self.point_id:
            if self.point.asset_id != self.execution.inspection.asset_id:
                raise ValidationError({"point": "Ponto de outro ativo."})


class ThicknessUnit(models.TextChoices):
    MM = "mm", "Milímetro"
    INCH = "in", "Polegada"


class ThicknessRequirement(CompanyModel):
    asset = models.ForeignKey(
        Asset, on_delete=models.PROTECT, related_name="thickness_requirements"
    )
    point = models.ForeignKey(
        MeasurementPoint,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="requirements",
    )
    position = models.ForeignKey(
        MeasurementPosition,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="requirements",
    )
    required_thickness = models.DecimalField(
        max_digits=12, decimal_places=5, validators=[MinValueValidator(Decimal("0.00001"))]
    )
    unit = models.CharField(max_length=2, choices=ThicknessUnit.choices)
    revision = models.CharField(max_length=40)
    technical_basis = models.TextField()
    reference_edition_item = models.TextField(blank=True)
    approved_by = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="approved_thickness_requirements",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    evidence = models.ForeignKey(
        StoredFile,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="thickness_requirements",
    )
    immutable_fields = ("asset_id", "point_id", "position_id")
    freeze_on = "approved_at"
    frozen_fields = (
        "required_thickness",
        "unit",
        "revision",
        "technical_basis",
        "reference_edition_item",
        "approved_by_id",
        "approved_at",
        "evidence_id",
    )

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(required_thickness__gt=0), name="pi_required_positive"
            )
        ]

    def clean(self):
        super().clean()
        if self.point_id:
            same_reference(self, "asset", self.point.asset_id)
        if self.position_id:
            same_reference(self, "point", self.position.point_id)


class ThicknessReading(CompanyModel):
    class Origin(models.TextChoices):
        FIELD = "field", "Campo"
        HISTORICAL = "historical", "Importação histórica"

    execution = models.ForeignKey(
        InspectionExecution, on_delete=models.PROTECT, related_name="readings"
    )
    position = models.ForeignKey(
        MeasurementPosition, on_delete=models.PROTECT, related_name="readings"
    )
    point_revision = models.ForeignKey(
        MeasurementPointRevision, on_delete=models.PROTECT, related_name="readings"
    )
    requirement = models.ForeignKey(
        ThicknessRequirement,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="readings",
    )
    instrument_use = models.ForeignKey(
        ExecutionInstrument,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="readings",
    )
    measured_at = models.DateTimeField()
    measured_by = models.ForeignKey(
        Professional, on_delete=models.PROTECT, related_name="thickness_readings"
    )
    value = models.DecimalField(
        max_digits=12, decimal_places=5, validators=[MinValueValidator(Decimal("0.00001"))]
    )
    unit = models.CharField(max_length=2, choices=ThicknessUnit.choices)
    sequence = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1)])
    origin = models.CharField(max_length=12, choices=Origin.choices, default=Origin.FIELD)
    source = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)
    immutable_fields = ("execution_id", "position_id", "point_revision_id")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.CheckConstraint(condition=Q(value__gt=0), name="pi_reading_positive"),
            models.UniqueConstraint(
                fields=["execution", "position", "sequence"], name="pi_reading_sequence"
            ),
        ]
        indexes = [models.Index(fields=["position", "measured_at"], name="pi_reading_history")]

    def clean(self):
        super().clean()
        if self.position_id and self.point_revision_id:
            if self.position.point_id != self.point_revision.point_id:
                raise ValidationError({"point_revision": "Revisão de outro ponto."})
        if self.position_id and self.execution_id:
            if self.position.point.asset_id != self.execution.inspection.asset_id:
                raise ValidationError({"position": "Posição de outro ativo."})
        if self.requirement_id and self.position_id and self.execution_id:
            same_asset = self.requirement.asset_id == self.execution.inspection.asset_id
            same_point = self.requirement.point_id in (None, self.position.point_id)
            same_position = self.requirement.position_id in (None, self.position_id)
            if not (same_asset and same_point and same_position):
                raise ValidationError({"requirement": "Requisito fora do escopo da leitura."})
        if self.instrument_use_id:
            same_reference(self, "execution", self.instrument_use.execution_id)


class Finding(CompanyModel):
    item = models.ForeignKey(InspectionItem, on_delete=models.PROTECT, related_name="findings")
    condition = models.ForeignKey(
        InspectionCondition,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="findings",
    )
    description = models.TextField()
    requires_technical_review = models.BooleanField(default=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="reviewed_findings",
    )
    immutable_fields = ("item_id",)

    def clean(self):
        super().clean()
        if (
            self.condition_id
            and self.item_id
            and self.condition.item_id != self.item.catalog_item_id
        ):
            raise ValidationError({"condition": "Condição de outro item de catálogo."})


class InspectionPhoto(CompanyModel):
    class Purpose(models.TextChoices):
        SCOPE = "scope", "Escopo inspecionado"
        POINT = "point", "Localização do ponto"
        READING = "reading", "Leitura do instrumento"
        FINDING = "finding", "Condição encontrada"
        TREATMENT = "treatment", "Tratativa"
        REFERENCE = "reference", "Referência ilustrativa"

    execution = models.ForeignKey(
        InspectionExecution, on_delete=models.PROTECT, related_name="photos"
    )
    item = models.ForeignKey(
        InspectionItem, null=True, blank=True, on_delete=models.PROTECT, related_name="photos"
    )
    point = models.ForeignKey(
        MeasurementPoint, null=True, blank=True, on_delete=models.PROTECT, related_name="photos"
    )
    reading = models.ForeignKey(
        ThicknessReading, null=True, blank=True, on_delete=models.PROTECT, related_name="photos"
    )
    finding = models.ForeignKey(
        Finding, null=True, blank=True, on_delete=models.PROTECT, related_name="photos"
    )
    file = models.ForeignKey(StoredFile, on_delete=models.PROTECT, related_name="inspection_photos")
    purpose = models.CharField(max_length=15, choices=Purpose.choices)
    caption = models.TextField(blank=True)
    captured_at = models.DateTimeField(null=True, blank=True)
    captured_by = models.ForeignKey(
        Professional, null=True, blank=True, on_delete=models.PROTECT, related_name="photos"
    )
    source = models.JSONField(default=dict, blank=True)
    immutable_fields = ("execution_id", "file_id")

    def clean(self):
        super().clean()
        if self.item_id:
            same_reference(self, "execution", self.item.execution_id)
        if self.reading_id:
            same_reference(self, "execution", self.reading.execution_id)
            same_reference(self, "point", self.reading.position.point_id)
        if self.finding_id:
            same_reference(self, "item", self.finding.item_id)
            same_reference(self, "execution", self.finding.item.execution_id)
        if (
            self.point_id
            and self.execution_id
            and self.point.asset_id != self.execution.inspection.asset_id
        ):
            raise ValidationError({"point": "Ponto de outro ativo."})


class Recommendation(CompanyModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Rascunho"
        OPEN = "open", "Aberta"
        WITHDRAWN = "withdrawn", "Retirada para revisão"
        CLOSED = "closed", "Encerrada"

    finding = models.ForeignKey(Finding, on_delete=models.PROTECT, related_name="recommendations")
    catalog_recommendation = models.ForeignKey(
        InspectionRecommendation,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="occurrences",
    )
    text = models.TextField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    opened_at = models.DateTimeField(null=True, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    withdrawal_reason = models.TextField(blank=True)
    technical_review_required = models.BooleanField(default=True)
    immutable_fields = ("finding_id",)

    def clean(self):
        super().clean()
        if self.catalog_recommendation_id and self.finding_id:
            if not self.catalog_recommendation.requires_action:
                raise ValidationError(
                    {
                        "catalog_recommendation": "Entrada sem tratativa não gera recomendação aberta."
                    }
                )
            if self.catalog_recommendation.condition_id != self.finding.condition_id:
                raise ValidationError({"catalog_recommendation": "Recomendação de outra condição."})


class RiskMatrixVersion(CompanyModel):
    code = models.CharField(max_length=100)
    revision = models.CharField(max_length=40)
    title = models.CharField(max_length=250)
    source_file = models.ForeignKey(
        StoredFile, null=True, blank=True, on_delete=models.PROTECT, related_name="risk_matrices"
    )
    parameters = models.JSONField(
        default=dict,
        blank=True,
        help_text="Somente parâmetros fornecidos e aprovados pela engenharia.",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="approved_risk_matrices",
    )
    effective_from = models.DateField(null=True, blank=True)
    immutable_fields = ("code", "revision")
    freeze_on = "approved_at"
    frozen_fields = (
        "title",
        "source_file_id",
        "parameters",
        "approved_at",
        "approved_by_id",
        "effective_from",
    )

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(
                fields=["company", "code", "revision"], name="pi_matrix_revision"
            )
        ]


class RiskBand(CompanyModel):
    class Unit(models.TextChoices):
        HOUR = "hour", "Horas"
        DAY = "day", "Dias"
        WEEK = "week", "Semanas"
        MONTH = "month", "Meses de calendário"

    matrix = models.ForeignKey(RiskMatrixVersion, on_delete=models.PROTECT, related_name="bands")
    score = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(25)]
    )
    treatment = models.TextField()
    lower_bound = models.PositiveIntegerField(null=True, blank=True)
    upper_bound = models.PositiveIntegerField(null=True, blank=True)
    unit = models.CharField(max_length=6, choices=Unit.choices)
    lower_inclusive = models.BooleanField(default=True)
    upper_inclusive = models.BooleanField(default=False)
    immediate_action = models.BooleanField(default=False)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["matrix", "score"], name="pi_matrix_score"),
            models.CheckConstraint(
                condition=Q(score__gte=1) & Q(score__lte=25), name="pi_score_range"
            ),
            models.CheckConstraint(
                condition=Q(lower_bound__isnull=True)
                | Q(upper_bound__isnull=True)
                | Q(upper_bound__gte=F("lower_bound")),
                name="pi_risk_bounds",
            ),
        ]

    def clean(self):
        super().clean()
        if self.matrix_id and self.matrix.approved_at:
            raise ValidationError(
                {"matrix": "Matriz aprovada exige nova versão para alterar faixas."}
            )


class RiskAssessment(CompanyModel):
    recommendation = models.ForeignKey(
        Recommendation, on_delete=models.PROTECT, related_name="risk_assessments"
    )
    matrix = models.ForeignKey(
        RiskMatrixVersion, on_delete=models.PROTECT, related_name="assessments"
    )
    probability = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    consequence_safety = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    consequence_environment = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    consequence_business = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    justification = models.TextField()
    classification = models.CharField(max_length=100, blank=True)
    immediate_action = models.BooleanField(default=False)
    assessed_at = models.DateTimeField()
    assessed_by = models.ForeignKey(
        Professional, on_delete=models.PROTECT, related_name="risk_assessments"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="approved_risk_assessments",
    )
    immutable_fields = ("recommendation_id", "matrix_id")
    freeze_on = "approved_at"
    frozen_fields = (
        "probability",
        "consequence_safety",
        "consequence_environment",
        "consequence_business",
        "justification",
        "classification",
        "immediate_action",
        "assessed_at",
        "assessed_by_id",
        "approved_at",
        "approved_by_id",
    )

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.CheckConstraint(
                condition=Q(probability__range=(1, 5))
                & Q(consequence_safety__range=(1, 5))
                & Q(consequence_environment__range=(1, 5))
                & Q(consequence_business__range=(1, 5)),
                name="pi_risk_inputs",
            ),
        ]

    @property
    def maximum_consequence(self):
        return max(self.consequence_safety, self.consequence_environment, self.consequence_business)

    @property
    def score(self):
        return self.probability * self.maximum_consequence

    @property
    def catastrophic(self):
        return self.maximum_consequence == 5


class RTI(CompanyModel):
    class Status(models.TextChoices):
        OPEN = "open", "Aberta"
        ASSESSMENT = "assessment", "Em avaliação"
        PLANNED = "planned", "Tratativa programada"
        IN_PROGRESS = "in_progress", "Tratativa em execução"
        VERIFICATION = "verification", "Aguardando verificação"
        CLOSED = "closed", "Encerrada"

    recommendation = models.OneToOneField(
        Recommendation, on_delete=models.PROTECT, related_name="rti"
    )
    reference = models.CharField(max_length=100)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.OPEN)
    risk_assessment = models.ForeignKey(
        RiskAssessment, null=True, blank=True, on_delete=models.PROTECT, related_name="rtis"
    )
    deadline_start = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    deadline_basis = models.TextField(blank=True)
    deadline_pending = models.BooleanField(default=True)
    immediate_action = models.BooleanField(default=False)
    responsible = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="responsible_rtis",
    )
    technical_review_required = models.BooleanField(default=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        Professional, null=True, blank=True, on_delete=models.PROTECT, related_name="closed_rtis"
    )
    closure_evidence = models.ForeignKey(
        StoredFile, null=True, blank=True, on_delete=models.PROTECT, related_name="closed_rtis"
    )
    closure_notes = models.TextField(blank=True)
    immutable_fields = ("recommendation_id",)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["company", "reference"], name="pi_rti_reference")
        ]
        indexes = [models.Index(fields=["company", "status", "due_at"], name="pi_rti_deadline")]

    def clean(self):
        super().clean()
        if self.risk_assessment_id:
            same_reference(self, "recommendation", self.risk_assessment.recommendation_id)
        if not self.deadline_pending and self.due_at is None:
            raise ValidationError({"due_at": "Informe a data definida para o prazo."})
        if self.status == self.Status.CLOSED and not (
            self.closed_at and self.closed_by_id and self.closure_evidence_id
        ):
            raise ValidationError(
                "Encerramento exige data, responsável e evidência. Permissão e eficácia devem ser validadas pelo serviço."
            )

    @property
    def inspection(self):
        return self.recommendation.finding.item.execution.inspection

    @property
    def asset(self):
        return self.inspection.asset


class RTIAction(CompanyModel):
    rti = models.ForeignKey(RTI, on_delete=models.PROTECT, related_name="actions")
    description = models.TextField()
    responsible = models.ForeignKey(
        Professional, null=True, blank=True, on_delete=models.PROTECT, related_name="rti_actions"
    )
    service_order = models.CharField(max_length=100, blank=True)
    planned_at = models.DateTimeField(null=True, blank=True)
    performed_at = models.DateTimeField(null=True, blank=True)
    evidence = models.ForeignKey(
        StoredFile, null=True, blank=True, on_delete=models.PROTECT, related_name="rti_actions"
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="verified_rti_actions",
    )
    verification_notes = models.TextField(blank=True)


class TechnicalDocument(CompanyModel):
    class Kind(models.TextChoices):
        VISUAL = "visual", "Relatório visual"
        THICKNESS = "thickness", "Relatório de espessura"
        COMBINED = "combined", "Relatório combinado"
        NR13 = "nr13", "Documento NR-13"
        BOOK = "book", "BOOK"
        VALVE = "valve", "Certificado de válvula"

    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="documents")
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="technical_documents")
    inspection = models.ForeignKey(
        Inspection, null=True, blank=True, on_delete=models.PROTECT, related_name="documents"
    )
    code = models.CharField(max_length=100)
    title = models.CharField(max_length=250)
    kind = models.CharField(max_length=15, choices=Kind.choices)
    module = models.CharField(max_length=20, choices=Module.choices)
    applicability = models.TextField(blank=True)
    immutable_fields = ("project_id", "asset_id", "inspection_id", "code")

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["company", "code"], name="pi_document_code")
        ]

    def clean(self):
        super().clean()
        if (
            self.project_id
            and self.asset_id
            and self.project.contract.client_id != self.asset.client.pk
        ):
            raise ValidationError({"asset": "Ativo de outro cliente."})
        if self.inspection_id:
            same_reference(self, "asset", self.inspection.asset_id)
            same_reference(self, "project", self.inspection.campaign_asset.campaign.project_id)


class DocumentRevision(CompanyModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Em elaboração"
        CHECK = "check", "Em conferência"
        REVIEW = "review", "Em revisão técnica"
        RETURNED = "returned", "Devolvida"
        APPROVED = "approved", "Aprovada"
        SIGNING = "signing", "Em assinatura"
        ISSUED = "issued", "Emitida"
        SUPERSEDED = "superseded", "Substituída"

    document = models.ForeignKey(
        TechnicalDocument, on_delete=models.PROTECT, related_name="revisions"
    )
    revision = models.CharField(max_length=30)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    template_code = models.CharField(max_length=100, blank=True)
    template_revision = models.CharField(max_length=30, blank=True)
    data_snapshot = models.JSONField(default=dict, blank=True)
    calculation_snapshot = models.JSONField(default=dict, blank=True)
    calculation_version = models.CharField(max_length=100, blank=True)
    reviewed_by = models.ForeignKey(
        Professional,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="reviewed_document_revisions",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)
    applicability_validated = models.BooleanField(default=False)
    decision = models.TextField(blank=True)
    immutable_fields = ("document_id", "revision")
    freeze_on = "issued_at"
    frozen_fields = (
        "template_code",
        "template_revision",
        "data_snapshot",
        "calculation_snapshot",
        "calculation_version",
        "reviewed_by_id",
        "approved_at",
        "issued_at",
        "applicability_validated",
        "decision",
    )

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["document", "revision"], name="pi_document_revision"),
            models.UniqueConstraint(
                fields=["document"], condition=Q(status="issued"), name="pi_one_issued_revision"
            ),
        ]


class DocumentAttachment(CompanyModel):
    revision = models.ForeignKey(
        DocumentRevision, on_delete=models.PROTECT, related_name="attachments"
    )
    file = models.ForeignKey(
        StoredFile, on_delete=models.PROTECT, related_name="document_attachments"
    )
    title = models.CharField(max_length=250)
    is_final_pdf = models.BooleanField(default=False)


class DocumentSignature(CompanyModel):
    class Role(models.TextChoices):
        INSPECTOR = "inspector", "Inspetor"
        ENGINEER = "engineer", "Engenheiro responsável / PLH"

    revision = models.ForeignKey(
        DocumentRevision, on_delete=models.PROTECT, related_name="signatures"
    )
    signer = models.ForeignKey(
        Professional, on_delete=models.PROTECT, related_name="document_signatures"
    )
    role = models.CharField(max_length=12, choices=Role.choices)
    signed_at = models.DateTimeField()
    signed_file = models.ForeignKey(
        StoredFile, on_delete=models.PROTECT, related_name="document_signatures"
    )
    name_snapshot = models.CharField(max_length=200)
    registration_snapshot = models.CharField(max_length=120, blank=True)
    method = models.CharField(max_length=100)
    verification_reference = models.TextField(blank=True)
    immutable_fields = (
        "revision_id",
        "signer_id",
        "role",
        "signed_at",
        "signed_file_id",
        "name_snapshot",
        "registration_snapshot",
        "method",
        "verification_reference",
    )

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(fields=["revision", "signer", "role"], name="pi_signature_role")
        ]


class ReportDelivery(CompanyModel):
    revision = models.ForeignKey(
        DocumentRevision, on_delete=models.PROTECT, related_name="deliveries"
    )
    delivered_at = models.DateTimeField()
    delivered_by = models.ForeignKey(
        Professional, on_delete=models.PROTECT, related_name="report_deliveries"
    )
    recipient_name = models.CharField(max_length=200)
    recipient_email = models.EmailField(blank=True)
    channel = models.CharField(max_length=80)
    receipt = models.ForeignKey(
        StoredFile,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="delivery_receipts",
    )


class AuditEvent(CompanyModel):
    entity_type = models.CharField(max_length=100)
    entity_id = models.UUIDField(db_index=True)
    action = models.CharField(max_length=100)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pires_audit_events",
    )
    occurred_at = models.DateTimeField()
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    request_id = models.UUIDField(null=True, blank=True, db_index=True)

    class Meta(CompanyModel.Meta):
        indexes = [
            models.Index(fields=["company", "entity_type", "entity_id"], name="pi_audit_entity")
        ]


class RecordOrigin(CompanyModel):
    entity_type = models.CharField(max_length=100)
    entity_id = models.UUIDField()
    source_system = models.CharField(max_length=100)
    source_key = models.CharField(max_length=250)
    digest = models.CharField(max_length=64, validators=[SHA256])
    payload = models.JSONField(default=dict, blank=True)
    schema_version = models.PositiveIntegerField(default=1)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(
                fields=["company", "source_system", "source_key"], name="pi_origin_key"
            )
        ]


class RecordRelation(CompanyModel):
    source_type = models.CharField(max_length=100)
    source_id = models.UUIDField()
    target_type = models.CharField(max_length=100)
    target_id = models.UUIDField()
    relation = models.CharField(max_length=100)
    notes = models.TextField(blank=True)


class OperationReceipt(CompanyModel):
    """Idempotência por organização, ator, operação e request UUID."""

    request_id = models.UUIDField()
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="pires_operation_receipts"
    )
    action = models.CharField(max_length=100)
    digest = models.CharField(max_length=64, validators=[SHA256])
    result = models.JSONField(default=dict, blank=True)

    class Meta(CompanyModel.Meta):
        constraints = CompanyModel.Meta.constraints + [
            models.UniqueConstraint(
                fields=["company", "actor", "action", "request_id"], name="pi_operation_request"
            )
        ]
