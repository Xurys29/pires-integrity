"""Fluxos adicionais do Admin: passos comentados e orquestrador por cenário.

Depende de tests/test_fluxo_thickness_admin.py (pacote anterior).
Falhas são regressões/lacunas reais: não são marcadas como sucesso esperado.
"""
from datetime import timedelta
from decimal import Decimal
from fractions import Fraction

from django.db import connection
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import RequestFactory
from django.urls import reverse

from sistema_pires import models as m
from sistema_pires.services.calcs.historico_medicoes import select_requirement
from . import test_fluxo_thickness_admin as anterior


class FluxosModelsAdminTests(anterior.ThicknessAdminWorkflowTest):
    # Reutiliza helpers, sem executar novamente o teste fixo de 730 dias por herança.
    test_fluxo_completo_no_admin = None

    def executar_cenario(self, *passos, preparar_ate=12):
        """Orquestrador: prepara pelo Admin, executa em ordem e para na primeira falha."""
        preparo = sorted(name for name in dir(self) if name.startswith('passo_'))
        for name in preparo[:preparar_ate]:
            passo_preparo = getattr(self, name)
            passo_preparo()
            print(f'[OK] {passo_preparo.__doc__}', flush=True)
        for passo in passos:
            passo()
            print(f'[OK] {passo.__doc__}', flush=True)

    def _form(self, model, data=None, obj=None):
        """Apoio: obtém o mesmo ModelForm usado pelo endpoint do Admin."""
        form = admin.site._registry[model].get_form(self._request(), obj)
        return form(data=data, instance=obj)

    def _invalid_post(self, model, data, *, obj=None, fields=()):
        """Apoio: exige erro de formulário HTTP 200, sem gravar ou gerar auditoria."""
        before = model.objects.count()
        audits = m.AuditEvent.objects.count()
        url = reverse(f'admin:sistema_pires_{model._meta.model_name}_'+('change' if obj else 'add'),
                      args=[obj.pk] if obj else None)
        response = self.client.post(url, data)
        self.assertEqual(response.status_code, 200)
        form = response.context['adminform'].form
        self.assertTrue(form.errors, 'POST rejeitado deve explicar o motivo no formulário.')
        for field in fields:
            self.assertIn(field, form.errors)
        self.assertEqual(model.objects.count(), before)
        self.assertEqual(m.AuditEvent.objects.count(), audits)
        return response

    def _review_event(self, reading, *, decision='valid', baseline=False):
        """Apoio: acrescenta revisão, sem editar o evento de aprovação anterior."""
        last = reading.reviews.order_by('-sequence').first()
        return self._post_admin(m.ThicknessReadingReview, {
            'company': self.company, 'reading': reading,
            'sequence': last.sequence+1 if last else 1, 'decision': decision,
            'representative': decision == 'valid', 'comparable': decision == 'valid',
            'baseline_approved': baseline, 'reviewer': self.engineer,
            'reviewed_at': self.now, 'reason': 'Decisão fictícia de teste',
            'evidence': self.support_file})

    def etapa_empresa_incompativel(self):
        """Passo de bloqueio: POST com unidade de outra empresa não salva o sistema."""
        other = self._post_admin(m.Company, {'name': 'Outra empresa', 'active': True})
        self._invalid_post(m.System, {'company': str(other.pk),
            'unit': str(self.asset.system.unit_id), 'name': 'Vínculo indevido',
            'active': 'on', 'source': '{}'})

    def etapa_posicao_incompativel(self):
        """Passo de bloqueio: formulário rejeita série pertencente a outra posição."""
        position = self._post_admin(m.MeasurementPosition, {
            'company': self.company, 'point': self.point, 'code': '90G', 'active': True})
        self._invalid_post(m.ThicknessReading, {
            'company': str(self.company.pk), 'execution': str(self.contexts['current']['execution'].pk),
            'position': str(position.pk), 'series': str(self.series.pk),
            'point_revision': str(self.point_revision.pk), 'value': '9', 'unit': 'mm',
            'sequence': '1', 'measured_at_0': self.now.date().isoformat(),
            'measured_at_1': self.now.strftime('%H:%M:%S'),
            'measured_by': str(self.inspector.pk), 'origin': 'field', 'source': '{}'})

    def etapa_filtrar_procedimentos(self):
        """Passo de seleção: formulário da série exclui procedimento de outra empresa."""
        other = self._post_admin(m.Company, {'name': 'Empresa externa', 'active': True})
        procedure = self._post_admin(m.ThicknessProcedureVersion, {
            'company': other, 'code': 'EXT', 'revision': '1', 'scope': 'Fictício',
            'status': 'test', 'days_per_year': 365})
        form = self._form(m.MeasurementSeries, obj=self.series)
        self.assertTrue(form.fields['procedure'].queryset.filter(pk=self.procedure.pk).exists())
        self.assertFalse(form.fields['procedure'].queryset.filter(pk=procedure.pk).exists())

    def etapa_filtrar_series_por_posicao(self):
        """Passo de seleção contextual: editar leitura não oferece revisão de outro ponto."""
        # A leitura é imutável: a própria ausência de seletor evita trocar a identidade.
        form = self._form(m.ThicknessReading, obj=self.current)
        for field in ('series', 'position', 'point_revision', 'execution', 'value'):
            self.assertNotIn(field, form.fields)

    def etapa_tentar_aprovacao_sem_evidencia(self):
        """Passo de bloqueio: referência inicial exige evidência de aprovação."""
        self._invalid_post(m.ThicknessReadingReview, {
            'company': str(self.company.pk), 'reading': str(self.current.pk), 'sequence': '1',
            'decision': 'valid', 'representative': 'on', 'comparable': 'on',
            'baseline_approved': 'on', 'reviewer': str(self.engineer.pk),
            'reviewed_at_0': self.now.date().isoformat(),
            'reviewed_at_1': self.now.strftime('%H:%M:%S'), 'reason': 'Sem evidência'},
            fields=('evidence',))
        self.assertEqual(self._latest(self.current).dimensional, 'pending')

    def etapa_exigir_fotos_na_validacao(self):
        """Passo de evidência: validar leitura sem fotos de ponto/leitura deve ser bloqueado."""
        # Remove apenas da preparação do banco de testes; não representa exclusão no Admin.
        m.InspectionPhoto.objects.filter(reading=self.current).delete()
        self._invalid_post(m.ThicknessReadingReview, {
            'company': str(self.company.pk), 'reading': str(self.current.pk), 'sequence': '1',
            'decision': 'valid', 'representative': 'on', 'comparable': 'on',
            'reviewer': str(self.engineer.pk),
            'reviewed_at_0': self.now.date().isoformat(),
            'reviewed_at_1': self.now.strftime('%H:%M:%S'),
            'reason': 'Sem fotos', 'evidence': str(self.support_file.pk)})

    def etapa_programar_atual(self):
        """Passo de preparo: cria execução atual e leitura ainda pendente pelo Admin."""
        self.contexts['current'] = self._service_context('current', 'PENDENTE')
        self.current = self._reading('current', '9')

    def etapa_invalidar_atual(self):
        """Passo de revisão: invalida a leitura e retira seu resultado numérico atual."""
        self.old = self._latest(self.current)
        self._review_event(self.current, decision='invalid')
        new = self._latest(self.current)
        self.assertNotEqual(new.pk, self.old.pk)
        self.assertEqual(new.dimensional, 'pending')
        self.assertIsNone(new.life_triage_days)
        self.assertIsNone(new.margin_mm)
        self.old.refresh_from_db()
        self.assertEqual(self.old.margin_mm, Decimal('1'))

    def etapa_revalidar_atual(self):
        """Passo de revisão: nova validação recompõe o cálculo sem editar revisões antigas."""
        self._review_event(self.current)
        self.assertEqual(self._latest(self.current).margin_mm, Decimal('1'))
        self.assertEqual(self.current.reviews.count(), 3)

    def etapa_invalidar_anterior(self):
        """Passo de dependência: invalidar a anterior recalcula a referência da atual."""
        old = self._latest(self.current)
        self._review_event(self.previous, decision='invalid')
        new = self._latest(self.current)
        self.assertNotEqual(new.pk, old.pk)
        self.assertEqual(new.previous_reading_id, self.initial.pk)
        self.assertNotEqual(new.previous_reading_id, self.previous.pk)
        self.assertEqual(new.initial_reading_id, self.initial.pk)
        self.assertTrue(new.result_snapshot['same_pair'])
        self.assertEqual(old.previous_reading_id, self.previous.pk)

    def etapa_repetir_menor_valida(self):
        """Passo de repetição: leitura menor pendente não substitui; validada passa a governar."""
        smaller = self._reading('current', '8.70', sequence=2)
        group = self.series.calculations.order_by('-calculated_at').first()
        self.assertNotEqual(group.reading_id, smaller.pk)
        self._review_event(smaller)
        result = self._latest(smaller)
        self.assertEqual(result.margin_mm, Decimal('.7'))
        self.assertEqual(result.short_rate_mm_year, Decimal('.8'))
        self.assertEqual(result.life_triage_days, 319)  # floor(365 * 0.7 / 0.8)
        self.assertEqual(self.current.value, Decimal('9'))

    def etapa_registrar_quebra(self):
        """Passo de descontinuidade: decisão não comparável suspende taxas do histórico."""
        self._post_admin(m.MeasurementSeriesRevision, {
            'company': self.company, 'series': self.series, 'point_revision': self.point_revision,
            'sequence': 2, 'effective_on': self.now.date(), 'decision': 'not_comparable',
            'reason': 'Troca de parede fictícia', 'evidence': self.support_file,
            'reviewed_by': self.engineer, 'reviewed_at': self.now,
            'method_reference': 'UT-DEMO', 'resolution_mm': Decimal('.01'),
            'service_conditions': {'scenario': 'ficticio'}})
        result = self._latest(self.current)
        self.assertIsNone(result.short_rate_mm_year)
        self.assertIsNone(result.long_rate_mm_year)
        self.assertIsNone(result.life_triage_days)
        self.assertIn('SERIES_NOT_COMPARABLE', {w['code'] for w in result.warnings})

    def etapa_nova_serie(self):
        """Passo de troca física: nova série vinculada à anterior não herda suas taxas."""
        self.series = self._post_admin(m.MeasurementSeries, {
            'company': self.company, 'position': self.position, 'code': 'PAREDE-NOVA',
            'started_on': self.now.date(), 'physical_description': 'Parede substituída',
            'start_reason': 'Troca fictícia', 'predecessor': self.series,
            'procedure': self.procedure, 'origin_evidence': self.support_file})
        self._post_admin(m.MeasurementSeriesRevision, {
            'company': self.company, 'series': self.series, 'point_revision': self.point_revision,
            'sequence': 1, 'effective_on': self.now.date(), 'decision': 'comparable',
            'reason': 'Nova parede', 'evidence': self.support_file, 'reviewed_by': self.engineer,
            'reviewed_at': self.now, 'method_reference': 'UT-DEMO',
            'resolution_mm': Decimal('.01'), 'service_conditions': {'scenario': 'ficticio'}})
        fresh = self._reading('current', '10', sequence=2)
        self._review_event(fresh, baseline=True)
        result = self._latest(fresh)
        self.assertIsNone(result.previous_reading_id)
        self.assertIsNone(result.initial_reading_id)
        self.assertIsNone(result.life_triage_days)

    def etapa_renomear(self):
        """Passo de identidade: alterar nome de exibição conserva série, leituras e posição."""
        ids = set(self.series.readings.values_list('pk', flat=True))
        self._post_admin(m.MeasurementPoint, {'display_name': 'Nome novo', 'code': self.point.code,
            'active': True}, obj=self.point)
        self.assertEqual(set(self.series.readings.values_list('pk', flat=True)), ids)
        self.assertEqual(self.series.position.point_id, self.point.pk)

    def etapa_conflito_requisitos(self):
        """Passo de requisito: aprova sobreposição no mesmo escopo e exige cálculo pendente."""
        old = self._latest(self.current)
        self._post_admin(m.ThicknessRequirement, {
            'company': self.company, 'asset': self.asset, 'point': self.point,
            'position': self.position, 'required_thickness': '8.2', 'unit': 'mm',
            'revision': 'CONFLITO', 'technical_basis': 'Exemplo de conflito',
            'scope_description': 'Mesmo escopo', 'applicable_code': 'DEMO',
            'valid_from': self.dates['initial'].date(), 'approved_by': self.engineer,
            'approved_at': self.now, 'evidence': self.support_file})
        result = self._latest(self.current)
        self.assertNotEqual(result.pk, old.pk)
        self.assertEqual(result.dimensional, 'pending')
        self.assertIsNone(result.requirement_id)
        self.assertIn('REQUIREMENT_CONFLICT', {w['code'] for w in result.warnings})
        self.assertEqual(old.requirement_id, self.requirement.pk)

    def etapa_prioridade_requisito(self):
        """Passo de escopo: requisito da posição prevalece sem contrariar limite do ativo."""
        self._post_admin(m.ThicknessRequirement, {
            'company': self.company, 'asset': self.asset, 'required_thickness': '7',
            'unit': 'mm', 'revision': 'ATIVO', 'technical_basis': 'Fictício',
            'scope_description': 'Ativo', 'applicable_code': 'DEMO',
            'valid_from': self.dates['initial'].date(), 'approved_by': self.engineer,
            'approved_at': self.now, 'evidence': self.support_file})
        selected, problems, _ = select_requirement(self.position, self.now.date())
        self.assertEqual(selected.pk, self.requirement.pk)
        self.assertEqual(problems, [])

    def etapa_nova_versao_procedimento(self):
        """Passo de versão: trocar procedimento recalcula, preservando snapshot anterior."""
        old = self._latest(self.current)
        replacement = self._post_admin(m.ThicknessProcedureVersion, {
            'company': self.company, 'code': 'ME-DEMO', 'revision': 'TESTE-02',
            'scope': 'Nova revisão fictícia', 'status': 'test', 'days_per_year': 365})
        self._post_admin(m.MeasurementSeries, {'code': self.series.code,
            'started_on': self.series.started_on, 'physical_description': self.series.physical_description,
            'start_reason': self.series.start_reason, 'procedure': replacement}, obj=self.series)
        new = self.current.calculations.order_by('-calculated_at', '-created_at').first()
        self.assertNotEqual(new.pk, old.pk)
        self.assertEqual(new.procedure_id, replacement.pk)
        old.refresh_from_db()
        self.assertEqual(old.procedure_id, self.procedure.pk)
        self.assertEqual(old.input_snapshot['procedure']['revision'], 'TESTE-01')

    def etapa_proteger_historico(self):
        """Passo de proteção: POST adulterado não muda leitura e exclusão retorna 403."""
        url = reverse('admin:sistema_pires_thicknessreading_change', args=[self.current.pk])
        response = self.client.post(url, {'value': '100', 'series': 'inexistente'})
        self.assertIn(response.status_code, (200, 302))
        self.current.refresh_from_db()
        self.assertEqual(self.current.value, Decimal('9'))
        for obj in (self.current, self._latest(self.current), self.current.reviews.first()):
            handler = admin.site._registry[type(obj)]
            self.assertFalse(handler.has_delete_permission(self._request(), obj))
            delete_url = reverse(f'admin:sistema_pires_{obj._meta.model_name}_delete', args=[obj.pk])
            self.assertEqual(self.client.post(delete_url, {'post': 'yes'}).status_code, 403)
        event = self.current.reviews.first()
        change = reverse('admin:sistema_pires_thicknessreadingreview_change', args=[event.pk])
        self.assertEqual(self.client.post(change, {'reason': 'Adulterado'}).status_code, 403)

    def etapa_perfis_bloqueados(self):
        """Passo de acesso: quatro perfis ficam sem escrita enquanto não houver mapeamento."""
        for role in ('manager', 'engineer', 'assistant', 'inspector'):
            with self.subTest(perfil=role):
                user = get_user_model().objects.create_user(username=f'teste_{role}', is_staff=True)
                m.CompanyMembership.objects.create(company=self.company, user=user, role=role, access_state='active')
                # Papéis operacionais não estão homologados: verifica o bloqueio atual,
                # não inventa quais operações cada perfil deveria poder executar.
                req = RequestFactory().get('/admin/'); req.user = user
                for model in (m.ThicknessReading, m.ThicknessReadingReview, m.ThicknessCalculationReview):
                    handler = admin.site._registry[model]
                    self.assertFalse(handler.has_add_permission(req))
                    self.assertFalse(handler.has_change_permission(req))
                self.client.force_login(user)
                self.assertEqual(self.client.post(reverse('admin:sistema_pires_thicknessreading_add'), {}).status_code, 403)
                self.assertEqual(set(admin.site._registry[m.Asset].get_queryset(req).values_list('company_id', flat=True)), {self.company.pk})
        self.client.force_login(self.actor)

    def etapa_sem_aprovacao_automatica(self):
        """Passo de conclusão: resultado numérico não cria aprovação, RTI ou documento."""
        result = self._latest(self.current)
        self.assertIsNotNone(result.margin_mm)
        self.assertFalse(result.technical_reviews.exists())
        self.assertFalse(m.RTI.objects.exists())
        self.assertFalse(m.DocumentRevision.objects.exists())
        form = self._form(m.DocumentRevision)
        for field in ('issued_at', 'approved_at', 'status', 'calculation_snapshot'):
            self.assertNotIn(field, form.fields)

    def etapa_inline_atomico(self):
        """Passo de formulário: filho inválido impede salvar pai; correção salva ambos."""
        data = {'company': str(self.company.pk), 'name': 'Pai e filho', 'active': 'on', 'source': '{}',
            'units-TOTAL_FORMS': '1', 'units-INITIAL_FORMS': '0',
            'units-MIN_NUM_FORMS': '0', 'units-MAX_NUM_FORMS': '1000',
            'units-0-location': 'Local', 'units-0-active': 'on',
            'contracts-TOTAL_FORMS': '0', 'contracts-INITIAL_FORMS': '0',
            'contracts-MIN_NUM_FORMS': '0', 'contracts-MAX_NUM_FORMS': '1000'}
        before = m.Client.objects.count()
        response = self.client.post(reverse('admin:sistema_pires_client_add'), data)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(m.Client.objects.count(), before)
        self.assertTrue(any(fs.formset.errors for fs in response.context['inline_admin_formsets']))
        data['units-0-name'] = 'Filho válido'
        self.assertEqual(self.client.post(reverse('admin:sistema_pires_client_add'), data).status_code, 302)
        parent = m.Client.objects.get(name='Pai e filho')
        child = m.Unit.objects.get(client=parent)
        self.assertEqual(child.company_id, parent.company_id)
        self.assertEqual(child.created_by_id, self.actor.pk)

    def test_relacoes_e_seletores(self):
        """Orquestra incompatibilidades e filtro de procedimento."""
        self.executar_cenario(self.etapa_empresa_incompativel, self.etapa_filtrar_procedimentos,
                             self.etapa_programar_atual, self.etapa_posicao_incompativel,
                             self.etapa_filtrar_series_por_posicao)

    def test_aprovacao_exige_evidencia(self):
        """Orquestra tentativa de aprovar referência inicial sem evidência."""
        self.executar_cenario(self.etapa_programar_atual, self.etapa_tentar_aprovacao_sem_evidencia)

    def test_validacao_exige_fotos(self):
        """Orquestra bloqueio esperado para validação sem fotos obrigatórias."""
        self.executar_cenario(self.etapa_programar_atual, self.etapa_exigir_fotos_na_validacao)

    def test_invalidacao_e_revalidacao(self):
        """Orquestra validação, invalidação e nova validação sem sobrescrever eventos."""
        self.executar_cenario(self.etapa_invalidar_atual, self.etapa_revalidar_atual, preparar_ate=21)

    def test_recalculo_dependencias(self):
        """Orquestra mudança na referência usada por cálculo posterior."""
        self.executar_cenario(self.etapa_invalidar_anterior, preparar_ate=21)

    def test_repeticoes(self):
        """Orquestra seleção de mínimo válido, sem média ou descarte de dados."""
        self.executar_cenario(self.etapa_repetir_menor_valida, preparar_ate=21)

    def test_quebra_comparabilidade(self):
        """Orquestra interrupção de taxas após quebra documentada."""
        self.executar_cenario(self.etapa_registrar_quebra, preparar_ate=21)

    def test_nova_serie(self):
        """Orquestra início de histórico para nova parede."""
        self.executar_cenario(self.etapa_nova_serie, preparar_ate=21)

    def test_renomeacao(self):
        """Orquestra renomeação sem ruptura da identidade física."""
        self.executar_cenario(self.etapa_renomear, preparar_ate=21)

    def test_requisitos_conflitantes(self):
        """Orquestra sobreposição e recálculo pendente."""
        self.executar_cenario(self.etapa_conflito_requisitos, preparar_ate=21)

    def test_prioridade_requisitos(self):
        """Orquestra requisito geral e específico compatíveis."""
        self.executar_cenario(self.etapa_prioridade_requisito)

    def test_versao_procedimento(self):
        """Orquestra troca de versão e preservação do resultado anterior."""
        self.executar_cenario(self.etapa_nova_versao_procedimento, preparar_ate=21)

    def test_historico_protegido(self):
        """Orquestra adulteração, edição de revisão e tentativa de exclusão."""
        self.executar_cenario(self.etapa_proteger_historico, preparar_ate=21)

    def test_acesso_atual(self):
        """Orquestra bloqueio de escrita de quatro perfis com vínculo ativo, ainda sem mapeamento operacional."""
        self.executar_cenario(self.etapa_perfis_bloqueados)

    def test_conclusao_nao_automatica(self):
        """Orquestra separação entre cálculo e conclusão/emissão."""
        self.executar_cenario(self.etapa_sem_aprovacao_automatica, preparar_ate=21)

    def test_inline_atomico(self):
        """Orquestra erro de filho e reenvio válido do cadastro composto."""
        self.executar_cenario(self.etapa_inline_atomico)

    def _cenario_numerico(self, initial, previous, current, elapsed_initial, elapsed_previous):
        """Apoio: três campanhas com dados variáveis; oráculo independente usa Fraction."""
        self.dates['initial'] = self.now-timedelta(days=elapsed_initial)
        self.dates['previous'] = self.now-timedelta(days=elapsed_previous)
        for key, value in [('initial', initial), ('previous', previous), ('current', current)]:
            self.contexts[key] = self._service_context(key, key.upper())
            reading = self._reading(key, value)
            self._review_event(reading, baseline=key == 'initial')
            if key == 'current':
                self.current = reading
        result = self._latest(self.current)
        a, b, c = map(Fraction, (initial, previous, current))
        margin = c-Fraction(8)
        short = (b-c)*365/elapsed_previous
        long = (a-c)*365/elapsed_initial
        # Oráculo não importa nem chama a fórmula do motor da aplicação.
        self.assertEqual(Fraction(result.margin_mm), margin)
        from decimal import ROUND_HALF_UP, localcontext
        for field, expected in [('short_rate_mm_year', short), ('long_rate_mm_year', long)]:
            with localcontext() as ctx:
                ctx.prec = 100
                projection = (Decimal(expected.numerator)/Decimal(expected.denominator)).quantize(
                    Decimal('0.000000000000001'), rounding=ROUND_HALF_UP)
            exact = result.result_snapshot['exact'][field]
            self.assertEqual(Fraction(int(exact['numerator']), int(exact['denominator'])), expected)
            if connection.vendor == 'sqlite':
                # SQLite armazena NUMERIC em ponto flutuante. O snapshot racional
                # continua exigido exatamente; tolerância só na coluna de consulta.
                self.assertAlmostEqual(getattr(result, field), projection,
                    delta=max(abs(projection)*Decimal('1e-14'), Decimal('1e-15')))
            else:
                self.assertEqual(getattr(result, field), projection)
        positive = [rate for rate in (short, long) if rate > 0]
        if margin > 0 and positive:
            exact_days = 365*margin/max(positive)
            self.assertEqual(result.life_triage_days, exact_days.numerator//exact_days.denominator)
        else:
            self.assertIsNone(result.life_triage_days)
        self.assertEqual(result.dimensional, 'above' if margin > 0 else 'limit' if margin == 0 else 'below')
        self.assertFalse(result.technical_reviews.exists())

    def etapa_taxas_distintas(self):
        """Passo numérico: intervalos de 700/103 dias e taxas diferentes das do exemplo."""
        self._cenario_numerico('12.43', '11.17', '10.29', 700, 103)

    def etapa_intervalos_irregulares(self):
        """Passo numérico: intervalos de 389/47 dias e perda pequena com precisão integral."""
        self._cenario_numerico('9.72', '9.31', '9.27', 389, 47)

    def etapa_taxa_zero(self):
        """Passo numérico: espessura estável não divide por zero nem projeta infinito."""
        self._cenario_numerico('10.3', '10.3', '10.3', 510, 89)

    def etapa_no_limite(self):
        """Passo numérico: atual igual à requerida tem saldo zero e nenhuma vida futura."""
        self._cenario_numerico('10.1', '9.2', '8', 612, 204)

    def etapa_abaixo_limite(self):
        """Passo numérico: atual abaixo da requerida não recebe projeção de vida futura."""
        self._cenario_numerico('10.2', '9.1', '7.93', 601, 117)

    def test_numerico_taxas_distintas(self):
        """Orquestra dados variáveis e compara com cálculo racional independente."""
        self.executar_cenario(self.etapa_taxas_distintas)

    def test_numerico_intervalos_irregulares(self):
        """Orquestra campanhas em intervalos reais diferentes de um ano."""
        self.executar_cenario(self.etapa_intervalos_irregulares)

    def test_numerico_taxa_zero(self):
        """Orquestra estabilidade de espessura pelo Admin."""
        self.executar_cenario(self.etapa_taxa_zero)

    def test_numerico_no_limite(self):
        """Orquestra leitura exatamente no requisito."""
        self.executar_cenario(self.etapa_no_limite)

    def test_numerico_abaixo_limite(self):
        """Orquestra leitura abaixo do requisito."""
        self.executar_cenario(self.etapa_abaixo_limite)

    def etapa_seletor_contextual(self):
        """Passo de usabilidade: seletor de série não oferece série de outra posição."""
        other_position = self._post_admin(m.MeasurementPosition, {
            'company': self.company, 'point': self.point, 'code': '180G', 'active': True})
        other_series = self._post_admin(m.MeasurementSeries, {
            'company': self.company, 'position': other_position, 'code': 'OUTRA-POSICAO',
            'started_on': self.dates['initial'].date(), 'physical_description': 'Outra posição',
            'start_reason': 'Fictício', 'procedure': self.procedure})
        draft = m.ThicknessReading(company=self.company, position=self.position)
        formclass = admin.site._registry[m.ThicknessReading].get_form(self._request())
        form = formclass(instance=draft)
        self.assertTrue(form.fields['series'].queryset.filter(pk=self.series.pk).exists())
        self.assertFalse(form.fields['series'].queryset.filter(pk=other_series.pk).exists(),
                         'O salvamento bloqueia incompatibilidades, mas o seletor ainda oferece série de outra posição.')

    def test_seletor_series_contextual(self):
        """Orquestra seleção contextual, distinta da validação ao salvar."""
        self.executar_cenario(self.etapa_seletor_contextual)

    def etapa_requisito_ausente(self):
        """Passo de ausência: posição sem requisito não recebe saldo ou vida automática."""
        # A preparação encerra antes do cadastro do requisito (passo 11).
        self.contexts = {}
        self.contexts['current'] = self._service_context('current', 'SEM-REQUISITO')
        reading = self._post_admin(m.ThicknessReading, {
            'company': self.company, 'execution': self.contexts['current']['execution'],
            'position': self.position, 'series': self.series, 'point_revision': self.point_revision,
            'value': '9', 'unit': 'mm', 'sequence': 1, 'measured_at': self.now,
            'measured_by': self.inspector, 'origin': 'field'})
        self._review_event(reading)
        result = self._latest(reading)
        self.assertEqual(result.dimensional, 'pending')
        self.assertIsNone(result.requirement_id)
        self.assertIsNone(result.margin_mm)
        self.assertIsNone(result.life_triage_days)
        self.assertIn('REQUIREMENT_PENDING', {w['code'] for w in result.warnings})

    def test_requisito_ausente(self):
        """Orquestra cálculo pendente por ausência de espessura requerida."""
        self.executar_cenario(self.etapa_requisito_ausente, preparar_ate=10)

    def etapa_retorno_vinculado(self):
        """Passo de retorno: complementação preserva inspeção e execução originais."""
        inspection = self.contexts['current']['inspection']
        original = self.contexts['current']['execution']
        followup = self._post_admin(m.InspectionExecution, {
            'company': self.company, 'inspection': inspection, 'sequence': 2,
            'kind': 'return', 'observed_at': self.now, 'inspector': self.inspector,
            'status': 'in_progress'})
        self.assertEqual(followup.inspection_id, original.inspection_id)
        self.assertNotEqual(followup.pk, original.pk)
        self.assertEqual(inspection.executions.count(), 2)
        original.refresh_from_db()
        self.assertEqual(original.kind, 'initial')
        inspection.refresh_from_db()
        self.assertEqual(inspection.status, 'in_progress')

    def test_retorno(self):
        """Orquestra retorno vinculado à mesma inspeção."""
        self.executar_cenario(self.etapa_programar_atual, self.etapa_retorno_vinculado)

    def etapa_requisito_expirado(self):
        """Passo de vigência: requisito expirado não pode governar medição atual."""
        self._post_admin(m.ThicknessRequirement, {
            'company': self.company, 'asset': self.asset, 'point': self.point,
            'position': self.position, 'required_thickness': '8', 'unit': 'mm',
            'revision': 'EXPIRADO', 'technical_basis': 'Exemplo fictício',
            'scope_description': 'Posição', 'applicable_code': 'DEMO',
            'valid_from': self.dates['initial'].date(),
            'valid_until': self.now.date()-timedelta(days=1),
            'approved_by': self.engineer, 'approved_at': self.now, 'evidence': self.support_file})
        selected, warnings, _ = select_requirement(self.position, self.now.date())
        self.assertIsNone(selected)
        self.assertIn('REQUIREMENT_PENDING', {w['code'] for w in warnings})

    def test_requisito_expirado(self):
        """Orquestra requisito expirado e cálculo atual pendente."""
        self.executar_cenario(self.etapa_requisito_expirado, self.etapa_requisito_ausente,
                             preparar_ate=10)

    def etapa_limite_geral_mais_restritivo(self):
        """Passo de conflito: requisito específico não reduz limite aplicável do ativo."""
        self._post_admin(m.ThicknessRequirement, {
            'company': self.company, 'asset': self.asset, 'required_thickness': '8.5',
            'unit': 'mm', 'revision': 'GERAL-RESTRITIVO', 'technical_basis': 'Fictício',
            'scope_description': 'Ativo', 'applicable_code': 'DEMO',
            'valid_from': self.dates['initial'].date(), 'approved_by': self.engineer,
            'approved_at': self.now, 'evidence': self.support_file})
        selected, warnings, _ = select_requirement(self.position, self.now.date())
        self.assertIsNone(selected)
        self.assertIn('REQUIREMENT_LIMIT_CONFLICT', {w['code'] for w in warnings})
        result = self._latest(self.current)
        self.assertEqual(result.dimensional, 'pending')
        self.assertIsNone(result.life_triage_days)

    def test_limite_mais_restritivo(self):
        """Orquestra conflito entre requisito da posição e limite do ativo."""
        self.executar_cenario(self.etapa_limite_geral_mais_restritivo, preparar_ate=21)
