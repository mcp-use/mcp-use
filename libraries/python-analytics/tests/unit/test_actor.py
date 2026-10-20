from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import pytest

from mcp_use_analytics import token_identity_hash
from mcp_use_analytics._actor import bearer_token, token_display_metadata

# Produced by running the gateway's own `tokenIdentityHash` / `tokenDisplayMetadata`
# (gateway.mcp-use/src/utils/mcp-classify.ts) under V8 and JavaScriptCore.
VECTORS = json.loads((Path(__file__).parent.parent / "fixtures" / "token_vectors.json").read_text())
CASES = {name: case for name, case in VECTORS.items() if isinstance(case, dict)}


def _b64url(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def test_shared_cross_sdk_vector() -> None:
    # The vector every Manufact SDK tests: a JWT with iss/sub hashes sha256(iss NUL sub).
    token = f"{_b64url('{}')}.{_b64url(json.dumps({'iss': 'https://issuer.example', 'sub': 'user_123'}))}.sig"
    expected = hashlib.sha256(b"https://issuer.example\x00user_123").hexdigest()
    assert token_identity_hash(token) == expected
    assert expected == VECTORS["sha_iss_nul_sub"] == CASES["basic"]["hash"]


@pytest.mark.parametrize("name", sorted(CASES))
def test_matches_gateway(name: str) -> None:
    case = CASES[name]
    assert token_identity_hash(case["token"]) == case["hash"]
    assert token_display_metadata(case["token"]) == (
        case["display"].get("tokenName"),
        case["display"].get("tokenEmail"),
    )


def test_opaque_token_hashes_raw_value() -> None:
    assert token_identity_hash("opaque") == hashlib.sha256(b"opaque").hexdigest()


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("Bearer abc", "abc"),
        ("Bearer  abc", " abc"),  # the gateway takes everything after "Bearer "
        ("bearer abc", None),
        ("Basic abc", None),
        ("Bearer ", None),
        ("Bearer mcp_internal_key", None),  # Manufact's own API keys are not end users
        (None, None),
    ],
)
def test_bearer_token(header: str | None, expected: str | None) -> None:
    assert bearer_token(header) == expected
