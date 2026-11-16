"""Testes isolados, sem PostgreSQL externo ou credenciais do .env."""
from .settings import *  # noqa: F401,F403

TESTING = True
DEBUG = False
SECRET_KEY = 'test-only-secret-key'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

