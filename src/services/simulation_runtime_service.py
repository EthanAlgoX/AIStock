"""Owner-only bridge to a deployment-managed private simulation runtime.

The remote contract uses negative integer identifiers, leaving native IDs intact.
No request may select an endpoint, upload executable code or choose a workspace.
"""
import os
from urllib.parse import urlsplit

import requests
from fastapi import HTTPException
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

    def request(self, method, path, payload=None):
        if not self.url:
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
            raise HTTPException(422 if response.status_code in {400, 404, 409, 422} else 503,
                                'Private simulation runtime rejected the operation; inspect its run status')
        try:
            return response.json()
        except ValueError:
            raise HTTPException(502, 'Invalid simulation runtime response') from None

    def items(self, path):
        if not self.url:
            return []
        try:
            result = self.request('GET', path)['items']
            if not isinstance(result, list) or any(not isinstance(row, dict) or type(row.get('id')) is not int or row['id'] >= 0 for row in result):
                raise ValueError('Invalid identifiers')
            return result
        except (HTTPException, ValueError, KeyError, TypeError):
            # Native strategies remain accessible; /runtime-status surfaces failure.
            return []

    def status(self):
        if not self.url:
            return {'configured': False, 'available': False}
        try:
            self.request('GET', '/health')
            return {'configured': True, 'available': True}
        except HTTPException:
            return {'configured': True, 'available': False}

    def overview(self):
        if not self.url:
            return {'items': [], 'runtime': {'configured': False, 'available': False}}
        try:
            rows = self.request('GET', '/overview')['items']
            if not isinstance(rows, list) or any(not isinstance(row, dict) or type(row.get('id')) is not int
                                               or row['id'] >= 0 or not isinstance(row.get('curve'), list) for row in rows):
                raise ValueError('Invalid overview response')
            return {'items': rows, 'runtime': {'configured': True, 'available': True}}
        except (HTTPException, ValueError, KeyError, TypeError):
            return {'items': [], 'runtime': {'configured': True, 'available': False}}
