import json
import sqlite3
import pytest
from src.repositories import simulation_runtime_sessions as periods


@pytest.fixture
def source_db(tmp_path):
    c = sqlite3.connect(tmp_path / 'runtime.db')
    c.execute('PRAGMA foreign_keys=ON')
    c.executescript('''
    CREATE TABLE versions(id TEXT PRIMARY KEY,strategy_id TEXT,number INTEGER,spec_json TEXT);
    CREATE TABLE paper_sessions(id TEXT PRIMARY KEY,version_id TEXT,status TEXT,result_json TEXT);
    CREATE TABLE paper_live_states(session_id TEXT PRIMARY KEY,state_json TEXT);
    CREATE TABLE paper_events(id INTEGER PRIMARY KEY,session_id TEXT,payload_json TEXT);
    CREATE TABLE llm_calls(id TEXT PRIMARY KEY);
    INSERT INTO versions VALUES('v1','strategy',1,'{}');
    INSERT INTO paper_sessions VALUES('account','v1','RUNNING','{"equity":100}');
    INSERT INTO paper_live_states VALUES('account','{"cash":100,"positions":{}}');
    ''')
    yield c
    c.close()


@pytest.fixture
def db(source_db):
    periods.install(source_db)
    return source_db


def test_legacy_paused_account_is_adopted_without_executing_or_resetting_ledger(source_db):
    source_db.execute("UPDATE paper_sessions SET status='PAUSED' WHERE id='account'")
    source_db.execute("INSERT INTO paper_events VALUES(42,'account','{}')")
    source_db.execute("INSERT INTO llm_calls VALUES('legacy-call')")
    original_account = source_db.execute('SELECT version_id,result_json FROM paper_sessions').fetchone()
    original_state = source_db.execute('SELECT state_json FROM paper_live_states').fetchone()[0]
    source_db.commit()

    periods.install(source_db)
    sessions = periods.describe(source_db, 'account')
    assert len(sessions) == 1
    adopted = sessions[0]
    assert adopted['status'] == 'open'
    assert adopted['start_kind'] == 'adopted_unknown_start'
    assert adopted['started_at'] is None
    assert adopted['observed_at']
    assert adopted['market'] is None
    assert adopted['sequence'] == 1 and adopted['previous_id'] is None
    assert json.loads(adopted['start_state_json']) == {
        'account': json.loads(original_account[1]), 'state': json.loads(original_state),
    }
    assert source_db.execute('SELECT status FROM paper_sessions').fetchone()[0] == 'PAUSED'
    with pytest.raises(ValueError, match='No active execution period'):
        periods.begin_batch(source_db, 'account')
    assert not periods.claim_current(source_db, 'account', adopted['id'])
    assert source_db.execute('SELECT COUNT(*) FROM runtime_execution_batches').fetchone()[0] == 0

    periods.install(source_db)
    assert periods.describe(source_db, 'account') == sessions
    source_db.execute("UPDATE paper_sessions SET status='RUNNING' WHERE id='account'")
    resumed, _ = periods.begin_batch(source_db, 'account')
    assert resumed == adopted['id']
    assert periods.claim_current(source_db, 'account', resumed)
    periods.install(source_db)
    assert periods.describe(source_db, 'account') == sessions

    source_db.execute("UPDATE paper_sessions SET status='PAUSED' WHERE id='account'")
    with pytest.raises(ValueError, match='No active execution period'):
        periods.begin_batch(source_db, 'account')
    assert not periods.claim_current(source_db, 'account', resumed)
    source_db.execute("UPDATE paper_sessions SET status='RUNNING' WHERE id='account'")
    assert periods.begin_batch(source_db, 'account')[0] == resumed
    assert periods.describe(source_db, 'account') == sessions
    assert tuple(source_db.execute('SELECT version_id,result_json FROM paper_sessions').fetchone()) == original_account
    assert source_db.execute('SELECT state_json FROM paper_live_states').fetchone()[0] == original_state
    assert source_db.execute('SELECT id FROM paper_events').fetchone()[0] == 42
    assert source_db.execute('SELECT id FROM llm_calls').fetchone()[0] == 'legacy-call'
    assert source_db.execute('SELECT COUNT(*) FROM runtime_session_event_links').fetchone()[0] == 0
    assert source_db.execute('SELECT COUNT(*) FROM runtime_session_call_links').fetchone()[0] == 0


@pytest.mark.parametrize('status', ['STOPPED', 'FAILED', 'COMPLETED'])
def test_terminal_legacy_accounts_start_explicitly_instead_of_being_adopted(source_db, status):
    source_db.execute('UPDATE paper_sessions SET status=? WHERE id=?', (status, 'account'))
    periods.install(source_db)
    assert periods.describe(source_db, 'account') == []
    source_db.execute("UPDATE paper_sessions SET status='RUNNING' WHERE id='account'")
    period_id, _ = periods.begin_batch(source_db, 'account')
    session = periods.describe(source_db, 'account')[0]
    assert session['id'] == period_id
    assert session['start_kind'] == 'explicit_start'
    assert session['started_at'] is not None
    assert session['sequence'] == 1 and session['previous_id'] is None
    assert json.loads(session['start_state_json'])['state']['cash'] == 100


def test_stop_restart_fences_old_batch_and_preserves_account(db):
    first, batch = periods.begin_batch(db, 'account')
    db.execute("INSERT INTO llm_calls VALUES('call')")
    periods.link_call(db, 'call', dict(execution_session_id=first,batch_id=batch))
    db.execute("INSERT INTO paper_events VALUES(1,'account','{}')")
    db.execute("UPDATE paper_sessions SET status='STOPPED' WHERE id='account'")
    db.execute("UPDATE paper_sessions SET status='RUNNING' WHERE id='account'")
    assert not periods.claim_current(db, 'account', first)
    second, _ = periods.begin_batch(db, 'account')
    assert second != first and periods.claim_current(db, 'account', second)
    db.execute("INSERT INTO paper_events VALUES(2,'account','{}')")
    assert db.execute('SELECT execution_session_id FROM runtime_session_event_links ORDER BY event_id').fetchall() == [(first,), (second,)]
    rows = periods.describe(db, 'account')
    assert rows[0]['started_at'] is None
    assert rows[0]['end_reason'] == 'STOPPED'
    assert rows[1]['previous_id'] == first and rows[1]['started_at'] is not None
    assert json.loads(rows[1]['start_state_json'])['state']['cash'] == 100
    assert db.execute('SELECT execution_session_id FROM runtime_session_call_links').fetchone()[0] == first


def test_pause_and_process_restart_keep_period_and_market_binding(db):
    first, _ = periods.begin_batch(db, 'account')
    db.execute("UPDATE paper_sessions SET status='PAUSED' WHERE id='account'")
    assert not periods.claim_current(db, 'account', first)
    db.execute("UPDATE paper_sessions SET status='RUNNING' WHERE id='account'")
    periods.install(db)
    assert periods.begin_batch(db, 'account')[0] == first
    periods.register_market(db, 'v1', 'CRYPTO')
    periods.register_market(db, 'v1', 'CRYPTO')
    with pytest.raises(ValueError, match='immutable'):
        periods.register_market(db, 'v1', 'US')
    assert periods.describe(db, 'account')[0]['market'] == 'CRYPTO'
