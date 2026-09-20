import pytest

from api.v1.endpoints.trial import RunRequest
from src.agent.executor import _build_language_section
from src.report_language import (
    get_report_labels, get_placeholder_text, get_sentiment_label,
    localize_operation_advice, normalize_report_language,
)


@pytest.mark.parametrize('language,expected', [('ja-JP', 'ja'), ('zh-tw', 'zh-TW'), ('zh-Hant', 'zh-TW')])
def test_report_language_aliases(language, expected):
    assert normalize_report_language(language) == expected


@pytest.mark.parametrize('language', ['en', 'zh', 'zh-TW', 'ja', 'ko'])
def test_all_report_languages_have_complete_labels_and_valid_api_payloads(language):
    assert get_report_labels(language).keys() == get_report_labels('en').keys()
    assert get_placeholder_text(language)
    assert get_sentiment_label(70, language)
    assert localize_operation_advice('buy', language)
    assert RunRequest(requestId='00000000-0000-4000-8000-000000000001', kind='assistant', topic='test', language=language).language == language


@pytest.mark.parametrize('language,label', [('ja', '日本語'), ('zh-TW', '繁體中文')])
def test_prompt_preserves_machine_values_and_selects_language(language, label):
    prompt = _build_language_section(language, chat_mode=True)
    assert label in prompt
    assert 'buy|hold|sell' in prompt


@pytest.mark.parametrize('language,label', [('ja', '日本語'), ('zh-TW', '繁體中文')])
@pytest.mark.parametrize('chat', [True, False])
def test_decision_and_executor_prompts_agree_with_api_language(language, label, chat):
    from api.v1.schemas.analysis import AnalyzeRequest
    from src.agent.agents.decision_agent import DecisionAgent
    from src.agent.executor import AgentExecutor
    from src.agent.protocols import AgentContext

    request = AnalyzeRequest(stock_code='600519', report_language=language)
    assert request.report_language == language
    metadata = {'report_language': language}
    if chat:
        metadata['response_mode'] = 'chat'
    context = AgentContext(stock_code='600519', meta=metadata)
    prompt = DecisionAgent(tool_registry=None, llm_adapter=None).system_prompt(context)
    assert label in prompt
    assert 'buy|hold|sell' in prompt
    user_prompt = AgentExecutor.__new__(AgentExecutor)._build_user_message('Analyze', metadata)
    assert label in user_prompt
    assert '输出语言: 中文' not in user_prompt
