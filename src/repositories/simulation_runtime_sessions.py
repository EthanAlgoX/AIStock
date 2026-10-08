"""SQLite execution periods for private runtimes using the existing paper journal.

No private strategy or deployment address is bundled. Unknown legacy market/start
metadata remains NULL until an adapter supplies authoritative information.
"""
import sqlite3
import uuid
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def install(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS runtime_market_versions (
      version_id TEXT PRIMARY KEY REFERENCES versions(id), strategy_id TEXT NOT NULL,
      market TEXT, version_number INTEGER NOT NULL, spec_json TEXT NOT NULL,
      UNIQUE(strategy_id,market,version_number));
    CREATE TABLE IF NOT EXISTS runtime_execution_sessions (
      id INTEGER PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES paper_sessions(id),
      version_id TEXT NOT NULL REFERENCES runtime_market_versions(version_id),
      sequence INTEGER NOT NULL, previous_id INTEGER REFERENCES runtime_execution_sessions(id),
      status TEXT NOT NULL, started_at TEXT, observed_at TEXT NOT NULL, ended_at TEXT,
      start_kind TEXT NOT NULL, end_reason TEXT, start_state_json TEXT NOT NULL,
      end_state_json TEXT, UNIQUE(paper_id,sequence));
    CREATE UNIQUE INDEX IF NOT EXISTS runtime_one_open_period
      ON runtime_execution_sessions(paper_id) WHERE status='open';
    CREATE TABLE IF NOT EXISTS runtime_session_event_links (
      event_id INTEGER PRIMARY KEY REFERENCES paper_events(id),
      execution_session_id INTEGER NOT NULL REFERENCES runtime_execution_sessions(id));
    CREATE TABLE IF NOT EXISTS runtime_execution_batches (
      id TEXT PRIMARY KEY, execution_session_id INTEGER NOT NULL REFERENCES runtime_execution_sessions(id),
      started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runtime_session_call_links (
      call_id TEXT PRIMARY KEY REFERENCES llm_calls(id),
      execution_session_id INTEGER NOT NULL REFERENCES runtime_execution_sessions(id),
      batch_id TEXT REFERENCES runtime_execution_batches(id));
    INSERT OR IGNORE INTO runtime_market_versions(version_id,strategy_id,version_number,spec_json)
      SELECT id,strategy_id,number,spec_json FROM versions;
    CREATE TRIGGER IF NOT EXISTS runtime_version_registered AFTER INSERT ON versions BEGIN
      INSERT INTO runtime_market_versions(version_id,strategy_id,version_number,spec_json)
        VALUES(NEW.id,NEW.strategy_id,NEW.number,NEW.spec_json);
    END;
    ''')
    stamp = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    start = f'''
      INSERT INTO runtime_execution_sessions(paper_id,version_id,sequence,previous_id,status,
          started_at,observed_at,start_kind,start_state_json)
      SELECT NEW.id,NEW.version_id,
          coalesce((SELECT max(sequence) FROM runtime_execution_sessions WHERE paper_id=NEW.id),0)+1,
          (SELECT id FROM runtime_execution_sessions WHERE paper_id=NEW.id ORDER BY sequence DESC LIMIT 1),
          'open',{stamp},{stamp},'explicit_start',
          json_object('account',json(NEW.result_json),'state',
            (SELECT json(state_json) FROM paper_live_states WHERE session_id=NEW.id))
      WHERE NOT EXISTS(SELECT 1 FROM runtime_execution_sessions WHERE paper_id=NEW.id AND status='open');
    '''
    c.executescript(f'''
    CREATE TRIGGER IF NOT EXISTS runtime_period_insert AFTER INSERT ON paper_sessions
      WHEN NEW.status='RUNNING' BEGIN {start} END;
    CREATE TRIGGER IF NOT EXISTS runtime_period_restart BEFORE UPDATE OF status ON paper_sessions
      WHEN NEW.status='RUNNING' AND OLD.status IN ('STOPPED','FAILED','COMPLETED') BEGIN {start} END;
    CREATE TRIGGER IF NOT EXISTS runtime_period_stop AFTER UPDATE OF status ON paper_sessions
      WHEN NEW.status IN ('STOPPED','FAILED','COMPLETED') AND OLD.status!=NEW.status BEGIN
      UPDATE runtime_execution_sessions SET status='closed',ended_at={stamp},end_reason=NEW.status,
        end_state_json=json_object('account',json(NEW.result_json),'state',
          (SELECT json(state_json) FROM paper_live_states WHERE session_id=NEW.id))
        WHERE paper_id=NEW.id AND status='open';
    END;
    CREATE TRIGGER IF NOT EXISTS runtime_period_event AFTER INSERT ON paper_events BEGIN
      INSERT INTO runtime_session_event_links(event_id,execution_session_id)
        SELECT NEW.id,id FROM runtime_execution_sessions WHERE paper_id=NEW.session_id
        ORDER BY sequence DESC LIMIT 1;
    END;
    ''')
    # Paused accounts retain their period; execution still requires RUNNING below.
    # Pre-install events remain intentionally unassigned and the start is unknown.
    c.execute('''INSERT INTO runtime_execution_sessions(paper_id,version_id,sequence,status,
      observed_at,start_kind,start_state_json)
      SELECT p.id,p.version_id,1,'open',?,'adopted_unknown_start',
        json_object('account',json(p.result_json),'state',json(l.state_json))
      FROM paper_sessions p LEFT JOIN paper_live_states l ON l.session_id=p.id
      WHERE p.status IN ('RUNNING','PAUSED') AND NOT EXISTS(
        SELECT 1 FROM runtime_execution_sessions r WHERE r.paper_id=p.id)''', (now(),))
    c.execute("UPDATE runtime_execution_batches SET status='interrupted',ended_at=? WHERE status='running'", (now(),))
    c.commit()


def register_market(c, version_id, market):
    row = c.execute('SELECT market FROM runtime_market_versions WHERE version_id=?', (version_id,)).fetchone()
    if row is None:
        raise LookupError('Strategy version is not registered')
    if row[0] is not None and row[0] != market:
        raise ValueError('A published market/version binding is immutable')
    c.execute('UPDATE runtime_market_versions SET market=? WHERE version_id=? AND market IS NULL', (market, version_id))


def begin_batch(c, paper_id):
    # Serialize with stop/start and atomically capture the period before external calls.
    c.execute("UPDATE runtime_execution_sessions SET id=id WHERE paper_id=? AND status='open'", (paper_id,))
    row = c.execute("SELECT r.id FROM runtime_execution_sessions r JOIN paper_sessions p ON p.id=r.paper_id WHERE r.paper_id=? AND r.status='open' AND p.status='RUNNING'", (paper_id,)).fetchone()
    if row is None:
        raise ValueError('No active execution period')
    batch = uuid.uuid4().hex
    c.execute('INSERT INTO runtime_execution_batches VALUES(?,?,?,NULL,?)', (batch,row[0],now(),'running'))
    return row[0], batch


def claim_current(c, paper_id, period_id):
    if period_id is None:
        raise ValueError('Execution period is required for ledger writes')
    return c.execute("UPDATE runtime_execution_sessions SET id=id WHERE id=? AND paper_id=? AND status='open' AND EXISTS(SELECT 1 FROM paper_sessions WHERE id=? AND status='RUNNING')", (period_id,paper_id,paper_id)).rowcount == 1


def finish_batch(c, batch_id, status):
    c.execute('UPDATE runtime_execution_batches SET status=?,ended_at=? WHERE id=?', (status,now(),batch_id))


def link_call(c, call_id, context):
    if context.get('execution_session_id') is not None:
        c.execute('INSERT INTO runtime_session_call_links VALUES(?,?,?)',
                  (call_id,context['execution_session_id'],context.get('batch_id')))


def describe(c, paper_id):
    c.row_factory = sqlite3.Row
    rows = c.execute('''SELECT r.*,v.market,v.version_number FROM runtime_execution_sessions r
      JOIN runtime_market_versions v ON v.version_id=r.version_id WHERE paper_id=? ORDER BY sequence''', (paper_id,)).fetchall()
    return [dict(row) for row in rows]
