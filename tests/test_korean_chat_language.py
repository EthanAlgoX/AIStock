from src.agent.executor import _build_language_section
from api.v1.endpoints.trial import RunRequest


def test_korean_chat_and_analysis_prompt_preserve_output_contract():
    for chat in (True, False):
        prompt = _build_language_section('ko', chat_mode=chat)
        assert '한국어로 답변하세요' in prompt
        assert 'buy|hold|sell' in prompt
        assert '默认使用中文' not in prompt
    assert 'Reply in English' in _build_language_section('en', chat_mode=True)
    assert '默认使用中文' in _build_language_section('zh', chat_mode=True)


def test_trial_request_accepts_korean_without_changing_default_language():
    from uuid import uuid4
    data = dict(requestId=uuid4(), kind='assistant', topic='주식 분석')
    assert RunRequest(**data, language='ko').language == 'ko'
    assert RunRequest(**data).language == 'en'
