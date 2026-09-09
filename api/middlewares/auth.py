# -*- coding: utf-8 -*-
"""
Auth middleware: protect /api/v1/* when admin auth is enabled.
"""

from __future__ import annotations

import logging
import os
import ipaddress
import time
import uuid
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from src.auth import COOKIE_NAME, is_auth_enabled, verify_session, account_mode_enabled, account_email, access_mode

logger = logging.getLogger(__name__)

EXEMPT_PATHS = frozenset({
    "/api/v1/auth/login",
    "/api/v1/auth/status",
    "/api/v1/auth/register",
    "/api/health",
    "/api/v1/health",
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
})


def _path_exempt(path: str) -> bool:
    """Check if path is exempt from auth."""
    normalized = path.rstrip("/") or "/"
    return normalized in EXEMPT_PATHS or normalized.startswith('/api/v1/trial/')


class AuthMiddleware(BaseHTTPMiddleware):
    """Require valid session for /api/v1/* when auth is enabled."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        path = request.url.path.rstrip('/')
        if path in {'/health', '/api/health', '/api/v1/health'} and request.method in {'GET', 'HEAD'}:
            return await call_next(request)
        if access_mode() == 'local' and path.startswith('/api/'):
            # Never infer local trust from proxy headers or a client-controlled Host.
            peer = request.client.host if request.client else ''
            host = request.url.hostname or ''
            try:
                local_peer = ipaddress.ip_address(peer).is_loopback
            except ValueError:
                local_peer = False
            try:
                local_host = ipaddress.ip_address(host).is_loopback
            except ValueError:
                local_host = host.lower() == 'localhost'
            if not local_peer or not local_host or request.headers.get('x-forwarded-for') or request.headers.get('forwarded'):
                return JSONResponse(status_code=403, content={'error': 'local_only', 'message': 'Local mode only accepts direct loopback access. Use server mode for shared deployments.'})
            if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
                origin = request.headers.get('origin')
                if request.headers.get('sec-fetch-site') == 'cross-site' or (origin and origin.rstrip('/') != str(request.base_url).rstrip('/')):
                    return JSONResponse(status_code=403, content={'error': 'origin_rejected', 'message': 'Cross-site request rejected.'})
            if path.startswith('/api/v1/auth/') and path != '/api/v1/auth/status':
                return JSONResponse(status_code=403, content={'error': 'local_account_disabled', 'message': 'Local mode does not require an account.'})
            if path.startswith('/api/v1/trial/'):
                return JSONResponse(status_code=403, content={'error': 'local_account_disabled', 'message': 'Trial accounts are available in server mode only.'})
            return await call_next(request)
        is_trial = path.startswith('/api/v1/trial/')
        from src.services.member_service import multi_user_enabled
        if multi_user_enabled() and access_mode() == 'legacy' and path.startswith('/api/v1/'):
            return JSONResponse(status_code=503, content={'error': 'unsafe_access_mode', 'message': 'Private workspaces require local or server account mode.'})
        if not is_auth_enabled() and not is_trial:
            return await call_next(request)
        if (account_mode_enabled() or is_trial) and path.startswith('/api/v1/'):
            secure = request.url.scheme == 'https' or (
                os.getenv('TRUST_X_FORWARDED_FOR', 'false').lower() == 'true'
                and request.headers.get('x-forwarded-proto', '').lower() == 'https'
            )
            if access_mode() == 'server' and not secure and path not in {'/api/v1/health'}:
                return JSONResponse(status_code=403, content={'error': 'https_required', 'message': 'Server mode requires HTTPS. Configure a trusted reverse proxy.'})
            if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
                origin = request.headers.get('origin')
                expected = str(request.base_url).rstrip('/')
                if secure and expected.startswith('http:'):
                    expected = 'https:' + expected[5:]
                allowed = {expected, *[o.strip().rstrip('/') for o in os.getenv('CORS_ORIGINS', '').split(',') if o.strip()]}
                if request.headers.get('sec-fetch-site') == 'cross-site' or (origin and origin.rstrip('/') not in allowed):
                    return JSONResponse(status_code=403, content={'error': 'origin_rejected', 'message': 'Cross-site request rejected.'})
            if not _path_exempt(path) and request.method != 'OPTIONS' and not account_email():
                return JSONResponse(status_code=401, content={'error': 'account_required', 'message': 'Complete administrator account setup first.'})
            if request.method == 'OPTIONS':
                return await call_next(request)
        path = request.url.path
        if _path_exempt(path):
            return await call_next(request)

        if not path.startswith("/api/v1/"):
            return await call_next(request)

        cookie_val = request.cookies.get(COOKIE_NAME)
        if cookie_val and cookie_val.startswith('member:'):
            from src.services.member_service import MemberService
            from src.services.member_policy import member_api_allowed
            from src.services.trial_service import TrialError
            try:
                service = MemberService()
                member = service.resolve(cookie_val)
                if not member_api_allowed(path.rstrip('/'), request.method):
                    return JSONResponse(status_code=403, content={'error': 'admin_required', 'message': 'This operation requires platform administrator access.'})
                request.state.member = member['id']
                if path.startswith('/api/v1/auth/'):
                    return await call_next(request)
                with service.scope(member):
                    return await _tracked_request(request, call_next, member['id'])
            except TrialError as exc:
                return JSONResponse(status_code=exc.status, content={'error': exc.code, 'message': 'Private workspace access unavailable.'})
        if not cookie_val or not verify_session(cookie_val):
            return JSONResponse(
                status_code=401,
                content={
                    "error": "unauthorized",
                    "message": "Login required",
                },
            )

        return await _tracked_request(request, call_next, 'owner')


async def _tracked_request(request, call_next, user_id):
    path = request.url.path
    from src.services.user_activity_service import activity_scope, feature_for_path, record_activity
    request_id = uuid.uuid4().hex
    started = time.monotonic()
    with activity_scope(feature_for_path(path), request_id):
        try:
            response = await call_next(request)
        except Exception:
            record_activity('request_error', resource=path, status='500')
            logger.exception('Member request failed user=%s request=%s', user_id, request_id)
            raise
        route = request.scope.get('route')
        resource = getattr(route, 'path', path)
        if request.method not in {'GET', 'HEAD', 'OPTIONS'} and path != '/api/v1/usage/activity':
            record_activity('operation', resource=request.method + ' ' + resource,
                            status=str(response.status_code),
                            duration_ms=int((time.monotonic() - started) * 1000))
        elif response.status_code >= 400:
            record_activity('request_error', resource=resource, status=str(response.status_code))
        response.headers['X-Request-ID'] = request_id
        response.headers['Cache-Control'] = 'private, no-store'
        return response


def add_auth_middleware(app):
    """Add auth middleware to protect API routes.

    The middleware is always registered; whether auth is enforced is determined
    at request time by is_auth_enabled() so the decision stays consistent across
    any runtime configuration reload.
    """
    app.add_middleware(AuthMiddleware)
