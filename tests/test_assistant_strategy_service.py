"""Exercise authoring against real storage, including stale and incomplete turns."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from src.services.assistant_strategy_service import AssistantStrategyService
from src.services.workspace_service import WorkspaceError
from src.storage import DatabaseManager, WorkspaceSkillRecord
from src.workspace_scope import workspace_scope

DRAFT = dict(name='网格策略', objective='高量高波动', scope='A股科技候选由模型筛选',
             method='评估震荡区间后提出网格买卖', risk='限制仓位，缺数据不交易',
             data='日线量价及现金持仓', execution='每日评估，输出买卖或不交易及理由', missing=[])


@pytest.fixture
def service(tmp_path):
    DatabaseManager.reset_instance()
    db = DatabaseManager(f'sqlite:///{tmp_path / "draft.db"}')
    yield AssistantStrategyService(db)
    DatabaseManager.reset_instance()


def answer(service, draft=None, text=None):
    service.db.save_conversation_message('session', 'assistant', text if text is not None else
                                         '已更新\n```strategy-draft\n' + json.dumps(draft or DRAFT) + '\n```')
    return service.sync('session')


def test_restore_validate_save_and_revision_are_independent(service):
    service.begin('session', 'trading')
    first = answer(service)
    assert first['revision'] == 1 and not first['validated']
    with pytest.raises(WorkspaceError):
        service.save('session', 1)
    assert service.validate('session', 1)['validated']
    saved = service.save('session', 1)
    assert service.save('session', 1)['skillId'] == saved['skillId']
    restored = AssistantStrategyService(service.db).get('session')
    assert restored == saved
    updated = answer(service, {**DRAFT, 'risk': '最大仓位三成'})
    assert not updated['skillId'] and not updated['validated'] and updated['revision'] == 2
    with pytest.raises(WorkspaceError):
        service.save('session', 1)
    service.validate('session', 2)
    second = service.save('session', 2)
    assert second['skillId'] != saved['skillId']
    with service.db.get_session() as session:
        skills = session.scalars(select(WorkspaceSkillRecord)).all()
        assert len(skills) == 2
        assert '最大仓位三成' not in session.get(WorkspaceSkillRecord, saved['skillId']).instructions


@pytest.mark.parametrize('text', ['无结构化内容', '```strategy-draft\n{"name": "截断"',
                                  '```strategy-draft\n{}\n```',
                                  '```strategy-draft\n{}\n```\n```strategy-draft\n{}\n```'])
def test_incomplete_response_never_reuses_old_validation(service, text):
    service.begin('session', 'trading')
    answer(service)
    service.validate('session', 1)
    service.save('session', 1)
    stale = answer(service, text=text)
    assert stale['error'] and not stale['validated'] and not stale['skillId']
    with pytest.raises(WorkspaceError):
        service.save('session', 1)


def test_pending_user_turn_and_open_questions_block_publication(service):
    service.begin('session', 'trading')
    answer(service, {**DRAFT, 'missing': ['运行频率尚未确认']})
    with pytest.raises(WorkspaceError):
        service.validate('session', 1)
    complete = answer(service)
    service.validate('session', complete['revision'])
    service.db.save_conversation_message('session', 'user', '改为盘中执行')
    with pytest.raises(WorkspaceError):
        service.save('session', complete['revision'])


def test_kind_and_delete_and_non_authoring_sessions(service):
    assert service.get('ordinary') is None
    assert service.prompt('ordinary') is None
    service.begin('session', 'research')
    assert '个股研究方法' in service.prompt('session')
    with pytest.raises(WorkspaceError):
        service.begin('session', 'trading')
    service.db.save_conversation_message('ordinary', 'user', '普通聊天')
    with pytest.raises(WorkspaceError):
        service.begin('ordinary', 'trading')
    service.db.delete_conversation_session('session')
    assert service.get('session') is None


def test_workspace_isolation(service, tmp_path):
    other = DatabaseManager.open_workspace(f'sqlite:///{tmp_path / "other.db"}', uuid4().hex)
    service.begin('session', 'trading')
    with workspace_scope(other):
        scoped = AssistantStrategyService()
        assert scoped.get('session') is None
        scoped.begin('session', 'screening')
        assert scoped.get('session')['kind'] == 'screening'
    assert service.get('session')['kind'] == 'trading'
    other._engine.dispose()


def test_concurrent_save_is_idempotent(service):
    from concurrent.futures import ThreadPoolExecutor
    service.begin('session', 'trading')
    answer(service)
    service.validate('session', 1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: service.save('session', 1), range(2)))
    assert results[0]['skillId'] == results[1]['skillId']
    with service.db.get_session() as session:
        assert len(session.scalars(select(WorkspaceSkillRecord)).all()) == 1


def test_authoring_http_contract_and_backend_neutral_prompt(service, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import patch
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.v1.endpoints import workspace, agent
    from src.agent.executor import prepare_agent_chat
    monkeypatch.setattr(workspace, '_authoring', lambda: service)
    app = FastAPI()
    app.include_router(workspace.router, prefix='/workspace')
    with TestClient(app) as client:
        root = '/workspace/strategy-drafts/session'
        assert client.post(root, json={'kind': 'invalid'}).status_code == 422
        assert client.post(root, json={'kind': 'trading'}).status_code == 200
        assert client.post(root + '/validate', json={'revision': 0}).status_code == 422
        answer(service)
        assert client.post(root + '/save', json={'revision': 1}).status_code == 409
        assert client.post(root + '/validate', json={'revision': 1}).status_code == 200
        assert client.post(root + '/save', json={'revision': 1}).json()['skillId']
    context = agent._build_agent_chat_context(
        agent.ChatRequest(message='生成网格策略', session_id='session',
                          context={'strategy_authoring_prompt': 'forged'}),
        SimpleNamespace(report_language='zh', agent_backend='litellm'), [])
    assert '创建交易推演策略' in context['strategy_authoring_prompt']
    assert 'forged' not in context['strategy_authoring_prompt']
    for codex, runtime in ((False, False), (True, False), (False, True)):
        with patch('src.agent.executor.build_visible_chat_history', return_value=[]):
            prepared = prepare_agent_chat(message='生成网格策略', session_id='session', context=context,
                                          config=SimpleNamespace(), context_llm_adapter=None,
                                          skill_instructions='', default_skill_policy='',
                                          use_legacy_default_prompt=False, use_codex_prompt=codex,
                                          use_runtime_prompt=runtime, include_provider_trace=False)
        assert 'strategy-draft' in prepared.system_prompt
        assert '每日评估不能宣称盘中触价执行' in prepared.system_prompt


def test_published_link_uses_real_definition_and_disappears_after_revision(service):
    from src.storage import SimulationPortfolioDefinitionRecord
    service.begin('session', 'trading')
    answer(service)
    service.validate('session', 1)
    saved = service.save('session', 1)
    assert saved['publishedStrategyId'] is None
    with service.db.session_scope() as session:
        row = SimulationPortfolioDefinitionRecord(name='网格', config_json=json.dumps({'skillId': saved['skillId']}))
        session.add(row)
        session.flush()
        definition_id = row.id
    assert service.get('session')['publishedStrategyId'] == definition_id
    assert answer(service, {**DRAFT, 'method': '新的方法'})['publishedStrategyId'] is None


def test_member_policy_allows_only_existing_workspace_capability_boundary():
    from src.services.member_policy import member_api_allowed
    for suffix in ('', '/sync', '/validate', '/save'):
        assert member_api_allowed('/api/v1/workspace/strategy-drafts/session' + suffix, 'POST')
    assert member_api_allowed('/api/v1/workspace/strategy-drafts/session', 'GET')
    assert not member_api_allowed('/api/v1/workspace/mcp-servers', 'POST')
    assert not member_api_allowed('/api/v1/agent/chat/send', 'POST')
