from django.contrib import admin
from django.core.exceptions import ValidationError
from django.test import TestCase, RequestFactory, override_settings
from django.contrib.auth import get_user_model
from sistema_pires import models as m
from sistema_pires.services.calcs.registro_medicoes import configured_procedure, affected_series, calculate_series
from . import test_thickness_models as fixtures


class ProcedureSelectionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        fixtures.ThicknessModelTests.setUpTestData.__func__(cls)
        cls.actor=get_user_model().objects.create_superuser(username='procedure_admin',email='test@example.test',password='somente-teste')

    def bind(self):
        self.series.procedure=self.procedure
        self.series.save()

    def test_existing_series_can_remain_pending(self):
        self.assertIsNone(configured_procedure(self.series.pk))

    def test_selected_procedure_is_persisted(self):
        self.bind()
        self.series.refresh_from_db()
        self.assertEqual(configured_procedure(self.series.pk),self.procedure.pk)

    def test_legacy_settings_no_longer_choose_procedure(self):
        with override_settings(PIRES_THICKNESS_PROCEDURES={str(self.series.pk):str(self.procedure.pk)}):
            self.assertIsNone(configured_procedure(self.series.pk))

    def test_cross_company_procedure_rejected(self):
        other=m.Company.objects.create(name='Outra')
        proc=m.ThicknessProcedureVersion.objects.create(company=other,code='P',revision='1',scope='Outro')
        self.series.procedure=proc
        with self.assertRaises(ValidationError):self.series.save()

    def test_changing_selection_keeps_previous_calculation(self):
        self.bind()
        reading=m.ThicknessReading.objects.create(company=self.company,execution=self.execution,position=self.position,
            point_revision=self.point_revision,series=self.series,value=9,unit='mm',measured_at=self.now,measured_by=self.prof)
        old=calculate_series(series_id=self.series.pk,actor=self.actor)['calculations'][0]
        proc=m.ThicknessProcedureVersion.objects.create(company=self.company,code='P',revision='2',scope='Teste')
        self.series.procedure=proc;self.series.save()
        new=calculate_series(series_id=self.series.pk,actor=self.actor)['calculations'][0]
        old.refresh_from_db()
        self.assertEqual(old.procedure_id,self.procedure.pk)
        self.assertEqual(new.procedure_id,proc.pk)
        self.assertEqual(new.supersedes_id,old.pk)

    def test_explicit_override_cannot_contradict_selected_procedure(self):
        self.bind()
        proc=m.ThicknessProcedureVersion.objects.create(company=self.company,code='P',revision='2',scope='Teste')
        with self.assertRaises(ValidationError):calculate_series(series_id=self.series.pk,procedure_id=proc.pk,actor=self.actor)

    def test_admin_has_selectable_field(self):
        self.bind();req=RequestFactory().get('/admin/');req.user=self.actor
        form=admin.site._registry[m.MeasurementSeries].get_form(req,self.series)
        self.assertIn('procedure',form.base_fields)
        self.assertNotIn('procedure',admin.site._registry[m.MeasurementSeries].autocomplete_fields)

    def test_selection_respects_company_in_existing_series_dropdown(self):
        other=m.Company.objects.create(name='Outra')
        proc=m.ThicknessProcedureVersion.objects.create(company=other,code='P',revision='1',scope='Outro')
        req=RequestFactory().get('/admin/');req.user=self.actor
        cls=admin.site._registry[m.MeasurementSeries].get_form(req,self.series)
        self.assertFalse(cls(instance=self.series).fields['procedure'].queryset.filter(pk=proc.pk).exists())

    def test_changing_procedure_identifies_affected_series(self):
        self.bind()
        self.assertEqual(affected_series(self.procedure),[self.series.pk])
        self.assertEqual(affected_series(self.series),[self.series.pk])

    def test_procedure_can_be_selected_and_saved_in_admin(self):
        from django.urls import reverse
        self.client.force_login(self.actor)
        data={'procedure':str(self.procedure.pk)}
        request=RequestFactory().get('/admin/');request.user=self.actor
        handler=admin.site._registry[m.MeasurementSeries]
        for inline in handler.get_inline_instances(request,self.series):
            prefix=inline.get_formset(request,self.series).get_default_prefix()
            data.update({f'{prefix}-TOTAL_FORMS':'0',f'{prefix}-INITIAL_FORMS':'0',f'{prefix}-MIN_NUM_FORMS':'0',f'{prefix}-MAX_NUM_FORMS':'1000'})
        response=self.client.post(reverse('admin:sistema_pires_measurementseries_change',args=[self.series.pk]),data)
        self.assertEqual(response.status_code,302)
        self.series.refresh_from_db()
        self.assertEqual(self.series.procedure_id,self.procedure.pk)
