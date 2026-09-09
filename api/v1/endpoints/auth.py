# -*- coding: utf-8 -*-
"""Authentication endpoints for Web admin login."""

from __future__ import annotations

import logging
import os
import hmac

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from api.deps import get_system_config_service
from src.auth import (
    account_mode_enabled,
    access_mode,
    account_email,
    register_account,
    update_account_email,
    COOKIE_NAME,
    SESSION_MAX_AGE_HOURS_DEFAULT,
    change_password,
    check_rate_limit,
    clear_rate_limit,
    create_session,
    get_client_ip,
    has_stored_password,
    is_auth_enabled,
    is_password_changeable,
    is_password_set,
    record_login_failure,
    refresh_auth_state,
    rotate_session_secret,
    set_initial_password,
    verify_password,
    verify_stored_password,
    verify_session,
)
from src.config import Config, setup_env
from src.core.config_manager import ConfigManager

logger = logging.getLogger(__name__)

router = APIRouter()


class LoginRequest(BaseModel):
    """Login request body. For first-time setup use password + password_confirm."""

    model_config = {"populate_by_name": True}

    password: str = Field(default="", max_length=1024, description="Admin password")
    email: str = Field(default="", max_length=254)
    password_confirm: str | None = Field(default=None, alias="passwordConfirm", description="Confirm (first-time)")


class ChangePasswordRequest(BaseModel):
    """Change password request body."""

    model_config = {"populate_by_name": True}

    current_password: str = Field(default="", max_length=1024, alias="currentPassword")
    new_password: str = Field(default="", max_length=1024, alias="newPassword")
    new_password_confirm: str = Field(default="", max_length=1024, alias="newPasswordConfirm")


class RegisterRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(default="", max_length=128)
    passwordConfirm: str = Field(default="", max_length=128)
    currentPassword: str = Field(default="", max_length=1024)
    setupToken: str = Field(default="", max_length=256)
    memberRegistration: bool = False
    inviteCode: str = Field(default="", max_length=256)


class EmailRequest(BaseModel):
    email: str = Field(max_length=254)
    currentPassword: str = Field(max_length=1024)


def _account_error(code: str, status: int = 400) -> JSONResponse:
    messages = {
        'registration_closed': 'This instance already has an administrator. Please sign in.',
        'credentials_invalid': 'Email or password incorrect.',
        'email_invalid': 'Enter a valid email address.',
        'password_mismatch': 'Passwords do not match.',
        'password_length': 'Password must contain 8–128 characters.',
        'setup_token_invalid': 'Setup token is invalid or expired. Generate a new token on the deployment host.',
        'account_required': 'Complete administrator account setup first.',
        'auth_required': 'Account protection cannot be disabled from the web.',
        'rate_limited': 'Too many failed attempts. Please try again later.',
    }
    return JSONResponse(status_code=status, content={'error': code, 'message': messages.get(code, 'Account update failed.')})


@router.post('/register')
async def auth_register(request: Request, body: RegisterRequest):
    if not account_mode_enabled():
        return _account_error('auth_required', 403)
    ip = get_client_ip(request)
    if not check_rate_limit(ip) or not check_rate_limit('account-setup'):
        return _account_error('rate_limited', 429)
    if body.memberRegistration:
        from src.services.member_service import MemberService, MEMBER_PREFIX, multi_user_enabled
        from src.services.trial_service import TrialError
        if not multi_user_enabled() or not account_email():
            return _account_error('registration_closed', 403)
        if body.password != body.passwordConfirm:
            return _account_error('password_mismatch')
        if body.email.strip().lower() == account_email():
            return _account_error('credentials_invalid', 400)
        try:
            token = MemberService().trials.enroll(body.email, body.password, body.inviteCode)
        except (TrialError, ValueError) as exc:
            record_login_failure(ip)
            record_login_failure('account-setup')
            return _account_error(str(exc), getattr(exc, 'status', 400))
        response = JSONResponse({'ok': True})
        _set_session_cookie(response, MEMBER_PREFIX + token, request)
        return response
    try:
        register_account(body.email, body.password, body.passwordConfirm, body.currentPassword, body.setupToken)
    except ValueError as exc:
        record_login_failure(ip)
        record_login_failure('account-setup')
        return _account_error(str(exc), 409 if str(exc) == 'registration_closed' else 400)
    clear_rate_limit(ip)
    clear_rate_limit('account-setup')
    session = create_session()
    if not session:
        return JSONResponse(status_code=503, content={'error': 'session_unavailable', 'message': 'Account saved. Please sign in again.'})
    response = JSONResponse({'ok': True})
    _set_session_cookie(response, session, request)
    return response


@router.post('/change-email')
async def auth_change_email(request: Request, body: EmailRequest):
    if request.cookies.get(COOKIE_NAME, '').startswith('member:'):
        return _account_error('email_change_requires_verification', 403)
    if not verify_session(request.cookies.get(COOKIE_NAME, '')):
        return _account_error('credentials_invalid', 401)
    from src.services.member_service import multi_user_enabled
    if multi_user_enabled():
        from src.storage import DatabaseManager, TrialUserRecord
        from sqlalchemy import select
        with DatabaseManager.get_instance().get_session() as session:
            if session.scalar(select(TrialUserRecord.id).where(TrialUserRecord.email == body.email.strip().lower())):
                return _account_error('email_in_use', 409)
    ip = get_client_ip(request)
    if not check_rate_limit(ip):
        return _account_error('rate_limited', 429)
    try:
        update_account_email(body.email, body.currentPassword)
    except ValueError as exc:
        record_login_failure(ip)
        return _account_error(str(exc))
    clear_rate_limit(ip)
    response = JSONResponse({'ok': True})
    session = create_session()
    if not session:
        return JSONResponse(status_code=503, content={'error': 'session_unavailable', 'message': 'Email saved. Please sign in again.'})
    _set_session_cookie(response, session, request)
    return response


class AuthSettingsRequest(BaseModel):
    """Update auth enablement and initial password settings."""

    model_config = {"populate_by_name": True}

    auth_enabled: bool = Field(alias="authEnabled")
    password: str = Field(default="")
    password_confirm: str | None = Field(default=None, alias="passwordConfirm")
    current_password: str = Field(default="", alias="currentPassword")


def _cookie_params(request: Request) -> dict:
    """Build cookie params including Secure based on request."""
    secure = False
    if os.getenv("TRUST_X_FORWARDED_FOR", "false").lower() == "true":
        proto = request.headers.get("X-Forwarded-Proto", "").lower()
        secure = proto == "https"
    else:
        # Check URL scheme when not behind proxy
        secure = request.url.scheme == "https"

    try:
        max_age_hours = int(os.getenv("ADMIN_SESSION_MAX_AGE_HOURS", str(SESSION_MAX_AGE_HOURS_DEFAULT)))
    except ValueError:
        max_age_hours = SESSION_MAX_AGE_HOURS_DEFAULT
    max_age = max_age_hours * 3600

    return {
        "httponly": True,
        "samesite": "lax",
        "secure": secure,
        "path": "/",
        "max_age": max_age,
    }


def _apply_auth_enabled(enabled: bool, request: Request | None = None) -> bool:
    """Persist auth toggle to .env and reload runtime config."""
    manager_applied = False
    if request is not None:
        try:
            service = get_system_config_service(request)
            service.apply_simple_updates(
                updates=[("ADMIN_AUTH_ENABLED", "true" if enabled else "false")],
                mask_token="******",
            )
            manager_applied = True
        except Exception as exc:
            logger.warning(
                "Failed to apply auth toggle via shared SystemConfigService, falling back: %s",
                exc,
                exc_info=True,
            )
            manager_applied = False

    if not manager_applied:
        try:
            manager = ConfigManager()
            manager.apply_updates(
                updates=[("ADMIN_AUTH_ENABLED", "true" if enabled else "false")],
                sensitive_keys=set(),
                mask_token="******",
            )
            manager_applied = True
        except Exception as exc:
            logger.error("Failed to apply auth toggle via ConfigManager: %s", exc, exc_info=True)
            manager_applied = False

    if not manager_applied:
        return False

    Config.reset_instance()
    setup_env(override=True)
    refresh_auth_state()
    return True


def _password_set_for_response(auth_enabled: bool) -> bool:
    """Avoid exposing stored-password state when auth is disabled."""
    return is_password_set() if auth_enabled else False


def _set_session_cookie(response: Response, session_value: str, request: Request) -> None:
    """Attach the admin session cookie to a response."""
    if not session_value.startswith('member:') and account_email():
        from src.services.user_activity_service import activity_scope, record_activity
        with activity_scope('settings'):
            record_activity('authenticated', resource=request.url.path)
    params = _cookie_params(request)
    response.set_cookie(
        key=COOKIE_NAME,
        value=session_value,
        httponly=params["httponly"],
        samesite=params["samesite"],
        secure=params["secure"],
        path=params["path"],
        max_age=params["max_age"],
    )


def _get_auth_status_dict(request: Request | None = None) -> dict:
    """Helper to build consistent auth status response body."""
    from src.services.member_service import MemberService, MEMBER_PREFIX, multi_user_enabled
    from src.services.trial_service import TrialError
    member = None
    enabled = multi_user_enabled()
    if enabled and request and request.cookies.get(COOKIE_NAME, '').startswith(MEMBER_PREFIX):
        try:
            service = MemberService()
            member = service.resolve(request.cookies[COOKIE_NAME])
        except TrialError:
            pass
    auth_enabled = is_auth_enabled()
    logged_in = False
    if auth_enabled and request:
        cookie_val = request.cookies.get(COOKIE_NAME)
        logged_in = verify_session(cookie_val) if cookie_val else False

    # setupState determination:
    # - enabled: auth is active
    # - password_retained: auth disabled but password exists
    # - no_password: auth disabled and no password exists
    if auth_enabled:
        setup_state = "enabled"
    elif has_stored_password():
        setup_state = "password_retained"
    else:
        setup_state = "no_password"

    return {
        "authEnabled": auth_enabled,
        "deploymentMode": access_mode(),
        "loggedIn": logged_in or member is not None,
        "passwordSet": _password_set_for_response(auth_enabled),
        "passwordChangeable": is_password_changeable() if auth_enabled else False,
        "setupState": setup_state,
        "accountMode": account_mode_enabled(),
        "accountState": ('ready' if account_email() else 'migrate' if has_stored_password() else 'register'),
        "email": member['email'] if member else account_email() if logged_in else None,
        "role": 'member' if member else 'admin' if logged_in else None,
        "userId": member['id'] if member else 'owner' if logged_in else None,
        "multiUserEnabled": enabled,
        "registrationMode": 'invite' if enabled and account_email() else 'closed',
        "quota": service.trials.status(member['id']) if member else None,
    }


@router.get(
    "/status",
    summary="Get auth status",
    description="Returns whether auth is enabled and if the current request is logged in.",
)
async def auth_status(request: Request, response: Response = None):
    """Return authEnabled, loggedIn, passwordSet, passwordChangeable, setupState without requiring auth."""
    if response is not None:
        response.headers['Cache-Control'] = 'private, no-store'
    return _get_auth_status_dict(request)


@router.post(
    "/settings",
    summary="Update auth settings",
    description=(
        "Enable or disable password login. "
        "When enabling without an existing password, password + passwordConfirm are required. "
        "When re-enabling with a stored password, currentPassword is required. "
        "When disabling auth (authEnabled=false) while auth is currently enabled, "
        "currentPassword is required to re-authenticate the admin — a valid session cookie "
        "alone is NOT enough for this high-risk action (CSRF / session-hijacking hardening "
        "for Issue #1970)."
    ),
)
async def auth_update_settings(request: Request, body: AuthSettingsRequest):
    """Manage auth enablement from the settings page."""
    if account_mode_enabled():
        return _account_error('auth_required', 403)
    target_enabled = body.auth_enabled
    current_enabled = is_auth_enabled()
    stored_password_exists = has_stored_password()

    password = (body.password or "").strip()
    confirm = (body.password_confirm or "").strip()
    current_password = (body.current_password or "").strip()

    if target_enabled:
        if password or confirm:
            if stored_password_exists:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "password_already_set",
                        "message": "已存在管理员密码，请启用认证后通过修改密码功能更新",
                    },
                )
            if not password:
                return JSONResponse(
                    status_code=400,
                    content={"error": "password_required", "message": "请输入要设置的管理员密码"},
                )
            if password != confirm:
                return JSONResponse(
                    status_code=400,
                    content={"error": "password_mismatch", "message": "两次输入的密码不一致"},
                )
            if has_stored_password():
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "password_already_set",
                        "message": "已存在管理员密码，请启用认证后通过修改密码功能更新",
                    },
                )
            err = set_initial_password(password)
            if err:
                return JSONResponse(
                    status_code=400,
                    content={"error": "invalid_password", "message": err},
                )
        elif not stored_password_exists:
            return JSONResponse(
                status_code=400,
                content={"error": "password_required", "message": "开启密码登录前请先设置密码"},
            )
        else:
            # P1 Vulnerability Fix: Enforce current-password check independent of global cached flag
            # We must verify they actually possess a valid admin session, otherwise an attacker
            # could hit a race condition when auth becomes enabled mid-flight.
            # This triggers whenever trying to enable/keep enabled an existing auth setup.
            cookie_val = request.cookies.get(COOKIE_NAME)
            # if target_enabled is True here, they are requesting to enable or keep auth enabled
            is_valid_session = cookie_val and verify_session(cookie_val)
            
            if not is_valid_session:
                if not current_password:
                    return JSONResponse(
                        status_code=400,
                        content={"error": "current_required", "message": "重新开启认证前请输入当前密码"},
                    )
                ip = get_client_ip(request)
                if not check_rate_limit(ip):
                    return JSONResponse(
                        status_code=429,
                        content={
                            "error": "rate_limited",
                            "message": "Too many failed attempts. Please try again later.",
                        },
                    )
                if not verify_stored_password(current_password):
                    record_login_failure(ip)
                    return JSONResponse(
                        status_code=401,
                        content={"error": "invalid_password", "message": "当前密码错误"},
                    )
                clear_rate_limit(ip)
    else:
        # target_enabled is False here: caller wants to disable auth.
        # High-risk action: require current admin password re-authentication even when
        # the request carries a cryptographically valid session cookie. A leaked session
        # cookie must never be enough to flip the system into an unauthenticated state
        # (CSRF / session-hijacking hardening for Issue #1970).
        if current_enabled:
            if not current_password:
                return JSONResponse(
                    status_code=400,
                    content={"error": "current_required", "message": "关闭认证前请输入当前密码"},
                )
            ip = get_client_ip(request)
            if not check_rate_limit(ip):
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "rate_limited",
                        "message": "Too many failed attempts. Please try again later.",
                    },
                )
            if not verify_stored_password(current_password):
                record_login_failure(ip)
                return JSONResponse(
                    status_code=401,
                    content={"error": "invalid_password", "message": "当前密码错误"},
                )
            clear_rate_limit(ip)

    if target_enabled != current_enabled:
        if not _apply_auth_enabled(target_enabled, request=request):
            return JSONResponse(
                status_code=500,
                content={"error": "internal_error", "message": "Failed to update auth settings"},
            )
        if not rotate_session_secret():
            rollback_ok = _apply_auth_enabled(current_enabled, request=request)
            if not rollback_ok:
                logger.error("Failed to roll back auth state after session secret rotation failure")
            return JSONResponse(
                status_code=500,
                content={"error": "internal_error", "message": "Failed to rotate session secret"},
            )
    else:
        if not _apply_auth_enabled(target_enabled, request=request):
            return JSONResponse(
                status_code=500,
                content={"error": "internal_error", "message": "Failed to update auth settings"},
            )

    if target_enabled:
        session_val = create_session()
        if not session_val:
            rollback_ok = _apply_auth_enabled(current_enabled, request=request)
            if not rollback_ok:
                logger.error("Failed to roll back auth state after session creation failure")
            return JSONResponse(
                status_code=500,
                content={"error": "internal_error", "message": "Failed to create session"},
            )
        # We manually set loggedIn=True because the cookie is being set in this response
        # and won't be visible in request.cookies until the NEXT request.
        content = _get_auth_status_dict(request)
        content["loggedIn"] = True
        resp = JSONResponse(content=content)
        _set_session_cookie(resp, session_val, request)
        return resp

    resp = JSONResponse(content=_get_auth_status_dict(request))
    resp.delete_cookie(key=COOKIE_NAME, path="/")
    return resp



@router.post(
    "/login",
    summary="Login or set initial password",
    description="Verify password and set session cookie. If password not set yet, accepts password+passwordConfirm.",
)
async def auth_login(request: Request, body: LoginRequest):
    """Verify password or set initial password, set cookie on success. Returns 401 or 429 on failure."""
    if account_mode_enabled():
        ip = get_client_ip(request)
        if not check_rate_limit(ip) or not check_rate_limit('account-login'):
            return _account_error('rate_limited', 429)
        email = account_email()
        if not email:
            return _account_error('account_required', 409)
        from src.services.member_service import MemberService, MEMBER_PREFIX, multi_user_enabled
        from src.services.trial_service import TrialError
        if multi_user_enabled() and body.email.strip().lower() != email:
            try:
                token = MemberService().trials.login(body.email, body.password)
            except (TrialError, ValueError):
                record_login_failure(ip)
                record_login_failure('account-login')
                return _account_error('credentials_invalid', 401)
            clear_rate_limit(ip)
            response = JSONResponse({'ok': True})
            _set_session_cookie(response, MEMBER_PREFIX + token, request)
            return response
        password_ok = verify_stored_password(body.password)
        if not password_ok or not hmac.compare_digest(body.email.strip().lower().encode(), email.encode()):
            record_login_failure(ip)
            record_login_failure('account-login')
            return _account_error('credentials_invalid', 401)
        clear_rate_limit(ip)
        clear_rate_limit('account-login')
        session = create_session()
        if not session:
            return JSONResponse(status_code=503, content={'error': 'session_unavailable', 'message': 'Unable to create session.'})
        response = JSONResponse({'ok': True})
        _set_session_cookie(response, session, request)
        return response
    if not is_auth_enabled():
        return JSONResponse(
            status_code=400,
            content={"error": "auth_disabled", "message": "Authentication is not configured"},
        )

    password = (body.password or "").strip()
    if not password:
        return JSONResponse(
            status_code=400,
            content={"error": "password_required", "message": "请输入密码"},
        )

    ip = get_client_ip(request)
    if not check_rate_limit(ip):
        return JSONResponse(
            status_code=429,
            content={
                "error": "rate_limited",
                "message": "Too many failed attempts. Please try again later.",
            },
        )

    password_set = is_password_set()

    if not password_set:
        # First-time setup: require passwordConfirm
        confirm = (body.password_confirm or "").strip()
        if password != confirm:
            record_login_failure(ip)
            return JSONResponse(
                status_code=400,
                content={"error": "password_mismatch", "message": "Passwords do not match"},
            )
        err = set_initial_password(password)
        if err:
            record_login_failure(ip)
            return JSONResponse(
                status_code=400,
                content={"error": "invalid_password", "message": err},
            )
    else:
        if not verify_password(password):
            record_login_failure(ip)
            return JSONResponse(
                status_code=401,
                content={"error": "invalid_password", "message": "密码错误"},
            )

    clear_rate_limit(ip)
    session_val = create_session()
    if not session_val:
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Failed to create session"},
        )

    resp = JSONResponse(content={"ok": True})
    _set_session_cookie(resp, session_val, request)
    return resp


@router.post(
    "/change-password",
    summary="Change password",
    description="Change password. Requires valid session.",
)
async def auth_change_password(body: ChangePasswordRequest, request: Request = None):
    """Change password. Requires login."""
    if request and request.cookies.get(COOKIE_NAME, '').startswith('member:'):
        from src.services.member_service import MemberService
        from src.services.trial_service import TrialError
        ip = get_client_ip(request)
        if not check_rate_limit(ip):
            return _account_error('rate_limited', 429)
        if body.new_password != body.new_password_confirm:
            return _account_error('password_mismatch')
        try:
            service = MemberService()
            member = service.resolve(request.cookies[COOKIE_NAME])
            service.change_credentials(member['id'], body.current_password, password=body.new_password)
        except TrialError as exc:
            record_login_failure(ip)
            return _account_error(exc.code, exc.status)
        response = Response(status_code=204)
        response.delete_cookie(COOKIE_NAME, path='/')
        return response
    if account_mode_enabled():
        if not request or not verify_session(request.cookies.get(COOKIE_NAME, '')):
            return _account_error('credentials_invalid', 401)
        ip = get_client_ip(request)
        if not check_rate_limit(ip):
            return _account_error('rate_limited', 429)
        if body.new_password != body.new_password_confirm:
            return _account_error('password_mismatch')
        if not verify_stored_password(body.current_password):
            record_login_failure(ip)
            return _account_error('credentials_invalid', 400)
        err = change_password(body.current_password, body.new_password)
        if err:
            return _account_error('password_length')
        clear_rate_limit(ip)
        session = create_session()
        if not session:
            return JSONResponse(status_code=503, content={'error': 'session_unavailable', 'message': 'Password saved. Please sign in again.'})
        response = Response(status_code=204)
        _set_session_cookie(response, session, request)
        return response
    if not is_password_changeable():
        return JSONResponse(
            status_code=400,
            content={"error": "not_changeable", "message": "Password cannot be changed via web"},
        )

    current = (body.current_password or "").strip()
    new_pwd = (body.new_password or "").strip()
    new_confirm = (body.new_password_confirm or "").strip()

    if not current:
        return JSONResponse(
            status_code=400,
            content={"error": "current_required", "message": "请输入当前密码"},
        )
    if new_pwd != new_confirm:
        return JSONResponse(
            status_code=400,
            content={"error": "password_mismatch", "message": "两次输入的新密码不一致"},
        )

    err = change_password(current, new_pwd)
    if err:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_password", "message": err},
        )
    return Response(status_code=204)


@router.post(
    "/logout",
    summary="Logout",
    description="Clear session cookie.",
)
async def auth_logout(request: Request):
    if request.cookies.get(COOKIE_NAME, '').startswith('member:'):
        from src.services.member_service import MemberService
        from src.services.trial_service import TrialError
        try:
            service = MemberService()
            member = service.resolve(request.cookies[COOKIE_NAME])
            service.trials.logout(member['id'])
        except TrialError:
            pass
        response = Response(status_code=204)
        response.delete_cookie(COOKIE_NAME, path='/')
        return response
    """Clear session cookie."""
    if is_auth_enabled() and not rotate_session_secret():
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Failed to invalidate session"},
        )
    resp = Response(status_code=204)
    resp.delete_cookie(key=COOKIE_NAME, path="/")
    return resp
