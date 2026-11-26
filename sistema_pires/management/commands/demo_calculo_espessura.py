import json
from datetime import date, timedelta
from decimal import Decimal
from django.core.management.base import BaseCommand
from sistema_pires.services.calcs.calculos_espessura import ReadingValue, calculate_thickness


class Command(BaseCommand):
    help = "Executa o exemplo fictício do engenheiro, sem cadastrar ou alterar dados."

    def handle(self, *args, **options):
        day = date(2026, 11, 26)
        result = calculate_thickness(
            initial=ReadingValue(Decimal('10'), day-timedelta(days=730), identifier='inicial'),
            previous=ReadingValue(Decimal('9.5'), day-timedelta(days=365), identifier='anterior'),
            current=ReadingValue(Decimal('9'), day, identifier='atual'), required=Decimal('8'))
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
