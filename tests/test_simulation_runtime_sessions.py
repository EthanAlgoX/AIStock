import json
import sqlite3
import pytest
from src.repositories import simulation_runtime_sessions as periods


@pytest.fixture
def db(tmp_path):
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
    periods.install(c)
    yield c
    c.close()


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
