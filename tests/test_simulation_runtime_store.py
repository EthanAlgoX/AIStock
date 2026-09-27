"""Real SQLite durability, concurrent writes, pagination and transport failures."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest
from src.repositories.simulation_runtime_store import SimulationRuntimeStore


def test_documents_survive_files_restart_and_keep_revisions(tmp_path):
    path = tmp_path / 'runtime.db'
    store = SimulationRuntimeStore(path)
    original = b'{"curve":[1,2],"model":"fixture"}'
    first = store.put('run/1', original, kind='backtest')
    assert store.put('run/1', original) == first
    second = store.put('run/1', b'{"curve":[1,2,3]}', kind='backtest')
    fresh = SimulationRuntimeStore(path)
    assert fresh.get('run/1') == b'{"curve":[1,2,3]}'
    assert fresh.document(first)['content'] == original
    assert fresh.page('documents', limit=1)['nextCursor'] == second
    assert fresh.page('documents', before=second)['items'][0]['id'] == first
    with sqlite3.connect(path) as connection:
        connection.execute('UPDATE runtime_documents SET content=? WHERE id=?', (b'corrupt', second))
    with pytest.raises(ValueError, match='checksum'):
        fresh.get('run/1')


def test_concurrent_snapshots_are_durable_and_paginated(tmp_path):
    path = tmp_path / 'runtime.db'
    store = SimulationRuntimeStore(path)
    def run(index):
        return store.put(f'run/{index}', b'x' * 12000, kind='result')
    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(run, range(25)))
    assert len(set(ids)) == 25
    cursor, records = None, []
    while True:
        page = SimulationRuntimeStore(path).page('documents', before=cursor, limit=7)
        records.extend(page['items'])
        cursor = page['nextCursor']
        if cursor is None:
            break
    assert len(records) == 25
    assert all(row['bytes'] == 12000 for row in records)
    assert all(store.get(f'run/{index}') == b'x' * 12000 for index in range(25))
