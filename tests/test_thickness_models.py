"""Integridade dos novos models; não testa o motor matemático ainda não implementado."""
from datetime import timedelta
from decimal import Decimal
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from sistema_pires import models as m


class ThicknessModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.now = timezone.now()
        cls.day = m.measurement_date(cls.now)
        cls.company = m.Company.objects.create(name="Pires teste")
        c = m.Client.objects.create(company=cls.company, name="Cliente")
        u = m.Unit.objects.create(company=cls.company, client=c, name="Unidade")
        system = m.System.objects.create(company=cls.company, unit=u, name="Sistema")
        cls.asset = m.Asset.objects.create(company=cls.company, system=system, tag="T01", asset_type="Tubulação")
        cls.prof = m.Professional.objects.create(company=cls.company, name="Engenheiro teste")
        contract = m.Contract.objects.create(company=cls.company, client=c, reference="C01", title="Teste")
        project = m.Project.objects.create(company=cls.company, contract=contract, code="P01", title="Teste")
        scope = m.ProjectAsset.objects.create(company=cls.company, project=project, asset=cls.asset, module="integrity")
        campaign = m.Campaign.objects.create(company=cls.company, project=project, code="CP01", title="Teste", coverage="full")
        ca = m.CampaignAsset.objects.create(company=cls.company, campaign=campaign, project_asset=scope, asset=cls.asset, thickness_required=True)
        inspection = m.Inspection.objects.create(company=cls.company, campaign_asset=ca, asset=cls.asset, modality="thickness")
        cls.execution = m.InspectionExecution.objects.create(company=cls.company, inspection=inspection, sequence=1, kind="initial", observed_at=cls.now, inspector=cls.prof)
        cls.point = m.MeasurementPoint.objects.create(company=cls.company, asset=cls.asset, code="P01")
        cls.point_revision = m.MeasurementPointRevision.objects.create(company=cls.company, point=cls.point, revision=1, location="A", change_reason="Inicial", effective_on=cls.day-timedelta(days=1000))
        cls.position = m.MeasurementPosition.objects.create(company=cls.company, point=cls.point, code="0")
        cls.file = m.StoredFile.objects.create(company=cls.company, file="test/e.jpg", original_name="e.jpg", mime_type="image/jpeg", size_bytes=10, sha256="a"*64, purpose="evidence")
        cls.series = m.MeasurementSeries.objects.create(company=cls.company, position=cls.position, code="S01", started_on=cls.day-timedelta(days=1000), physical_description="Parede original", start_reason="Inicial")
        cls.series_review = m.MeasurementSeriesRevision.objects.create(company=cls.company, series=cls.series, point_revision=cls.point_revision, sequence=1, effective_on=cls.series.started_on, decision="comparable", reason="Equivalência documentada", evidence=cls.file, reviewed_by=cls.prof, reviewed_at=cls.now)
        cls.procedure = m.ThicknessProcedureVersion.objects.create(company=cls.company, code="ME", revision="teste-1", scope="Teste")
        cls.req = m.ThicknessRequirement.objects.create(company=cls.company, asset=cls.asset, required_thickness=8, unit="mm", revision="1", technical_basis="Teste", valid_from=cls.day-timedelta(days=1000), scope_description="Ativo", applicable_code="Procedimento fictício", approved_by=cls.prof, approved_at=cls.now)

    def reading(self, **overrides):
        data = dict(company=self.company, execution=self.execution, position=self.position, point_revision=self.point_revision, series=self.series, value=Decimal('9'), unit='mm', measured_at=self.now, measured_by=self.prof, sequence=1)
        data.update(overrides)
        return m.ThicknessReading.objects.create(**data)

    def review(self, reading, **overrides):
        data=dict(company=self.company, reading=reading, sequence=1, decision='valid', representative=True, comparable=True, reviewer=self.prof, reviewed_at=self.now, reason='Conferido')
        data.update(overrides)
        return m.ThicknessReadingReview.objects.create(**data)

    def calc(self, reading, **overrides):
        data=dict(company=self.company, reading=reading, series=self.series, procedure=self.procedure, engine_version='teste-1', input_snapshot={'current_mm':'9'})
        data.update(overrides)
        return m.ThicknessCalculation.objects.create(**data)

    def test_raw_reading_cannot_be_overwritten(self):
        r=self.reading(); r.value=Decimal('8')
        with self.assertRaises(ValidationError): r.save()

    def test_raw_reading_cannot_be_deleted(self):
        with self.assertRaises(ValidationError): self.reading().delete()

    def test_legacy_reading_can_remain_unassigned_but_not_validated(self):
        r=self.reading(series=None)
        with self.assertRaises(ValidationError): self.review(r)

    def test_series_cannot_use_other_position(self):
        other=m.MeasurementPosition.objects.create(company=self.company, point=self.point, code='90')
        with self.assertRaises(ValidationError): self.reading(position=other)

    def test_reading_cannot_predate_series(self):
        with self.assertRaises(ValidationError): self.reading(measured_at=self.now-timedelta(days=1100))

    def test_nominal_needs_source_and_unit(self):
        with self.assertRaises(ValidationError):
            m.AssetComponent.objects.create(company=self.company, asset=self.asset, code='C', description='Tubo', nominal_thickness=10)

    def test_pending_is_not_validation(self):
        r=self.reading()
        with self.assertRaises(ValidationError): self.review(r, decision='pending')

    def test_baseline_requires_comparability(self):
        r=self.reading()
        with self.assertRaises(ValidationError): self.review(r, baseline_approved=True, comparable=False)

    def test_review_is_append_only(self):
        rev=self.review(self.reading()); rev.reason='Alterado'
        with self.assertRaises(ValidationError): rev.save()

    def test_correction_needs_reason_evidence_actor_date(self):
        old=self.reading()
        with self.assertRaises(ValidationError): self.reading(sequence=2, corrects=old)

    def test_formal_correction_preserves_original(self):
        old=self.reading()
        corrected=self.reading(sequence=2, value=Decimal('8.9'), corrects=old, correction_reason='Transcrição', correction_evidence=self.file, correction_proposed_by=self.prof, correction_proposed_at=self.now)
        self.assertEqual(corrected.corrects.value, Decimal('9'))
        self.assertEqual(m.ThicknessReading.objects.count(), 2)

    def test_correction_needs_technical_approval_for_calculation(self):
        old=self.reading()
        r=self.reading(sequence=2, corrects=old, correction_reason='Erro', correction_evidence=self.file, correction_proposed_by=self.prof, correction_proposed_at=self.now)
        rev=self.review(r)
        with self.assertRaises(ValidationError): self.calc(r, reading_review=rev, requirement=self.req, margin_mm=1, dimensional='above')

    def test_requirement_requires_validity_for_approval(self):
        with self.assertRaises(ValidationError):
            m.ThicknessRequirement.objects.create(company=self.company, asset=self.asset, required_thickness=8, unit='mm', revision='2', technical_basis='Teste', approved_by=self.prof, approved_at=self.now)

    def test_requirement_validity_is_frozen(self):
        self.req.valid_from=self.day
        with self.assertRaises(ValidationError): self.req.save()

    def test_pending_calculation_has_null_results(self):
        c=self.calc(self.reading())
        self.assertIsNone(c.margin_mm)
        self.assertEqual(c.dimensional, 'pending')

    def test_calculation_rejects_unreviewed_outputs(self):
        with self.assertRaises(ValidationError): self.calc(self.reading(), requirement=self.req, margin_mm=1, dimensional='above')

    def test_same_day_readings_do_not_form_rate(self):
        previous=self.reading(sequence=1, measured_at=self.now-timedelta(minutes=1))
        r=self.reading(sequence=2)
        prev_review=self.review(previous); rev=self.review(r)
        with self.assertRaises(ValidationError):
            self.calc(r, reading_review=rev, previous_reading=previous, previous_review=prev_review, series_review=self.series_review, short_rate_mm_year=Decimal('.5'))

    def test_negative_rate_can_be_preserved(self):
        previous=self.reading(sequence=1, measured_at=self.now-timedelta(days=365), value=Decimal('8.5'))
        r=self.reading(sequence=2); prev_review=self.review(previous); rev=self.review(r)
        c=self.calc(r, reading_review=rev, previous_reading=previous, previous_review=prev_review, series_review=self.series_review, short_rate_mm_year=Decimal('-.5'), trend='review')
        self.assertEqual(c.short_rate_mm_year, Decimal('-.5'))

    def test_no_future_life_at_limit(self):
        r=self.reading(value=Decimal('8'));rev=self.review(r)
        with self.assertRaises(ValidationError):
            self.calc(r, reading_review=rev, requirement=self.req, margin_mm=0, dimensional='limit', life_triage_days=1)

    def test_expired_requirement_rejected(self):
        req=m.ThicknessRequirement.objects.create(company=self.company, asset=self.asset, required_thickness=8, unit='mm', revision='old', technical_basis='Teste', valid_from=self.day-timedelta(days=50), valid_until=self.day-timedelta(days=10), scope_description='Ativo', applicable_code='Teste', approved_by=self.prof, approved_at=self.now)
        r=self.reading();rev=self.review(r)
        with self.assertRaises(ValidationError): self.calc(r, reading_review=rev, requirement=req, margin_mm=1, dimensional='above')

    def test_calculation_is_immutable(self):
        c=self.calc(self.reading()); c.input_snapshot={'changed':True}
        with self.assertRaises(ValidationError): c.save()

    def test_test_procedure_does_not_imply_homologation(self):
        self.assertEqual(self.procedure.status, 'test')
        self.procedure.status='approved'
        with self.assertRaises(ValidationError): self.procedure.save()

    def test_pending_result_cannot_receive_green(self):
        c=self.calc(self.reading())
        with self.assertRaises(ValidationError):
            m.ThicknessCalculationReview.objects.create(company=self.company, calculation=c, sequence=1, reviewer=self.prof, reviewed_at=self.now, decision='approved', conclusion='Teste')

    def test_nr13_conclusion_requires_plh(self):
        scope=self.execution.inspection.campaign_asset.project_asset
        # Modifica só o fixture de teste; a aplicação deve usar o fluxo de autorização.
        m.ProjectAsset.objects.filter(pk=scope.pk).update(module='nr13')
        self.execution=m.InspectionExecution.objects.get(pk=self.execution.pk)
        c=self.calc(self.reading())
        with self.assertRaises(ValidationError):
            m.ThicknessCalculationReview.objects.create(company=self.company, calculation=c, sequence=1, reviewer=self.prof, reviewed_at=self.now, decision='rejected', conclusion='Teste')

    def test_imported_history_requires_documented_origin(self):
        r=self.reading(origin='historical')
        with self.assertRaises(ValidationError): self.review(r)

    def test_renaming_display_does_not_change_point_identity(self):
        pk=self.point.pk
        self.point.display_name='Ponto renomeado';self.point.save()
        self.assertEqual(self.point.pk,pk)
        self.assertEqual(self.point.code,'P01')
