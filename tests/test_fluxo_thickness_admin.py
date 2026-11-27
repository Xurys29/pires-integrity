"""Um teste de integração, com passos ordenados e cadastros via POST no Admin.

Executar: python manage.py test tests.test_fluxo_thickness_admin --noinput --verbosity 2
Requer os 60 models, procedure selecionável na série e serviços em services/calcs.
Não usa fixtures de outros testes e não altera o banco de desenvolvimento.
"""
import base64
import json
import tempfile
from datetime import date, datetime, timedelta
from decimal import Decimal
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import FieldDoesNotExist
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, TestCase, override_settings
from django.db import models as django_models
from django.urls import reverse
from django.utils import timezone
from sistema_pires import models as m
from sistema_pires.services.calcs.registro_medicoes import calculate_series


class ThicknessAdminWorkflowTest(TestCase):
    def setUp(self):
        """Preparação do teste: isola arquivos e cria apenas a conta administrativa."""
        self.media=tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        self.settings_override=override_settings(MEDIA_ROOT=self.media.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        User=get_user_model()
        self.actor=User.objects.create_superuser(
            **{User.USERNAME_FIELD:'fluxo_thickness_teste'}, password='somente-teste-local')
        self.now=timezone.localtime(timezone.now()).replace(microsecond=0)
        self.dates={'initial':self.now-timedelta(days=730),
                    'previous':self.now-timedelta(days=365),'current':self.now}
        self.executed_steps=[]

    def _request(self):
        """Apoio aos passos: fornece usuário ao consultar formulários e inlines do Admin."""
        request=RequestFactory().get('/admin/')
        request.user=self.actor
        return request

    def _post_admin(self, model, values, obj=None):
        """Apoio: grava pelo endpoint real do Admin, sem chamar save_model diretamente."""
        handler=admin.site._registry[model]
        request=self._request()
        formclass=handler.get_form(request,obj)
        data={}
        for name,field in formclass.base_fields.items():
            if name not in values:
                try:
                    model_field=model._meta.get_field(name)
                except FieldDoesNotExist:
                    continue
                if model_field.has_default():
                    default=model_field.get_default()
                    if isinstance(model_field,django_models.JSONField):
                        data[name]=json.dumps(default)
                    elif isinstance(default,bool):
                        data[name]='on' if default else ''
                    elif default is not None:
                        data[name]=str(default)
        for name,value in values.items():
            if isinstance(value,datetime):
                local=timezone.localtime(value) if timezone.is_aware(value) else value
                data[f'{name}_0']=local.strftime('%Y-%m-%d')
                data[f'{name}_1']=local.strftime('%H:%M:%S')
            elif isinstance(value,date):
                data[name]=value.isoformat()
            elif isinstance(value,bool):
                if value:data[name]='on'
            elif isinstance(value,(dict,list)):
                data[name]=json.dumps(value,ensure_ascii=False)
            elif isinstance(value,django_models.Model):
                data[name]=str(value.pk)
            else:
                data[name]=value
        for child in handler.get_inline_instances(request,obj):
            prefix=child.get_formset(request,obj).get_default_prefix()
            data.update({f'{prefix}-TOTAL_FORMS':'0',f'{prefix}-INITIAL_FORMS':'0',
                         f'{prefix}-MIN_NUM_FORMS':'0',f'{prefix}-MAX_NUM_FORMS':'1000'})
        before=set(model.objects.values_list('pk',flat=True)) if obj is None else None
        url=reverse(f'admin:sistema_pires_{model._meta.model_name}_'+('change' if obj else 'add'),
                    args=[obj.pk] if obj else None)
        response=self.client.post(url,data)
        errors={}
        if response.status_code==200 and response.context:
            errors['form']=response.context['adminform'].form.errors.as_json()
            errors['inlines']=[{'errors':fs.formset.errors,'management':list(fs.formset.non_form_errors())}
                               for fs in response.context['inline_admin_formsets']]
        self.assertEqual(response.status_code,302,
            f'Falha em {model.__name__}: status={response.status_code}; erros={errors}')
        if obj is not None:
            obj.refresh_from_db()
            return obj
        added=set(model.objects.values_list('pk',flat=True))-before
        self.assertEqual(len(added),1,f'Esperava um cadastro de {model.__name__}, encontrei {added}')
        return model.objects.get(pk=added.pop())

    def _upload(self,name,purpose,*,image=False):
        """Apoio: envia arquivo fictício pelo Admin e confere hash/tamanho automáticos."""
        if image:
            content=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=')
            mime='image/png'
        else:
            content=b'%PDF-1.4\n% Evidencia ficticia para teste automatizado\n%%EOF'
            mime='application/pdf'
        result=self._post_admin(m.StoredFile,{
            'company':self.company,'purpose':purpose,
            'file':SimpleUploadedFile(name,content,content_type=mime)})
        self.assertTrue(result.sha256)
        self.assertEqual(result.size_bytes,len(content))
        return result

    def _service_context(self,key,code):
        """Apoio: cria campanha, inspeção, execução e uso de instrumento de uma data."""
        when=self.dates[key]
        campaign=self._post_admin(m.Campaign,{'company':self.company,'project':self.project,
            'code':f'CP-{code}','title':f'Campanha fictícia {code}','coverage':'full',
            'planned_start':when.date(),'planned_end':when.date()})
        selection=self._post_admin(m.CampaignAsset,{'company':self.company,'campaign':campaign,
            'project_asset':self.scope,'asset':self.asset,'selected':True,'thickness_required':True,
            'inspector':self.inspector,'planned_at':when})
        inspection=self._post_admin(m.Inspection,{'company':self.company,'campaign_asset':selection,
            'asset':self.asset,'modality':'thickness','planned_at':when,'inspector':self.inspector})
        self.assertEqual(inspection.status,'planned')
        execution=self._post_admin(m.InspectionExecution,{'company':self.company,'inspection':inspection,
            'sequence':1,'kind':'initial','observed_at':when,'inspector':self.inspector,
            'status':'in_progress','service_order':f'OS-{code}',
            'procedure_reference':self.procedure.code,'procedure_revision':self.procedure.revision})
        # No Admin atual a transição da inspeção é explícita, não um efeito
        # automático de cadastrar a execução. O teste não pressupõe essa automação.
        self._post_admin(m.Inspection,{'status':'in_progress','planned_at':when,
            'inspected_at':when,'inspector':self.inspector},obj=inspection)
        self.assertEqual(inspection.status,'in_progress')
        certificate=self._post_admin(m.CalibrationRecord,{'company':self.company,'instrument':self.instrument,
            'certificate_number':f'CAL-DEMO-{code}','calibrated_on':when.date()-timedelta(days=30),
            'valid_until':when.date()+timedelta(days=300),'issuer':'Laboratório fictício',
            'file':self.support_file})
        equipment=self._post_admin(m.ExecutionInstrument,{'company':self.company,'execution':execution,
            'instrument':self.instrument,'calibration':certificate,'purpose':'Medição de espessura demonstrativa',
            'verification':'Registro fictício; sem comprovação metrológica real'})
        return {'campaign':campaign,'inspection':inspection,'execution':execution,'equipment':equipment}

    def _reading(self,key,value,*,sequence=1,corrects=None):
        """Apoio: cadastra leitura e duas evidências contextuais, sem validá-la."""
        context=self.contexts[key]
        payload={'company':self.company,'execution':context['execution'],'position':self.position,
            'point_revision':self.point_revision,'series':self.series,'value':Decimal(value),'unit':'mm',
            'sequence':sequence,'measured_at':self.dates[key],'measured_by':self.inspector,
            'instrument_use':context['equipment'],'origin':'field' if key=='current' else 'historical',
            'source_evidence':self.reading_file,'original_resolution':Decimal('.01'),
            'method_reference':'UT-DEMO','service_conditions':{'scenario':'ficticio'},
            'source':{'source_system':'DEMO','reference':f'DADO-FICTICIO-{key}'}}
        if corrects:
            payload.update(corrects=corrects,correction_reason='Correção fictícia de transcrição',
                correction_evidence=self.reading_file,correction_proposed_by=self.inspector,
                correction_proposed_at=self.now)
        reading=self._post_admin(m.ThicknessReading,payload)
        self.assertEqual(reading.requirement_id,self.requirement.pk)
        for purpose,file in [('point',self.point_file),('reading',self.reading_file)]:
            self._post_admin(m.InspectionPhoto,{'company':self.company,'execution':context['execution'],
                'point':self.point,'reading':reading,'file':file,'purpose':purpose,
                'caption':f'Evidência fictícia de {purpose} para {key}',
                'captured_at':self.dates[key],'captured_by':self.inspector})
        self.assertEqual(reading.photos.count(),2)
        return reading

    def _review(self,reading,*,baseline=False,correction=False):
        """Apoio: registra decisão técnica explícita pelo Admin; não é homologação real."""
        return self._post_admin(m.ThicknessReadingReview,{'company':self.company,'reading':reading,
            'sequence':1,'decision':'valid','representative':True,'comparable':True,
            'baseline_approved':baseline,'correction_approved':correction,
            'reviewer':self.engineer,'reviewed_at':self.now,'reason':'Validação fictícia de teste',
            'evidence':self.support_file})

    def _latest(self,reading):
        """Apoio: consulta o cálculo já produzido pelo hook, sem executá-lo manualmente."""
        result=reading.calculations.order_by('-calculated_at','-created_at').first()
        self.assertIsNotNone(result,'O Admin não criou cálculo automaticamente.')
        self.assertEqual(result.procedure_id,self.procedure.pk)
        return result

    def passo_01_autenticar(self):
        """Passo 01: entra como superusuário de demonstração no Admin."""
        self.client.force_login(self.actor)
        self.assertEqual(self.client.get(reverse('admin:index')).status_code,200)

    def passo_02_cadastrar_estrutura(self):
        """Passo 02: cadastra empresa, cliente, unidade, sistema, ativo e componente."""
        self.company=self._post_admin(m.Company,{'name':'Pires - fluxo fictício','active':True})
        customer=self._post_admin(m.Client,{'company':self.company,'name':'Cliente DEMO','active':True})
        unit=self._post_admin(m.Unit,{'company':self.company,'client':customer,'name':'Unidade DEMO','active':True})
        system=self._post_admin(m.System,{'company':self.company,'unit':unit,'name':'Água DEMO','active':True})
        self.asset=self._post_admin(m.Asset,{'company':self.company,'system':system,'tag':'LIN-DEMO-001',
            'asset_type':'Tubulação fictícia','active':True})
        self.component=self._post_admin(m.AssetComponent,{'company':self.company,'asset':self.asset,
            'code':'TRECHO-A','description':'Trecho fictício A','active':True,
            'nominal_thickness':Decimal('12'),'nominal_unit':'mm','nominal_source':'Catálogo fictício; não é a medição inicial'})
        self.customer=customer

    def passo_03_cadastrar_profissionais(self):
        """Passo 03: registra inspetor e engenheiro fictícios, sem afirmar habilitação real."""
        self.inspector=self._post_admin(m.Professional,{'company':self.company,'name':'Inspetor DEMO',
            'job_title':'Inspetor fictício','active':True,'is_training_record':True})
        self.engineer=self._post_admin(m.Professional,{'company':self.company,'name':'Engenheiro DEMO',
            'job_title':'Responsável fictício','active':True,'is_training_record':True})

    def passo_04_cadastrar_procedimento(self):
        """Passo 04: cria uma versão em TESTE, sem aprová-la ou configurar UUID em settings."""
        self.procedure=self._post_admin(m.ThicknessProcedureVersion,{'company':self.company,
            'code':'ME-DEMO','revision':'TESTE-01','scope':'Fluxo fictício de medição','status':'test',
            'days_per_year':365,'rules':{'scenario':'automated-test','days_per_year':365},'applicable_codes':[]})
        self.assertIsNone(self.procedure.approved_at)

    def passo_05_enviar_arquivos(self):
        """Passo 05: envia arquivos de apoio e imagens; vincula o procedimento ao anexo."""
        self.support_file=self._upload('apoio-ficticio.pdf','reference')
        self.drawing_file=self._upload('isometrico-ficticio.png','drawing',image=True)
        self.point_file=self._upload('local-ficticio.png','evidence',image=True)
        self.reading_file=self._upload('leitura-ficticia.png','evidence',image=True)
        self._post_admin(m.ThicknessProcedureVersion,{'evidence':self.support_file,'scope':self.procedure.scope,
            'status':'test','days_per_year':365,'rules':self.procedure.rules,'applicable_codes':[]},obj=self.procedure)

    def passo_06_cadastrar_contrato_projeto(self):
        """Passo 06: cria contrato, projeto e inclusão do ativo no escopo do projeto."""
        contract=self._post_admin(m.Contract,{'company':self.company,'client':self.customer,
            'reference':'C-DEMO','title':'Contrato fictício','responsible_engineer':self.engineer,'active':True})
        self.project=self._post_admin(m.Project,{'company':self.company,'contract':contract,
            'code':'P-DEMO','title':'Projeto fictício','active':True,'scope_version':1,'plan_version':1})
        self.scope=self._post_admin(m.ProjectAsset,{'company':self.company,'project':self.project,
            'asset':self.asset,'module':'integrity','active':True})

    def passo_07_cadastrar_instrumento(self):
        """Passo 07: identifica o instrumento; cada execução terá seu certificado de teste."""
        self.instrument=self._post_admin(m.Instrument,{'company':self.company,'code':'UT-DEMO',
            'instrument_type':'Ultrassom fictício','serial_number':'DEMO-001','active':True})

    def passo_08_cadastrar_ponto_revisao(self):
        """Passo 08: cadastra desenho/revisão e ponto com localização física demonstrativa."""
        drawing=self._post_admin(m.Isometric,{'company':self.company,'asset':self.asset,
            'code':'ISO-DEMO','title':'Desenho fictício'})
        drawing_revision=self._post_admin(m.IsometricRevision,{'company':self.company,'isometric':drawing,
            'revision':'01','file':self.drawing_file,'issued_on':self.dates['initial'].date()})
        self.point=self._post_admin(m.MeasurementPoint,{'company':self.company,'asset':self.asset,
            'component':self.component,'code':'P01','display_name':'Ponto DEMO','active':True})
        self.point_revision=self._post_admin(m.MeasurementPointRevision,{'company':self.company,'point':self.point,
            'revision':1,'isometric_revision':drawing_revision,'sheet':'1','location':'Trecho A, posição fictícia',
            'change_reason':'Cadastro inicial fictício','effective_on':self.dates['initial'].date()})

    def passo_09_cadastrar_posicao(self):
        """Passo 09: identifica a posição angular que será a mesma nas três campanhas."""
        self.position=self._post_admin(m.MeasurementPosition,{'company':self.company,'point':self.point,
            'code':'0G','display_name':'0 graus','angle_degrees':Decimal('0'),
            'orientation_basis':'Referência fictícia','active':True})

    def passo_10_cadastrar_serie_selecionando_procedimento(self):
        """Passo 10: escolhe o procedimento pelo campo da série, sem usar settings."""
        self.series=self._post_admin(m.MeasurementSeries,{'company':self.company,'position':self.position,
            'code':'SERIE-01','started_on':self.dates['initial'].date(),
            'physical_description':'Mesma parede fictícia','start_reason':'Cadastro inicial de teste',
            'procedure':self.procedure,'origin_evidence':self.support_file})
        self.assertEqual(self.series.procedure_id,self.procedure.pk)

    def passo_11_cadastrar_requisito(self):
        """Passo 11: cadastra requisito fictício aprovado de 8 mm, vigente desde a inicial."""
        self.requirement=self._post_admin(m.ThicknessRequirement,{'company':self.company,'asset':self.asset,
            'point':self.point,'position':self.position,'required_thickness':Decimal('8'),'unit':'mm',
            'revision':'TESTE-01','technical_basis':'Limite fictício, sem aplicação operacional',
            'scope_description':'Posição DEMO','applicable_code':'Procedimento fictício de teste',
            'valid_from':self.dates['initial'].date(),'approved_by':self.engineer,
            'approved_at':self.now,'evidence':self.support_file})

    def passo_12_validar_comparabilidade(self):
        """Passo 12: registra equivalência física/método/resolução, com decisão explícita."""
        self._post_admin(m.MeasurementSeriesRevision,{'company':self.company,'series':self.series,
            'point_revision':self.point_revision,'sequence':1,'effective_on':self.dates['initial'].date(),
            'decision':'comparable','method_reference':'UT-DEMO','resolution_mm':Decimal('.01'),
            'service_conditions':{'scenario':'ficticio'},'reason':'Mesmo local físico no cenário fictício',
            'evidence':self.support_file,'reviewed_by':self.engineer,'reviewed_at':self.now})
        self.contexts={}

    def passo_13_programar_execucao_inicial(self):
        """Passo 13: cria campanha/inspeção/execução histórica de 730 dias e instrumento."""
        self.contexts['initial']=self._service_context('initial','INICIAL')

    def passo_14_registrar_leitura_inicial(self):
        """Passo 14: registra 10 mm e fotos; o cálculo nasce pendente antes da validação."""
        self.initial=self._reading('initial','10')
        self.assertEqual(self._latest(self.initial).dimensional,'pending')

    def passo_15_aprovar_referencia_inicial(self):
        """Passo 15: valida os 10 mm e aprova sua utilização como referência inicial."""
        self._review(self.initial,baseline=True)
        result=self._latest(self.initial)
        self.assertEqual(result.margin_mm,Decimal('2'))
        self.assertIsNone(result.life_triage_days)

    def passo_16_programar_execucao_anterior(self):
        """Passo 16: cria uma segunda campanha/inspeção/execução, 365 dias antes da atual."""
        self.contexts['previous']=self._service_context('previous','ANTERIOR')

    def passo_17_registrar_leitura_anterior(self):
        """Passo 17: registra 9,50 mm na mesma posição, mas em outra execução."""
        self.previous=self._reading('previous','9.50')
        self.assertEqual(self._latest(self.previous).dimensional,'pending')

    def passo_18_validar_leitura_anterior(self):
        """Passo 18: valida 9,50 mm; CT/LT usam o mesmo par e projetam 1.095 dias."""
        self._review(self.previous)
        result=self._latest(self.previous)
        self.assertEqual(result.life_triage_days,1095)
        self.assertTrue(result.result_snapshot['same_pair'])

    def passo_19_programar_execucao_atual(self):
        """Passo 19: cria terceira campanha/inspeção/execução na data atual."""
        self.contexts['current']=self._service_context('current','ATUAL')

    def passo_20_registrar_leitura_atual(self):
        """Passo 20: registra 9 mm; não recebe resultado liberado antes de ser validada."""
        self.current=self._reading('current','9')
        result=self._latest(self.current)
        self.assertEqual(result.dimensional,'pending')
        self.assertIsNone(result.margin_mm)

    def passo_21_validar_leitura_atual(self):
        """Passo 21: valida a leitura atual pelo Admin, acionando o recálculo automaticamente."""
        self._review(self.current)
        self.original_calculation=self._latest(self.current)

    def passo_22_conferir_resultado_730_dias(self):
        """Passo 22: confere todas as referências e os resultados do exemplo do engenheiro."""
        result=self.original_calculation
        self.assertEqual(result.initial_reading_id,self.initial.pk)
        self.assertEqual(result.previous_reading_id,self.previous.pk)
        self.assertEqual(result.requirement_id,self.requirement.pk)
        self.assertEqual(result.margin_mm,Decimal('1'))
        self.assertEqual(result.loss_percent,Decimal('10'))
        self.assertEqual(result.short_rate_mm_year,Decimal('.5'))
        self.assertEqual(result.long_rate_mm_year,Decimal('.5'))
        self.assertEqual(result.life_triage_days,730)
        self.assertFalse(result.result_snapshot['same_pair'])
        self.assertEqual(result.result_snapshot['display']['margin_mm'],'1,00')
        self.assertTrue(any(w['code']=='PROCEDURE_TEST' for w in result.warnings))
        self.assertFalse(result.technical_reviews.exists())

    def passo_23_propor_correcao(self):
        """Passo 23: propõe 8,90 mm em nova linha; não apaga nem substitui sem aprovação."""
        self.corrected=self._reading('current','8.90',sequence=2,corrects=self.current)
        self.current.refresh_from_db()
        self.assertEqual(self.current.value,Decimal('9'))
        self.assertFalse(self.corrected.reviews.exists())

    def passo_24_aprovar_correcao(self):
        """Passo 24: aprova formalmente a correção; novo cálculo resulta em 547 dias."""
        self._review(self.corrected,correction=True)
        result=self._latest(self.corrected)
        self.assertEqual(result.margin_mm,Decimal('.9'))
        self.assertEqual(result.short_rate_mm_year,Decimal('.6'))
        self.assertEqual(result.long_rate_mm_year,Decimal('.55'))
        self.assertEqual(result.life_triage_days,547)

    def passo_25_conferir_historico_e_idempotencia(self):
        """Passo 25: prova preservação do original, auditoria e ausência de cálculo duplicado."""
        self.original_calculation.refresh_from_db()
        self.assertEqual(self.original_calculation.life_triage_days,730)
        self.assertEqual(self.original_calculation.result_snapshot['current_mm'],'9')
        self.assertEqual(m.ThicknessReading.objects.count(),4)
        count=m.ThicknessCalculation.objects.count()
        result=calculate_series(series_id=self.series.pk,actor=self.actor)
        self.assertEqual(result['created'],0)
        self.assertEqual(m.ThicknessCalculation.objects.count(),count)
        self.assertTrue(m.AuditEvent.objects.filter(action='thickness.calculated').exists())
        self.assertFalse(m.ThicknessCalculationReview.objects.exists())
        self.assertFalse(m.RTI.objects.exists())
        self.assertIsNone(self.procedure.approved_at)

    def executar_fluxo(self):
        """Orquestrador: executa os 25 passos na ordem; interrompe no primeiro erro."""
        passos=[
            self.passo_01_autenticar,
            self.passo_02_cadastrar_estrutura,
            self.passo_03_cadastrar_profissionais,
            self.passo_04_cadastrar_procedimento,
            self.passo_05_enviar_arquivos,
            self.passo_06_cadastrar_contrato_projeto,
            self.passo_07_cadastrar_instrumento,
            self.passo_08_cadastrar_ponto_revisao,
            self.passo_09_cadastrar_posicao,
            self.passo_10_cadastrar_serie_selecionando_procedimento,
            self.passo_11_cadastrar_requisito,
            self.passo_12_validar_comparabilidade,
            self.passo_13_programar_execucao_inicial,
            self.passo_14_registrar_leitura_inicial,
            self.passo_15_aprovar_referencia_inicial,
            self.passo_16_programar_execucao_anterior,
            self.passo_17_registrar_leitura_anterior,
            self.passo_18_validar_leitura_anterior,
            self.passo_19_programar_execucao_atual,
            self.passo_20_registrar_leitura_atual,
            self.passo_21_validar_leitura_atual,
            self.passo_22_conferir_resultado_730_dias,
            self.passo_23_propor_correcao,
            self.passo_24_aprovar_correcao,
            self.passo_25_conferir_historico_e_idempotencia,
        ]
        for passo in passos:
            passo()
            self.executed_steps.append(passo.__name__)
            print(f'[OK] {passo.__doc__}',flush=True)
        return self.executed_steps

    def test_fluxo_completo_no_admin(self):
        """Teste descoberto pelo Django: chama o orquestrador e exige todos os passos."""
        result=self.executar_fluxo()
        self.assertEqual(len(result),25)
        self.assertEqual(result[-1],'passo_25_conferir_historico_e_idempotencia')
