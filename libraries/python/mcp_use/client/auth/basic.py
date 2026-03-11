"""HTTP Basic authentication support."""

import base64
from collections.abc import Generator

import httpx
from pydantic import BaseModel, SecretStr

from mcp_use.telemetry.telemetry import telemetry


class BasicAuth(httpx.Auth, BaseModel):
    """HTTP Basic authentication for HTTP requests.

    Encodes username:password as Base64 in the Authorization header.
    """

    username: str
    password: SecretStr

    def __init__(self, **data):
        super().__init__(**data)

    @telemetry("auth_basic")
    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        """Apply HTTP Basic authentication to the request."""
        credentials = f"{self.username}:{self.password.get_secret_value()}"
        encoded = base64.b64encode(credentials.encode()).decode("ascii")
        request.headers["Authorization"] = f"Basic {encoded}"
        yield request
