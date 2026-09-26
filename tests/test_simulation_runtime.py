"""The private runtime cannot bypass member isolation or collide with native IDs."""
from unittest.mock import Mock, patch
import pytest
from fastapi import HTTPException
from src.services.simulation_runtime_service import SimulationRuntimeService
from api.v1.endpoints.simulation_portfolios import detail, control, Control


def test_disabled_for_member_even_when_configured(monkeypatch):
    monkeypatch.setenv('SIMULATION_RUNTIME_URL','http://private/bridge')
    with patch('src.services.simulation_runtime_service.current_workspace_database',return_value=object()), patch('requests.Session.request') as request:
        service=SimulationRuntimeService()
        assert service.items('/definitions') == []
        with pytest.raises(HTTPException) as error: service.request('GET','/portfolios/-1')
        assert error.value.status_code == 404
        request.assert_not_called()


def test_private_ids_route_only_to_private_runtime(monkeypatch):
    monkeypatch.setenv('SIMULATION_RUNTIME_URL','http://private/bridge')
    with patch.object(SimulationRuntimeService,'request',return_value={'id':-1}) as request:
        assert detail(-1)['id']==-1
        assert control(-1,Control(action='pause'))['id']==-1
        assert request.call_args.args==('POST','/portfolios/-1/control',{'action':'pause'})


def test_native_listing_survives_runtime_failure_and_status_exposes_failure(monkeypatch):
    monkeypatch.setenv('SIMULATION_RUNTIME_URL','http://private/bridge')
    with patch.object(SimulationRuntimeService,'request',side_effect=HTTPException(503,'unavailable')):
        service=SimulationRuntimeService()
        assert service.items('/portfolios')==[]
        assert service.status()=={'configured':True,'available':False}


def test_rejects_native_identifier_from_private_provider(monkeypatch):
    monkeypatch.setenv('SIMULATION_RUNTIME_URL','http://private/bridge')
    with patch.object(SimulationRuntimeService,'request',return_value={'items':[{'id':1}]}):
        assert SimulationRuntimeService().items('/portfolios')==[]


def test_provider_errors_do_not_disclose_secrets(monkeypatch):
    monkeypatch.setenv('SIMULATION_RUNTIME_URL','http://private/bridge')
    with patch('requests.Session.request',return_value=Mock(ok=False,status_code=500,text='private-secret')):
        with pytest.raises(HTTPException) as error:SimulationRuntimeService().request('POST','/portfolios/-1/control')
        assert 'private-secret' not in error.value.detail


def test_failed_overview_is_reported_even_when_health_endpoint_works(monkeypatch):
    monkeypatch.setenv('SIMULATION_RUNTIME_URL', 'http://private/bridge')
    with patch.object(SimulationRuntimeService, 'request', return_value={'items': [{'id': 1, 'curve': []}]}):
        assert SimulationRuntimeService().overview() == {
            'items': [], 'runtime': {'configured': True, 'available': False}}
    with patch('src.services.simulation_runtime_service.current_workspace_database', return_value=object()):
        assert SimulationRuntimeService().overview()['runtime']['configured'] is False
