"""Verificação do Admin contra os models revisados da Pires."""
import hashlib
from types import SimpleNamespace
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, RequestFactory
from django.urls import reverse
from django.utils import timezone
from datetime import timedelta
from sistema_pires import models as m


class PiresAdminTests(TestCase):
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


    def setUp(self):
        self.user=get_user_model().objects.create_superuser(username='admin_test', email='admin@example.test', password='somente-teste')
        self.client.force_login(self.user)
        self.request=RequestFactory().get('/admin/')
        self.request.user=self.user

    def test_all_sixty_models_registered(self):
        models=list(m.Company._meta.app_config.get_models())
        self.assertEqual(len(models),60)
        self.assertTrue(all(admin.site.is_registered(model) for model in models))

    def test_all_add_pages_render_or_are_explicitly_blocked(self):
        for model in m.Company._meta.app_config.get_models():
            with self.subTest(model=model.__name__):
                url=reverse(f'admin:sistema_pires_{model._meta.model_name}_add')
                response=self.client.get(url)
                expected=200 if admin.site._registry[model].has_add_permission(self.request) else 403
                self.assertEqual(response.status_code,expected)

    def test_existing_change_pages_render(self):
        # Inclui cadastros, requisito aprovado, upload e revisões técnicas.
        for model in m.Company._meta.app_config.get_models():
            obj=model.objects.first()
            if obj:
                with self.subTest(model=model.__name__):
                    url=reverse(f'admin:sistema_pires_{model._meta.model_name}_change',args=[obj.pk])
                    self.assertEqual(self.client.get(url).status_code,200)

    def test_editable_unit_inline_inherits_company_and_audits(self):
        parent=m.Client.objects.first()
        model_admin=admin.site._registry[m.Client]
        inline=next(i for i in model_admin.get_inline_instances(self.request,parent) if i.model is m.Unit)
        formset_class=inline.get_formset(self.request,parent)
        prefix=formset_class.get_default_prefix()
        initial=m.Unit.objects.filter(client=parent).count()
        data={f'{prefix}-TOTAL_FORMS':str(initial+1),f'{prefix}-INITIAL_FORMS':str(initial),f'{prefix}-MIN_NUM_FORMS':'0',f'{prefix}-MAX_NUM_FORMS':'1000'}
        for index,unit in enumerate(m.Unit.objects.filter(client=parent)):
            data.update({f'{prefix}-{index}-id':str(unit.pk),f'{prefix}-{index}-name':unit.name,f'{prefix}-{index}-location':unit.location,f'{prefix}-{index}-active':'on'})
        data.update({f'{prefix}-{initial}-name':'Nova unidade inline',f'{prefix}-{initial}-location':'Teste',f'{prefix}-{initial}-active':'on'})
        formset=formset_class(data=data,instance=parent)
        self.assertTrue(formset.is_valid(),(formset.errors,formset.non_form_errors()))
        model_admin.save_formset(self.request,SimpleNamespace(instance=parent),formset,True)
        unit=m.Unit.objects.get(name='Nova unidade inline')
        self.assertEqual(unit.company_id,parent.company_id)
        self.assertEqual(unit.created_by_id,self.user.pk)
        self.assertTrue(m.AuditEvent.objects.filter(entity_id=unit.pk,action='admin.inline.add').exists())

    def test_new_parent_inline_validates_without_company_field(self):
        parent=m.Client(company=self.company,name='Novo cliente ainda não salvo')
        model_admin=admin.site._registry[m.Client]
        inline=next(i for i in model_admin.get_inline_instances(self.request,parent) if i.model is m.Unit)
        cls=inline.get_formset(self.request,parent);p=cls.get_default_prefix()
        fs=cls(data={f'{p}-TOTAL_FORMS':'1',f'{p}-INITIAL_FORMS':'0',f'{p}-MIN_NUM_FORMS':'0',f'{p}-MAX_NUM_FORMS':'1000',f'{p}-0-name':'U nova',f'{p}-0-active':'on'},instance=parent)
        self.assertTrue(fs.is_valid(),fs.errors)
        self.assertEqual(fs.forms[0].instance.company_id,self.company.pk)

    def test_immutable_reading_fields_are_not_editable(self):
        r=m.ThicknessReading.objects.create(company=self.company,execution=self.execution,position=self.position,point_revision=self.point_revision,series=self.series,value=9,unit='mm',measured_at=self.now,measured_by=self.prof)
        form=admin.site._registry[m.ThicknessReading].get_form(self.request,r)
        self.assertNotIn('value',form.base_fields)
        self.assertNotIn('series',form.base_fields)

    def test_approval_events_are_append_only(self):
        event=self.series_review
        handler=admin.site._registry[type(event)]
        self.assertFalse(handler.has_change_permission(self.request,event))
        url=reverse('admin:sistema_pires_measurementseriesrevision_change',args=[event.pk])
        self.assertEqual(self.client.post(url,{'reason':'Alterado'}).status_code,403)

    def test_calculation_cannot_be_created_manually(self):
        handler=admin.site._registry[m.ThicknessCalculation]
        self.assertFalse(handler.has_add_permission(self.request))
        self.assertEqual(self.client.post(reverse('admin:sistema_pires_thicknesscalculation_add'),{}).status_code,403)

    def test_delete_is_disabled_for_all_pires_models(self):
        for model in m.Company._meta.app_config.get_models():
            self.assertFalse(admin.site._registry[model].has_delete_permission(self.request))

    def test_file_metadata_computed_before_model_validation(self):
        handler=admin.site._registry[m.StoredFile]
        formclass=handler.get_form(self.request)
        content=b'%PDF-1.4\nDemo de teste\n%%EOF'
        upload=SimpleUploadedFile('amostra.pdf',content,content_type='text/plain')
        form=formclass(data={'company':str(self.company.pk),'purpose':'evidence','source':'{}'},files={'file':upload})
        self.assertTrue(form.is_valid(),form.errors)
        self.assertEqual(form.instance.sha256,hashlib.sha256(content).hexdigest())
        self.assertEqual(form.instance.mime_type,'application/pdf')
        self.assertEqual(form.instance.size_bytes,len(content))
        self.assertIsNone(form.instance.verified_at)

    def test_file_rejects_false_pdf_extension(self):
        formclass=admin.site._registry[m.StoredFile].get_form(self.request)
        form=formclass(data={'company':str(self.company.pk),'purpose':'evidence'},files={'file':SimpleUploadedFile('falso.pdf',b'<html>nao e pdf</html>')})
        self.assertFalse(form.is_valid())
        self.assertIn('file',form.errors)

    def test_file_change_page_does_not_publish_storage_url(self):
        handler=admin.site._registry[m.StoredFile]
        fields=handler.get_fields(self.request,self.file)
        self.assertNotIn('file',fields)
        self.assertEqual(fields.count('file_reference'),1)
        response=self.client.get(reverse('admin:sistema_pires_storedfile_change',args=[self.file.pk]))
        self.assertNotContains(response,'href="/media/test/e.jpg"')

    def test_staff_without_operational_mapping_cannot_write(self):
        staff=get_user_model().objects.create_user(username='staff_test',is_staff=True)
        req=RequestFactory().get('/admin/');req.user=staff
        for model in m.Company._meta.app_config.get_models():
            handler=admin.site._registry[model]
            self.assertFalse(handler.has_add_permission(req))
            self.assertFalse(handler.has_change_permission(req))

    def test_staff_without_membership_sees_no_company_data(self):
        staff=get_user_model().objects.create_user(username='scoped_staff',is_staff=True)
        req=RequestFactory().get('/admin/');req.user=staff
        self.assertFalse(admin.site._registry[m.Asset].get_queryset(req).exists())

    def test_staff_membership_limits_company_queryset(self):
        staff=get_user_model().objects.create_user(username='member_staff',is_staff=True)
        m.CompanyMembership.objects.create(company=self.company,user=staff,role='assistant',access_state='active')
        other=m.Company.objects.create(name='Outra')
        c=m.Client.objects.create(company=other,name='Outro cliente')
        req=RequestFactory().get('/admin/');req.user=staff
        qs=admin.site._registry[m.Client].get_queryset(req)
        self.assertTrue(qs.exists())
        self.assertFalse(qs.filter(pk=c.pk).exists())

    def test_workflow_fields_cannot_open_or_issue_without_services(self):
        rec=admin.site._registry[m.Recommendation].get_form(self.request)
        doc=admin.site._registry[m.DocumentRevision].get_form(self.request)
        self.assertNotIn('status',rec.base_fields)
        self.assertNotIn('issued_at',doc.base_fields)
        self.assertNotIn('calculation_snapshot',doc.base_fields)

    def test_client_and_unit_can_be_saved_in_one_admin_post(self):
        data={
            'company':str(self.company.pk),'name':'Cliente via Admin','active':'on','source':'{}',
            'units-TOTAL_FORMS':'1','units-INITIAL_FORMS':'0','units-MIN_NUM_FORMS':'0','units-MAX_NUM_FORMS':'1000',
            'units-0-name':'Unidade via Admin','units-0-location':'Local','units-0-active':'on',
            'contracts-TOTAL_FORMS':'0','contracts-INITIAL_FORMS':'0','contracts-MIN_NUM_FORMS':'0','contracts-MAX_NUM_FORMS':'1000',
        }
        response=self.client.post(reverse('admin:sistema_pires_client_add'),data)
        self.assertEqual(response.status_code,302)
        obj=m.Client.objects.get(name='Cliente via Admin')
        child=m.Unit.objects.get(client=obj,name='Unidade via Admin')
        self.assertEqual(child.company_id,self.company.pk)
        self.assertEqual(obj.created_by_id,self.user.pk)
        self.assertTrue(m.AuditEvent.objects.filter(entity_id=obj.pk).exists())

    def test_upload_can_be_saved_through_admin(self):
        import tempfile
        from django.test import override_settings
        with tempfile.TemporaryDirectory() as folder, override_settings(MEDIA_ROOT=folder):
            content=b'%PDF-1.4\nTeste\n%%EOF'
            response=self.client.post(reverse('admin:sistema_pires_storedfile_add'),{
                'company':str(self.company.pk),'purpose':'evidence','source':'{}',
                'file':SimpleUploadedFile('teste-admin.pdf',content,content_type='application/pdf'),
            })
            self.assertEqual(response.status_code,302)
            obj=m.StoredFile.objects.get(original_name='teste-admin.pdf')
            self.assertEqual(obj.sha256,hashlib.sha256(content).hexdigest())
            self.assertEqual(obj.created_by_id,self.user.pk)
