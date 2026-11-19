"""Configuração Django para desenvolvimento, Docker e produção."""
import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

def env(name, default=None):
    return os.environ.get(name, default)

def env_bool(name, default=False):
    return str(env(name, str(default))).lower() in {'1', 'true', 'yes', 'on'}

SECRET_KEY = env('DJANGO_SECRET_KEY', 'django-insecure-development-only-change-me')
FERNET_KEY = os.environ["FERNET_KEY"]
DEBUG = env_bool('DJANGO_DEBUG', True)
ALLOWED_HOSTS = [x.strip() for x in env('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if x.strip()]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.postgres',
    'rest_framework',
    'sistema_pires',
    'axes',
]
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware', 'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware','axes.middleware.AxesMiddleware',
]
ROOT_URLCONF = 'pires_integrity.urls'
WSGI_APPLICATION = 'pires_integrity.wsgi.application'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / 'base_templates'], 'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request', 'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]
AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',
    'django.contrib.auth.backends.ModelBackend',
]
DB_ENGINE = env('DB_ENGINE', 'django.db.backends.postgresql')
if DB_ENGINE.endswith('sqlite3'):
    DATABASES = {'default': {'ENGINE': DB_ENGINE, 'NAME': env('DB_NAME', BASE_DIR / 'db.sqlite3')}}
else:
    DATABASES = {'default': {
        'ENGINE': DB_ENGINE, 'NAME': env('DB_NAME', ''), 'USER': env('DB_USER', ''),
        'PASSWORD': env('DB_PASSWORD', ''), 'HOST': env('DB_HOST', '127.0.0.1'),
        'PORT': env('DB_PORT', '5432'), 'CONN_MAX_AGE': int(env('DB_CONN_MAX_AGE', '60')),
        'OPTIONS': {'client_encoding': 'UTF8'},
    }}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
LANGUAGE_CODE = 'pt-br'
TIME_ZONE = env('DJANGO_TIME_ZONE', 'America/Sao_Paulo')
USE_I18N = True
USE_TZ = True
STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static'] if (BASE_DIR / 'static').exists() else []
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', False)
SESSION_COOKIE_SECURE = env_bool('SESSION_COOKIE_SECURE', False)
CSRF_COOKIE_SECURE = env_bool('CSRF_COOKIE_SECURE', False)
X_FRAME_OPTIONS = 'DENY'
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
CSRF_TRUSTED_ORIGINS = [x.strip() for x in env('CSRF_TRUSTED_ORIGINS', '').split(',') if x.strip()]
EMAIL_BACKEND = env('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
