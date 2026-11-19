"""Regressões de inicialização e do healthcheck usadas no CI."""
from unittest.mock import patch

from django.db import OperationalError, connection
from django.test import TestCase, override_settings


@override_settings(ALLOWED_HOSTS=['testserver'])
class HealthcheckTests(TestCase):
    def test_reports_healthy_database(self):
        response = self.client.get('/healthz/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})

    def test_reports_database_failure(self):
        with patch('sistema_pires.views.connection.cursor', side_effect=OperationalError('Database unavailable')):
            response = self.client.get('/healthz/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'status': 'unavailable'})

    def test_rejects_post(self):
        self.assertEqual(self.client.post('/healthz/').status_code, 405)

    def test_admin_login_loads(self):
        response = self.client.get('/admin/login/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'csrfmiddlewaretoken')

    def test_database_executes_query(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            self.assertEqual(cursor.fetchone()[0], 1)
