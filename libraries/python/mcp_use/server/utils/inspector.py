"""Route handlers for the MCP inspector UI and its proxy endpoints."""

import json
import logging
import os
from urllib.parse import urlencode, urljoin

import httpx
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse

logger = logging.getLogger(__name__)

# Override with INSPECTOR_CDN_BASE_URL (e.g. http://localhost:2967) for E2E or local dev
INSPECTOR_CDN_BASE_URL = os.environ.get(
    "INSPECTOR_CDN_BASE_URL",
    "https://unpkg.com/@mcp-use/inspector@latest/dist/web",
).rstrip("/")
INDEX_URL = f"{INSPECTOR_CDN_BASE_URL}/index.html"

# Headers that must be stripped before forwarding a proxied request to the
# upstream MCP server.  They describe *our* edge, not the target.
_STRIPPED_HEADER_PREFIXES = ("x-proxy-", "x-target-", "x-mcp-", "x-forwarded-", "cf-")
_STRIPPED_HEADER_NAMES = frozenset(
    {"host", "x-target-url", "content-length", "accept-encoding", "x-original-host", "cdn-loop"}
)


async def inspector_index(request: Request, mcp_path: str = "/mcp") -> Response:
    """Serve the inspector index.html file with autoconnect parameter."""
    server_url = f"{request.url.scheme}://{request.url.netloc}{mcp_path}"

    server_param = request.query_params.get("server")
    autoconnect_param = request.query_params.get("autoConnect")

    if not server_param and not autoconnect_param:
        autoconnect_url = f"{request.url.scheme}://{request.url.netloc}{request.url.path}?autoConnect={server_url}"
        return RedirectResponse(url=autoconnect_url, status_code=302)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(INDEX_URL, follow_redirects=True)
            if response.status_code == 200:
                return HTMLResponse(response.text)
            else:
                logger.warning(
                    f"Failed to fetch inspector from CDN: {INDEX_URL} returned status {response.status_code}"
                )
    except Exception as e:
        logger.exception(f"Failed to fetch inspector from CDN: {INDEX_URL} - {e}")

    return HTMLResponse(
        content=f"""
        <html>
        <head><title>Inspector Unavailable</title></head>
        <body style="font-family: sans-serif; padding: 2rem;">
            <h1>Inspector CDN Unavailable</h1>
            <p>Could not load the inspector from CDN: <code>{INDEX_URL}</code></p>
            <p>The <code>index.html</code> file may be missing from the npm package.</p>
            <p style="margin-top: 2rem;">Server URL: <code>{server_url}</code></p>
        </body>
        </html>
        """,
        status_code=503,
    )


async def inspector_static(request: Request) -> Response:
    """Serve static files from the CDN."""
    path = request.path_params.get("path", "")
    cdn_url = f"{INSPECTOR_CDN_BASE_URL}/{path}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(cdn_url, follow_redirects=True)
            if response.status_code == 200:
                return HTMLResponse(
                    content=response.content, media_type=response.headers.get("Content-Type", "text/plain")
                )
            else:
                logger.warning(
                    f"Failed to fetch static file from CDN: {cdn_url} returned status {response.status_code}"
                )
    except Exception as e:
        logger.exception(f"Failed to fetch static file from CDN: {cdn_url} - {e}")

    return HTMLResponse("File not found", status_code=404)


async def inspector_telemetry_noop(request: Request) -> Response:
    """Silently accept inspector telemetry POSTs (PostHog / Scarf).

    The inspector JS fires analytics to ``/inspector/api/tel/posthog`` and
    ``/inspector/api/tel/scarf``.  In the standalone TS inspector these are
    forwarded server-side; in the embedded Python inspector we simply return
    200 so the browser does not log noisy 405 errors.
    """
    return Response(status_code=200)


def make_inspector_proxy(proxy_base: str):
    """Return an ASGI handler that proxies inspector requests to an MCP server.

    The inspector JS routes MCP traffic through ``/inspector/api/proxy`` to
    avoid browser CORS restrictions.  The handler:

    * reads the target from the ``X-Target-URL`` header (normal mode) or the
      ``__mcp_target`` query parameter (OAuth discovery mode);
    * strips infrastructure/CDN headers before forwarding;
    * follows one redirect hop server-side so the browser stays same-origin;
    * streams ``text/event-stream`` responses chunk-by-chunk;
    * rewrites the ``resource`` field in OAuth protected-resource metadata so
      the browser's validation sees the proxy URL, not the upstream origin.
    """

    def strip_proxy_prefix(request_path: str) -> str:
        """Remove the proxy base from the beginning of *request_path*."""
        if request_path == proxy_base:
            return ""
        if request_path.startswith(f"{proxy_base}/"):
            return request_path[len(proxy_base) :]
        return request_path

    def collect_query_items(query_params) -> list[tuple[str, str]]:
        """Return (key, value) pairs, supporting Starlette multi-value params."""
        if hasattr(query_params, "multi_items"):
            return list(query_params.multi_items())
        return list(query_params.items())

    def rewrite_oauth_resource(content: bytes, request: Request) -> bytes:
        """Rewrite ``resource`` in an OAuth discovery JSON body."""
        try:
            body_json = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            return content

        if "resource" not in body_json:
            return content

        protected_resource_prefix = "/.well-known/oauth-protected-resource"
        request_path = strip_proxy_prefix(request.url.path)
        proxy_origin = f"{request.url.scheme}://{request.url.netloc}"

        resource_suffix = ""
        if request_path.startswith(protected_resource_prefix):
            resource_suffix = request_path[len(protected_resource_prefix) :]

        body_json["resource"] = f"{proxy_origin}{proxy_base}{resource_suffix}"
        return json.dumps(body_json).encode()

    def filter_request_headers(raw_headers) -> dict[str, str]:
        """Build a forwarding header dict, stripping infrastructure headers."""
        headers: dict[str, str] = {}
        for k, v in raw_headers.items():
            lk = k.lower()
            if lk in _STRIPPED_HEADER_NAMES or any(lk.startswith(p) for p in _STRIPPED_HEADER_PREFIXES):
                continue
            headers[k] = v
        headers["accept-encoding"] = "identity"
        return headers

    def strip_encoding_headers(resp: httpx.Response) -> dict[str, str]:
        """Return response headers without encoding/length metadata."""
        return {
            k: v
            for k, v in resp.headers.items()
            if k.lower() not in ("content-encoding", "transfer-encoding", "content-length")
        }

    async def handle_proxy_error(exc: Exception, target_url: str, client: httpx.AsyncClient) -> JSONResponse:
        """Close *client* and return an appropriate JSON error response."""
        await client.aclose()
        if isinstance(exc, httpx.ConnectError):
            logger.warning(f"Connection refused to {target_url} - server may not be running")
            return JSONResponse({"error": "Connection refused", "targetUrl": target_url}, status_code=502)

        logger.exception(f"Proxy request failed: {exc}")
        return JSONResponse({"error": "Proxy request failed", "details": str(exc)}, status_code=500)

    async def inspector_proxy(request: Request) -> Response:
        """Proxy MCP requests from the inspector to the target server."""
        # __mcp_target query parameter takes precedence (used for OAuth
        # discovery where the full target path is encoded).
        target_from_query = request.query_params.get("__mcp_target")
        if target_from_query:
            request_path = strip_proxy_prefix(request.url.path)
            target_url = target_from_query + request_path
            extra_params = [(k, v) for k, v in collect_query_items(request.query_params) if k != "__mcp_target"]
            if extra_params:
                target_url += ("&" if "?" in target_url else "?") + urlencode(extra_params)
        else:
            target_url = request.headers.get("x-target-url")

        if not target_url:
            return JSONResponse(
                {"error": "Missing X-Target-URL header or __mcp_target query parameter"}, status_code=400
            )

        try:
            url_obj = httpx.URL(target_url)
            if url_obj.scheme not in ("http", "https"):
                raise ValueError
        except (httpx.InvalidURL, ValueError):
            return JSONResponse({"error": "Invalid target URL format"}, status_code=400)

        body = await request.body()
        headers = filter_request_headers(request.headers)

        client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0))

        async def send_streaming(url: str) -> httpx.Response:
            return await client.send(
                client.build_request(method=request.method, url=url, content=body, headers=headers),
                stream=True,
            )

        try:
            response = await send_streaming(target_url)
        except Exception as e:
            return await handle_proxy_error(e, target_url, client)

        # Follow one redirect hop inside the proxy so the browser never sees a
        # Location pointing at the upstream origin (which would bypass CORS).
        if 300 <= response.status_code < 400:
            location = response.headers.get("location")
            if location:
                redirect_url = urljoin(target_url, location)
                await response.aclose()
                try:
                    response = await send_streaming(redirect_url)
                except Exception as e:
                    return await handle_proxy_error(e, redirect_url, client)

        resp_headers = strip_encoding_headers(response)
        content_type = response.headers.get("content-type", "")

        # Stream SSE responses chunk-by-chunk so the inspector receives events
        # in real time instead of waiting for the upstream to close.
        if "text/event-stream" in content_type:

            async def event_generator():
                try:
                    async for chunk in response.aiter_bytes():
                        yield chunk
                finally:
                    await response.aclose()
                    await client.aclose()

            return StreamingResponse(
                content=event_generator(),
                status_code=response.status_code,
                headers=resp_headers,
                media_type=content_type,
            )

        # For non-streaming responses, buffer and set Content-Length.
        try:
            content = await response.aread()
        finally:
            await response.aclose()
            await client.aclose()

        # Rewrite OAuth discovery responses so the browser's resource
        # validation matches the proxy URL rather than the upstream origin.
        is_oauth_discovery = (
            "/.well-known/oauth-protected-resource" in request.url.path and "application/json" in content_type
        )
        if is_oauth_discovery and content:
            content = rewrite_oauth_resource(content, request)

        resp_headers["content-length"] = str(len(content))
        return Response(
            content=content,
            status_code=response.status_code,
            headers=resp_headers,
        )

    return inspector_proxy
