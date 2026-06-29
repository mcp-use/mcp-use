import logging
import os
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as pkg_version
from urllib.parse import urlencode

import httpx
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

logger = logging.getLogger(__name__)

DEFAULT_CDN_BASE = "https://inspector-cdn.mcp-use.com"
UNPKG_DIST_BASE = "https://unpkg.com/@mcp-use/inspector@latest/dist/web"


def resolve_inspector_use_cdn(env: os._Environ | None = None) -> bool:
    """Return whether to serve the versioned CDN bundle shell.

    Python has no bundled dist/web/, so CDN is the default. Set
    ``INSPECTOR_USE_CDN=false`` to fall back to fetching index.html from unpkg.
    Set ``INSPECTOR_USE_CDN=true`` explicitly when needed (e.g. e2e matrix).
    """
    env = env or os.environ
    use_cdn = env.get("INSPECTOR_USE_CDN")
    if use_cdn == "false":
        return False
    if use_cdn == "true":
        return True
    return True


def _resolve_cdn_base(env: os._Environ | None = None) -> str:
    env = env or os.environ
    return (
        env.get("INSPECTOR_CDN_BASE")
        or env.get("INSPECTOR_CDN_BASE_URL")  # legacy alias
        or DEFAULT_CDN_BASE
    ).rstrip("/")


def get_inspector_version(env: os._Environ | None = None) -> str:
    env = env or os.environ
    if version := env.get("INSPECTOR_VERSION"):
        return version
    try:
        return pkg_version("@mcp-use/inspector")
    except PackageNotFoundError:
        return "latest"


def inspector_cdn_js_url(
    *,
    cdn_base: str | None = None,
    inspector_version: str | None = None,
    env: os._Environ | None = None,
) -> str:
    base = (cdn_base or _resolve_cdn_base(env)).rstrip("/")
    version = inspector_version or get_inspector_version(env)
    return f"{base}/inspector@{version}.js"


INSPECTOR_CDN_BASE = _resolve_cdn_base()
INSPECTOR_VERSION = get_inspector_version()
CDN_JS_URL = inspector_cdn_js_url()

# Legacy alias: unpkg dist base for offline fallback tests and docs.
INSPECTOR_CDN_BASE_URL = UNPKG_DIST_BASE
INDEX_URL = f"{UNPKG_DIST_BASE}/index.html"


def generate_cdn_shell_html(
    *,
    cdn_base: str | None = None,
    inspector_version: str | None = None,
    inspector_mode: str = "embedded",
) -> str:
    """Minimal HTML shell that loads the inspector bundle from CDN.

    The JS runs on the host origin so any same-origin /inspector/api/* calls
    stay on the embedding server.
    """
    base = (cdn_base or INSPECTOR_CDN_BASE).rstrip("/")
    version = inspector_version or INSPECTOR_VERSION
    cdn_js_url = inspector_cdn_js_url(cdn_base=base, inspector_version=version)
    disable_telemetry = os.environ.get("MCP_USE_ANONYMIZED_TELEMETRY") == "false"

    runtime_scripts = "\n    ".join(
        script
        for script in (
            f'<script>window.__MCP_PROXY_URL__ = null;</script>',
            f'<script>window.__MCP_INSPECTOR_MODE__ = {repr(inspector_mode)};</script>',
            (
                '<script>window.__MCP_USE_ANONYMIZED_TELEMETRY__ = false;'
                "try{localStorage.setItem('MCP_USE_ANONYMIZED_TELEMETRY','false');}"
                "catch(e){}</script>"
            )
            if disable_telemetry
            else None,
        )
        if script
    )

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link
      rel="icon"
      type="image/svg+xml"
      href="{base}/favicon-black.svg"
    />
    <link
      rel="icon"
      type="image/svg+xml"
      href="{base}/favicon-white.svg"
      media="(prefers-color-scheme: dark)"
    />
    <link
      rel="icon"
      type="image/svg+xml"
      href="{base}/favicon-black.svg"
      media="(prefers-color-scheme: light)"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
    <title>Inspector | mcp-use</title>
    <meta
      name="description"
      content="Free, open-source MCP Inspector by mcp-use. Connect to any MCP server, test tools, prompts, and resources, inspect RPC logs, and debug MCP apps — all in your browser."
    />
    <script>window.__INSPECTOR_VERSION__ = {version!r};</script>
    {runtime_scripts}
  </head>
  <body>
    <script>
      if (typeof window !== "undefined" && typeof window.process === "undefined") {{
        window.process = {{
          env: {{}},
          platform: "browser",
          browser: true,
          version: "v18.0.0",
          versions: {{ node: "18.0.0" }},
          cwd: () => "/",
          nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
        }};
      }}
    </script>
    <div id="root"></div>
    <script type="module" src="{cdn_js_url}"></script>
  </body>
</html>"""


async def _inspector_index(
    request: Request,
    mcp_path: str = "/mcp",
    inspector_path: str = "/inspector",
):
    """Serve the inspector UI with autoconnect parameter."""
    server_url = f"{request.url.scheme}://{request.url.netloc}{mcp_path}"

    server_param = request.query_params.get("server")
    autoconnect_param = request.query_params.get("autoConnect")

    if not server_param and not autoconnect_param:
        autoconnect_url = (
            f"{request.url.scheme}://{request.url.netloc}{inspector_path}?{urlencode({'autoConnect': server_url})}"
        )
        return RedirectResponse(url=autoconnect_url, status_code=302)

    if resolve_inspector_use_cdn():
        return HTMLResponse(generate_cdn_shell_html())

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(INDEX_URL, follow_redirects=True)
            if response.status_code == 200:
                html = response.text.replace(
                    'src="/inspector/assets/',
                    f'src="{UNPKG_DIST_BASE}/assets/',
                )
                html = html.replace(
                    'href="/inspector/assets/',
                    f'href="{UNPKG_DIST_BASE}/assets/',
                )
                return HTMLResponse(html)
            logger.warning(
                "Failed to fetch inspector from unpkg: %s returned status %s",
                INDEX_URL,
                response.status_code,
            )
    except Exception:
        logger.exception("Failed to fetch inspector from unpkg: %s", INDEX_URL)

    return HTMLResponse(
        content=f"""
        <html>
        <head><title>Inspector Unavailable</title></head>
        <body style="font-family: sans-serif; padding: 2rem;">
            <h1>Inspector Unavailable</h1>
            <p>Could not load the inspector from unpkg: <code>{INDEX_URL}</code></p>
            <p>Set <code>INSPECTOR_USE_CDN=true</code> (default) to load the versioned CDN bundle instead.</p>
            <p style="margin-top: 2rem;">Server URL: <code>{server_url}</code></p>
        </body>
        </html>
        """,
        status_code=503,
    )


async def _inspector_static(request: Request):
    """Serve SPA shell (CDN mode) or proxy static assets from unpkg."""
    if resolve_inspector_use_cdn():
        return HTMLResponse(generate_cdn_shell_html())

    path = request.path_params.get("path", "")
    cdn_url = f"{UNPKG_DIST_BASE}/{path}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(cdn_url, follow_redirects=True)
            if response.status_code == 200:
                return Response(
                    content=response.content,
                    media_type=response.headers.get("Content-Type", "text/plain"),
                )
            logger.warning(
                "Failed to fetch static file from unpkg: %s returned status %s",
                cdn_url,
                response.status_code,
            )
    except Exception:
        logger.exception("Failed to fetch static file from unpkg: %s", cdn_url)

    return HTMLResponse("File not found", status_code=404)
