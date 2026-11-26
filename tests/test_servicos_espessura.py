from datetime import timedelta
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied
from django.test import TestCase, override_settings
from django.utils import timezone
from sistema_pires import models as m
from sistema_pires.services.calcs.registro_medicoes import calculate_series, register_reading, register_reading_review
from . import test_thickness_models as fixtures


class ThicknessServiceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        fixtures.ThicknessModelTests.setUpTestData.__func__(cls)
        cls.actor=get_user_model().objects.create_superuser(username='motor_teste',email='motor@example.test',password='somente-teste')

    def execute(self):
        return calculate_series(series_id=self.series.pk,procedure_id=self.procedure.pk,actor=self.actor)

    def reading(self,value,days=0,*,baseline=False,review=True,execution=None,unit='mm',**kwargs):
        if execution is None:
            execution=m.InspectionExecution.objects.create(company=self.company,inspection=self.execution.inspection,
                sequence=m.InspectionExecution.objects.count()+1,kind='initial',observed_at=self.now-timedelta(days=days),inspector=self.prof)
        last=execution.readings.filter(position=self.position).order_by('-sequence').first()
        row=m.ThicknessReading.objects.create(company=self.company,execution=execution,position=self.position,
            point_revision=self.point_revision,series=self.series,value=Decimal(value),unit=unit,
            measured_at=self.now-timedelta(days=days),measured_by=self.prof,sequence=last.sequence+1 if last else 1,
            source_evidence=self.file,**kwargs)
        if review:
            m.ThicknessReadingReview.objects.create(company=self.company,reading=row,sequence=1,decision='valid',
                representative=True,comparable=True,baseline_approved=baseline,reviewer=self.prof,reviewed_at=self.now,
                reason='Teste validado',evidence=self.file if baseline else None)
        return row

    def reference_case(self):
        initial=self.reading('10',730,baseline=True)
        previous=self.reading('9.5',365)
        current=self.reading('9')
        return initial,previous,current

    def result_for(self,batch,reading):
        return next(c for c in batch['calculations'] if c.reading_id==reading.pk)

    def test_reference_case_persisted_730_days(self):
        initial,previous,current=self.reference_case()
        result=self.result_for(self.execute(),current)
        self.assertEqual(result.life_triage_days,730)
        self.assertEqual(result.initial_reading_id,initial.pk)
        self.assertEqual(result.previous_reading_id,previous.pk)
        self.assertEqual(result.margin_mm,Decimal('1'))
        self.assertEqual(result.result_snapshot['reference_for_loss'],str(initial.pk))

    def test_repeat_is_idempotent(self):
        self.reference_case();first=self.execute();second=self.execute()
        self.assertEqual(first['created'],3)
        self.assertEqual(second['created'],0)
        self.assertEqual([c.pk for c in first['calculations']],[c.pk for c in second['calculations']])

    def test_minimum_valid_reading_selected(self):
        self.reading('10',365,baseline=True)
        high=self.reading('9.5')
        low=self.reading('9',execution=high.execution)
        results=self.execute()['calculations']
        current=[c for c in results if c.reading.execution_id==high.execution_id]
        self.assertEqual(len(current),1)
        self.assertEqual(current[0].reading_id,low.pk)

    def test_invalid_lower_reading_does_not_replace_valid_minimum(self):
        good=self.reading('9')
        bad=self.reading('1',review=False,execution=good.execution)
        m.ThicknessReadingReview.objects.create(company=self.company,reading=bad,sequence=1,decision='invalid',reviewer=self.prof,reviewed_at=self.now,reason='Leitura inválida conferida')
        self.assertEqual(self.execute()['calculations'][0].reading_id,good.pk)

    def test_unreviewed_lower_reading_keeps_group_pending(self):
        self.reading('10',365,baseline=True)
        high=self.reading('9')
        self.reading('1',review=False,execution=high.execution)
        result=self.result_for(self.execute(),high)
        self.assertIsNone(result.short_rate_mm_year)
        self.assertIn('READING_PENDING',[w['code'] for w in result.warnings])

    def test_oldest_approved_baseline_not_first_imported_row(self):
        self.reading('11',800,review=False,origin='historical')
        baseline=self.reading('10',730,baseline=True)
        current=self.reading('9')
        result=self.result_for(self.execute(),current)
        self.assertEqual(result.initial_reading_id,baseline.pk)

    def test_new_series_has_no_previous_series_rate(self):
        self.reference_case();other=m.MeasurementSeries.objects.create(company=self.company,position=self.position,code='S2',started_on=self.day,physical_description='Parede substituída',start_reason='Troca',predecessor=self.series)
        row=m.ThicknessReading.objects.create(company=self.company,execution=self.execution,position=self.position,point_revision=self.point_revision,series=other,value=10,unit='mm',measured_at=self.now,measured_by=self.prof)
        batch=calculate_series(series_id=other.pk,procedure_id=self.procedure.pk,actor=self.actor)
        self.assertIsNone(batch['calculations'][0].previous_reading_id)
        self.assertIsNone(batch['calculations'][0].short_rate_mm_year)

    def test_pending_reading_never_computes_margin(self):
        row=self.reading('9',review=False)
        result=self.execute()['calculations'][0]
        self.assertEqual(result.dimensional,'pending')
        self.assertIsNone(result.margin_mm)
        self.assertEqual(result.reading_id,row.pk)

    def test_zero_rate_persisted_without_life(self):
        self.reading('9',365,baseline=True);current=self.reading('9')
        result=self.result_for(self.execute(),current)
        self.assertEqual(result.short_rate_mm_year,0)
        self.assertIsNone(result.life_short_days)

    def test_negative_rate_preserved_in_database(self):
        self.reading('8.5',365,baseline=True);current=self.reading('9')
        result=self.result_for(self.execute(),current)
        self.assertEqual(result.short_rate_mm_year,Decimal('-.5'))
        self.assertEqual(result.trend,'review')

    def test_missing_requirement_keeps_pending_dimension(self):
        m.ThicknessRequirement.objects.all().delete()
        self.reading('10',365,baseline=True);current=self.reading('9')
        result=self.result_for(self.execute(),current)
        self.assertEqual(result.dimensional,'pending')
        self.assertIsNone(result.life_triage_days)
        self.assertIsNotNone(result.short_rate_mm_year)

    def requirement(self,*,value='8',point=None,position=None,**overrides):
        data=dict(company=self.company,asset=self.asset,required_thickness=Decimal(value),unit='mm',revision=str(m.ThicknessRequirement.objects.count()+1),technical_basis='Teste',scope_description='Escopo',applicable_code='Teste',valid_from=self.day-timedelta(days=1000),approved_at=self.now,approved_by=self.prof,point=point,position=position)
        data.update(overrides)
        return m.ThicknessRequirement.objects.create(**data)

    def test_position_requirement_has_priority(self):
        req=self.requirement(value='8.5',point=self.point,position=self.position)
        current=self.reading('9');result=self.execute()['calculations'][0]
        self.assertEqual(result.requirement_id,req.pk)
        self.assertEqual(result.margin_mm,Decimal('.5'))

    def test_specific_requirement_cannot_lower_applicable_limit(self):
        self.requirement(value='7',point=self.point,position=self.position)
        self.reading('9');result=self.execute()['calculations'][0]
        self.assertIsNone(result.requirement_id)
        self.assertIn('REQUIREMENT_LIMIT_CONFLICT',[w['code'] for w in result.warnings])

    def test_overlapping_requirements_are_pending(self):
        self.requirement(value='8.5')
        self.reading('9');result=self.execute()['calculations'][0]
        self.assertEqual(result.dimensional,'pending')
        self.assertIn('REQUIREMENT_CONFLICT',[w['code'] for w in result.warnings])

    def test_approved_successor_does_not_change_issued_input(self):
        self.reading('9');old=self.execute()['calculations'][0]
        new=self.requirement(value='8.5',supersedes=self.req,valid_from=self.day-timedelta(days=10))
        current=self.execute()['calculations'][0]
        self.assertEqual(current.requirement_id,new.pk)
        old.refresh_from_db();self.assertEqual(old.requirement_id,self.req.pk)
        self.assertEqual(current.supersedes_id,old.pk)

    def test_changed_method_blocks_rates_until_review(self):
        self.reading('10',365,baseline=True);row=self.reading('9',method_reference='Método novo')
        result=self.result_for(self.execute(),row)
        self.assertIsNone(result.short_rate_mm_year)
        self.assertIn('METHOD_CHANGED',[w['code'] for w in result.warnings])

    def test_same_date_executions_do_not_form_pair(self):
        self.reading('10');row=self.reading('9')
        result=self.result_for(self.execute(),row)
        self.assertIsNone(result.short_rate_mm_year)

    def test_baseline_not_approved_no_long_rate(self):
        self.reading('10',365);row=self.reading('9')
        result=self.result_for(self.execute(),row)
        self.assertIsNone(result.long_rate_mm_year)
        self.assertIsNotNone(result.short_rate_mm_year)

    def test_pending_correction_does_not_silently_replace_original(self):
        old=self.reading('9')
        correction=self.reading('8.9',execution=old.execution,review=False,corrects=old,correction_reason='Transcrição',correction_evidence=self.file,correction_proposed_by=self.prof,correction_proposed_at=self.now)
        result=self.execute()['calculations'][0]
        self.assertEqual(result.reading_id,old.pk)
        self.assertTrue(result.warnings)

    def test_approved_correction_becomes_selection_and_preserves_original(self):
        old=self.reading('9');self.execute()
        corrected=self.reading('8.9',execution=old.execution,review=False,corrects=old,correction_reason='Transcrição',correction_evidence=self.file,correction_proposed_by=self.prof,correction_proposed_at=self.now)
        m.ThicknessReadingReview.objects.create(company=self.company,reading=corrected,sequence=1,decision='valid',representative=True,comparable=True,correction_approved=True,reviewer=self.prof,reviewed_at=self.now,reason='Correção conferida',evidence=self.file)
        result=self.execute()['calculations'][0]
        self.assertEqual(result.reading_id,corrected.pk)
        old.refresh_from_db();self.assertEqual(old.value,Decimal('9'))
        self.assertTrue(old.calculations.exists())

    def test_formal_invalidation_recalculates_history_without_old_approval(self):
        baseline,previous,current=self.reference_case();old=self.result_for(self.execute(),current)
        register_reading_review(actor=self.actor,procedure_id=self.procedure.pk,company=self.company,reading=previous,decision='invalid',reviewer=self.prof,reviewed_at=self.now,reason='Referência inválida')
        new=self.result_for(self.execute(),current)
        self.assertNotEqual(new.pk,old.pk)
        self.assertEqual(new.previous_reading_id,baseline.pk)
        self.assertFalse(new.technical_reviews.exists())

    def test_register_reading_is_pending_until_review(self):
        row,result=register_reading(actor=self.actor,procedure_id=self.procedure.pk,company=self.company,execution=self.execution,position=self.position,point_revision=self.point_revision,series=self.series,value=Decimal('9'),unit='mm',measured_at=self.now,measured_by=self.prof)
        self.assertEqual(row.requirement_id,self.req.pk)
        self.assertEqual(result['calculations'][0].dimensional,'pending')

    def test_staff_actor_cannot_write_services_yet(self):
        staff=get_user_model().objects.create_user(username='staff',is_staff=True)
        with self.assertRaises(PermissionDenied):calculate_series(series_id=self.series.pk,procedure_id=self.procedure.pk,actor=staff)

    def test_cross_company_procedure_is_rejected(self):
        from django.core.exceptions import ObjectDoesNotExist
        other=m.Company.objects.create(name='Outra')
        proc=m.ThicknessProcedureVersion.objects.create(company=other,code='X',revision='1',scope='Outro')
        with self.assertRaises(ObjectDoesNotExist):calculate_series(series_id=self.series.pk,procedure_id=proc.pk,actor=self.actor)

    def test_calculation_does_not_create_rti_or_technical_conclusion(self):
        self.reference_case();batch=self.execute()
        self.assertFalse(m.RTI.objects.exists())
        self.assertFalse(m.ThicknessCalculationReview.objects.exists())
        self.assertTrue(all('PROCEDURE_TEST' in [w['code'] for w in c.warnings] for c in batch['calculations']))

    def test_correction_invalidating_baseline_does_not_reuse_old_baseline(self):
        baseline,previous,current=self.reference_case();self.execute()
        m.ThicknessReadingReview.objects.create(company=self.company,reading=baseline,sequence=2,decision='invalid',reviewer=self.prof,reviewed_at=self.now,reason='Histórico não comparável')
        result=self.result_for(self.execute(),current)
        self.assertIsNone(result.initial_reading_id)
        self.assertIsNone(result.long_rate_mm_year)

    def test_resolution_change_blocks_rates(self):
        self.reading('10',365,baseline=True)
        row=self.reading('9',original_resolution=Decimal('.01'))
        result=self.result_for(self.execute(),row)
        self.assertIsNone(result.short_rate_mm_year)
        self.assertIn('RESOLUTION_CHANGED',[w['code'] for w in result.warnings])

    def test_competing_corrections_remain_pending(self):
        old=self.reading('9')
        for value in ('8.9','8.8'):
            row=self.reading(value,execution=old.execution,review=False,corrects=old,correction_reason='Correção',correction_evidence=self.file,correction_proposed_by=self.prof,correction_proposed_at=self.now)
            m.ThicknessReadingReview.objects.create(company=self.company,reading=row,sequence=1,decision='valid',representative=True,comparable=True,correction_approved=True,reviewer=self.prof,reviewed_at=self.now,reason='Teste',evidence=self.file)
        result=self.execute()['calculations'][0]
        self.assertEqual(result.dimensional,'pending')
        self.assertIn('CORRECTION_CONFLICT',[w['code'] for w in result.warnings])

    def test_admin_hook_automatically_records_pending_calculation(self):
        from django.contrib import admin
        from django.urls import reverse
        self.client.force_login(self.actor)
        day=timezone.localtime(self.now)
        data={'company':str(self.company.pk),'execution':str(self.execution.pk),
              'position':str(self.position.pk),'point_revision':str(self.point_revision.pk),
              'series':str(self.series.pk),'value':'9','unit':'mm','sequence':'1','origin':'field',
              'measured_at_0':day.strftime('%Y-%m-%d'),'measured_at_1':day.strftime('%H:%M:%S'),
              'measured_by':str(self.prof.pk),'source':'{}','service_conditions':'{}',
              'reviews-TOTAL_FORMS':'0','reviews-INITIAL_FORMS':'0','reviews-MIN_NUM_FORMS':'0','reviews-MAX_NUM_FORMS':'1000',
              'inspection_photos-TOTAL_FORMS':'0','inspection_photos-INITIAL_FORMS':'0','inspection_photos-MIN_NUM_FORMS':'0','inspection_photos-MAX_NUM_FORMS':'1000',
              'calculations-TOTAL_FORMS':'0','calculations-INITIAL_FORMS':'0','calculations-MIN_NUM_FORMS':'0','calculations-MAX_NUM_FORMS':'1000'}
        # Obtém os prefixos reais dos inlines para testar o POST completo.
        parent_admin=admin.site._registry[m.ThicknessReading]
        request=__import__('django.test',fromlist=['RequestFactory']).RequestFactory().get('/admin/')
        request.user=self.actor
        for inline in parent_admin.get_inline_instances(request):
            prefix=inline.get_formset(request).get_default_prefix()
            data.update({f'{prefix}-TOTAL_FORMS':'0',f'{prefix}-INITIAL_FORMS':'0',f'{prefix}-MIN_NUM_FORMS':'0',f'{prefix}-MAX_NUM_FORMS':'1000'})
        self.series.procedure=self.procedure
        self.series.save()
        response=self.client.post(reverse('admin:sistema_pires_thicknessreading_add'),data)
        self.assertEqual(response.status_code,302)
        self.assertEqual(m.ThicknessReading.objects.get().requirement_id,self.req.pk)
        self.assertEqual(m.ThicknessCalculation.objects.count(),1)
        self.assertEqual(m.ThicknessCalculation.objects.get().dimensional,'pending')

    def document_revision(self,status='draft',issued=False):
        doc=m.TechnicalDocument.objects.create(company=self.company,project=self.execution.inspection.campaign_asset.campaign.project,
             asset=self.asset,inspection=self.execution.inspection,code='DOC1',title='Teste',kind='thickness',module='integrity')
        return m.DocumentRevision.objects.create(company=self.company,document=doc,revision='1',status=status,
             issued_at=self.now if issued else None,data_snapshot={'fixed':'original'},calculation_snapshot={'fixed':'original'})

    def test_issued_report_snapshot_not_modified(self):
        baseline,previous,current=self.reference_case();doc=self.document_revision('issued',True)
        self.execute();doc.refresh_from_db()
        self.assertEqual(doc.status,'issued')
        self.assertEqual(doc.calculation_snapshot,{'fixed':'original'})
        self.assertTrue(m.AuditEvent.objects.filter(entity_id=doc.pk,action='thickness.new_document_revision_required').exists())

    def test_unissued_approved_document_returns_to_review(self):
        self.reference_case();doc=self.document_revision('approved')
        self.execute();doc.refresh_from_db()
        self.assertEqual(doc.status,'review')
        self.assertIsNone(doc.approved_at)

    def test_consolidated_never_dilutes_critical_value(self):
        from sistema_pires.services.calcs.consolidacao_inspecao import summarize_calculations
        self.reading('9',365,baseline=True);self.reading('7')
        batch=self.execute()
        summary=summarize_calculations(batch['calculations'],expected_position_ids=[self.position.pk])
        self.assertTrue(summary['critical'])
        self.assertEqual(summary['worst_dimensional'],'below')
        self.assertIsNone(summary['technical_conclusion'])

    def test_coverage_not_assumed_from_existing_data(self):
        from sistema_pires.services.calcs.consolidacao_inspecao import summarize_calculations
        self.reading('9');summary=summarize_calculations(self.execute()['calculations'])
        self.assertIsNone(summary['coverage']['expected'])
        self.assertTrue(summary['has_pending'])

    def test_new_campaign_does_not_rewrite_older_calculations(self):
        old=self.reading('10',365,baseline=True)
        first=self.execute()['calculations'][0]
        self.reading('9')
        second=self.execute()
        self.assertEqual(second['created'],1)
        self.assertEqual(self.result_for(second,old).pk,first.pk)

    def test_documented_physical_break_not_healed_by_later_comparable_event(self):
        self.reading('10',365,baseline=True)
        m.MeasurementSeriesRevision.objects.create(company=self.company,series=self.series,point_revision=self.point_revision,
            sequence=2,effective_on=self.day-timedelta(days=100),decision='not_comparable',reason='Parede alterada',reviewed_by=self.prof,reviewed_at=self.now,evidence=self.file)
        m.MeasurementSeriesRevision.objects.create(company=self.company,series=self.series,point_revision=self.point_revision,
            sequence=3,effective_on=self.day,decision='comparable',reason='Estado atual conferido',reviewed_by=self.prof,reviewed_at=self.now,evidence=self.file)
        current=self.reading('9')
        result=self.result_for(self.execute(),current)
        self.assertIsNone(result.short_rate_mm_year)
        self.assertIsNone(result.long_rate_mm_year)
        self.assertIn('SERIES_BREAK_REVIEW',[w['code'] for w in result.warnings])

    def test_formally_invalidated_competing_branch_does_not_resurrect_original(self):
        old=self.reading('9')
        branches=[]
        for value in ('8.9','8.8'):
            row=self.reading(value,execution=old.execution,review=False,corrects=old,correction_reason='Correção',correction_evidence=self.file,correction_proposed_by=self.prof,correction_proposed_at=self.now)
            m.ThicknessReadingReview.objects.create(company=self.company,reading=row,sequence=1,decision='valid',representative=True,comparable=True,correction_approved=True,reviewer=self.prof,reviewed_at=self.now,reason='Conferido',evidence=self.file)
            branches.append(row)
        self.assertEqual(self.execute()['calculations'][0].dimensional,'pending')
        m.ThicknessReadingReview.objects.create(company=self.company,reading=branches[1],sequence=2,decision='invalid',reviewer=self.prof,reviewed_at=self.now,reason='Resolução formal do conflito',evidence=self.file)
        result=self.execute()['calculations'][0]
        self.assertEqual(result.reading_id,branches[0].pk)
        self.assertEqual(m.ThicknessReading.objects.get(pk=old.pk).value,Decimal('9'))
