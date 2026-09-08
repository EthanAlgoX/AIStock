"""One metered physical model call for every private-workspace Agent/generator."""
import json
import threading
import uuid

from src.services.member_service import current_member, control_plane
from src.services.trial_service import TrialError, trial_model_params

_CALL_SLOTS = threading.BoundedSemaphore(2)


def member_completion(messages, *, tools=None, max_tokens=None, temperature=None):
    member = current_member()
    if not member:
        raise TrialError('credentials_invalid', 401)
    if member.get('modelBlocked'):
        raise TrialError('model_run_stopped', 409)
    limit = min(4096, max_tokens or 4096)
    if type(limit) is not int or limit <= 0:
        raise TrialError('invalid_reservation')
    payload = {'messages': messages, 'tools': tools or []}
    reservation = len(json.dumps(payload, ensure_ascii=False).encode('utf-8')) + 2048 + limit
    if reservation > 60000:
        raise TrialError('context_too_large', 413)
    if not _CALL_SLOTS.acquire(timeout=5):
        raise TrialError('model_busy', 429)
    service = member['service']
    try:
        with control_plane():
            service.require_enabled(member['id'])
            params = trial_model_params()
            call_id = service.trials.reserve(member['id'], 'workspace:' + uuid.uuid4().hex,
                                             reservation, workspace=True)
        import litellm
        kwargs = dict(params, messages=messages, max_tokens=limit, timeout=45,
                      num_retries=0, stream=False)
        if tools:
            kwargs['tools'] = tools
        if temperature is not None:
            kwargs['temperature'] = temperature
        try:
            response = litellm.completion(**kwargs)
            usage = response.usage
            if (usage is None or type(usage.prompt_tokens) is not int or usage.prompt_tokens <= 0
                    or type(usage.completion_tokens) is not int or usage.completion_tokens < 0
                    or type(usage.total_tokens) is not int
                    or usage.total_tokens != usage.prompt_tokens + usage.completion_tokens):
                raise TrialError('usage_unverified', 502)
            with control_plane():
                service.trials.settle(call_id, usage.total_tokens)
            return response
        except Exception as exc:
            # Keep an uncertain reservation and stop every sibling/follow-up call
            # sharing this request context. Never expose provider exception text.
            member['modelBlocked'] = True
            if isinstance(exc, TrialError):
                raise
            raise TrialError('model_call_failed', 502) from None
    finally:
        _CALL_SLOTS.release()
