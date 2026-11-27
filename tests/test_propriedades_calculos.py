"""Validação matemática gerada, reproduzível e independente do banco.

Não requer Hypothesis. Semente fixa mantém as falhas reproduzíveis.
A classe segue passos comentados e um orquestrador, sem usar o motor como oráculo.
"""
import random
from datetime import date, datetime, timedelta
from decimal import Decimal, localcontext
from fractions import Fraction
from django.test import SimpleTestCase
from sistema_pires.services.calcs.calculos_espessura import ReadingValue, calculate_thickness


class PropriedadesCalculosTests(SimpleTestCase):
    SEED = 27112026
    AMOSTRAS = 1000
    DIA = date(2026, 11, 27)

    def setUp(self):
        """Preparo: gerador local, semente fixa e contagem das verificações geradas."""
        self.rng = random.Random(self.SEED)
        self.cenarios = 0

    def _decimal(self, numerator, divisor=10000):
        """Apoio: produz entradas decimais sem introduzir float."""
        return Decimal(numerator)/Decimal(divisor)

    def _ler(self, value, days=0, unit='mm', identifier=''):
        """Apoio: representa leitura com data civil e identificação explícita."""
        return ReadingValue(value, self.DIA-timedelta(days=days), unit, identifier)

    def _exato(self, result, field):
        """Apoio: recupera a fração registrada no snapshot; não calcula resultado esperado."""
        value = result['exact'][field]
        return None if value is None else Fraction(int(value['numerator']), int(value['denominator']))

    def _entrada(self):
        """Apoio: amostra espessuras positivas e dias dentro do domínio do teste."""
        return (self._decimal(self.rng.randint(1, 1000000)),
                self._decimal(self.rng.randint(1, 1000000)),
                self._decimal(self.rng.randint(1, 1000000)),
                self._decimal(self.rng.randint(1, 1000000)),
                self.rng.randint(1, 10000), self.rng.randint(1, 10000))

    def passo_01_oraculo_independente(self):
        """Passo 01: 1.000 conjuntos, incluindo perda/ganho, contra aritmética Decimal independente."""
        for index in range(self.AMOSTRAS):
            a, b, c, req, short_days, extra_days = self._entrada()
            long_days = short_days+extra_days
            with self.subTest(passo=1, amostra=index, inicial=a, anterior=b, atual=c,
                              requerida=req, dias_curta=short_days, dias_longa=long_days):
                result = calculate_thickness(current=self._ler(c), previous=self._ler(b, short_days, identifier='p'),
                    initial=self._ler(a, long_days, identifier='i'), required=req)
                with localcontext() as ctx:
                    ctx.prec = 100
                    expected = {'margin_mm': c-req, 'loss_percent': (a-c)*100/a,
                        'short_rate_mm_year': (b-c)*365/short_days,
                        'long_rate_mm_year': (a-c)*365/long_days}
                    for field, target in expected.items():
                        # O motor escreve 60 algarismos significativos; o oráculo usa 100.
                        tolerance = max(abs(target), Decimal(1))*Decimal('1e-58')
                        self.assertLessEqual(abs(Decimal(result[field])-target), tolerance)
                short_exact = (Fraction(b)-Fraction(c))*365/short_days
                long_exact = (Fraction(a)-Fraction(c))*365/long_days
                self.assertEqual(self._exato(result, 'short_rate_mm_year'), short_exact)
                self.assertEqual(self._exato(result, 'long_rate_mm_year'), long_exact)
                positives = [rate for rate in (short_exact, long_exact) if rate > 0]
                conservative = max(positives) if positives else None
                self.assertEqual(self._exato(result, 'triage_rate_mm_year'), conservative)
                # Piso da vida verificado como intervalo exato, sem repetir a função life().
                for rate_field, life_field in [('short_rate_mm_year', 'life_short_days'),
                        ('long_rate_mm_year', 'life_long_days'), ('triage_rate_mm_year', 'life_triage_days')]:
                    rate = self._exato(result, rate_field)
                    life = result[life_field]
                    margin = Fraction(c)-Fraction(req)
                    if rate is not None and rate > 0 and margin > 0:
                        self.assertIsInstance(life, int)
                        self.assertLessEqual(life*rate, 365*margin)
                        self.assertGreater((life+1)*rate, 365*margin)
                    else:
                        self.assertIsNone(life)
                self.assertEqual(result['dimensional'], 'above' if c > req else 'below' if c < req else 'limit')
                self.assertIsNone(result['adopted_rate_mm_year'])
                self.cenarios += 1

    def passo_02_escala(self):
        """Passo 02: 1.000 escalas positivas preservam perda percentual e vida, escalando saldo/taxas."""
        for index in range(self.AMOSTRAS):
            a, b, c, req, ds, extra = self._entrada()
            factor = Decimal(self.rng.randint(1, 100))
            first = calculate_thickness(current=self._ler(c), previous=self._ler(b, ds),
                initial=self._ler(a, ds+extra), required=req)
            scaled = calculate_thickness(current=self._ler(c*factor), previous=self._ler(b*factor, ds),
                initial=self._ler(a*factor, ds+extra), required=req*factor)
            with self.subTest(passo=2, amostra=index, fator=factor):
                self.assertEqual(first['dimensional'], scaled['dimensional'])
                self.assertEqual(first['life_triage_days'], scaled['life_triage_days'])
                self.assertEqual(self._exato(first, 'loss_percent'), self._exato(scaled, 'loss_percent'))
                for field in ('margin_mm', 'short_rate_mm_year', 'long_rate_mm_year'):
                    self.assertEqual(self._exato(scaled, field), self._exato(first, field)*Fraction(factor))
                self.cenarios += 1

    def passo_03_intervalos(self):
        """Passo 03: dobrar dias reduz taxas à metade e duplica a vida exata antes do piso."""
        for index in range(self.AMOSTRAS):
            c = self._decimal(self.rng.randint(20000, 900000))
            loss = self._decimal(self.rng.randint(1, 20000))
            days = self.rng.randint(1, 5000)
            first = calculate_thickness(current=self._ler(c), previous=self._ler(c+loss, days), required=c/2)
            doubled = calculate_thickness(current=self._ler(c), previous=self._ler(c+loss, days*2), required=c/2)
            with self.subTest(passo=3, amostra=index):
                self.assertEqual(self._exato(doubled, 'short_rate_mm_year')*2,
                                 self._exato(first, 'short_rate_mm_year'))
                self.assertIn(doubled['life_short_days'], (2*first['life_short_days'], 2*first['life_short_days']+1))
                self.cenarios += 1

    def passo_04_monotonicidade(self):
        """Passo 04: taxa maior reduz vida; saldo maior aumenta vida, admitindo empate pelo piso."""
        for index in range(self.AMOSTRAS):
            c = self._decimal(self.rng.randint(20000, 900000))
            loss = self._decimal(self.rng.randint(1, 50000))
            days = self.rng.randint(1, 5000)
            normal = calculate_thickness(current=self._ler(c), previous=self._ler(c+loss, days), required=c/2)
            faster = calculate_thickness(current=self._ler(c), previous=self._ler(c+2*loss, days), required=c/2)
            more_margin = calculate_thickness(current=self._ler(c), previous=self._ler(c+loss, days), required=c/4)
            with self.subTest(passo=4, amostra=index):
                self.assertLessEqual(faster['life_triage_days'], normal['life_triage_days'])
                self.assertGreaterEqual(more_margin['life_triage_days'], normal['life_triage_days'])
                self.cenarios += 1

    def passo_05_unidades(self):
        """Passo 05: 1.000 conjuntos equivalentes em polegadas e milímetros produzem resultados iguais."""
        for index in range(self.AMOSTRAS):
            a, b, c, req, ds, extra = self._entrada()
            inch = calculate_thickness(current=self._ler(c, unit='in'), previous=self._ler(b, ds, 'in'),
                initial=self._ler(a, ds+extra, 'in'), required=req, required_unit='in')
            mm = calculate_thickness(current=self._ler(c*Decimal('25.4')),
                previous=self._ler(b*Decimal('25.4'), ds), initial=self._ler(a*Decimal('25.4'), ds+extra),
                required=req*Decimal('25.4'))
            with self.subTest(passo=5, amostra=index):
                self.assertEqual(inch['exact'], mm['exact'])
                self.assertEqual(inch['life_triage_days'], mm['life_triage_days'])
                self.assertEqual(inch['dimensional'], mm['dimensional'])
                self.cenarios += 1

    def passo_06_ausencias_e_limites(self):
        """Passo 06: 1.000 espessuras sem histórico/requisito, estáveis, no limite e abaixo."""
        for index in range(self.AMOSTRAS):
            c = self._decimal(self.rng.randint(20000, 900000))
            with self.subTest(passo=6, amostra=index):
                no_history = calculate_thickness(current=self._ler(c), required=c/2)
                self.assertEqual(no_history['trend'], 'insufficient')
                self.assertIsNone(no_history['life_triage_days'])
                missing = calculate_thickness(current=self._ler(c), previous=self._ler(c+1, 130))
                self.assertEqual(missing['dimensional'], 'pending')
                self.assertIsNone(missing['margin_mm'])
                self.assertIsNone(missing['life_triage_days'])
                stable = calculate_thickness(current=self._ler(c), previous=self._ler(c, 130), required=c/2)
                self.assertEqual(stable['trend'], 'zero')
                self.assertIsNone(stable['life_triage_days'])
                for req, classification in ((c, 'limit'), (c+Decimal('.00001'), 'below')):
                    result = calculate_thickness(current=self._ler(c), previous=self._ler(c+1, 130), required=req)
                    self.assertEqual(result['dimensional'], classification)
                    self.assertIsNone(result['life_triage_days'])
                self.cenarios += 1

    def passo_07_taxas_mistas(self):
        """Passo 07: taxa negativa não é invertida; triagem usa só positiva e exige revisão."""
        for index in range(self.AMOSTRAS):
            c = self._decimal(self.rng.randint(20000, 900000))
            result = calculate_thickness(current=self._ler(c), previous=self._ler(c-Decimal('.1'), 73),
                initial=self._ler(c+Decimal('.2'), 511), required=c/2)
            with self.subTest(passo=7, amostra=index):
                self.assertLess(self._exato(result, 'short_rate_mm_year'), 0)
                self.assertGreater(self._exato(result, 'long_rate_mm_year'), 0)
                self.assertEqual(result['triage_sources'], ['long'])
                self.assertEqual(result['trend'], 'review')
                self.assertIsNone(result['life_short_days'])
                self.assertIsNone(result['adopted_rate_mm_year'])
                self.cenarios += 1

    def passo_08_entradas_invalidas(self):
        """Passo 08: rejeita valores não finitos/positivos, float, unidade e datas inválidas."""
        for bad in (Decimal('NaN'), Decimal('Infinity'), Decimal('-Infinity'), Decimal(0), Decimal(-1), 9.0):
            with self.subTest(valor=str(bad)), self.assertRaises(ValueError):
                self._ler(bad)
        for bad_day in (datetime(2026, 11, 27), '2026-11-27', None):
            with self.subTest(data=str(bad_day)), self.assertRaises(ValueError):
                ReadingValue(Decimal(9), bad_day)
        with self.assertRaises(ValueError):
            self._ler(Decimal(9), unit='cm')
        for invalid_required in (Decimal('NaN'), Decimal('Infinity'), Decimal(0), Decimal(-1), 8.0):
            with self.subTest(requerida=str(invalid_required)), self.assertRaises(ValueError):
                calculate_thickness(current=self._ler(Decimal(9)), required=invalid_required)
        with self.assertRaises(ValueError):
            calculate_thickness(current=self._ler(Decimal(9)), required=Decimal(8), required_unit='cm')
        with self.assertRaises(ValueError):
            calculate_thickness(current=Decimal(9))
        for delta in (0, -1):
            with self.subTest(dias=delta), self.assertRaises(ValueError):
                calculate_thickness(current=self._ler(Decimal(9)), previous=self._ler(Decimal(10), delta))
        with self.assertRaises(ValueError):
            calculate_thickness(current=self._ler(Decimal(9)),
                previous=self._ler(Decimal(10), 365), initial=self._ler(Decimal(11), 30))

    def executar_validacao(self):
        """Orquestrador: executa oito grupos em ordem e relata grupos concluídos."""
        passos = [self.passo_01_oraculo_independente, self.passo_02_escala,
            self.passo_03_intervalos, self.passo_04_monotonicidade, self.passo_05_unidades,
            self.passo_06_ausencias_e_limites, self.passo_07_taxas_mistas, self.passo_08_entradas_invalidas]
        for passo in passos:
            passo()
            print(f'[OK] {passo.__doc__}', flush=True)
        print(f'[OK] {self.cenarios} cenários gerados; semente={self.SEED}', flush=True)

    def test_propriedades_e_formulas(self):
        """Executa a validação matemática gerada sem depender de dados de um cliente."""
        self.executar_validacao()
        self.assertEqual(self.cenarios, 7*self.AMOSTRAS)
