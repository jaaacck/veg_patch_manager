import base64

from django.conf import settings
from django.contrib.auth import authenticate
from django.http import HttpResponse


class OptionalBasicAuthMiddleware:
    """Gate the whole app behind HTTP Basic auth when REQUIRE_AUTH is enabled.

    No-op when REQUIRE_AUTH is off, so the default zero-config experience is
    unchanged. When on, every request needs valid credentials for a Django user
    (create one with `manage.py createsuperuser`) — except the admin (which has
    its own login) and static/media files. The browser shows its native login
    prompt, so the single-page app needs no separate login screen.
    """

    EXEMPT_PREFIXES = ('/admin/', '/static/', '/media/')

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not getattr(settings, 'REQUIRE_AUTH', False):
            return self.get_response(request)

        if request.path.startswith(self.EXEMPT_PREFIXES):
            return self.get_response(request)

        # Already authenticated via a Django session?
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated:
            return self.get_response(request)

        header = request.META.get('HTTP_AUTHORIZATION', '')
        if header.startswith('Basic '):
            try:
                raw = base64.b64decode(header.split(' ', 1)[1]).decode('utf-8')
                username, password = raw.split(':', 1)
            except Exception:
                username = password = None
            if username is not None:
                authed = authenticate(request, username=username, password=password)
                if authed is not None:
                    request.user = authed
                    return self.get_response(request)

        resp = HttpResponse('Authentication required', status=401)
        resp['WWW-Authenticate'] = 'Basic realm="Square Foot Garden"'
        return resp
