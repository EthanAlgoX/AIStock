"""Cross-page contracts exercised against a real isolated SQLite ledger."""
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from src.services.workspace_service import WorkspaceService, WorkspaceError
from src.services.workspace_inputs import history, freeze_trading_inputs, run_usage
from src.services.workspace_external_runs import begin, execute
from src.storage import DatabaseManager, WorkspaceRunRecord, OwnerCallAttributionRecord, LLMUsage


@pytest.fixture
def workspace(tmp_path):
    DatabaseManager.reset_instance()
    db = DatabaseManager(f"sqlite:///{tmp_path / 'flows.db'}")
    yield WorkspaceService(db)
    DatabaseManager.reset_instance()


def saved(workspace, index=0, *, kind='research', subject=None, market='CN'):
    run_id = begin(workspace, kind, f'report {index}', market, subject or {'stock':'600519'}, {})
    with workspace.db.session_scope() as session:
        row = session.get(WorkspaceRunRecord, run_id)
        row.created_at = datetime(2026, 9, 1) + timedelta(seconds=index)
    return run_id


def test_history_is_paginated_filtered_and_counts_all_rows(workspace):
    for index in range(105):
        saved(workspace, index)
    last = saved(workspace, 106, kind='expert_review')
    page = history(workspace, stock='600519', offset=100, limit=30)
    assert page['total'] == 106 and len(page['items']) == 6
    assert page['statusCounts'] == {'queued':106}
    assert history(workspace, kind='expert_review')['items'][0]['id'] == last
    assert history(workspace, query='report 106')['total'] == 1
    assert history(workspace, start='2026-09-02')['total'] == 0
    assert history(workspace, query='%')['total'] == 0
    with pytest.raises(WorkspaceError):
        history(workspace, start='2026-09-99')


def test_candidate_deep_research_is_indexed_without_copying_report(workspace):
    run_id = saved(workspace, kind='screening', subject={'industry':'test'})
    workspace._store_artifact(run_id, 'CandidateResearch', 'deep research', {'symbol':'AAPL', 'report':{'status':'failed'}})
    assert history(workspace, stock='AAPL')['items'][0]['id'] == run_id
    assert history(workspace, stock='MSFT')['total'] == 0
    assert len(workspace.get_run(run_id)['artifacts']) == 1


def test_trading_freezes_explicit_candidates_and_rejects_unusable_sources(workspace):
    source = saved(workspace, kind='screening', subject={})
    workspace._store_artifact(source, 'CandidateList', 'candidates', {'status':'success','result':{'candidates':[{'code':'600519'}, {'symbol':'600519'}, {'symbol':'AAPL'}]}})
    task = {'market':'CN','subject':{'universeMode':'screening','sourceRunId':source}}
    with pytest.raises(WorkspaceError):
        freeze_trading_inputs(workspace, task)
    workspace._finish_run(source, 'completed')
    frozen = freeze_trading_inputs(workspace, task)
    assert frozen['symbols'] == ['600519']
    assert frozen['sourceRunId'] == source and frozen['asOf']
    assert not frozen['executionEnabled']
    with pytest.raises(WorkspaceError):
        freeze_trading_inputs(workspace, {'market':'CN','subject':{'universeMode':'screening'}})
    with pytest.raises(WorkspaceError):
        freeze_trading_inputs(workspace, {'market':'US','subject':task['subject']})


def test_external_run_exists_while_running_and_preserves_failure(workspace):
    run_id = saved(workspace)
    def callback():
        assert workspace.get_run(run_id)['status'] == 'running'
        raise RuntimeError('provider timeout')
    with pytest.raises(RuntimeError):
        execute(workspace, run_id, callback, 'ResearchReport')
    run = workspace.get_run(run_id)
    assert run['status'] == 'failed' and run['errorMessage'] == 'provider timeout'
    assert run['artifacts'] == []
    with pytest.raises(WorkspaceError, match='原执行队列'):
        workspace.cancel_run(run_id)


def test_run_usage_excludes_other_requests_and_distinguishes_missing(workspace):
    with workspace.db.session_scope() as session:
        usage = LLMUsage(call_type='agent',model='test',prompt_tokens=4,completion_tokens=6,total_tokens=10)
        session.add(usage)
        session.flush()
        session.add(OwnerCallAttributionRecord(usage_id=usage.id,request_id='owned-run',feature='research'))
    assert run_usage(workspace.db, 'owned-run')['tokens'] == 10
    assert not run_usage(workspace.db, 'another-run')['recorded']


def test_history_and_sources_do_not_cross_databases(workspace, tmp_path):
    run_id = saved(workspace)
    other_db = DatabaseManager.open_workspace(f"sqlite:///{tmp_path / 'other.db'}", "a" * 32)
    try:
        other = WorkspaceService(other_db)
        from src.workspace_scope import workspace_scope
        with workspace_scope(other_db):
            assert history(other)['total'] == 0
            with pytest.raises(WorkspaceError):
                other.get_run(run_id)
    finally:
        other_db._engine.dispose()


def test_invalid_stock_discussion_does_not_enter_worker(workspace):
    task = workspace.create_task({'kind':'expert_review','market':'GLOBAL','name':'ambiguous','objective':'研究简称',
                                  'subject':{'stock':'中兴国际'}, 'capabilities':{'expertIds':[-1001]}})
    with patch('src.services.workspace_service._WORKERS') as workers:
        with pytest.raises(WorkspaceError):
            workspace.create_run(task['id'])
        workers.submit.assert_not_called()
    assert history(workspace)['total'] == 0


def test_concurrent_first_visits_seed_one_expert_catalog(workspace):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    barrier = Barrier(6)
    def read(_):
        barrier.wait(timeout=10)
        return WorkspaceService(workspace.db).list_experts()
    with ThreadPoolExecutor(max_workers=6) as pool:
        catalogs = list(pool.map(read, range(6)))
    assert all(len(catalog) == 14 for catalog in catalogs)
    assert len(workspace.list_experts()) == 14
