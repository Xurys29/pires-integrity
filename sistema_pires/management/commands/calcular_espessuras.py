import json
from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist, ValidationError, PermissionDenied
from django.core.management.base import BaseCommand, CommandError
from sistema_pires.services.calcs.registro_medicoes import calculate_series


class Command(BaseCommand):
    help = "Calcula/recalcula uma série sem aprovar resultados ou emitir relatórios."

    def add_arguments(self, parser):
        parser.add_argument("--series", required=True)
        parser.add_argument("--procedure", help="Opcional: por padrão usa o procedimento selecionado na série.")
        parser.add_argument("--actor", required=True, help="Login do superusuário responsável pela execução de teste.")

    def handle(self, *args, **options):
        User = get_user_model()
        try:
            actor = User.objects.get(**{User.USERNAME_FIELD: options["actor"]})
            result = calculate_series(series_id=options["series"], procedure_id=options["procedure"], actor=actor)
        except (ObjectDoesNotExist, ValidationError, PermissionDenied, ValueError) as exc:
            raise CommandError(str(exc)) from exc
        output = {"created": result["created"], "engine_version": result["engine_version"],
                  "requires_technical_review": True,
                  "calculations": [{"id": str(c.pk), "reading_id": str(c.reading_id),
                                    "result": c.result_snapshot} for c in result["calculations"]]}
        self.stdout.write(json.dumps(output, ensure_ascii=False, indent=2))
