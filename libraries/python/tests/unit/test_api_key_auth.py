"""Unit tests for APIKeyAuth."""

import httpx
import pytest

from mcp_use.client.auth import APIKeyAuth


class TestAPIKeyAuth:
    """Tests for APIKeyAuth."""

    def test_creates_with_header(self):
        auth = APIKeyAuth(key="my-key", header="X-API-Key")
        assert auth.key.get_secret_value() == "my-key"
        assert auth.header == "X-API-Key"
        assert auth.query_param is None

    def test_creates_with_query_param(self):
        auth = APIKeyAuth(key="my-key", query_param="api_key")
        assert auth.query_param == "api_key"
        assert auth.header is None

    def test_is_httpx_auth(self):
        auth = APIKeyAuth(key="my-key", header="X-API-Key")
        assert isinstance(auth, httpx.Auth)

    def test_rejects_no_location(self):
        with pytest.raises(ValueError, match="Either 'header' or 'query_param' must be provided"):
            APIKeyAuth(key="my-key")

    def test_rejects_both_locations(self):
        with pytest.raises(ValueError, match="Only one of"):
            APIKeyAuth(key="my-key", header="X-API-Key", query_param="api_key")

    def test_auth_flow_sets_header(self):
        auth = APIKeyAuth(key="secret-key", header="X-API-Key")
        request = httpx.Request("GET", "https://example.com")

        flow = auth.auth_flow(request)
        modified = next(flow)

        assert modified.headers["X-API-Key"] == "secret-key"

    def test_auth_flow_sets_query_param(self):
        auth = APIKeyAuth(key="secret-key", query_param="api_key")
        request = httpx.Request("GET", "https://example.com/path")

        flow = auth.auth_flow(request)
        modified = next(flow)

        assert "api_key=secret-key" in str(modified.url)

    def test_key_is_secret(self):
        auth = APIKeyAuth(key="secret", header="X-API-Key")
        dumped = auth.model_dump()
        assert dumped["key"] != "secret"

    def test_custom_header_name(self):
        auth = APIKeyAuth(key="token-123", header="Authorization")
        request = httpx.Request("GET", "https://example.com")

        flow = auth.auth_flow(request)
        modified = next(flow)

        assert modified.headers["Authorization"] == "token-123"
