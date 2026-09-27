"""Read-only SQLite ledger audit. Reports missing evidence without inventing it."""
import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def audit(database, engine):
    connection = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('BEGIN')  # One consistent snapshot while schedulers keep writing.
        report = dict(observedAt=datetime.now(timezone.utc).isoformat(), engine=engine,
                      integrity=connection.execute('PRAGMA quick_check').fetchone()[0], accounts=[])
        if engine == 'native':
            for row in connection.execute('SELECT * FROM simulation_portfolio_runs'):
                trades, run_count = [], 0
                for run in connection.execute("SELECT result_snapshot_json FROM simulation_runs WHERE strategy_version_id=? AND execution_mode='portfolio_day' AND status='completed'", (row['strategy_version_id'],)):
                    run_count += 1
                    trades.extend(json.loads(run[0]).get('trades', []))
                orders = connection.execute('SELECT * FROM simulation_orders WHERE account_id=?', (row['account_id'],)).fetchall()
                fills = connection.execute('SELECT count(*) FROM simulation_fills f JOIN simulation_orders o ON f.order_id=o.id WHERE o.account_id=?', (row['account_id'],)).fetchone()[0]
                config = json.loads(row['config_json'])
                report['accounts'].append(dict(id=row['id'], name=config['name'], mode=row['mode'], status=row['status'],
                    versionId=row['strategy_version_id'], days=run_count, trades=len(trades), orders=len(orders), fills=fills,
                    missingReasons=sum(not bool(t.get('reason')) for t in trades),
                    missingDirectDecisionEvidence=sum(not bool(t.get('decisionEvidence')) for t in trades),
                    countMismatch=len(orders) != len(trades) or fills != sum(t['status'] == 'filled' for t in trades)))
        else:
            for row in connection.execute('SELECT * FROM paper_sessions'):
                result = json.loads(row['result_json'] or '{}')
                actions = [d for d in result.get('decisions', []) if d.get('action') in {'BUY', 'SELL', 'HEDGE_OPEN', 'HEDGE_CLOSE'}]
                archived = [json.loads(d[0]) for d in connection.execute("SELECT payload_json FROM paper_events WHERE session_id=? AND kind IN ('fill','decision','trade')", (row['id'],))]
                version = connection.execute('SELECT id FROM versions WHERE id=?', (row['version_id'],)).fetchone()
                report['accounts'].append(dict(id=row['id'], versionId=row['version_id'], status=row['status'],
                    trades=len(actions), buy=sum(d['action'] == 'BUY' for d in actions), sell=sum(d['action'] == 'SELL' for d in actions),
                    missingReasons=sum(not bool(d.get('decision_reason') or d.get('reason')) for d in actions),
                    missingFees=sum(d.get('fee') is None for d in actions),
                    missingSlippage=sum(d.get('slippage') is None for d in actions),
                    unarchivedTrades=sum(d not in archived for d in actions), missingVersion=version is None,
                    countMismatch=result.get('metrics', {}).get('trade_count') != len(actions)))
            report['backtests'] = []
            for row in connection.execute('SELECT id,version_id,result_json FROM backtests'):
                trades = json.loads(row['result_json'] or '{}').get('trades', [])
                report['backtests'].append(dict(id=row['id'], versionId=row['version_id'], trades=len(trades),
                    missingReasons=sum(not bool(t.get('decision_reason') or t.get('reason')) for t in trades)))
            report['archivedResults'] = []
            if connection.execute("SELECT 1 FROM sqlite_master WHERE name='runtime_document_heads'").fetchone():
                import hashlib
                for row in connection.execute("SELECT d.* FROM runtime_document_heads h JOIN runtime_documents d ON d.id=h.document_id WHERE d.kind='backtest_result'"):
                    raw = row['content']
                    value = json.loads(raw)
                    trades = value.get('trades', [])
                    report['archivedResults'].append(dict(key=row['document_key'], documentId=row['id'],
                        hashValid=hashlib.sha256(raw).hexdigest() == row['sha256'], trades=len(trades),
                        missingReasons=sum(not bool(t.get('decision_reason') or t.get('reason') or t.get('exit_reason')) for t in trades)))
        return report
    finally:
        connection.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('--engine', choices=['native', 'private'], required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.database, args.engine), ensure_ascii=False, indent=2))
