"""Background delivery of events to the Manufact ingest endpoint.

One :class:`Channel` exists per ``(endpoint, api_key)``. Recording an event only
appends it to a bounded in-memory queue; a daemon thread prepares events (sizes,
payload redaction, JSON) and POSTs them to ``{endpoint}/v1/events`` in batches,
by size or about once a second.

Delivery rules (``manufact.sdk.v1``):

- ``202``: done; the response's ``config`` is authoritative for capture settings.
  Events listed in ``rejected`` with ``"retryable": true`` (``queue_unavailable``:
  the edge could not enqueue them) are sent again with backoff; the others
  were accepted, or rejected for good, and are never sent again.
- ``401``: the key is invalid or revoked; the channel stops for good.
- ``402``: the organization is out of credits; events are dropped for a while.
- ``400``/other ``4xx``: the batch is dropped (``413`` splits it first).
- ``408``/``5xx``/network errors: nothing was enqueued; the whole batch is
  retried with exponential backoff (or after ``Retry-After``).
- Those and the ``retryable`` rejections are failed attempts: a batch is
  dropped after ``MAX_ATTEMPTS`` (8) of them, about 30-60 s of backoff, the
  same budget and schedule as the TypeScript SDK.
- ``429``: ``Retry-After`` (always sent with it) holds back every send on the
  channel, that is on the key, until it has passed. Being rate limited is not
  a failed attempt, so the batch keeps its attempts; a ``429`` without
  ``Retry-After`` counts as one.

Capture settings (``config``) come from ``GET /v1/config`` and from every
``202``. Events are encoded with the settings in hand, so before encoding, the
delivery thread asks ``GET /v1/config`` again when they are more than
``CONFIG_MAX_AGE`` old: a dashboard change then applies to the next batch,
not to the one after it. A failed refresh keeps the last settings and is not
tried again for ``CONFIG_MAX_AGE``; none is made while a ``429`` (or a retry
backoff) holds sends back, and a ``429`` to it holds them back too.

Nothing here ever raises into the caller: every failure is logged and swallowed.
"""

from __future__ import annotations

import atexit
import email.utils
import json
import logging
import math
import os
import random
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from ._version import USER_AGENT

logger = logging.getLogger("mcp_use_analytics")

SCHEMA = "manufact.sdk.v1"
MAX_BATCH_EVENTS = 100
# The ingest edge rejects bodies over 1 MB with 413; stay well below it.
MAX_BATCH_BYTES = 900_000
MAX_QUEUE_EVENTS = 10_000
MAX_BUFFER_BYTES = 8_000_000
FLUSH_INTERVAL = 1.0
REQUEST_TIMEOUT = 10.0
CONFIG_TIMEOUT = 5.0
# Settings older than this are fetched again before events are encoded; the
# dashboard promises changes reach the SDK within about a minute.
CONFIG_MAX_AGE = 60.0
# A refresh holds back encoding (the last settings are still usable), so it
# gets a shorter bound than the first fetch: at most the exit flush's budget.
CONFIG_REFRESH_TIMEOUT = 2.0
# Failed attempts before a batch is dropped. The waits in between (0.5 s
# doubling, each jittered to 50-100 %) add up to about 30-60 s.
MAX_ATTEMPTS = 8
MAX_BACKOFF = 60.0
MAX_RETRY_AFTER = 600.0
# Shortest pause after a 429, so ``Retry-After: 0`` cannot make sending spin.
MIN_RATE_LIMIT_PAUSE = 1.0
CREDITS_PAUSE = 300.0
ATEXIT_TIMEOUT = 2.0


@dataclass
class RemoteConfig:
    """Capture settings from the dashboard, as reported by the ingest endpoint."""

    capture_payloads: bool = False
    identify_actors: bool = False
    known: bool = False


class Preparable(Protocol):
    """A recorded event that can turn itself into wire JSON on the delivery thread."""

    def prepare(self, config: RemoteConfig) -> tuple[bytes, bytes] | None:
        """Return ``(envelope, event_json)`` or ``None`` to drop the event."""
        ...


@dataclass
class _Batch:
    envelope: bytes
    events: list[bytes]
    # Each event's enqueue sequence number (see Channel.flush).
    seqs: list[int]

    @property
    def size(self) -> int:
        return len(self.envelope) + sum(len(event) + 1 for event in self.events) + 16

    def subset(self, indexes: list[int]) -> _Batch:
        return _Batch(self.envelope, [self.events[i] for i in indexes], [self.seqs[i] for i in indexes])


class _Outcome:
    SENT = "sent"
    PARTIAL = "partial"  # sent; some events must be sent again
    RETRY = "retry"
    DROP = "drop"
    SPLIT = "split"
    STOP = "stop"
    PAUSE = "pause"
    HOLD = "hold"  # rate limited: wait for Retry-After without using up an attempt


_channels: dict[tuple[str, str], Channel] = {}
_channels_lock = threading.Lock()
_warned: set[str] = set()


def warn_once(key: str, message: str, *args: Any) -> None:
    """Log a warning the first time ``key`` is seen in this process."""
    if key in _warned:
        return
    _warned.add(key)
    logger.warning(message, *args)


def get_channel(endpoint: str, api_key: str) -> Channel:
    """The shared channel for this endpoint and key, created on first use."""
    key = (endpoint, api_key)
    with _channels_lock:
        channel = _channels.get(key)
        if channel is None or channel.closed:
            channel = Channel(endpoint, api_key)
            _channels[key] = channel
        return channel


def all_channels() -> list[Channel]:
    with _channels_lock:
        return list(_channels.values())


class Channel:
    """A bounded queue plus one daemon thread delivering to one ingest key."""

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        *,
        flush_interval: float = FLUSH_INTERVAL,
        max_queue_events: int = MAX_QUEUE_EVENTS,
        opener: Callable[..., Any] | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self.flush_interval = flush_interval
        self.max_queue_events = max_queue_events
        self._open = opener or _default_opener().open
        # Measures the age of ``config`` (injectable for tests).
        self._clock = clock or time.monotonic
        self.config = RemoteConfig()
        # When ``config`` was last received or last asked for (``None``: never).
        self._config_checked_at: float | None = None
        self.closed = False
        self._stopped = False
        self._reset_state()

    # -- state --------------------------------------------------------------

    def _reset_state(self) -> None:
        self._lock = threading.Lock()
        self._wake = threading.Condition(self._lock)
        self._idle = threading.Condition(self._lock)
        # Events carry their enqueue sequence number from _raw to _ready to a
        # batch; _live holds the numbers not yet sent or dropped, oldest first
        # (_settled marks those finished out of order until they reach the head).
        self._raw: deque[tuple[int, Preparable]] = deque()
        self._ready: deque[tuple[bytes, bytes, int]] = deque()
        self._next_seq = 0
        self._live: deque[int] = deque()
        self._settled: set[int] = set()
        self._ready_bytes = 0
        self._first_ready_at: float | None = None
        self._inflight = 0
        # Events numbered below this are sent without waiting for a full batch.
        self._flush_before = 0
        self._next_send_at = 0.0
        self._paused_until = 0.0
        self._attempts = 0
        self._dropped = 0
        # Lowered after a 413 so the split halves are not merged again.
        self._max_batch_bytes = MAX_BATCH_BYTES
        self._thread: threading.Thread | None = None
        self._pid = os.getpid()

    def _pending(self) -> int:
        return len(self._raw) + len(self._ready) + self._inflight

    def _oldest_pending(self) -> int | None:
        """The sequence number of the oldest event not yet sent or dropped."""
        live = self._live
        while live and live[0] in self._settled:
            self._settled.discard(live.popleft())
        return live[0] if live else None

    def _done_before(self, seq: int) -> bool:
        oldest = self._oldest_pending()
        return oldest is None or oldest >= seq

    def _finish(self, seqs: list[int]) -> None:
        """Mark events as sent or dropped (waking flushes waiting on them)."""
        if seqs:
            self._settled.update(seqs)
            self._oldest_pending()
            self._idle.notify_all()

    # -- producer side (request path) ---------------------------------------

    def enqueue(self, event: Preparable, *, urgent: bool = False) -> None:
        """Queue an event for delivery. Never blocks on I/O and never raises.

        ``urgent`` sends it as soon as it is encoded instead of waiting for the
        batch interval (stdio servers can be killed right after their last reply).
        """
        try:
            if os.getpid() != self._pid:  # forked without the at-fork hook (e.g. os.fork in C code)
                self._after_fork_in_child()
            with self._lock:
                if self._stopped or self.closed or time.monotonic() < self._paused_until:
                    return
                if len(self._raw) >= self.max_queue_events:
                    self._dropped += 1
                    if self._dropped == 1:
                        logger.warning("mcp-use-analytics: event queue full, dropping events")
                    return
                seq = self._next_seq
                self._next_seq += 1
                self._raw.append((seq, event))
                self._live.append(seq)
                if urgent:
                    self._flush_before = seq + 1
                self._ensure_thread()
                self._wake.notify()
        except Exception:  # pragma: no cover - defensive: recording must never break a request
            logger.debug("mcp-use-analytics: enqueue failed", exc_info=True)

    def _ensure_thread(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, name="mcp-use-analytics", daemon=True)
            self._thread.start()

    # -- control ------------------------------------------------------------

    def flush(self, timeout: float | None = None) -> bool:
        """Send the events queued before this call now, and wait until they are delivered (or dropped).

        Events queued meanwhile (other requests, other threads) are not waited
        for, so a busy channel never holds a flush until its timeout.

        Returns:
            ``True`` when those events were all delivered or dropped within ``timeout`` seconds.
        """
        deadline = None if timeout is None else time.monotonic() + timeout
        with self._lock:
            target = self._next_seq
            if self._done_before(target):
                return True
            self._flush_before = max(self._flush_before, target)
            if self._raw or self._ready:
                self._ensure_thread()
            self._wake.notify()
            while not self._done_before(target):
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    return False
                self._idle.wait(remaining)
            return True

    def close(self, timeout: float | None = None) -> bool:
        """Flush, then stop the delivery thread; later events are dropped."""
        drained = self.flush(timeout)
        with self._lock:
            self.closed = True
            self._wake.notify_all()
        return drained

    def _after_fork_in_child(self) -> None:
        # The parent keeps delivering what it queued; the child starts empty
        # with fresh locks (a lock held by another thread at fork time would
        # otherwise stay locked forever) and starts its own thread on demand.
        stopped = self._stopped
        config = self.config
        self._reset_state()
        self._stopped = stopped
        self.config = config

    # -- delivery thread ----------------------------------------------------

    def _run(self) -> None:
        try:
            while self._step():
                pass
        except Exception:  # pragma: no cover - defensive
            logger.debug("mcp-use-analytics: delivery thread crashed", exc_info=True)
        finally:
            with self._lock:
                if self._thread is threading.current_thread():
                    self._thread = None
                self._idle.notify_all()

    def _batch_due(self, now: float) -> bool:
        if not self._ready or now < self._next_send_at:
            return False
        if self.closed or not self._done_before(self._flush_before):
            return True
        if len(self._ready) >= MAX_BATCH_EVENTS or self._ready_bytes >= self._max_batch_bytes:
            return True
        return self._first_ready_at is not None and now - self._first_ready_at >= self.flush_interval

    def _step(self) -> bool:
        with self._lock:
            while True:
                if self._stopped:
                    self._discard_all()
                    return False
                now = time.monotonic()
                if now < self._paused_until:
                    self._discard_all()
                if self._raw or self._batch_due(now):
                    break
                if not self._ready:
                    self._idle.notify_all()
                    if self.closed:
                        return False
                self._wake.wait(self._wait_timeout(now))
            if self._raw and self._config_due(now):
                raw = None
            else:
                raw = list(self._raw)
                self._raw.clear()
                self._inflight += len(raw)

        if raw is None:
            # Before encoding, not after: the events wait in the queue (nothing
            # is in flight), so the settings fetched now apply to them too.
            self._fetch_config(CONFIG_TIMEOUT if self._config_checked_at is None else CONFIG_REFRESH_TIMEOUT)
            return True

        prepared = [(seq, self._prepare(event)) for seq, event in raw]
        with self._lock:
            self._inflight -= len(raw)
            failed = []
            for seq, item in prepared:
                if item is None:
                    failed.append(seq)
                else:
                    self._push_ready(item, seq)
            self._finish(failed)
            if not self._batch_due(time.monotonic()):
                return True
            batch = self._take_batch()
            self._inflight += len(batch.events)

        outcome, delay, retry = self._send(batch)
        with self._lock:
            self._inflight -= len(batch.events)
            self._settle(batch, outcome, delay, retry)
            self._idle.notify_all()
        return True

    def _config_due(self, now: float) -> bool:
        """Whether to ask ``GET /v1/config`` before encoding (called with the lock held).

        Never fetched yet, or nothing heard for ``CONFIG_MAX_AGE`` (a ``202``
        counts, a failed fetch waits that long too); never while a ``429`` or a
        retry backoff holds back requests on the key.
        """
        if now < self._next_send_at or now < self._paused_until:
            return False
        checked = self._config_checked_at
        return checked is None or self._clock() - checked >= CONFIG_MAX_AGE

    def _wait_timeout(self, now: float) -> float | None:
        deadlines = []
        if self._ready:
            if self._first_ready_at is not None:
                deadlines.append(self._first_ready_at + self.flush_interval)
            if self._next_send_at > now:
                deadlines.append(self._next_send_at)
        if self._paused_until > now:
            deadlines.append(self._paused_until)
        return max(0.01, min(deadlines) - now) if deadlines else None

    def _prepare(self, event: Preparable) -> tuple[bytes, bytes] | None:
        try:
            return event.prepare(self.config)
        except Exception:
            logger.debug("mcp-use-analytics: dropping an event that failed to serialize", exc_info=True)
            return None

    def _push_ready(self, item: tuple[bytes, bytes], seq: int) -> None:
        self._ready.append((item[0], item[1], seq))
        self._ready_bytes += len(item[1])
        if self._first_ready_at is None:
            self._first_ready_at = time.monotonic()
        dropped = []
        while self._ready_bytes > MAX_BUFFER_BYTES and len(self._ready) > 1:
            # Keep the most recent events when the endpoint is unreachable for long.
            _, event, old_seq = self._ready.popleft()
            self._ready_bytes -= len(event)
            self._dropped += 1
            dropped.append(old_seq)
        self._finish(dropped)

    def _take_batch(self) -> _Batch:
        """Pop up to one batch of same-envelope events from the head of the buffer."""
        envelope = self._ready[0][0]
        batch = _Batch(envelope, [], [])
        skipped: deque[tuple[bytes, bytes, int]] = deque()
        size = len(envelope) + 16
        while self._ready and len(batch.events) < MAX_BATCH_EVENTS and len(skipped) <= MAX_BATCH_EVENTS:
            item = self._ready.popleft()
            if item[0] != envelope:
                skipped.append(item)
                continue
            if batch.events and size + len(item[1]) > self._max_batch_bytes:
                self._ready.appendleft(item)
                break
            batch.events.append(item[1])
            batch.seqs.append(item[2])
            size += len(item[1]) + 1
            self._ready_bytes -= len(item[1])
        self._ready.extendleft(reversed(skipped))
        if not self._ready:
            self._first_ready_at = None
        return batch

    def _requeue(self, batch: _Batch) -> None:
        for event, seq in zip(reversed(batch.events), reversed(batch.seqs), strict=True):
            self._ready.appendleft((batch.envelope, event, seq))
            self._ready_bytes += len(event)
        if self._first_ready_at is None:
            self._first_ready_at = time.monotonic()

    def _settle(self, batch: _Batch, outcome: str, delay: float, retry: list[int]) -> None:
        now = time.monotonic()
        if outcome == _Outcome.SENT or outcome == _Outcome.DROP:
            self._attempts = 0
            self._next_send_at = 0.0
            self._finish(batch.seqs)
        elif outcome == _Outcome.SPLIT:
            self._max_batch_bytes = max(1, min(self._max_batch_bytes, batch.size // 2))
            half = len(batch.events) // 2
            self._requeue(batch.subset(list(range(half, len(batch.events)))))
            self._requeue(batch.subset(list(range(half))))
        elif outcome == _Outcome.PARTIAL:
            # Only the events the edge could not enqueue go again; resending the
            # accepted ones would count them twice.
            again = set(retry)
            self._finish([seq for index, seq in enumerate(batch.seqs) if index not in again])
            self._retry(batch.subset(retry), delay, now)
        elif outcome == _Outcome.RETRY:
            self._retry(batch, delay, now)
        elif outcome == _Outcome.HOLD:
            # Retry-After applies to the key: every send waits, and the batch
            # keeps its place and its attempts however long the limit lasts.
            self._next_send_at = max(self._next_send_at, now + delay)
            self._requeue(batch)
        elif outcome == _Outcome.PAUSE:
            self._paused_until = now + delay
            self._discard_all()
        elif outcome == _Outcome.STOP:
            self._stopped = True
            self._discard_all()
        self._wake.notify()

    def _retry(self, batch: _Batch, delay: float, now: float) -> None:
        self._attempts += 1
        self._next_send_at = now + delay
        if self._attempts >= MAX_ATTEMPTS:
            logger.debug("mcp-use-analytics: dropping %d events after %d attempts", len(batch.events), MAX_ATTEMPTS)
            self._attempts = 0
            self._finish(batch.seqs)
        else:
            self._requeue(batch)

    def _discard_all(self) -> None:
        # Only ever called with nothing in flight: every live event is queued here.
        self._raw.clear()
        self._ready.clear()
        self._live.clear()
        self._settled.clear()
        self._ready_bytes = 0
        self._first_ready_at = None
        self._idle.notify_all()

    # -- HTTP ---------------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }

    def _apply_config(self, body: bytes) -> list[int]:
        """Apply a reply's ``config``; returns the ``rejected`` indexes marked ``retryable``."""
        try:
            payload = json.loads(body or b"{}")
        except ValueError:
            return []
        if not isinstance(payload, dict):
            return []
        config = payload.get("config")
        if isinstance(config, dict):
            self.config = RemoteConfig(
                capture_payloads=config.get("capture_payloads") is True,
                identify_actors=config.get("identify_actors") is True,
                known=True,
            )
            self._config_checked_at = self._clock()
        rejected = payload.get("rejected")
        if not isinstance(rejected, list):
            return []
        retry: list[int] = []
        final: list[Any] = []
        for entry in rejected:
            index = entry.get("index") if isinstance(entry, dict) else None
            if isinstance(entry, dict) and entry.get("retryable") is True and type(index) is int:
                retry.append(index)
            else:
                final.append(entry)
        if final:
            first = final[0] if isinstance(final[0], dict) else {}
            warn_once("rejected", "mcp-use-analytics: the ingest endpoint rejected events (%s)", first.get("reason"))
            logger.debug("mcp-use-analytics: rejected %s", final)
        if retry:
            logger.debug("mcp-use-analytics: %d events were not enqueued; sending them again", len(retry))
        return retry

    def _fetch_config(self, timeout: float) -> None:
        """``GET /v1/config``. On failure the last settings stay; a ``401`` stops the channel."""
        # Counted before the request, so a failure is not retried for CONFIG_MAX_AGE.
        self._config_checked_at = self._clock()
        request = urllib.request.Request(f"{self.endpoint}/v1/config", headers=self._headers(), method="GET")
        try:
            with self._open(request, timeout=timeout) as response:
                self._apply_config(response.read())
        except urllib.error.HTTPError as error:
            error.close()
            if error.code == 401:
                self._invalid_key()
            elif error.code == 429:
                # The key's budget is spent: hold back the sends too, as a 429 to a POST does.
                retry_after = _retry_after(error.headers.get("Retry-After") if error.headers else None)
                with self._lock:
                    hold_until = time.monotonic() + max(MIN_RATE_LIMIT_PAUSE, retry_after or 0.0)
                    self._next_send_at = max(self._next_send_at, hold_until)
                logger.debug("mcp-use-analytics: config request rate limited")
            else:
                logger.debug("mcp-use-analytics: config request failed with HTTP %s", error.code)
        except Exception as error:
            logger.debug("mcp-use-analytics: config request failed: %s", error)

    def _invalid_key(self) -> None:
        warn_once(
            f"invalid:{self.endpoint}",
            "mcp-use-analytics: the analytics key was rejected (invalid or revoked); analytics is disabled",
        )
        with self._lock:
            self._stopped = True
            self._discard_all()

    def _send(self, batch: _Batch) -> tuple[str, float, list[int]]:
        """POST one batch: ``(outcome, delay, indexes to send again)``."""
        body = b"".join([batch.envelope, b"[", b",".join(batch.events), b"]}"])
        request = urllib.request.Request(
            f"{self.endpoint}/v1/events", data=body, headers=self._headers(), method="POST"
        )
        try:
            response = self._open(request, timeout=REQUEST_TIMEOUT)
        except urllib.error.HTTPError as error:
            try:
                outcome, delay = self._http_error(error, batch)
                return outcome, delay, []
            finally:
                error.close()
        except Exception as error:
            logger.debug("mcp-use-analytics: delivery failed: %s", error)
            return _Outcome.RETRY, self._backoff(), []
        with response:
            try:
                body = response.read()
            except Exception as error:
                # The status says the batch was handled; resending it would count it twice.
                logger.debug("mcp-use-analytics: could not read the ingest reply: %s", error)
                body = b""
        retry = sorted({index for index in self._apply_config(body) if 0 <= index < len(batch.events)})
        logger.debug("mcp-use-analytics: delivered %d events", len(batch.events) - len(retry))
        if retry:
            return _Outcome.PARTIAL, self._backoff(), retry
        return _Outcome.SENT, 0.0, []

    def _http_error(self, error: urllib.error.HTTPError, batch: _Batch) -> tuple[str, float]:
        code = error.code
        if code == 401:
            warn_once(
                f"invalid:{self.endpoint}",
                "mcp-use-analytics: the analytics key was rejected (invalid or revoked); analytics is disabled",
            )
            return _Outcome.STOP, 0.0
        if code == 402:
            warn_once("credits", "mcp-use-analytics: the organization is out of credits; events are dropped for now")
            return _Outcome.PAUSE, CREDITS_PAUSE
        if code == 413 and len(batch.events) > 1:
            return _Outcome.SPLIT, 0.0
        if code in (408, 429) or code >= 500:
            retry_after = _retry_after(error.headers.get("Retry-After") if error.headers else None)
            logger.debug("mcp-use-analytics: ingest returned HTTP %s, retrying", code)
            if code == 429:
                if retry_after is not None:
                    return _Outcome.HOLD, max(MIN_RATE_LIMIT_PAUSE, retry_after)
                return _Outcome.RETRY, max(MIN_RATE_LIMIT_PAUSE, self._backoff())
            return _Outcome.RETRY, retry_after if retry_after is not None else self._backoff()
        warn_once(f"http:{code}", "mcp-use-analytics: the ingest endpoint answered HTTP %s; dropping events", code)
        return _Outcome.DROP, 0.0

    def _backoff(self) -> float:
        base = min(MAX_BACKOFF, 0.5 * (2**self._attempts))
        return base * (0.5 + random.random() / 2)


def _default_opener() -> urllib.request.OpenerDirector:
    # Proxies from the environment only (HTTPS_PROXY, NO_PROXY, ...). urllib's
    # default also asks macOS's system configuration, which can crash a process
    # forked from a multi-threaded parent (gunicorn/uvicorn workers).
    return urllib.request.build_opener(urllib.request.ProxyHandler(urllib.request.getproxies_environment()))


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    value = value.strip()
    try:
        seconds = float(value)
    except ValueError:
        try:
            parsed = email.utils.parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        seconds = parsed.timestamp() - time.time()
    if not math.isfinite(seconds):
        return None
    return max(0.0, min(MAX_RETRY_AFTER, seconds))


# -- process hooks ---------------------------------------------------------


def flush_all(timeout: float | None) -> bool:
    """Flush every channel; ``True`` when all drained within ``timeout``."""
    deadline = None if timeout is None else time.monotonic() + timeout
    drained = True
    for channel in all_channels():
        remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
        drained = channel.flush(remaining) and drained
    return drained


def close_all(timeout: float | None) -> bool:
    deadline = None if timeout is None else time.monotonic() + timeout
    drained = True
    for channel in all_channels():
        remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
        drained = channel.close(remaining) and drained
    return drained


def _atexit_flush() -> None:
    try:
        flush_all(ATEXIT_TIMEOUT)
    except Exception:  # pragma: no cover - interpreter shutdown
        pass


def _after_fork_in_child() -> None:
    global _channels_lock
    _channels_lock = threading.Lock()
    for channel in list(_channels.values()):
        channel._after_fork_in_child()


atexit.register(_atexit_flush)
if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_after_fork_in_child)
