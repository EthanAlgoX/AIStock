"""Owner-only bridge to a deployment-managed private simulation runtime.

The remote contract uses negative integer identifiers, leaving native IDs intact.
No request may select an endpoint, upload executable code or choose a workspace.
"""
import os
import math
import re
from urllib.parse import urlsplit

import requests
from fastapi import HTTPException
from pydantic import ValidationError
from src.workspace_scope import current_workspace_database


class SimulationRuntimeService:
    def __init__(self):
        self.url = os.environ.get('SIMULATION_RUNTIME_URL', '').strip().rstrip('/')
        if current_workspace_database() is not None:
            self.url = ''
        if self.url:
            parsed = urlsplit(self.url)
            if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError('Invalid simulation runtime URL')

    def _configured(self):
        # A cached owner instance must not survive a later workspace switch.
        return bool(self.url) and current_workspace_database() is None

    def request(self, method, path, payload=None, *, missing_is_404=False):
        if not self._configured():
            raise HTTPException(404, 'Private simulation runtime unavailable')
        try:
            with requests.Session() as client:
                client.trust_env = False  # Internal traffic must not traverse a host proxy.
                response = client.request(method, self.url + path, json=payload,
                                          timeout=(3, 20), allow_redirects=False)
        except requests.RequestException:
            raise HTTPException(503, 'Private simulation runtime unavailable; retry later') from None
        if not response.ok or response.is_redirect:
            # Provider errors may contain deployment paths or secrets; do not proxy them.
            if missing_is_404 and response.status_code == 404:
                raise HTTPException(404, 'Source operation receipt not found')
            raise HTTPException(422 if response.status_code in {400, 404, 409, 422} else 503,
                                'Private simulation runtime rejected the operation; inspect its run status')
        try:
            value = response.json()
            # Legacy detail/history bodies may be large, but invalid numbers
            # must never break serialization of native data in a merged view.
            self._validate_json(value, bounded=False)
            return value
        except ValueError:
            raise HTTPException(502, 'Invalid simulation runtime response') from None

    def items(self, path):
        if not self._configured():
            return []
        try:
            result = self.request('GET', path)['items']
            if not isinstance(result, list) or any(not isinstance(row, dict) or type(row.get('id')) is not int or row['id'] >= 0 for row in result):
                raise ValueError('Invalid identifiers')
            if len({row['id'] for row in result}) != len(result):
                raise ValueError('Duplicate identifiers')
            return result
        except (HTTPException, ValueError, KeyError, TypeError):
            # Native strategies remain accessible; /runtime-status surfaces failure.
            return []

    def status(self):
        if not self._configured():
            return {'configured': False, 'available': False}
        try:
            self.request('GET', '/health')
            return {'configured': True, 'available': True}
        except HTTPException:
            return {'configured': True, 'available': False}

    def overview(self):
        if not self._configured():
            return {'items': [], 'runtime': {'configured': False, 'available': False}}
        try:
            rows = self.request('GET', '/overview')['items']
            if not isinstance(rows, list) or any(not isinstance(row, dict) or type(row.get('id')) is not int
                                               or row['id'] >= 0 or not isinstance(row.get('curve'), list) for row in rows):
                raise ValueError('Invalid overview response')
            if len({row['id'] for row in rows}) != len(rows):
                raise ValueError('Duplicate identifiers')
            return {'items': rows, 'runtime': {'configured': True, 'available': True}}
        except (HTTPException, ValueError, KeyError, TypeError):
            return {'items': [], 'runtime': {'configured': True, 'available': False}}

    def capabilities(self):
        """Probe only the versioned extension; legacy endpoints remain independent."""
        from api.v1.schemas.simulation_runtime import SourceCapabilities
        if not self._configured():
            return {'configured': False, 'available': False, 'capabilities': None, 'legacy': False}
        try:
            value = self.request('GET', '/capabilities', missing_is_404=True)
            self._validate_json(value)
            capability = SourceCapabilities.model_validate(value).model_dump()
            return {'configured': True, 'available': True, 'capabilities': capability, 'legacy': False}
        except HTTPException as exc:
            # Only an absent extension identifies a legacy adapter. A failed or
            # invalid versioned contract must not enable legacy write controls.
            return {'configured': True, 'available': False, 'capabilities': None, 'legacy': exc.status_code == 404}
        except (ValidationError, ValueError, TypeError):
            return {'configured': True, 'available': False, 'capabilities': None, 'legacy': False}

    @staticmethod
    def _validate_json(value, depth=0, *, bounded=True):
        """Reject non-JSON/non-finite evidence before passing it to a browser."""
        if depth > 20:
            raise ValueError('Evidence nesting exceeds contract')
        if type(value) is float and not math.isfinite(value):
            raise ValueError('Non-finite source value')
        if bounded and isinstance(value, str) and len(value) > 8000:
            raise ValueError('Source text exceeds contract')
        if isinstance(value, dict):
            if (bounded and len(value) > 1000) or any(not isinstance(key, str) for key in value):
                raise ValueError('Invalid source object')
            for nested in value.values():
                SimulationRuntimeService._validate_json(nested, depth + 1, bounded=bounded)
        elif isinstance(value, list):
            if bounded and len(value) > 1000:
                raise ValueError('Source list exceeds contract')
            for nested in value:
                SimulationRuntimeService._validate_json(nested, depth + 1, bounded=bounded)
        elif value is not None and type(value) not in (str, int, float, bool):
            raise ValueError('Invalid source value')

    def source_request(self, method, path, payload=None):
        """Allowlisted source operations; never a generic private API proxy."""
        from api.v1.schemas.simulation_runtime import (
            CandidatePreview, SourceBacktests, SourceOperation, SourceResearches,
            SourceStrategies, SourceTask, SourceTasks, SourceVersions,
        )
        if not self._configured():
            raise HTTPException(404, 'Private simulation runtime unavailable')
        status = self.capabilities()
        if not status['available']:
            raise HTTPException(503, 'Source strategy workspace unavailable; legacy strategies remain accessible')
        capability = status['capabilities']
        source_id = r'[A-Za-z0-9_-]{1,80}'
        request_id = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        routes = [
            ('GET', r'/strategies', SourceStrategies, 'read'),
            ('GET', r'/strategies/-[1-9][0-9]*/versions', SourceVersions, 'read'),
            ('GET', r'/strategies/-[1-9][0-9]*/backtests', SourceBacktests, 'read'),
            ('GET', r'/strategies/-[1-9][0-9]*/research', SourceResearches, 'read'),
            ('GET', r'/tasks', SourceTasks, 'read'),
            ('GET', rf'/tasks/{source_id}', SourceTask, 'read'),
            ('POST', rf'/tasks/{source_id}/cancel', SourceTask, 'cancelTasks'),
            ('GET', rf'/versions/{source_id}/candidate-preview', CandidatePreview, 'read'),
            ('POST', rf'/versions/{source_id}/candidate-paper', SourceOperation, 'candidatePaper'),
            ('POST', rf'/versions/{source_id}/research', SourceOperation, 'research'),
            ('GET', rf'/requests/{request_id}', SourceOperation, 'read'),
        ]
        route = next((row for row in routes if row[0] == method and re.fullmatch(row[1], path)), None)
        if route is None:
            raise HTTPException(422, 'Unsupported source operation')
        if not capability['operations'][route[3]]:
            raise HTTPException(409, 'Source operation is not supported by this engine')
        if method == 'POST' and path.endswith(('/candidate-paper', '/research')):
            if not capability['asyncRequests'] or not capability['idempotentRequests']:
                raise HTTPException(409, 'Source operation requires asynchronous idempotent receipts')
            kind = 'research' if path.endswith('/research') else 'candidate-paper'
            keys = {'requestId', 'sourceBacktestId', 'budget'} if kind == 'research' else {'requestId'}
            if (not isinstance(payload, dict) or set(payload) != keys
                    or not isinstance(payload.get('requestId'), str)
                    or not re.fullmatch(request_id, payload['requestId'])):
                raise HTTPException(422, 'Invalid source operation request')
            if kind == 'research' and (type(payload['budget']) is not int or not 1 <= payload['budget'] <= 16
                    or not isinstance(payload['sourceBacktestId'], str)
                    or not re.fullmatch(source_id, payload['sourceBacktestId'])):
                raise HTTPException(422, 'Invalid source research request')
        try:
            if path.startswith('/requests/'):
                value = self.request(method, path, payload, missing_is_404=True)
            else:
                value = self.request(method, path, payload)
            self._validate_json(value)
            result = route[2].model_validate(value).model_dump()
            # Correlate resource identity as well as shape. A stale/provider result
            # must never send the UI to another candidate or operation.
            if path.startswith('/strategies/'):
                strategy_id = int(path.split('/')[2])
                if path.endswith('/versions') and any(row['strategyId'] != strategy_id for row in result['items']):
                    raise ValueError('Source strategy mismatch')
            if path.startswith('/versions/') and result.get('versionId') != path.split('/')[2]:
                raise ValueError('Source version mismatch')
            if path.startswith('/requests/') and result['requestId'] != path.split('/')[2]:
                raise ValueError('Source receipt mismatch')
            if path.startswith('/tasks/') and result['id'] != path.split('/')[2]:
                raise ValueError('Source task mismatch')
            if method == 'POST' and path.endswith(('/candidate-paper', '/research')):
                kind = 'research' if path.endswith('/research') else 'candidate-paper'
                if result['kind'] != kind or result['requestId'] != payload['requestId']:
                    raise ValueError('Source operation mismatch')
            if result.get('kind') == 'candidate-paper' and result['status'] == 'SUCCEEDED' and result['portfolioId'] is None:
                raise ValueError('Completed paper request has no account')
            if 'items' in result and len({row['id'] for row in result['items']}) != len(result['items']):
                raise ValueError('Duplicate source resource identifiers')
            return result
        except (ValidationError, ValueError, TypeError, KeyError):
            raise HTTPException(502, 'Invalid source strategy response') from None
