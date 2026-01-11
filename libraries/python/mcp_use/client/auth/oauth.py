"""OAuth authentication support for MCP clients."""

import base64
import hashlib
import json
import re
import secrets
import webbrowser
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from authlib.integrations.httpx_client import AsyncOAuth2Client
from authlib.oauth2 import OAuth2Error
from pydantic import BaseModel, Field, HttpUrl, SecretStr

from mcp_use.client.auth.bearer import BearerAuth
from mcp_use.client.auth.oauth_callback import OAuthCallbackServer
from mcp_use.client.exceptions import OAuthAuthenticationError, OAuthDiscoveryError
from mcp_use.logging import logger
from mcp_use.telemetry.telemetry import telemetry


class ServerOAuthMetadata(BaseModel):
    """OAuth metadata from MCP server with flexible field support.
    It is essentially a configuration that tells MCP client:

    - Where to send users for authorization
    - Where to exchange the codes for tokens
    - Which OAuth features are supported
    - Where to register new users with DCR"""

    issuer: HttpUrl  # The OAuth server's identity
    authorization_endpoint: HttpUrl  # URL with endpoint for client auth
    token_endpoint: HttpUrl  # URL with endpoint for tokens' exchange
    userinfo_endpoint: HttpUrl | None = None
    revocation_endpoint: HttpUrl | None = None
    introspection_endpoint: HttpUrl | None = None
    registration_endpoint: HttpUrl | None = None  # Endpoint for DCR
    jwks_uri: HttpUrl | None = None
    response_types_supported: list[str] = Field(default_factory=lambda: ["code"])
    subject_types_supported: list[str] = Field(default_factory=lambda: ["public"])
    id_token_signing_alg_values_supported: list[str] = Field(default_factory=lambda: ["RS256"])
    scopes_supported: list[str] | None = None  # Which permissions are supported
    token_endpoint_auth_methods_supported: list[str] = Field(default_factory=lambda: ["client_secret_basic"])
    claims_supported: list[str] | None = None
    code_challenge_methods_supported: list[str] | None = None
    client_id_metadata_document_supported: bool | None = None

    class Config:
        extra = "allow"  # Allow additional fields


class ProtectedResourceMetadata(BaseModel):
    """
    PRM (Protected Resource Metadata) can have metadata
    describing their configuration. It could contain information
    about the OAuth metadata.
    """

    resource: str
    authorization_servers: list[str]
    scopes_supported: list[str] | None = None


class OAuthClientProvider(BaseModel):
    """OAuth client provider configuration for a specific server.

    This contains all the information needed to authenticate with an OAuth server
    without needing to discover metadata or register clients dynamically."""

    id: str  # Unique identifier
    display_name: str
    metadata: ServerOAuthMetadata | dict[str, Any]

    @property
    def oauth_metadata(self) -> ServerOAuthMetadata:
        """Get OAuth metadata as ServerOAuthMetadata instance."""
        if isinstance(self.metadata, dict):
            return ServerOAuthMetadata(**self.metadata)
        return self.metadata


class TokenData(BaseModel):
    """OAuth token data.

    This is the information received after
    successfull authentication"""

    access_token: str  # Actual credential used for requests
    token_type: str = "Bearer"
    expires_at: float | None = None
    refresh_token: str | None = None
    scope: str | None = None


class ClientRegistrationResponse(BaseModel):
    """Dynamic Client Registration response.

    It represents the response from an OAuth server
    when you dinamically register a new OAuth client."""

    client_id: str
    client_secret: str | None = None
    client_id_issued_at: int | None = None
    client_secret_expires_at: int | None = None
    redirect_uris: list[str] | None = None  # Where auth server should redirect after auth
    grant_types: list[str] | None = None  # Which oauth flows it uses
    response_types: list[str] | None = None
    client_name: str | None = None
    token_endpoint_auth_method: str | None = None

    class Config:
        extra = "allow"  # Allow additional fields from server


class FileTokenStorage:
    """File-based token storage.

    It's responsible for:

    - Saving OAuth tokens to disk after auth
    - Loading saved tokens when the app restarts
    - Deleting tokens when they're revoked
    - Organizing tokens by server URL"""

    def __init__(self, base_dir: Path | None = None):
        """Initialize token storage.

        Args:
            base_dir: Base directory for token storage. Defaults to ~/.mcp_use/tokens
        """
        self.base_dir = base_dir or Path.home() / ".mcp_use" / "tokens"
        logger.debug(f"FileTokenStorage initialized with base_dir: {self.base_dir}")
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _get_token_path(self, server_url: str) -> Path:
        """Get token file path for a server."""
        # Create a safe filename from the URL
        parsed = urlparse(server_url)
        filename = f"{parsed.netloc}_{parsed.path.replace('/', '_')}.json"
        path = self.base_dir / filename
        logger.debug(f"Token path for server '{server_url}' is '{path}'")
        return path

    async def save_tokens(self, server_url: str, tokens: dict[str, Any]) -> None:
        """Save tokens to file."""
        token_path = self._get_token_path(server_url)
        logger.debug(f"Saving tokens for '{server_url}' to '{token_path}'")
        token_data = TokenData(**tokens)
        token_path.write_text(token_data.model_dump_json())
        logger.debug(f"Tokens saved successfully for '{server_url}'")

    async def load_tokens(self, server_url: str) -> TokenData | None:
        """Load tokens from file."""
        token_path = self._get_token_path(server_url)
        logger.debug(f"Attempting to load tokens for '{server_url}' from '{token_path}'")
        if not token_path.exists():
            logger.debug(f"Token file not found: '{token_path}'")
            return None

        try:
            data = json.loads(token_path.read_text())
            token_data = TokenData(**data)
            logger.debug(f"Successfully loaded tokens for '{server_url}'")
            return token_data
        except (json.JSONDecodeError, ValueError) as e:
            logger.debug(f"Failed to load or parse token file '{token_path}': {e}")
            return None

    async def delete_tokens(self, server_url: str) -> None:
        """Delete tokens for a server."""
        token_path = self._get_token_path(server_url)
        logger.debug(f"Deleting tokens for '{server_url}' at '{token_path}'")
        if token_path.exists():
            token_path.unlink()
            logger.debug(f"Token file '{token_path}' deleted.")
        else:
            logger.debug(f"Token file '{token_path}' not found, nothing to delete.")


class OAuth:
    """OAuth authentication handler for MCP clients.

    This is the main class that handles all the authentication
    It has several features:

    - Discovers OAuth server capabilities automatically
    - Registers client dynamically when possible
    - Manages token storage and refresh automaticlly"""

    def __init__(
        self,
        server_url: str,
        token_storage: FileTokenStorage | None = None,
        scope: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        callback_port: int | None = None,
        oauth_provider: OAuthClientProvider | None = None,
        client_metadata_url: str | None = None,
    ):
        """Initialize OAuth handler.

        Args:
            server_url: The MCP server URL
            token_storage: Token storage implementation. Defaults to FileTokenStorage
            scope: OAuth scopes to request
            client_id: OAuth client ID. If not provided, will attempt dynamic registration
            client_secret: OAuth client secret (for confidential clients)
            callback_port: Port for local callback server, if empty, 8080 is used
            oauth_provider: OAuth client provider to prevent metadata discovery
            client_metadata_url: Field used to authenticate with CIMD
        """
        logger.debug(f"Initializing OAuth for server: {server_url}")
        self.server_url = server_url
        self.token_storage = token_storage or FileTokenStorage()
        self.scope = scope
        self.client_id = client_id
        self.client_secret = client_secret
        self.client_metadata_url = client_metadata_url

        if callback_port:
            self.callback_port = callback_port
            logger.info(f"Using custom callback port {self.callback_port} provided in config")
        else:
            self.callback_port = 8080
            logger.info(f"Using default callback port {self.callback_port}")

        # Set the default redirect uri
        self.redirect_uri = f"http://localhost:{self.callback_port}/callback"
        self._oauth_provider = oauth_provider
        self._metadata: ServerOAuthMetadata | None = None
        self._resource_metadata: ProtectedResourceMetadata | None = None

        if self._oauth_provider:
            self._metadata = self._oauth_provider.oauth_metadata
            logger.debug(f"Using OAuth provider {self._oauth_provider.id} with metadata")

        self._client: AsyncOAuth2Client | None = None
        self._bearer_auth: BearerAuth | None = None
        logger.debug(f"OAuth initialized with scope='{self.scope}', client_id='{self.client_id}'")

    @telemetry("oauth_initialize")
    async def initialize(self, client: httpx.AsyncClient) -> BearerAuth | None:
        """Initialize OAuth and return bearer auth if tokens exist."""
        logger.debug(f"OAuth.initialize called for {self.server_url}")
        # Try to load existing tokens
        logger.debug("Attempting to load existing tokens")
        token_data = await self.token_storage.load_tokens(self.server_url)
        if token_data:
            logger.debug("Found existing tokens, checking validity")
            if self._is_token_valid(token_data):
                logger.debug("Existing token is valid, creating BearerAuth")
                self._bearer_auth = BearerAuth(token=SecretStr(token_data.access_token))
                logger.debug("OAuth.initialize returning existing valid BearerAuth")
                return self._bearer_auth
            else:
                logger.debug("Existing token is expired")
        else:
            logger.debug("No existing tokens found")

        # Discover OAuth metadata
        if not self._metadata:
            logger.debug("No valid token, proceeding to discover OAuth metadata")
            await self._discover_metadata(client)
        else:
            logger.debug("Using provided OAuth metadata, skipping discovery")

        logger.debug("OAuth.initialize finished, no valid token available yet")
        return None

    @telemetry("oauth_authenticate")
    async def authenticate(self) -> BearerAuth:
        """Perform OAuth authentication flow."""
        logger.debug("OAuth.authenticate called")
        if not self._metadata:
            logger.error("OAuth.authenticate called before metadata was discovered.")
            raise OAuthAuthenticationError("OAuth metadata not discovered")

        # The port check should be done now. OAuth servers
        # register client_id with also redirect_uri, so we
        # have to ensure port is available before DCR
        try:
            import socket

            sock = socket.socket()
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", self.callback_port))
            sock.close()
            logger.debug(f"Using registered port {self.callback_port} for callback")
        except (ValueError, OSError) as exception:
            logger.error(f"The port {self.callback_port} is not available! Try using a different port!")
            raise exception

        # Check if code challenge exists with S256
        if (
            not self._metadata.code_challenge_methods_supported
            or "S256" not in self._metadata.code_challenge_methods_supported
        ):
            raise OAuthAuthenticationError("The auth must support code challenge S256. Can't complete auth without it.")

        # Check if it supports CIMD
        supports_cimd = (
            self._metadata.client_id_metadata_document_supported
            if self._metadata.client_id_metadata_document_supported
            else False
        )

        client_id = self.client_id
        client_secret = self.client_secret

        # 1) CIMD path (preferred when configured as specified in MCP spec)
        if self.client_metadata_url and supports_cimd:
            logger.debug(f"Using Client ID Metadata Document (CIMD) as client_id: {self.client_metadata_url}")
            client_id = self.client_metadata_url
            client_secret = None  # public client
        else:
            # 2) Legacy paths: pre-registered clients or DCR
            registration = None  # Track if we used DCR
            if not client_id:
                logger.debug("No client_id provided, attempting dynamic client registration")
                # Try to load previously registered client
                registration = await self._load_client_registration()

                if registration:
                    logger.debug("Using previously registered client")
                    client_id = registration.client_id
                    client_secret = registration.client_secret
                else:
                    # Attempt dynamic registration
                    registration = await self._try_dynamic_registration()
                    if registration:
                        logger.debug("Dynamic registration successful")
                        client_id = registration.client_id
                        client_secret = registration.client_secret
                        # Store for future use
                        await self._store_client_registration(registration)
                    else:
                        if supports_cimd and not self._metadata.registration_endpoint:
                            raise OAuthAuthenticationError(
                                "OAuth server only supports Client ID Metadata Documents. "
                                "Please provide 'client_metadata_url' in the auth configuration "
                                "pointing to your CIMD JSON document."
                            )
                        logger.error("Dynamic client registration failed or not supported")
                        raise OAuthAuthenticationError(
                            "OAuth requires a client_id. Server does not support dynamic registration. "
                            "Please provide one in the auth configuration. "
                            "Example: {'auth': {'client_id': 'your-registered-client-id'}}"
                        )

        logger.debug(f"Using client_id: {client_id}")

        # Generate PKCE code_verifier/challenge
        code_verifier, code_challenge = self._generate_pkce_pair()

        # Create OAuth client
        logger.debug("Creating AsyncOAuth2Client")
        self._client = AsyncOAuth2Client(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=self.redirect_uri,
            scope=self.scope,
        )

        # Start callback server
        logger.debug("Starting OAuth callback server")

        callback_server = OAuthCallbackServer(port=self.callback_port)
        redirect_uri = await callback_server.start()
        self._client.redirect_uri = redirect_uri
        logger.debug(f"Callback server started, redirect_uri: {redirect_uri}")

        # Generate state for CSRF protection
        state = secrets.token_urlsafe(32)
        logger.debug(f"Generated state for CSRF protection: {state}")

        # Get resource as required in the MCP spec
        resource = self._resource_metadata.resource if self._resource_metadata else self.server_url

        # Build authorization URL
        logger.debug("Creating authorization URL")
        auth_url, _ = self._client.create_authorization_url(
            str(self._metadata.authorization_endpoint),
            resource=resource,
            state=state,
            code_challenge=code_challenge,
            code_challenge_method="S256",
        )

        logger.debug("OAuth flow started:")
        logger.debug(f"  Client ID: {client_id}")
        logger.debug(f"  Authorization endpoint: {self._metadata.authorization_endpoint}")
        logger.debug(f"  Redirect URI: {redirect_uri}")
        logger.debug(f"  Scope: {self.scope}")

        # Open browser for authorization
        print(f"Opening browser for authorization: {auth_url}")
        webbrowser.open(auth_url)

        # Wait for callback
        logger.debug("Waiting for authorization code from callback server")
        try:
            response = await callback_server.wait_for_code()
            logger.debug("Received response from callback server")
        except TimeoutError as e:
            logger.error(f"OAuth callback timed out: {e}")
            raise OAuthAuthenticationError(f"OAuth timeout: {e}") from e

        if response.error:
            logger.error("OAuth authorization failed:")
            logger.error(f"  Error: {response.error}")
            logger.error(f"  Description: {response.error_description}")
            logger.error("  The OAuth server returned this error, likely because:")
            logger.error(f"    1. The client_id '{client_id}' is not registered with the OAuth server")
            logger.error("    2. The redirect_uri doesn't match the registered one")
            logger.error("    3. The requested scopes are invalid")
            raise OAuthAuthenticationError(f"{response.error}: {response.error_description}")

        if not response.code:
            logger.error("Callback response did not contain an authorization code")
            raise OAuthAuthenticationError("No authorization code received")

        logger.debug(f"Received authorization code: {response.code[:10]}...")

        # Verify state
        logger.debug(f"Verifying state. Expected: {state}, Got: {response.state}")
        if response.state != state:
            logger.error("State mismatch in OAuth callback. Possible CSRF attack.")
            raise OAuthAuthenticationError("Invalid state parameter - possible CSRF attack")
        logger.debug("State verified successfully")

        # Exchange code for tokens
        logger.debug("Exchanging authorization code for tokens")
        try:
            token_response = await self._client.fetch_token(
                str(self._metadata.token_endpoint),
                authorization_response=f"{redirect_uri}?code={response.code}&state={response.state}",
                grant_type="authorization_code",
                code_verifier=code_verifier,
            )
            logger.debug("Successfully fetched tokens")
        except OAuth2Error as e:
            logger.error(f"Token exchange failed: {e}")
            raise OAuthAuthenticationError(f"Token exchange failed: {e}") from e

        # Save tokens
        logger.debug("Saving fetched tokens")
        await self.token_storage.save_tokens(self.server_url, token_response)

        # Create bearer auth
        logger.debug("Creating BearerAuth with new access token")
        self._bearer_auth = BearerAuth(token=SecretStr(token_response["access_token"]))
        return self._bearer_auth

    def _generate_pkce_pair(self) -> tuple[str, str]:
        """Generate PKCE code_verifier and S256 code_challenge"""
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
            .rstrip(b"=")
            .decode("ascii")
        )

        return code_verifier, code_challenge

    async def _discover_metadata(self, client: httpx.AsyncClient) -> None:
        """Discover OAuth metadata from server."""
        logger.debug(f"Discovering OAuth metadata for {self.server_url}")
        # Try well-known endpoint first
        parsed = urlparse(self.server_url)

        base_url = f"{parsed.scheme}://{parsed.netloc}"
        prm_url: str | None = None

        # 1) Try to get PRM URL from 401 + WWW-Authenticate
        try:
            init_resp = await client.get(self.server_url, headers={"Accept": "application/json"})
            if init_resp.status_code == 401:
                # Parse the resource_metadata
                prm_url = self._extract_prm(init_resp)
        except httpx.HTTPError as e:
            logger.debug(f"Failed probing server for PRM via 401: {e}")

        # 1b) If WWW-Authenticate didn’t give us a URL, try well-known PRM paths
        if not prm_url:
            path = (parsed.path or "").rstrip("/")
            candidate_prm_urls: list[str] = []

            # Path-specific form: /.well-known/oauth-protected-resource{path}
            if path:
                candidate_prm_urls.append(f"{base_url}/.well-known/oauth-protected-resource{path}")

            # Root form: /.well-known/oauth-protected-resource
            candidate_prm_urls.append(f"{base_url}/.well-known/oauth-protected-resource")

            for candidate in candidate_prm_urls:
                try:
                    logger.debug(f"Trying OAuth PRM endpoint at: {candidate}")
                    prm_response = await client.get(candidate)
                    prm_response.raise_for_status()
                    prm = prm_response.json()
                    self._resource_metadata = ProtectedResourceMetadata(**prm)
                    logger.debug("Successfully got the PRM data")
                    logger.debug(f"Authorization servers: {self._resource_metadata.authorization_servers}")
                    prm_url = candidate
                    break
                except (httpx.HTTPError, ValueError) as e:
                    logger.debug(f"Failed to discover OAuth PRM at {candidate}: {e}")

        # 2) If we have PRM URL but _resource_metadata is still None
        if prm_url and not self._resource_metadata:
            try:
                logger.debug(f"Trying OAuth PRM endpoint at: {prm_url}")
                prm_response = await client.get(prm_url)
                prm_response.raise_for_status()
                prm = prm_response.json()
                self._resource_metadata = ProtectedResourceMetadata(**prm)
                logger.debug("Successfully got the PRM data")
                logger.debug(f"Authorization servers: {self._resource_metadata.authorization_servers}")
            except (httpx.HTTPError, ValueError) as e:
                logger.debug(f"Failed to discover OAuth PRM at {prm_url}: {e}")
                pass

        # 3) For each authorization server, try AS metadata and stop on first success
        #
        # Well-known URL construction differs between OAuth 2.0 and OpenID Connect:
        #   - OAuth 2.0 (RFC 8414): Insert .well-known between host and path
        #   - OpenID Connect: Append .well-known to issuer
        #
        # Example for issuer https://github.com/login/oauth:
        #   - OAuth 2.0:  https://github.com/.well-known/oauth-authorization-server/login/oauth
        #   - OIDC:       https://github.com/login/oauth/.well-known/openid-configuration
        #
        # See: https://www.rfc-editor.org/rfc/rfc8414.html#section-3.1
        auth_servers = self._resource_metadata.authorization_servers if self._resource_metadata else []
        for auth_server in auth_servers:
            parsed_issuer = urlparse(auth_server)
            issuer_base = f"{parsed_issuer.scheme}://{parsed_issuer.netloc}"
            issuer_path = (parsed_issuer.path or "").rstrip("/")

            # OAuth 2.0 (RFC 8414): Insert .well-known between host and path
            oauth_candidates: list[str] = []
            if issuer_path:
                # e.g., https://github.com/.well-known/oauth-authorization-server/login/oauth
                oauth_candidates.append(f"{issuer_base}/.well-known/oauth-authorization-server{issuer_path}")
            else:
                oauth_candidates.append(f"{issuer_base}/.well-known/oauth-authorization-server")

            # OpenID Connect: Append .well-known to issuer
            oidc_candidates: list[str] = []
            # e.g., https://github.com/login/oauth/.well-known/openid-configuration
            oidc_candidates.append(f"{auth_server.rstrip('/')}/.well-known/openid-configuration")

            # Try OAuth 2.0 Authorization Server Metadata endpoints first
            for well_known_url in oauth_candidates:
                try:
                    logger.debug(f"Trying OAuth metadata discovery for issuer: {parsed_issuer.netloc}")
                    response = await client.get(well_known_url)
                    response.raise_for_status()
                    metadata = response.json()
                    self._metadata = ServerOAuthMetadata(**metadata)
                    logger.debug("Successfully discovered OAuth metadata")
                    logger.debug(f"  Authorization endpoint: {self._metadata.authorization_endpoint}")
                    logger.debug(f"  Token endpoint: {self._metadata.token_endpoint}")
                    return
                except (httpx.HTTPError, ValueError) as e:
                    logger.debug(f"Failed to discover OAuth metadata: {e}")

            # Then try OpenID Connect Discovery endpoints
            for oidc_url in oidc_candidates:
                logger.debug(f"Trying OpenID Connect discovery for issuer: {parsed_issuer.netloc}")
                try:
                    response = await client.get(oidc_url)
                    response.raise_for_status()
                    metadata = response.json()
                    self._metadata = ServerOAuthMetadata(**metadata)
                    logger.debug("Successfully discovered OIDC metadata")
                    logger.debug(f"  Authorization endpoint: {self._metadata.authorization_endpoint}")
                    logger.debug(f"  Token endpoint: {self._metadata.token_endpoint}")
                    return
                except (httpx.HTTPError, ValueError) as e:
                    logger.debug(f"Failed to discover OIDC metadata: {e}")

        # 4) If PRM path didn't yield anything, fall back to old host-level discovery
        if not self._metadata:
            well_known_url = f"{base_url}/.well-known/oauth-authorization-server"
            try:
                logger.debug(f"Trying OAuth metadata discovery for host: {parsed.netloc}")
                resp = await client.get(well_known_url)
                resp.raise_for_status()
                self._metadata = ServerOAuthMetadata(**resp.json())
                logger.debug("Successfully discovered OAuth metadata (host-level fallback)")
                return
            except (httpx.HTTPError, ValueError) as e:
                logger.debug(f"Failed to discover OAuth metadata: {e}")

            oidc_url = f"{base_url}/.well-known/openid-configuration"
            logger.debug(f"Trying OpenID Connect discovery for host: {parsed.netloc}")
            try:
                resp = await client.get(oidc_url)
                resp.raise_for_status()
                self._metadata = ServerOAuthMetadata(**resp.json())
                logger.debug("Successfully discovered OIDC metadata (host-level fallback)")
                return
            except (httpx.HTTPError, ValueError) as e:
                logger.debug(f"Failed to discover OIDC metadata: {e}")

        logger.error(f"Failed to discover OAuth/OIDC metadata for {self.server_url}")
        raise OAuthDiscoveryError(
            f"Failed to discover OAuth metadata for {self.server_url}. "
            "Server must support OAuth metadata discovery at "
            "/.well-known/oauth-authorization-server or /.well-known/openid-configuration"
        )

    def _extract_prm(self, response: httpx.Response) -> str | None:
        www_auth = response.headers.get("WWW-Authenticate")
        if not www_auth:
            return None

        # If the server has a scope and the user didn't override it
        scope_match = re.search(r'scope="([^"]+)"', www_auth)
        if scope_match and not self.scope:
            self.scope = scope_match.group(1)
            logger.debug("Using scope from WWW-Authenticate header")

        # Extract PRM url
        match = re.search(r'resource_metadata="([^"]+)"', www_auth)
        if match:
            return match.group(1)

        return None

    def _is_token_valid(self, token_data: TokenData) -> bool:
        """Check if token is still valid."""
        logger.debug("Checking token validity")
        if not token_data.expires_at:
            logger.debug("Token has no expiration time, assuming it's valid.")
            return True  # No expiration info, assume valid

        # Check if token expires in more than 60 seconds
        expires_at = datetime.fromtimestamp(token_data.expires_at, tz=UTC)
        now = datetime.now(tz=UTC)
        is_valid = expires_at > now + timedelta(seconds=60)
        logger.debug(f"Token expires at {expires_at}, current time is {now}. Valid: {is_valid}")
        return is_valid

    async def _try_dynamic_registration(self) -> ClientRegistrationResponse | None:
        """Try Dynamic Client Registration if supported by the server."""
        if not self._metadata or not self._metadata.registration_endpoint:
            logger.debug("No registration endpoint available, skipping DCR")
            return None

        logger.info("Attempting Dynamic Client Registration")
        logger.debug(f"DCR endpoint: {self._metadata.registration_endpoint}")

        registration_data = {
            "client_name": "mcp-use",
            "redirect_uris": [self.redirect_uri],
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",  # Public client
            "application_type": "native",
        }

        # Add scope if specified
        if self.scope:
            registration_data["scope"] = self.scope

        logger.debug(f"DCR request payload: {registration_data}")
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    str(self._metadata.registration_endpoint),
                    json=registration_data,
                    headers={"Content-Type": "application/json"},
                )
                logger.debug(f"DCR response status: {response.status_code}")
                response.raise_for_status()

                # Parse registration response
                reg_response_data = response.json()
                logger.debug(f"DCR response body: {reg_response_data}")
                reg_response = ClientRegistrationResponse(**reg_response_data)

                # Update our credentials
                self.client_id = reg_response.client_id
                self.client_secret = reg_response.client_secret

                logger.info(f"Dynamic Client Registration successful: {self.client_id}")

                # Store the registered client info for future use
                await self._store_client_registration(reg_response)

                return reg_response

        except httpx.HTTPError as e:
            logger.warning(f"Dynamic Client Registration failed: {e}")
            # Log the response if available
            if hasattr(e, "response") and e.response:
                logger.debug(f"DCR response: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            logger.warning(f"Unexpected error during DCR: {e}")
            return None

    async def _store_client_registration(self, registration: ClientRegistrationResponse) -> None:
        """Store client registration data for future use."""
        logger.debug("Storing client registration data")
        # Store alongside tokens in a separate file
        storage_path = self.token_storage.base_dir / "registrations"
        storage_path.mkdir(parents=True, exist_ok=True)

        # Create a safe filename from the server URL
        parsed = urlparse(self.server_url)
        filename = f"{parsed.netloc}_{parsed.path.replace('/', '_')}_registration.json"
        reg_path = storage_path / filename
        logger.debug(f"Storing client registration to '{reg_path}'")

        # Store registration data
        reg_path.write_text(registration.model_dump_json())
        logger.debug("Client registration data stored successfully")

    async def _load_client_registration(self) -> ClientRegistrationResponse | None:
        """Load previously registered client credentials if available."""
        logger.debug("Attempting to load client registration data")
        storage_path = self.token_storage.base_dir / "registrations"

        # Create a safe filename from the server URL
        parsed = urlparse(self.server_url)
        filename = f"{parsed.netloc}_{parsed.path.replace('/', '_')}_registration.json"
        reg_path = storage_path / filename
        logger.debug(f"Checking for client registration file at '{reg_path}'")

        if reg_path.exists():
            logger.debug("Client registration file found")
            try:
                data = json.loads(reg_path.read_text())
                reg_response = ClientRegistrationResponse(**data)

                # Check if registration is still valid (if expiry info provided)
                if reg_response.client_secret_expires_at:
                    expires_at = datetime.fromtimestamp(reg_response.client_secret_expires_at, tz=UTC)
                    now = datetime.now(tz=UTC)
                    logger.debug(f"Checking client registration expiry. Expires at: {expires_at}, Now: {now}")
                    if expires_at <= now:
                        logger.debug("Stored client registration has expired")
                        return None

                self.client_id = reg_response.client_id
                self.client_secret = reg_response.client_secret
                logger.debug(f"Loaded stored client registration: {self.client_id}")
                return reg_response

            except Exception as e:
                logger.debug(f"Failed to load client registration: {e}")
        else:
            logger.debug("Client registration file not found")

        return None

    @telemetry("oauth_refresh_token")
    async def refresh_token(self) -> BearerAuth | None:
        """Refresh the access token if possible."""
        logger.debug("Attempting to refresh token")
        token_data = await self.token_storage.load_tokens(self.server_url)
        if not token_data or not token_data.refresh_token:
            logger.debug("No token data or refresh token found, cannot refresh.")
            return None

        if not self._metadata:
            logger.debug("No OAuth metadata available, cannot refresh token.")
            return None

        if not self._client:
            if not self.client_id:
                logger.debug("Cannot refresh token without client_id")
                return None
            logger.debug("Creating temporary AsyncOAuth2Client for token refresh")
            self._client = AsyncOAuth2Client(client_id=self.client_id, client_secret=self.client_secret)

        logger.debug("Calling client.refresh_token")
        try:
            token_response = await self._client.refresh_token(
                str(self._metadata.token_endpoint),
                refresh_token=token_data.refresh_token,
            )
            logger.debug("Token refresh successful")

            # Save new tokens
            logger.debug("Saving new tokens after refresh")
            await self.token_storage.save_tokens(self.server_url, token_response)

            # Update bearer auth
            logger.debug("Updating BearerAuth with new access token")
            self._bearer_auth = BearerAuth(token=SecretStr(token_response["access_token"]))
            return self._bearer_auth

        except OAuth2Error as e:
            logger.warning(f"Token refresh failed: {e}. Re-authentication is required.")
            # Refresh failed, need to re-authenticate
            return None
