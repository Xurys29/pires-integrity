"""Testes de integridade. Executar com manage.py test tests --noinput."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.utils import timezone

from sistema_pires.models import (
    Asset,
    Campaign,
    CampaignAsset,
    Client,
    Company,
    Contract,
    DocumentRevision,
    Finding,
    Inspection,
    InspectionCatalog,
    InspectionCatalogItem,
    InspectionCondition,
    InspectionExecution,
    InspectionItem,
    InspectionPhoto,
    InspectionRecommendation,
    Isometric,
    IsometricRevision,
    MeasurementPoint,
    MeasurementPointRevision,
    MeasurementPosition,
    Module,
    OperationReceipt,
    Professional,
    Project,
    ProjectAsset,
    Recommendation,
    RiskAssessment,
    RiskBand,
    RiskMatrixVersion,
    RTI,
    StoredFile,
    System,
    TechnicalDocument,
    ThicknessReading,
    ThicknessRequirement,
    Unit,
)


class ModelIntegrityTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.now = timezone.now()
        cls.company = Company.objects.create(name="Pires - teste")
        cls.other_company = Company.objects.create(name="Outra organização")
        cls.asset_client = Client.objects.create(company=cls.company, name="Cliente")
        cls.unit = Unit.objects.create(company=cls.company, client=cls.asset_client, name="Unidade")
        cls.system = System.objects.create(company=cls.company, unit=cls.unit, name="Sistema")
        cls.asset = Asset.objects.create(
            company=cls.company, system=cls.system, tag="TAG-01", asset_type="Linha"
        )
        cls.other_asset = Asset.objects.create(
            company=cls.company, system=cls.system, tag="TAG-02", asset_type="Linha"
        )
        cls.professional = Professional.objects.create(
            company=cls.company, name="Inspetor de teste"
        )
        cls.contract = Contract.objects.create(
            company=cls.company, client=cls.asset_client, reference="C-01", title="Contrato"
        )
        cls.project = Project.objects.create(
            company=cls.company, contract=cls.contract, code="P-01", title="Projeto"
        )
        cls.scope = ProjectAsset.objects.create(
            company=cls.company, project=cls.project, asset=cls.asset, module=Module.INTEGRITY
        )
        cls.campaign = Campaign.objects.create(
            company=cls.company,
            project=cls.project,
            code="CP-01",
            title="Campanha",
            coverage=Campaign.Coverage.FULL,
        )
        cls.campaign_asset = CampaignAsset.objects.create(
            company=cls.company,
            campaign=cls.campaign,
            project_asset=cls.scope,
            asset=cls.asset,
            visual_required=True,
            thickness_required=True,
        )
        cls.inspection = Inspection.objects.create(
            company=cls.company,
            campaign_asset=cls.campaign_asset,
            asset=cls.asset,
            modality=Inspection.Modality.COMBINED,
        )
        cls.catalog = InspectionCatalog.objects.create(
            company=cls.company, code="LVT", revision="01", title="LVT sintética"
        )
        cls.catalog_item = InspectionCatalogItem.objects.create(
            company=cls.company,
            catalog=cls.catalog,
            item_key="01",
            component="Linha",
            description="Descrição",
        )
        cls.condition = InspectionCondition.objects.create(
            company=cls.company,
            item=cls.catalog_item,
            code="D01",
            label="Condição",
            description="Descrição",
        )
        cls.cat_recommendation = InspectionRecommendation.objects.create(
            company=cls.company, condition=cls.condition, code="R01", text="Texto de teste"
        )
        cls.execution = InspectionExecution.objects.create(
            company=cls.company,
            inspection=cls.inspection,
            sequence=1,
            kind=InspectionExecution.Kind.INITIAL,
            observed_at=cls.now,
            inspector=cls.professional,
            catalog=cls.catalog,
        )
        cls.item = InspectionItem.objects.create(
            company=cls.company,
            execution=cls.execution,
            item_key="01",
            catalog_item=cls.catalog_item,
            condition=cls.condition,
        )
        cls.finding = Finding.objects.create(
            company=cls.company,
            item=cls.item,
            condition=cls.condition,
            description="Achado sintético",
        )
        cls.recommendation = Recommendation.objects.create(
            company=cls.company,
            finding=cls.finding,
            catalog_recommendation=cls.cat_recommendation,
            text="Texto de teste",
        )
        cls.point = MeasurementPoint.objects.create(
            company=cls.company, asset=cls.asset, code="P01"
        )
        cls.point_revision = MeasurementPointRevision.objects.create(
            company=cls.company,
            point=cls.point,
            revision=1,
            location="Trecho A",
            change_reason="Cadastro inicial",
            effective_on=cls.now.date(),
        )
        cls.position = MeasurementPosition.objects.create(
            company=cls.company, point=cls.point, code="0°", angle_degrees=0
        )
        cls.file = StoredFile.objects.create(
            company=cls.company,
            file="test/evidence.jpg",
            original_name="evidence.jpg",
            mime_type="image/jpeg",
            size_bytes=10,
            sha256="a" * 64,
            purpose=StoredFile.Purpose.EVIDENCE,
        )
        cls.matrix = RiskMatrixVersion.objects.create(
            company=cls.company, code="PIRES", revision="01", title="Matriz sintética"
        )

    def reading(self, **overrides):
        values = dict(
            company=self.company,
            execution=self.execution,
            position=self.position,
            point_revision=self.point_revision,
            measured_at=self.now,
            measured_by=self.professional,
            value=Decimal("7.20"),
            unit="mm",
        )
        values.update(overrides)
        return ThicknessReading(**values)

    def test_two_executions_belong_to_same_inspection(self):
        InspectionExecution.objects.create(
            company=self.company,
            inspection=self.inspection,
            sequence=2,
            kind=InspectionExecution.Kind.RETURN,
            observed_at=self.now + timedelta(days=1),
            inspector=self.professional,
        )
        self.assertEqual(self.inspection.executions.count(), 2)

    def test_periodic_inspection_keeps_asset_history(self):
        Inspection.objects.create(
            company=self.company,
            campaign_asset=self.campaign_asset,
            asset=self.asset,
            modality=Inspection.Modality.COMBINED,
        )
        self.assertEqual(self.asset.inspections.count(), 2)

    def test_duplicate_tag_ignores_case(self):
        with self.assertRaises(ValidationError):
            Asset.objects.create(
                company=self.company, system=self.system, tag="tag-01", asset_type="Linha"
            )

    def test_same_tag_allowed_in_another_organization(self):
        client = Client.objects.create(company=self.other_company, name="Outro cliente")
        unit = Unit.objects.create(company=self.other_company, client=client, name="Unidade")
        system = System.objects.create(company=self.other_company, unit=unit, name="Sistema")
        Asset.objects.create(
            company=self.other_company, system=system, tag="TAG-01", asset_type="Linha"
        )

    def test_cross_company_relation_rejected(self):
        with self.assertRaises(ValidationError):
            Unit.objects.create(
                company=self.other_company, client=self.asset_client, name="Inválida"
            )

    def test_contract_rejects_end_before_start(self):
        with self.assertRaises(ValidationError):
            Contract.objects.create(
                company=self.company,
                client=self.asset_client,
                reference="C-02",
                title="Inválido",
                starts_on=self.now.date(),
                ends_on=(self.now - timedelta(days=1)).date(),
            )

    def test_asset_change_in_inspection_rejected(self):
        self.inspection.asset = self.other_asset
        with self.assertRaises(ValidationError):
            self.inspection.save()

    def test_positive_reading_saved(self):
        reading = self.reading()
        reading.save()
        reading.refresh_from_db()
        self.assertEqual(reading.value, Decimal("7.20000"))

    def test_zero_reading_rejected(self):
        with self.assertRaises(ValidationError):
            self.reading(value=0).save()

    def test_negative_reading_blocked_by_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            ThicknessReading.objects.bulk_create([self.reading(value=-1)])

    def test_position_angle_360_rejected(self):
        with self.assertRaises(ValidationError):
            MeasurementPosition.objects.create(
                company=self.company, point=self.point, code="360", angle_degrees=360
            )

    def test_reading_rejects_another_point_revision(self):
        point = MeasurementPoint.objects.create(company=self.company, asset=self.asset, code="P02")
        revision = MeasurementPointRevision.objects.create(
            company=self.company,
            point=point,
            revision=1,
            location="B",
            change_reason="Inicial",
            effective_on=self.now.date(),
        )
        with self.assertRaises(ValidationError):
            self.reading(point_revision=revision).save()

    def test_requirement_rejects_another_asset(self):
        requirement = ThicknessRequirement.objects.create(
            company=self.company,
            asset=self.other_asset,
            required_thickness=5,
            unit="mm",
            revision="01",
            technical_basis="Teste",
        )
        with self.assertRaises(ValidationError):
            self.reading(requirement=requirement).save()

    def test_point_revision_preserves_history(self):
        self.point_revision.location = "Alteração silenciosa"
        with self.assertRaises(ValidationError):
            self.point_revision.save()

    def test_foreign_item_photo_rejected(self):
        other = InspectionExecution.objects.create(
            company=self.company,
            inspection=self.inspection,
            sequence=2,
            kind="return",
            observed_at=self.now,
            inspector=self.professional,
        )
        with self.assertRaises(ValidationError):
            InspectionPhoto.objects.create(
                company=self.company,
                execution=other,
                item=self.item,
                file=self.file,
                purpose="scope",
            )

    def test_finding_photo_saved(self):
        InspectionPhoto.objects.create(
            company=self.company,
            execution=self.execution,
            item=self.item,
            finding=self.finding,
            file=self.file,
            purpose="finding",
        )

    def test_recommendation_condition_mismatch_rejected(self):
        condition = InspectionCondition.objects.create(
            company=self.company,
            item=self.catalog_item,
            code="D02",
            label="Outra",
            description="Outra condição",
        )
        template = InspectionRecommendation.objects.create(
            company=self.company, condition=condition, code="R02", text="Outro texto"
        )
        with self.assertRaises(ValidationError):
            Recommendation.objects.create(
                company=self.company,
                finding=self.finding,
                catalog_recommendation=template,
                text="Inválida",
            )

    def test_rti_is_unique_per_concrete_recommendation(self):
        RTI.objects.create(
            company=self.company, recommendation=self.recommendation, reference="RTI-01"
        )
        with self.assertRaises(ValidationError):
            RTI.objects.create(
                company=self.company, recommendation=self.recommendation, reference="RTI-02"
            )

    def test_rti_cannot_close_without_evidence(self):
        with self.assertRaises(ValidationError):
            RTI.objects.create(
                company=self.company,
                recommendation=self.recommendation,
                reference="RTI-01",
                status="closed",
            )

    def test_catastrophic_score_five_preserves_unknown_deadline(self):
        assessment = RiskAssessment.objects.create(
            company=self.company,
            recommendation=self.recommendation,
            matrix=self.matrix,
            probability=1,
            consequence_safety=5,
            consequence_environment=1,
            consequence_business=1,
            justification="Teste",
            assessed_at=self.now,
            assessed_by=self.professional,
        )
        self.assertEqual(assessment.score, 5)
        self.assertTrue(assessment.catastrophic)
        rti = RTI.objects.create(
            company=self.company,
            recommendation=self.recommendation,
            reference="RTI-01",
            risk_assessment=assessment,
            immediate_action=True,
        )
        self.assertTrue(rti.deadline_pending)
        self.assertIsNone(rti.due_at)

    def test_risk_out_of_range_rejected(self):
        with self.assertRaises(ValidationError):
            RiskAssessment.objects.create(
                company=self.company,
                recommendation=self.recommendation,
                matrix=self.matrix,
                probability=6,
                consequence_safety=1,
                consequence_environment=1,
                consequence_business=1,
                justification="Teste",
                assessed_at=self.now,
                assessed_by=self.professional,
            )

    def test_verified_catalog_item_cannot_be_changed(self):
        self.catalog.status = "verified"
        self.catalog.verified_at = self.now
        self.catalog.verified_by = self.professional
        self.catalog.save()
        # Nova leitura evita depender de objetos relacionados em cache.
        item = InspectionCatalogItem.objects.get(pk=self.catalog_item.pk)
        item.description = "Alteração"
        with self.assertRaises(ValidationError):
            item.save()

    def test_approved_requirement_is_frozen(self):
        requirement = ThicknessRequirement.objects.create(
            company=self.company,
            asset=self.asset,
            required_thickness=5,
            unit="mm",
            revision="01",
            technical_basis="Teste",
            valid_from=self.now.date(),
            scope_description="Ativo completo",
            applicable_code="Procedimento sintético de teste",
            approved_at=self.now,
            approved_by=self.professional,
        )
        requirement.required_thickness = 6
        with self.assertRaises(ValidationError):
            requirement.save()

    def test_issued_snapshot_is_frozen(self):
        document = TechnicalDocument.objects.create(
            company=self.company,
            project=self.project,
            asset=self.asset,
            inspection=self.inspection,
            code="DOC-01",
            title="Relatório",
            kind="combined",
            module="integrity",
        )
        revision = DocumentRevision.objects.create(
            company=self.company,
            document=document,
            revision="01",
            issued_at=self.now,
            data_snapshot={"tag": "TAG-01"},
        )
        revision.data_snapshot = {"tag": "MUDOU"}
        with self.assertRaises(ValidationError):
            revision.save()

    def test_asset_with_history_is_protected_from_delete(self):
        with self.assertRaises(ProtectedError):
            self.asset.delete()

    def test_duplicate_operation_receipt_rejected(self):
        import uuid

        user = get_user_model().objects.create_user(username="inspector")
        values = dict(
            company=self.company,
            actor=user,
            request_id=uuid.uuid4(),
            action="save_draft",
            digest="b" * 64,
        )
        OperationReceipt.objects.create(**values)
        with self.assertRaises(ValidationError):
            OperationReceipt.objects.create(**values)
