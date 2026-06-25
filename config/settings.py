import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('SECRET_KEY', 'unsafe-default-change-me')
DEBUG = os.environ.get('DEBUG', '0') == '1'
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', '*').split(',')

# Optional login gate. Off by default (zero-config self-host). When on, every
# request (except the admin and static files) needs HTTP Basic credentials for a
# Django user — create one with `manage.py createsuperuser`.
REQUIRE_AUTH = os.environ.get('REQUIRE_AUTH', '0') == '1'

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'garden',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'garden.middleware.OptionalBasicAuthMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('POSTGRES_DB', 'garden'),
        'USER': os.environ.get('POSTGRES_USER', 'garden'),
        'PASSWORD': os.environ.get('POSTGRES_PASSWORD', 'garden'),
        'HOST': os.environ.get('POSTGRES_HOST', 'db'),
        'PORT': os.environ.get('POSTGRES_PORT', '5432'),
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = 'en-gb'
TIME_ZONE = 'Europe/London'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Wide-open CORS is fine for an unauthenticated LAN app; lock it down once auth is required.
CORS_ALLOW_ALL_ORIGINS = not REQUIRE_AUTH

REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.AllowAny'],
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'DEFAULT_PAGINATION_CLASS': None,
}

DATA_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024  # 20MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024
