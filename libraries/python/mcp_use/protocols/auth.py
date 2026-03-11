from __future__ import annotations

from typing import Protocol, runtime_checkable

import httpx


@runtime_checkable
class Auth(Protocol):
    def apply_to_request(self, request: httpx.Request) -> httpx.Request: ...

    async def refresh(self) -> None: ...

    @property
    def is_expired(self) -> bool: ...
