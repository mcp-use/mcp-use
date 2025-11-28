import argparse

from fastmcp import Context, FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse

mcp = FastMCP(name="AuthServer")

# We set all the fields to ensure that models
# correctly bind data

# OAuth metadata configuration
OAUTH_METADATA_RESPONSE = {
    "issuer": "http://127.0.0.1:8081",
    "authorization_endpoint": "http://127.0.0.1:8081/oauth/authorize",
    "token_endpoint": "http://127.0.0.1:8081/oauth/token",
    "userinfo_endpoint": "http://127.0.0.1:8081/oauth/userinfo",
    "revocation_endpoint": "http://127.0.0.1:8081/oauth/revocation",
    "introspection_endpoint": "http://127.0.0.1:8081/oauth/introspection",
    "registration_endpoint": "http://127.0.0.1:8081/oauth/register",
    "jwks_uri": "http://127.0.0.1:8081/oauth/jwks",
    "response_types_supported": ["code"],
    "subject_types_supported": ["public"],
    "id_token_signing_alg_values_supported": ["RS256"],
    "scopes_supported": ["openid", "profile", "email"],
    "token_endpoint_auth_methods_supported": ["client_secret_basic", "none"],
    "claims_supported": ["bla", "blabla"],
    "code_challenge_methods_supported": ["S256", "plain"],
    "client_id_metadata_document_supported": True,
}

PRM_RESPONSE = {
    "resource": "http://127.0.0.1:8081/mcp",
    "authorization_servers": ["http://127.0.0.1:8081"],
    # Optional but nice for testing
    "scopes_supported": ["openid", "profile", "email"],
}

DCR_RESPONSE = {
    "client_id": "renvins",
    "client_secret": "what a secret",
    "client_id_issued_at": 0,
    "client_secret_expires_at": 0,
    "redirect_uris": ["what a uri"],
    "grant_types": ["what a grant"],
    "response_types": ["good_response"],
    "client_name": "renvins_better",
    "token_endpoint_auth_method": "code",
}

AUTH_CODE_RESPONSE = {
    "code": "test_auth_code_12345",
}

TOKEN_RESPONSE = {
    "access_token": "valid_token",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "openid profile email",
}

SAMPLE_VALID_TOKEN = "valid_token"


def verify_auth(ctx: Context) -> str:
    """Verify auth token from context."""
    request = ctx.get_http_request()
    auth_header = request.headers.get("Authorization") if request else None

    if not auth_header or not auth_header.startswith("Bearer "):
        raise Exception("Missing or invalid Authorization header")

    token = auth_header.split(" ")[1]
    if token != SAMPLE_VALID_TOKEN:
        raise Exception("Invalid token")

    return token


@mcp.custom_route("/.well-known/oauth-authorization-server", methods=["GET"])
async def oauth_metadata(request: Request) -> JSONResponse:
    """Serve OAuth 2.1 Authorization Server Metadata."""
    return JSONResponse(OAUTH_METADATA_RESPONSE)


@mcp.custom_route("/.well-known/oauth-protected-resource", methods=["GET"])
async def oauth_prm(request: Request) -> JSONResponse:
    """Serve OAuth Protected Resource Metadata (PRM)."""
    return JSONResponse(PRM_RESPONSE)


@mcp.custom_route("/.well-known/openid-configuration", methods=["GET"])
async def oidc_metadata(request: Request) -> JSONResponse:
    """Serve OpenID Connect Discovery metadata."""
    return JSONResponse(OAUTH_METADATA_RESPONSE)


@mcp.custom_route("/oauth/register", methods=["POST"])
async def dynamic_regisration(request: Request) -> JSONResponse:
    """Serve client DCR data"""
    return JSONResponse(DCR_RESPONSE)


@mcp.custom_route("/oauth/authorize", methods=["GET"])
async def oauth_authorize(request: Request) -> RedirectResponse:
    """OAuth authorization endpoint - returns pre-created authorization code"""
    # Get the redirect_uri and state from query params
    params = dict(request.query_params)
    redirect_uri = params.get("redirect_uri", "http://127.0.0.1:8081/callback")
    state = params.get("state")

    # Redirect with pre-created authorization code
    redirect_url = f"{redirect_uri}?code={AUTH_CODE_RESPONSE['code']}&state={state}"
    return RedirectResponse(url=redirect_url, status_code=302)


@mcp.custom_route("/oauth/token", methods=["POST"])
async def oauth_token(request: Request) -> JSONResponse:
    """OAuth token endpoint - returns pre-created token"""
    return JSONResponse(TOKEN_RESPONSE)


# Protected tool that requires auth
@mcp.tool()
async def protected_tool(ctx: Context) -> str:
    """A tool that requires authentication."""
    verify_auth(ctx)
    return "Authenticated access granted!"


# Simple math tool for testing
@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run MCP auth test server.")
    parser.add_argument(
        "--transport",
        type=str,
        choices=["streamable-http", "sse"],
        default="streamable-http",
        help="MCP transport type to use (default: streamable-http)",
    )
    args = parser.parse_args()

    print(f"Starting MCP auth server with transport: {args.transport}")

    if args.transport == "streamable-http":
        mcp.run(transport="streamable-http", host="127.0.0.1", port=8081)
    elif args.transport == "sse":
        mcp.run(transport="sse", host="127.0.0.1", port=8081)
