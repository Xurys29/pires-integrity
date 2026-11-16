import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib import messages
from django.core import signing
from django.db import connection
from django.db.models import F
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.html import format_html
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_http_methods, require_GET

from appa_bot.forms import StakeholderForm, AtualizarStakeHolderForm
from appa_bot.models import Stakeholder
from appa_bot.portal import SALT, criar_link_portal, permitir_solicitacao
from appa_bot.services.main_services import MainServices
from engine_campanha.disparador import Disparador_de_emails

logger = logging.getLogger(__name__)


@require_GET
def healthz(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
        return JsonResponse({'status': 'ok'})
    except Exception:
        return JsonResponse({'status': 'unavailable'}, status=503)