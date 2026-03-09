"""API key authentication support."""

from collections.abc import Generator

import httpx
from pydantic import BaseModel, SecretStr, model_validator

from mcp_use.telemetry.telemetry import telemetry


class APIKeyAuth(httpx.Auth, BaseModel):
    """API key authentication for HTTP requests.

    Supports sending the API key via a custom header or query parameter.
    Exactly one of ``header`` or ``query_param`` must be provided.
    """

    key: SecretStr
    header: str | None = None
    query_param: str | None = None

    def __init__(self, **data):
        super().__init__(**data)

    @model_validator(mode="after")
    def _validate_location(self) -> "APIKeyAuth":
        if not self.header and not self.query_param:
            raise ValueError("Either 'header' or 'query_param' must be provided")
        if self.header and self.query_param:
            raise ValueError("Only one of 'header' or 'query_param' can be provided, not both")
        return self

    @telemetry("auth_api_key")
    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        """Apply API key authentication to the request."""
        if self.header:
            request.headers[self.header] = self.key.get_secret_value()
        elif self.query_param:
            request.url = request.url.copy_merge_params({self.query_param: self.key.get_secret_value()})
        yield request
