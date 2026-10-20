from __future__ import annotations

import json
import logging
import os
import socket
import sys
import threading
import time
import urllib.error
from typing import Any

import pytest
from mock_ingest import API_KEY, FakeClock, MockIngest, Scripted

from mcp_use_analytics import _transport
from mcp_use_analytics._transport import MAX_BATCH_EVENTS, Channel, RemoteConfig

ENVELOPE = b'{"schema":"manufact.sdk.v1","sdk":{"name":"test"},"events":'
# The real backoff, before the autouse fixture below makes it instant.
REAL_BACKOFF = Channel._backoff


class Raw:
    """A minimal recorded event."""

    def __init__(self, index: int, envelope: bytes = ENVELOPE, size: int = 0) -> None:
        self.index = index
        self.envelope = envelope
        self.size = size
        self.seen_config: RemoteConfig | None = None

    def prepare(self, config: RemoteConfig) -> tuple[bytes, bytes]:
        self.seen_config = config
        return self.envelope, json.dumps({"id": str(self.index), "pad": "x" * self.size}).encode()


@pytest.fixture(autouse=True)
def _fast_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Channel, "_backoff", lambda self: 0.01)


def ids(ingest: MockIngest) -> list[int]:
    return [int(event["id"]) for event in ingest.accepted_events()]


def test_batches_by_count_and_reads_config_first(ingest: MockIngest) -> None:
    ingest.config = {"capture_payloads": True, "identify_actors": False}
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    events = [Raw(i) for i in range(250)]
    for event in events:
        channel.enqueue(event)
    assert channel.flush(5)
    assert sorted(ids(ingest)) == list(range(250))
    assert all(len(batch["events"]) <= MAX_BATCH_EVENTS for batch in ingest.batches)
    assert ingest.requests[0].method == "GET" and ingest.requests[0].path == "/v1/config"
    assert events[0].seen_config == RemoteConfig(capture_payloads=True, identify_actors=False, known=True)
    post = next(r for r in ingest.requests if r.method == "POST")
    assert post.headers["authorization"] == f"Bearer {API_KEY}"
    assert post.headers["content-type"] == "application/json"
    assert post.headers["user-agent"].startswith("mcp-use-analytics/")
    assert post.body["schema"] == "manufact.sdk.v1"


def test_batches_by_size(ingest: MockIngest) -> None:
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    for i in range(12):
        channel.enqueue(Raw(i, size=200_000))
    assert channel.flush(5)
    assert sorted(ids(ingest)) == list(range(12))
    assert len(ingest.batches) >= 3
    for request in ingest.requests:
        if request.method == "POST":
            assert len(json.dumps(request.body)) < 1_000_000


def test_sends_within_the_flush_interval_without_flush(ingest: MockIngest) -> None:
    channel = Channel(ingest.url, API_KEY, flush_interval=0.2)
    channel.enqueue(Raw(1))
    assert ingest.wait_for(lambda i: len(i.events) == 1, timeout=3)


def test_groups_batches_by_envelope(ingest: MockIngest) -> None:
    other = b'{"schema":"manufact.sdk.v1","sdk":{"name":"other"},"events":'
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    for i in range(6):
        channel.enqueue(Raw(i, ENVELOPE if i % 2 else other))
    assert channel.flush(5)
    names = {batch["sdk"]["name"]: sorted(int(e["id"]) for e in batch["events"]) for batch in ingest.batches}
    assert names == {"test": [1, 3, 5], "other": [0, 2, 4]}


def test_401_stops_for_good(ingest: MockIngest, caplog: pytest.LogCaptureFixture) -> None:
    ingest.script.append(Scripted(401, {"error": "invalid_key"}))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    with caplog.at_level(logging.WARNING, logger="mcp_use_analytics"):
        channel.enqueue(Raw(1))
        assert channel.flush(5)
        channel.enqueue(Raw(2))
        assert channel.flush(1)
    assert len([r for r in ingest.requests if r.method == "POST"]) == 1
    assert sum("rejected" in record.message for record in caplog.records) == 1


def test_401_on_config_stops_before_sending(ingest: MockIngest) -> None:
    ingest.config_status = 401
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    assert [r.method for r in ingest.requests] == ["GET"]


def test_402_pauses_and_drops(ingest: MockIngest) -> None:
    ingest.script.append(Scripted(402, {"error": "credits_exhausted"}))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    channel.enqueue(Raw(2))
    assert channel.flush(1)
    assert len([r for r in ingest.requests if r.method == "POST"]) == 1
    assert ids(ingest) == []


@pytest.mark.parametrize("status", [400, 404, 422])
def test_client_errors_drop_the_batch(ingest: MockIngest, status: int) -> None:
    ingest.script.append(Scripted(status, {"error": "invalid_batch"}))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    channel.enqueue(Raw(2))
    assert channel.flush(5)
    assert ids(ingest) == [2]


def test_413_splits_the_batch(ingest: MockIngest) -> None:
    ingest.script.append(Scripted(413))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    for i in range(4):
        channel.enqueue(Raw(i))
    assert channel.flush(5)
    assert sorted(ids(ingest)) == [0, 1, 2, 3]
    sizes = [len(r.body["events"]) for r in ingest.requests if r.method == "POST"]
    assert sizes[0] == 4 and max(sizes[1:]) <= 2


@pytest.mark.parametrize("status", [408, 500, 503])
def test_retries_transient_failures(ingest: MockIngest, status: int) -> None:
    ingest.script.extend([Scripted(status, headers={"Retry-After": "0"}), Scripted(status)])
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(7))
    assert channel.flush(5)
    posts = [r for r in ingest.requests if r.method == "POST"]
    assert len(posts) == 3
    assert {e["id"] for r in posts for e in r.body["events"]} == {"7"}  # same event id on every retry
    assert ids(ingest) == [7]


def test_gives_up_after_max_attempts(ingest: MockIngest) -> None:
    ingest.script.extend(Scripted(500) for _ in range(_transport.MAX_ATTEMPTS))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    assert len([r for r in ingest.requests if r.method == "POST"]) == _transport.MAX_ATTEMPTS
    assert ids(ingest) == []


def test_network_errors_are_retried_and_never_raise() -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    channel = Channel(f"http://127.0.0.1:{port}", API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)  # retried MAX_ATTEMPTS times, then dropped


def test_retry_after_parsing() -> None:
    assert _transport._retry_after("3") == 3
    assert _transport.MAX_RETRY_AFTER == 600  # ten minutes, as in @mcp-use/analytics
    assert _transport._retry_after("100000") == _transport.MAX_RETRY_AFTER
    assert _transport._retry_after("nonsense") is None
    assert _transport._retry_after(None) is None
    assert _transport._retry_after("") is None
    assert _transport._retry_after("inf") is None and _transport._retry_after("nan") is None
    http_date = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(time.time() + 30))
    assert 25 <= (_transport._retry_after(http_date) or 0) <= 31


def test_bounded_queue_drops_newest(ingest: MockIngest) -> None:
    channel = Channel(ingest.url, API_KEY, flush_interval=60, max_queue_events=2)
    channel._ensure_thread = lambda: None  # type: ignore[method-assign]  # keep the worker off
    for i in range(3):
        channel.enqueue(Raw(i))
    assert channel._dropped == 1 and len(channel._raw) == 2
    del channel._ensure_thread
    assert channel.flush(5)
    assert sorted(ids(ingest)) == [0, 1]


def test_close_drops_later_events(ingest: MockIngest) -> None:
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.close(5)
    channel.enqueue(Raw(2))
    assert channel.flush(1)
    assert ids(ingest) == [1]


def test_flush_of_an_empty_channel_is_immediate(ingest: MockIngest) -> None:
    started = time.monotonic()
    assert Channel(ingest.url, API_KEY).flush(5)
    assert time.monotonic() - started < 0.1


def test_prepare_failure_drops_only_that_event(ingest: MockIngest) -> None:
    class Broken(Raw):
        def prepare(self, config: RemoteConfig) -> tuple[bytes, bytes]:
            raise RuntimeError("boom")

    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Broken(1))
    channel.enqueue(Raw(2))
    assert channel.flush(5)
    assert ids(ingest) == [2]


@pytest.mark.skipif(not hasattr(os, "fork") or sys.platform == "win32", reason="POSIX fork only")
def test_fork_child_starts_clean_and_delivers(ingest: MockIngest) -> None:
    channel = _transport.get_channel(ingest.url, API_KEY)
    channel.flush_interval = 60
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    channel.enqueue(Raw(2))  # still queued in the parent when it forks
    pid = os.fork()
    if pid == 0:  # child: inherited queue is gone, a new worker delivers its own events
        code = 1
        try:
            if channel._pending() == 0:
                channel.enqueue(Raw(3))
                code = 0 if channel.flush(5) else 2
        finally:
            os._exit(code)
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0
    assert channel.flush(5)
    assert sorted(ids(ingest)) == [1, 2, 3]


def test_shared_channel_per_endpoint_and_key(ingest: MockIngest) -> None:
    a = _transport.get_channel(ingest.url, API_KEY)
    assert _transport.get_channel(ingest.url, API_KEY) is a
    assert _transport.get_channel(ingest.url, API_KEY + "x") is not a
    a.close(0)
    assert _transport.get_channel(ingest.url, API_KEY) is not a


def posted_ids(ingest: MockIngest) -> list[list[int]]:
    return [[int(e["id"]) for e in r.body["events"]] for r in ingest.requests if r.method == "POST"]


def partial(ingest: MockIngest, rejected: list[dict[str, object]]) -> Scripted:
    """A 202 that reports some events as not enqueued."""
    return Scripted(202, {"accepted": 0, "rejected": rejected, "config": ingest.config})


def test_only_retryable_rejections_are_sent_again(ingest: MockIngest) -> None:
    ingest.script.append(
        partial(
            ingest,
            [
                {"index": 1, "reason": "queue_unavailable", "retryable": True},
                {"index": 2, "reason": "event: invalid", "retryable": False},
                {"index": 4, "reason": "queue_unavailable", "retryable": True},
                {"index": 9, "reason": "queue_unavailable", "retryable": True},  # not in the batch
                {"index": "3", "reason": "queue_unavailable", "retryable": True},  # malformed
            ],
        )
    )
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    for i in range(5):
        channel.enqueue(Raw(i))
    assert channel.flush(5)
    # Accepted events (0, 3) and the event rejected for good (2) are never resent.
    assert posted_ids(ingest) == [[0, 1, 2, 3, 4], [1, 4]]


def test_retryable_rejections_give_up_after_max_attempts(ingest: MockIngest) -> None:
    retry = [{"index": 0, "reason": "queue_unavailable", "retryable": True}]
    ingest.script.extend(partial(ingest, retry) for _ in range(_transport.MAX_ATTEMPTS))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    assert posted_ids(ingest) == [[1]] * _transport.MAX_ATTEMPTS
    channel.enqueue(Raw(2))
    assert channel.flush(5)
    assert posted_ids(ingest)[-1] == [2]


def test_retryable_rejections_wait_for_the_backoff(ingest: MockIngest, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Channel, "_backoff", lambda self: 0.5)
    ingest.script.append(partial(ingest, [{"index": 0, "reason": "queue_unavailable", "retryable": True}]))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    started = time.monotonic()
    assert channel.flush(5)
    assert time.monotonic() - started >= 0.45
    assert posted_ids(ingest) == [[1], [1]]


def test_retry_budget_and_backoff_match_the_typescript_sdk(monkeypatch: pytest.MonkeyPatch) -> None:
    # 8 attempts; the 7 waits between them start at 0.5 s and double, each
    # jittered to 50-100 %: about 30 to 60 s in all, as in @mcp-use/analytics.
    assert _transport.MAX_ATTEMPTS == 8
    channel = Channel("http://ingest.invalid", API_KEY)

    def waits(jitter: float) -> list[float]:
        monkeypatch.setattr(_transport.random, "random", lambda: jitter)
        result = []
        for attempts in range(_transport.MAX_ATTEMPTS - 1):
            channel._attempts = attempts
            result.append(REAL_BACKOFF(channel))
        return result

    assert waits(0.0) == [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0]
    assert sum(waits(0.0)) == 31.75
    assert sum(waits(1.0)) == 63.5
    channel._attempts = 20
    assert REAL_BACKOFF(channel) == _transport.MAX_BACKOFF


def rate_limited(retry_after: str | None = "0") -> Scripted:
    headers = {} if retry_after is None else {"Retry-After": retry_after}
    return Scripted(429, {"error": "rate_limited"}, headers=headers)


def test_429_with_retry_after_does_not_use_up_attempts(ingest: MockIngest, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_transport, "MIN_RATE_LIMIT_PAUSE", 0.01)
    attempts = _transport.MAX_ATTEMPTS
    # One failed attempt short of the budget, then more 429s than the whole budget.
    ingest.script.extend([Scripted(503)] * (attempts - 1) + [rate_limited()] * (attempts + 2))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    assert posted_ids(ingest) == [[1]] * (2 * attempts + 2)
    assert ids(ingest) == [1]


def test_429_without_retry_after_is_a_failed_attempt(ingest: MockIngest, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_transport, "MIN_RATE_LIMIT_PAUSE", 0.01)
    ingest.script.extend(rate_limited(None) for _ in range(_transport.MAX_ATTEMPTS + 2))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    assert posted_ids(ingest) == [[1]] * _transport.MAX_ATTEMPTS
    assert ids(ingest) == []


def test_429_pauses_at_least_a_second(ingest: MockIngest) -> None:
    ingest.script.append(rate_limited("0"))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    started = time.monotonic()
    assert channel.flush(5)
    assert time.monotonic() - started >= _transport.MIN_RATE_LIMIT_PAUSE * 0.9
    assert posted_ids(ingest) == [[1], [1]]


def test_429_holds_back_every_send_until_retry_after(ingest: MockIngest) -> None:
    ingest.script.append(Scripted(429, {"error": "rate_limited"}, headers={"Retry-After": "1"}))
    channel = Channel(ingest.url, API_KEY, flush_interval=0)
    channel.enqueue(Raw(1))
    assert ingest.wait_for(lambda i: len(i.batches) == 1)
    channel.enqueue(Raw(2))  # a new event does not jump the pause
    started = time.monotonic()
    assert channel.flush(5)
    assert time.monotonic() - started >= 0.8
    assert posted_ids(ingest) == [[1], [1, 2]]


def test_flush_waits_only_for_events_queued_before_it(ingest: MockIngest) -> None:
    # Serverless with in-instance concurrency: other invocations keep recording
    # while this one flushes; it must not wait for an empty queue.
    ingest.delay = 0.05
    channel = Channel(ingest.url, API_KEY, flush_interval=0)
    stop = threading.Event()

    def other_invocations() -> None:
        i = 1000
        while not stop.is_set():
            channel.enqueue(Raw(i))
            i += 1
            time.sleep(0.005)

    busy = threading.Thread(target=other_invocations)
    busy.start()
    try:
        time.sleep(0.1)
        channel.enqueue(Raw(1))
        started = time.monotonic()
        assert channel.flush(3)
        assert time.monotonic() - started < 1.0
        assert 1 in ids(ingest)
    finally:
        stop.set()
        busy.join()


def test_flush_still_waits_for_its_own_retried_events(ingest: MockIngest) -> None:
    ingest.script.append(Scripted(503, {"error": "queue_unavailable"}))
    channel = Channel(ingest.url, API_KEY, flush_interval=60)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    assert ids(ingest) == [1]
    assert channel._pending() == 0 and not channel._live


def test_a_202_whose_body_is_lost_is_not_sent_again() -> None:
    posts: list[bytes] = []

    class Reply:
        def __enter__(self) -> Reply:
            return self

        def __exit__(self, *exc: object) -> None:
            return None

        def read(self) -> bytes:
            raise TimeoutError("the connection dropped after the status line")

    def opener(request: Any, timeout: float) -> Reply:
        if request.get_method() == "GET":
            raise urllib.error.URLError("no config")
        posts.append(request.data)
        return Reply()

    channel = Channel("http://ingest.invalid", API_KEY, flush_interval=60, opener=opener)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    assert len(posts) == 1


# -- dashboard settings (GET /v1/config) --------------------------------------

OFF = RemoteConfig(known=True)
ON = RemoteConfig(capture_payloads=True, identify_actors=True, known=True)


def config_gets(ingest: MockIngest) -> int:
    return sum(1 for r in ingest.requests if r.method == "GET" and r.path == "/v1/config")


def test_stale_config_is_fetched_once_before_encoding(ingest: MockIngest) -> None:
    clock = FakeClock()
    channel = Channel(ingest.url, API_KEY, flush_interval=60, clock=clock)
    first = Raw(1)
    channel.enqueue(first)
    assert channel.flush(5)
    assert first.seen_config == OFF
    # Turned on in the dashboard; the next event comes more than a minute after the last reply.
    ingest.config = {"capture_payloads": True, "identify_actors": True}
    clock.advance(_transport.CONFIG_MAX_AGE + 1)
    later = [Raw(i) for i in range(2, 6)]
    for event in later:
        channel.enqueue(event)
    assert channel.flush(5)
    assert all(event.seen_config == ON for event in later)
    assert [(r.method, r.path) for r in ingest.requests] == [("GET", "/v1/config"), ("POST", "/v1/events")] * 2
    assert sorted(ids(ingest)) == [1, 2, 3, 4, 5]


def test_fresh_config_is_not_fetched_again(ingest: MockIngest) -> None:
    clock = FakeClock()
    channel = Channel(ingest.url, API_KEY, flush_interval=60, clock=clock)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    ingest.config = {"capture_payloads": True, "identify_actors": True}
    clock.advance(_transport.CONFIG_MAX_AGE - 1)
    second = Raw(2)
    channel.enqueue(second)
    assert channel.flush(5)
    assert second.seen_config == OFF  # still within the minute: the settings of the last reply
    # That reply carried the new settings and restarted the minute: no GET is needed.
    clock.advance(_transport.CONFIG_MAX_AGE - 1)
    third = Raw(3)
    channel.enqueue(third)
    assert channel.flush(5)
    assert third.seen_config == ON
    assert config_gets(ingest) == 1


class _Reply:
    def __init__(self, body: dict[str, Any]) -> None:
        self.body = json.dumps(body).encode()

    def __enter__(self) -> _Reply:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def test_failed_refresh_keeps_the_last_config_and_waits_a_minute() -> None:
    get_timeouts: list[float] = []
    posts: list[bytes] = []

    def opener(request: Any, timeout: float) -> _Reply:
        if request.get_method() == "GET":
            get_timeouts.append(timeout)
            if len(get_timeouts) > 1:
                raise TimeoutError("timed out")
            return _Reply({"config": {"capture_payloads": True, "identify_actors": False}})
        posts.append(request.data)
        return _Reply({"accepted": 1, "rejected": []})  # no config: only GET /v1/config refreshes here

    clock = FakeClock()
    channel = Channel("http://ingest.invalid", API_KEY, flush_interval=60, opener=opener, clock=clock)
    events = [Raw(i) for i in range(4)]
    channel.enqueue(events[0])
    assert channel.flush(5)
    clock.advance(_transport.CONFIG_MAX_AGE + 1)
    channel.enqueue(events[1])  # the refresh times out: sent anyway, with the last settings
    assert channel.flush(5)
    clock.advance(_transport.CONFIG_MAX_AGE - 1)
    channel.enqueue(events[2])  # the failure counts as a refresh: no new attempt within the minute
    assert channel.flush(5)
    clock.advance(2)
    channel.enqueue(events[3])
    assert channel.flush(5)
    last = RemoteConfig(capture_payloads=True, known=True)
    assert [event.seen_config for event in events] == [last] * 4
    assert len(posts) == 4
    assert get_timeouts == [
        _transport.CONFIG_TIMEOUT,
        _transport.CONFIG_REFRESH_TIMEOUT,
        _transport.CONFIG_REFRESH_TIMEOUT,
    ]


def test_refresh_answered_with_an_error_keeps_the_last_config(ingest: MockIngest) -> None:
    ingest.config = {"capture_payloads": True, "identify_actors": True}
    clock = FakeClock()
    channel = Channel(ingest.url, API_KEY, flush_interval=60, clock=clock)
    channel.enqueue(Raw(1))
    assert channel.flush(5)
    ingest.config_status = 503
    ingest.config_headers = {"Retry-After": "5"}
    clock.advance(_transport.CONFIG_MAX_AGE + 1)
    later = Raw(2)
    started = time.monotonic()
    channel.enqueue(later)
    assert channel.flush(5)
    assert time.monotonic() - started < 1.0  # a failed refresh does not hold delivery back
    assert later.seen_config == ON
    assert config_gets(ingest) == 2 and ids(ingest) == [1, 2]


def test_no_refresh_while_a_429_holds_sends_back(ingest: MockIngest) -> None:
    ingest.script.append(rate_limited("1"))
    clock = FakeClock()
    channel = Channel(ingest.url, API_KEY, flush_interval=0, clock=clock)
    channel.enqueue(Raw(1))
    assert ingest.wait_for(lambda i: len(i.batches) == 1)
    clock.advance(_transport.CONFIG_MAX_AGE + 1)
    channel.enqueue(Raw(2))  # recorded while the key is rate limited: encoded with the last settings
    assert channel.flush(5)
    assert posted_ids(ingest) == [[1], [1, 2]]
    assert config_gets(ingest) == 1
    # The hold is over and the 202 restarted the minute; a minute later the next event refreshes.
    clock.advance(_transport.CONFIG_MAX_AGE + 1)
    channel.enqueue(Raw(3))
    assert channel.flush(5)
    assert config_gets(ingest) == 2


def test_429_on_config_holds_back_sends(ingest: MockIngest) -> None:
    ingest.config_status = 429
    ingest.config_headers = {"Retry-After": "1"}
    channel = Channel(ingest.url, API_KEY, flush_interval=0)
    first = Raw(1)
    started = time.monotonic()
    channel.enqueue(first)
    assert channel.flush(5)
    assert time.monotonic() - started >= 0.9
    assert [r.method for r in ingest.requests] == ["GET", "POST"]
    assert first.seen_config == RemoteConfig()  # nothing known yet: nothing optional is sent
