from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from mock_ingest import API_KEY, FakeClock, MockIngest  # noqa: E402,F401

from mcp_use_analytics import _mcp_v1, _transport  # noqa: E402

# The suite must never reach a real ingest endpoint or inherit a developer's key.
for _name in ("MANUFACT_ANALYTICS_KEY", "MANUFACT_ANALYTICS_URL", "MANUFACT_ANALYTICS_DISABLED"):
    os.environ.pop(_name, None)


@pytest.fixture(autouse=True)
def _isolated_state() -> Iterator[None]:
    yield
    for channel in _transport.all_channels():
        channel.close(timeout=0)
    with _transport._channels_lock:
        _transport._channels.clear()
    _transport._warned.clear()
    _mcp_v1._deferred_states.clear()


@pytest.fixture
def ingest() -> Iterator[MockIngest]:
    server = MockIngest()
    try:
        yield server
    finally:
        server.close()


@pytest.fixture
def capture_ingest(ingest: MockIngest) -> MockIngest:
    """An ingest whose dashboard config turns payload capture and actor identification on."""
    ingest.config = {"capture_payloads": True, "identify_actors": True}
    return ingest


@pytest.fixture
def config_clock(ingest: MockIngest) -> FakeClock:
    """The clock that ages the dashboard settings of ``ingest``'s shared channel (what ``instrument()`` uses)."""
    clock = FakeClock()
    _transport.get_channel(ingest.url, API_KEY)._clock = clock
    return clock
