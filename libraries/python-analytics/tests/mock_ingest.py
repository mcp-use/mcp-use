"""A local stand-in for the Manufact ingest edge (``POST /v1/events``, ``GET /v1/config``)."""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

API_KEY = "mfi_" + "T" * 40
"""A well-formed analytics key for tests."""


class FakeClock:
    """A monotonic clock that only moves when told to (for the age of the dashboard settings)."""

    def __init__(self, start: float = 1_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@dataclass
class Received:
    method: str
    path: str
    headers: dict[str, str]
    body: Any


@dataclass
class Scripted:
    """A canned answer for the next ``POST /v1/events``."""

    status: int
    body: Any = None
    headers: dict[str, str] = field(default_factory=dict)


class MockIngest:
    """Records every request; answers ``202`` with the current ``config`` unless scripted otherwise."""

    def __init__(self) -> None:
        self.config = {"capture_payloads": False, "identify_actors": False}
        self.requests: list[Received] = []
        self.script: deque[Scripted] = deque()
        self.config_status = 200
        self.config_headers: dict[str, str] = {}
        # Seconds each POST takes, like a real round trip.
        self.delay = 0.0
        self._lock = threading.Lock()
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self._thread.start()

    @property
    def url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    # -- assertions ---------------------------------------------------------

    @property
    def batches(self) -> list[dict[str, Any]]:
        with self._lock:
            return [r.body for r in self.requests if r.path == "/v1/events" and isinstance(r.body, dict)]

    @property
    def events(self) -> list[dict[str, Any]]:
        return [event for batch in self.batches for event in batch.get("events", [])]

    def accepted_events(self) -> list[dict[str, Any]]:
        """Events of batches answered 2xx (scripted failures are excluded)."""
        with self._lock:
            return [
                event
                for r in self.requests
                if r.path == "/v1/events"
                and isinstance(r.body, dict)
                and r.headers.get("x-mock-status", "202")[0] == "2"
                for event in r.body.get("events", [])
            ]

    def wait_for(self, predicate: Callable[[MockIngest], bool], timeout: float = 5.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate(self):
                return True
            time.sleep(0.02)
        return predicate(self)

    # -- HTTP ---------------------------------------------------------------

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        ingest = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
                pass

            def _reply(self, status: int, body: Any, headers: dict[str, str] | None = None) -> None:
                data = json.dumps(body).encode() if body is not None else b""
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self) -> None:
                with ingest._lock:
                    ingest.requests.append(
                        Received("GET", self.path, {k.lower(): v for k, v in self.headers.items()}, None)
                    )
                if self.path != "/v1/config":
                    return self._reply(404, {"error": "not_found"})
                if ingest.config_status != 200:
                    error = {401: "invalid_key", 429: "rate_limited"}.get(ingest.config_status, "unavailable")
                    return self._reply(ingest.config_status, {"error": error}, ingest.config_headers)
                self._reply(200, {"config": ingest.config})

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length)
                if ingest.delay:
                    time.sleep(ingest.delay)
                try:
                    body = json.loads(raw)
                except ValueError:
                    body = raw
                with ingest._lock:
                    scripted = ingest.script.popleft() if ingest.script else None
                    headers = {k.lower(): v for k, v in self.headers.items()}
                    headers["x-mock-status"] = str(scripted.status if scripted else 202)
                    ingest.requests.append(Received("POST", self.path, headers, body))
                if scripted is not None:
                    return self._reply(scripted.status, scripted.body, scripted.headers)
                events = body.get("events", []) if isinstance(body, dict) else []
                self._reply(202, {"accepted": len(events), "rejected": [], "config": ingest.config})

        return Handler
