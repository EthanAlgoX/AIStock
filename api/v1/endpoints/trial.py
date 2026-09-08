"""Public trial endpoints. Trial cookies never authorize administrator routes."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from src import auth
from src.services.trial_service import TrialService, TrialError, TRIAL_COOKIE, EXPERTS, trial_enabled
from api.v1.endpoints.auth import _cookie_params

router = APIRouter()


class Credentials(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)
    inviteCode: str = Field(default='', max_length=256)


class Invitation(BaseModel):
    email: str = Field(max_length=254)


class Enabled(BaseModel):
    enabled: bool


class RunRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requestId: UUID
    kind: Literal['assistant', 'roundtable', 'research', 'screening', 'trading', 'holdings']
    topic: str = Field(min_length=2, max_length=2000)
    stock: str = Field(default='', max_length=20, pattern=r'^[A-Za-z0-9.]*$')
    language: Literal['en', 'zh'] = 'zh'
    experts: list[Literal['warren-buffett', 'charlie-munger', 'peter-lynch']] = Field(default_factory=list, max_length=2)
    mode: Literal['independent', 'debate'] = 'independent'


def call(fn):
    try:
        return fn()
    except TrialError as exc:
        return JSONResponse(status_code=exc.status, content={'error': exc.code, 'message': exc.code})
    except ValueError:
        return JSONResponse(status_code=400, content={'error': 'invalid_input', 'message': 'Invalid input.'})


def identity(service, request):
    return service.identity(request.cookies.get(TRIAL_COOKIE, ''))


def require_admin(request):
    if not auth.account_email() or not auth.verify_session(request.cookies.get(auth.COOKIE_NAME, '')):
        raise TrialError('admin_required', 403)


@router.get('/status')
def status(request: Request):
    service = TrialService()
    user = None
    try:
        user = service.status(identity(service, request))
    except TrialError:
        pass
    return {'enabled': trial_enabled(), 'user': user, 'experts': list(EXPERTS)}


def authenticate(request, body, enroll):
    service = TrialService()
    key = 'trial-auth:' + auth.get_client_ip(request)
    if not auth.check_rate_limit(key) or not auth.check_rate_limit('trial-auth-global'):
        raise TrialError('rate_limited', 429)
    try:
        token = (service.enroll(body.email, body.password, body.inviteCode) if enroll
                 else service.login(body.email, body.password))
    except (TrialError, ValueError):
        auth.record_login_failure(key)
        auth.record_login_failure('trial-auth-global')
        raise
    auth.clear_rate_limit(key)
    auth.clear_rate_limit('trial-auth-global')
    params = _cookie_params(request)
    params.update(path='/api/v1/trial', max_age=7 * 86400)
    response = JSONResponse({'ok': True})
    response.set_cookie(TRIAL_COOKIE, token, **params)
    return response


@router.post('/enroll')
def enroll(request: Request, body: Credentials):
    return call(lambda: authenticate(request, body, True))


@router.post('/login')
def login(request: Request, body: Credentials):
    return call(lambda: authenticate(request, body, False))


@router.post('/logout')
def logout(request: Request):
    def perform():
        service = TrialService()
        service.logout(identity(service, request))
        response = Response(status_code=204)
        response.delete_cookie(TRIAL_COOKIE, path='/api/v1/trial')
        return response
    return call(perform)


@router.get('/runs')
def runs(request: Request):
    service = TrialService()
    return call(lambda: service.runs(identity(service, request)))


@router.post('/runs')
def run(request: Request, body: RunRequest, background: BackgroundTasks):
    def perform():
        service = TrialService()
        user_id = identity(service, request)
        payload = body.model_dump(mode='json')
        if len(set(payload['experts'])) != len(payload['experts']):
            raise TrialError('invalid_input')
        run_id, created = service.start(user_id, payload)
        if created:
            background.add_task(service.execute, user_id, run_id)
        return {'id': run_id}
    return call(perform)


@router.get('/admin/users')
def users(request: Request):
    def perform():
        require_admin(request)
        return TrialService().users()
    return call(perform)


@router.post('/admin/invitations')
def invite(request: Request, body: Invitation):
    def perform():
        require_admin(request)
        return TrialService().invite(body.email)
    return call(perform)


@router.patch('/admin/users/{user_id}')
def enabled(request: Request, user_id: str, body: Enabled):
    def perform():
        require_admin(request)
        TrialService().set_enabled(user_id, body.enabled)
        return {'ok': True}
    return call(perform)
