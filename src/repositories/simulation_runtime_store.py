"""SQLite evidence store for deployment-private simulation engines.

No strategy, credential, filesystem root or server address is bundled here.
Files may be exported as caches; SQLite holds versioned bytes and call evidence.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


class SimulationRuntimeStore:
    def __init__(self, database):
        self.database = str(Path(database).resolve())
        with self.connection() as connection:
            connection.executescript('''
                CREATE TABLE IF NOT EXISTS runtime_documents (
                    id INTEGER PRIMARY KEY, document_key TEXT NOT NULL,
                    kind TEXT NOT NULL, sha256 TEXT NOT NULL, content BLOB NOT NULL,
                    metadata_json TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(document_key, sha256));
                CREATE TABLE IF NOT EXISTS runtime_document_heads (
                    document_key TEXT PRIMARY KEY,
                    document_id INTEGER NOT NULL REFERENCES runtime_documents(id));
                CREATE INDEX IF NOT EXISTS ix_runtime_document_kind ON runtime_documents(kind,id);
            ''')

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.database, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def put(self, key, content, *, kind='artifact', metadata=None):
        """Atomically retain immutable content and switch the current revision."""
        if not isinstance(content, bytes):
            raise TypeError('Document content must be bytes')
        digest = hashlib.sha256(content).hexdigest()
        with self.connection() as connection:
            connection.execute('''INSERT OR IGNORE INTO runtime_documents
                (document_key,kind,sha256,content,metadata_json,created_at) VALUES (?,?,?,?,?,?)''',
                               (key, kind, digest, content, encode(metadata or {}), now()))
            ident = connection.execute('SELECT id FROM runtime_documents WHERE document_key=? AND sha256=?',
                                       (key, digest)).fetchone()['id']
            connection.execute('''INSERT INTO runtime_document_heads VALUES (?,?)
                ON CONFLICT(document_key) DO UPDATE SET document_id=excluded.document_id''', (key, ident))
        return ident

    def get(self, key):
        with self.connection() as connection:
            row = connection.execute('''SELECT d.* FROM runtime_documents d JOIN runtime_document_heads h
                ON h.document_id=d.id WHERE h.document_key=?''', (key,)).fetchone()
            if row is None:
                raise KeyError(key)
            return self._content(row)

    @staticmethod
    def _content(row):
        content = bytes(row['content'])
        if hashlib.sha256(content).hexdigest() != row['sha256']:
            raise ValueError('SQLite simulation document checksum mismatch')
        return content

    def document(self, ident):
        with self.connection() as connection:
            row = connection.execute('SELECT * FROM runtime_documents WHERE id=?', (ident,)).fetchone()
            if row is None:
                raise KeyError(ident)
            content = self._content(row)
            return dict(id=row['id'], key=row['document_key'], kind=row['kind'], sha256=row['sha256'],
                        metadata=json.loads(row['metadata_json']), createdAt=row['created_at'], content=content)

    def page(self, kind, *, before=None, limit=50):
        """Cursor pagination; summaries never truncate stored document/call bodies."""
        if kind != 'documents' or not 1 <= limit <= 100:
            raise ValueError('Invalid archive page')
        table, columns = {
            'documents': ('runtime_documents', 'id,document_key,kind,sha256,metadata_json,created_at,length(content) AS bytes'),
        }[kind]
        where, params = (' WHERE id<?', [before]) if before is not None else ('', [])
        with self.connection() as connection:
            rows = connection.execute(f'SELECT {columns} FROM {table}{where} ORDER BY id DESC LIMIT ?',
                                      [*params, limit + 1]).fetchall()
        items = [dict(row) for row in rows[:limit]]
        return {'items': items, 'nextCursor': items[-1]['id'] if len(rows) > limit else None}
