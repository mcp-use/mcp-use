"""Bearer token authentication support."""

from collections.abc import Generator

import httpx
from pydantic import BaseModel, SecretStr

from mcp_use.telemetry.telemetry import telemetry


class BearerAuth(httpx.Auth, BaseModel):
    """Bearer token authentication for HTTP requests."""

    token: SecretStr

    def __init__(self, **data):
        super().__init__(**data)

    @telemetry("auth_bearer")
    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        """Apply bearer token authentication to the request."""
        request.headers["Authorization"] = f"Bearer {self.token.get_secret_value()}"
        yield request
