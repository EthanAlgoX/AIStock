from src.services.simulation_execution_ledger import normalize_executions


def test_only_confirmed_positive_execution_records_are_mapped():
    fill=dict(timestamp='2026-01-01T00:00:00Z', action='BUY', symbol='BTCUSDT',qty=.125,close=80000,reason='example')
    records=[fill,dict(fill,action='SELL'),dict(fill,action='HOLD'),dict(fill,action='ALLOW'),dict(fill,qty=0),dict(fill,close=float('nan'))]
    result=normalize_executions(records)
    assert len(result)==2
    assert [x['side'] for x in result]==['buy','sell']
    assert result[0]['price']==80000
    assert result[0]['fee'] is None
    assert result[0]['timestamp']==fill['timestamp']


def test_preserves_multiple_executions_at_one_time_and_known_zero_fee():
    fill=dict(timestamp='2026-01-01',action='BUY',symbol='EXAMPLE',qty=2,close=10,fee=0)
    result=normalize_executions([fill,fill])
    assert len(result)==2 and result[0]['id']!=result[1]['id']
    assert result[0]['fee']==0
