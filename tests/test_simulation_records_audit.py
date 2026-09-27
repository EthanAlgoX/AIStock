"""Missing evidence must be reported rather than replaced by made-up reasons."""
import json
import sqlite3
from scripts.audit_simulation_records import audit


def test_private_audit_checks_actual_journal_and_costs(tmp_path):
    path = tmp_path / 'runtime.db'
    with sqlite3.connect(path) as c:
        c.executescript('''CREATE TABLE paper_sessions(id,version_id,status,result_json);
            CREATE TABLE versions(id); CREATE TABLE paper_events(session_id,kind,payload_json);
            CREATE TABLE backtests(id,version_id,result_json);''')
        trade = dict(action='SELL', symbol='BTC', qty=1, close=100, reason='risk limit', timestamp='2026-01-01')
        c.execute('INSERT INTO versions VALUES (?)', ('v1',))
        c.execute('INSERT INTO paper_sessions VALUES (?,?,?,?)', ('s1','v1','RUNNING',json.dumps(dict(decisions=[trade],metrics={'trade_count':1}))))
        c.execute('INSERT INTO backtests VALUES (?,?,?)', ('b1','v1',json.dumps({'trades':[{'reason':None}]})))
    before = audit(path, 'private')
    assert before['accounts'][0]['unarchivedTrades'] == 1
    assert before['accounts'][0]['missingFees'] == 1
    assert before['accounts'][0]['missingReasons'] == 0
    assert before['backtests'][0]['missingReasons'] == 1
    with sqlite3.connect(path) as c:
        c.execute('INSERT INTO paper_events VALUES (?,?,?)', ('s1','fill',json.dumps(trade)))
    after = audit(path, 'private')
    assert after['accounts'][0]['unarchivedTrades'] == 0
    assert after['accounts'][0]['missingFees'] == 1
