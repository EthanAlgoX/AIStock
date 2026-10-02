"""Server health must follow HTTP readiness on the configured port."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
import os
from pathlib import Path
import subprocess
import sys
from threading import Thread

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]


def _server_probe():
    compose = yaml.safe_load((ROOT / "docker/docker-compose.yml").read_text())
    assert "healthcheck" not in compose["services"]["analyzer"]
    assert "HEALTHCHECK NONE" in (ROOT / "docker/Dockerfile").read_text()
    probe = compose["services"]["server"]["healthcheck"]["test"]
    assert probe[:2] == ["CMD", "python"]
    return [sys.executable, *probe[2:]]


@contextmanager
def _health_server(status):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(status if self.path == "/api/health" else 404)
            self.end_headers()

        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_port
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.parametrize("status,success", [(200, True), (503, False)])
def test_server_probe_uses_configured_port_and_http_readiness(status, success):
    with _health_server(status) as port:
        result = subprocess.run(
            _server_probe(), env={**os.environ, "API_PORT": str(port)},
            capture_output=True, timeout=10,
        )
    assert (result.returncode == 0) is success


def test_server_probe_does_not_turn_connection_failure_into_success():
    server = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = server.server_port
    server.server_close()
    result = subprocess.run(
        _server_probe(), env={**os.environ, "API_PORT": str(port)},
        capture_output=True, timeout=10,
    )
    assert result.returncode != 0


def test_server_command_and_probe_share_compose_port_even_with_shell_override():
    compose = yaml.safe_load((ROOT / "docker/docker-compose.yml").read_text())
    service = compose["services"]["server"]
    configured_port = next(value.split("=", 1)[1] for value in service["environment"] if value.startswith("API_PORT="))
    assert service["command"][-1] == configured_port
    assert service["ports"] == [f"{configured_port}:{configured_port}"]
    # Explicit environment entries override env_file values, including when
    # API_PORT was supplied in the shell rather than the application's .env.
    assert configured_port == "${API_PORT:-8000}"
