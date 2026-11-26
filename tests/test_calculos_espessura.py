from datetime import date, timedelta, datetime
from decimal import Decimal
from django.test import SimpleTestCase
from sistema_pires.services.calcs.calculos_espessura import ReadingValue, calculate_thickness, format_number


class ThicknessMathTests(SimpleTestCase):
    day=date(2026,11,26)

    def reading(self,value,days=0,unit='mm',identifier=''):
        return ReadingValue(Decimal(value),self.day-timedelta(days=days),unit,identifier)

    def test_engineer_example_730_days(self):
        r=calculate_thickness(current=self.reading('9'),previous=self.reading('9.5',365),initial=self.reading('10',730),required=Decimal('8'))
        self.assertEqual(Decimal(r['margin_mm']),Decimal('1'))
        self.assertEqual(Decimal(r['loss_percent']),Decimal('10'))
        self.assertEqual(Decimal(r['short_rate_mm_year']),Decimal('.5'))
        self.assertEqual(Decimal(r['long_rate_mm_year']),Decimal('.5'))
        self.assertEqual(r['life_triage_days'],730)
        self.assertIsNone(r['adopted_rate_mm_year'])

    def test_same_pair_is_explicit(self):
        ref=self.reading('10',365,identifier='ref')
        r=calculate_thickness(current=self.reading('9'),previous=ref,initial=ref,required=Decimal('8'))
        self.assertTrue(r['same_pair'])
        self.assertTrue(r['notes'])

    def test_equal_rates_with_different_pairs_not_same_pair(self):
        r=calculate_thickness(current=self.reading('9'),previous=self.reading('9.5',365,identifier='p'),initial=self.reading('10',730,identifier='i'),required=Decimal('8'))
        self.assertFalse(r['same_pair'])

    def test_zero_rate_not_infinite(self):
        r=calculate_thickness(current=self.reading('9'),previous=self.reading('9',365),required=Decimal('8'))
        self.assertEqual(r['trend'],'zero')
        self.assertIsNone(r['life_short_days'])

    def test_negative_rate_preserved(self):
        r=calculate_thickness(current=self.reading('9'),previous=self.reading('8.5',365),required=Decimal('8'))
        self.assertEqual(Decimal(r['short_rate_mm_year']),Decimal('-.5'))
        self.assertEqual(r['trend'],'review')
        self.assertIsNone(r['life_short_days'])

    def test_negative_loss_preserved(self):
        r=calculate_thickness(current=self.reading('9'),initial=self.reading('8',365))
        self.assertLess(Decimal(r['loss_percent']),0)

    def test_most_conservative_positive_rate(self):
        r=calculate_thickness(current=self.reading('9'),previous=self.reading('10',365),initial=self.reading('10',730),required=Decimal('8'))
        self.assertEqual(Decimal(r['triage_rate_mm_year']),1)
        self.assertEqual(r['life_triage_days'],365)
        self.assertEqual(r['triage_sources'],['short'])

    def test_limit_has_no_future_life(self):
        r=calculate_thickness(current=self.reading('8'),previous=self.reading('9',365),required=Decimal('8'))
        self.assertEqual(r['dimensional'],'limit')
        self.assertIsNone(r['life_triage_days'])

    def test_below_required_is_critical(self):
        r=calculate_thickness(current=self.reading('7.99'),required=Decimal('8'))
        self.assertEqual(r['dimensional'],'below')
        self.assertIn('BELOW_REQUIRED',[w['code'] for w in r['warnings']])

    def test_unrounded_dimension_controls_classification(self):
        r=calculate_thickness(current=self.reading('7.99999'),required=Decimal('8'))
        self.assertEqual(r['display']['current_mm'],'8,00')
        self.assertEqual(r['dimensional'],'below')

    def test_no_history_returns_null_not_zero(self):
        r=calculate_thickness(current=self.reading('9'),required=Decimal('8'))
        self.assertEqual(r['trend'],'insufficient')
        self.assertIsNone(r['short_rate_mm_year'])
        self.assertIsNone(r['life_triage_days'])

    def test_no_requirement_keeps_rates_but_not_life(self):
        r=calculate_thickness(current=self.reading('9'),previous=self.reading('10',365))
        self.assertEqual(r['dimensional'],'pending')
        self.assertEqual(Decimal(r['short_rate_mm_year']),1)
        self.assertIsNone(r['life_triage_days'])

    def test_same_day_is_rejected(self):
        with self.assertRaises(ValueError): calculate_thickness(current=self.reading('9'),previous=self.reading('10'))

    def test_future_reference_rejected(self):
        with self.assertRaises(ValueError): calculate_thickness(current=self.reading('9'),previous=self.reading('10',-1))

    def test_baseline_cannot_follow_previous(self):
        with self.assertRaises(ValueError): calculate_thickness(current=self.reading('9'),previous=self.reading('10',365),initial=self.reading('10',30))

    def test_inch_conversion_exact(self):
        r=calculate_thickness(current=self.reading('1',unit='in'),required=Decimal('25.4'))
        self.assertEqual(r['dimensional'],'limit')
        self.assertEqual(Decimal(r['current_mm']),Decimal('25.4'))

    def test_actual_leap_interval_used(self):
        r=calculate_thickness(current=ReadingValue(Decimal('9'),date(2024,3,1)),previous=ReadingValue(Decimal('10'),date(2023,3,1)))
        self.assertEqual(r['short_interval_days'],366)
        self.assertEqual(r['exact']['short_rate_mm_year'],{'numerator':'365','denominator':'366'})

    def test_floor_life_without_rate_rounding(self):
        r=calculate_thickness(current=self.reading('9'),previous=self.reading('12',100),required=Decimal('8'))
        self.assertEqual(r['life_short_days'],33)

    def test_small_positive_rate_display(self):
        self.assertIn('+<0,001',format_number('0.00001',3))

    def test_small_negative_rate_display(self):
        self.assertIn('-<0,001',format_number('-0.00001',3))

    def test_float_input_rejected(self):
        with self.assertRaises(ValueError): ReadingValue(9.0,self.day)

    def test_nonfinite_rejected(self):
        for value in ('NaN','Infinity','-Infinity'):
            with self.subTest(value=value),self.assertRaises(ValueError): self.reading(value)

    def test_zero_and_negative_rejected(self):
        for value in ('0','-1'):
            with self.subTest(value=value),self.assertRaises(ValueError): self.reading(value)

    def test_unknown_unit_rejected(self):
        with self.assertRaises(ValueError): self.reading('9',unit='cm')

    def test_datetime_not_silently_converted_to_date(self):
        with self.assertRaises(ValueError): ReadingValue(Decimal('9'),datetime(2026,11,26))
