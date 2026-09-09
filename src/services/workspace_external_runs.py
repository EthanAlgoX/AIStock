"""Bridge existing executors into the run ledger without introducing another queue."""
import json
import uuid
from src.storage import WorkspaceRunRecord, WorkspaceTaskRecord, utc_naive_now
from src.services.user_activity_service import activity_scope


def begin(workspace, kind, name, market, subject, config, *, run_id=None, trigger='agent_tool', parent=None):
    run_id, task_id = run_id or uuid.uuid4().hex, uuid.uuid4().hex
    snapshot = dict(kind=kind, name=name, market=market, subject=subject, config=config,
                    objective=name, capabilities={})
    with workspace.db.session_scope() as session:
        session.add(WorkspaceTaskRecord(id=task_id, task_kind=kind, name=name, market=market,
                    objective=name, subject_json=json.dumps(subject), config_json=json.dumps(config),
                    capability_bindings_json='{}', enabled=False))
        session.flush()
        session.add(WorkspaceRunRecord(id=run_id, task_id=task_id, task_kind=kind, status='queued',
                    trigger_type=trigger, task_snapshot_json=json.dumps(snapshot),
                    result_summary_json=json.dumps({'parentRunId': parent, 'externalExecutor': True})))
    return run_id


def execute(workspace, run_id, callback, artifact_type):
    with workspace.db.session_scope() as session:
        row = session.get(WorkspaceRunRecord, run_id)
        row.status, row.started_at = 'running', utc_naive_now()
        kind = row.task_kind
    with activity_scope(kind, run_id):
        try:
            result = callback()
            if not result or (isinstance(result, dict) and 'status' in result and result['status'] != 'success'):
                workspace._finish_run(run_id, 'failed', error_code='external_failed',
                                      error_message=str((result or {}).get('message') or '执行未生成报告。'))
            else:
                workspace._store_artifact(run_id, artifact_type, '正式执行结果', result,
                                          text=result.get('result') if isinstance(result.get('result'), str) else None)
                workspace._finish_run(run_id, 'completed')
            return result
        except Exception as exc:
            workspace._finish_run(run_id, 'failed', error_code='external_failed', error_message=str(exc))
            raise
