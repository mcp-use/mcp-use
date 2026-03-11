"""Unit tests for BasicAuth."""

import base64

import httpx
import pytest

from mcp_use.client.auth import BasicAuth


class TestBasicAuth:
    """Tests for BasicAuth."""

    def test_creates_with_credentials(self):
        auth = BasicAuth(username="user", password="pass")
        assert auth.username == "user"
        assert auth.password.get_secret_value() == "pass"

    def test_is_httpx_auth(self):
        auth = BasicAuth(username="user", password="pass")
        assert isinstance(auth, httpx.Auth)

    def test_auth_flow_sets_header(self):
        auth = BasicAuth(username="alice", password="s3cret")
        request = httpx.Request("GET", "https://example.com")

        flow = auth.auth_flow(request)
        modified = next(flow)

        expected = base64.b64encode(b"alice:s3cret").decode("ascii")
        assert modified.headers["Authorization"] == f"Basic {expected}"

    def test_password_is_secret(self):
        auth = BasicAuth(username="user", password="secret")
        dumped = auth.model_dump()
        # SecretStr should mask the value in serialization
        assert dumped["password"] != "secret"

    def test_special_characters_in_credentials(self):
        auth = BasicAuth(username="user@domain.com", password="p@ss:word!")
        request = httpx.Request("GET", "https://example.com")

        flow = auth.auth_flow(request)
        modified = next(flow)

        expected = base64.b64encode(b"user@domain.com:p@ss:word!").decode("ascii")
        assert modified.headers["Authorization"] == f"Basic {expected}"
