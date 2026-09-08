import base64
import binascii
import struct
import zlib

import pytest
from pydantic import ValidationError

from api.v1.schemas.workspace import ExpertCreateRequest, ExpertUpdateRequest
from src.services.expert_avatar import validate_avatar
from tests.test_workspace_service import workspace  # noqa: F401


def png_avatar(width=1):
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', binascii.crc32(body))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, 1, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00'))
    png += chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


def test_avatar_roundtrip_and_reset(workspace):
    avatar = png_avatar()
    expert = workspace.create_expert({'name': 'Avatar test', 'prompt': 'Research', 'avatar': avatar})
    assert workspace.get_expert(expert['id'])['avatar'] == avatar
    assert workspace.update_expert(expert['id'], {'prompt': 'Updated'})['avatar'] == avatar
    assert workspace.update_expert(expert['id'], {'avatar': None})['avatar'] is None
    assert all(item['avatar'] is None for item in workspace.list_experts() if item['builtIn'])


@pytest.mark.parametrize('avatar', ['https://example.com/avatar.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,AAAA', 'data:image/png;base64,%%%%', png_avatar(513), png_avatar()[:-12], 'x' * 180001])
def test_avatar_rejects_unsafe_or_invalid_input(avatar):
    with pytest.raises(ValueError):
        validate_avatar(avatar)
    with pytest.raises(ValidationError):
        ExpertUpdateRequest(avatar=avatar)


def test_avatar_schema_optional_and_clear_semantics():
    assert ExpertCreateRequest(name='Test', prompt='Research').avatar is None
    assert 'avatar' not in ExpertUpdateRequest(prompt='Updated').model_dump(exclude_unset=True)
    assert ExpertUpdateRequest(avatar=None).model_dump(exclude_unset=True) == {'avatar': None}
    assert ExpertCreateRequest(name='Test', prompt='Research', avatar=png_avatar()).avatar == png_avatar()


def test_avatars_are_excluded_from_frozen_discussion_inputs(workspace):
    from unittest.mock import patch
    from tests.test_workspace_discussion import payload
    workspace.update_expert(-1001, {'avatar': png_avatar()})
    with patch('src.services.workspace_service._WORKERS'):
        run = workspace.create_run(workspace.create_task(payload())['id'])
    assert all('avatar' not in member['expert'] for member in run['taskSnapshot']['discussionSnapshot']['members'])


def test_legacy_avatar_column_migration_is_idempotent(workspace):
    from sqlalchemy import inspect
    engine = workspace.db._engine
    with engine.begin() as connection:
        connection.exec_driver_sql('ALTER TABLE workspace_experts DROP COLUMN avatar')
    workspace.db._ensure_strategy_definition_schema()
    workspace.db._ensure_strategy_definition_schema()
    assert 'avatar' in {column['name'] for column in inspect(engine).get_columns('workspace_experts')}
