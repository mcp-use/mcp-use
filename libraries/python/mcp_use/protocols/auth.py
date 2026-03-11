from __future__ import annotations

import httpx
from typing import Protocol, runtime_checkable

@runtime_checkable
class Auth(Protocol):
    def apply_to_request(self, request: httpx.Request) -> httpx.Request: ...
    
    async def refresh(self) -> None: ...
    
    @property
    def is_expired(self) -> bool: ...
