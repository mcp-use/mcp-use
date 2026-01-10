import httpx
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse

CDN_BASE_URL = "https://unpkg.com/@mcp-use/inspector@latest/dist/web"
INDEX_URL = f"{CDN_BASE_URL}/index.html"


async def _inspector_index(request: Request, mcp_path: str = "/mcp"):
    """Serve the inspector index.html file with autoconnect parameter."""
    # Get the server URL from the request
    server_url = f"{request.url.scheme}://{request.url.netloc}{mcp_path}"

    # Check if server or autoConnect parameter is already present
    server_param = request.query_params.get("server")
    autoconnect_param = request.query_params.get("autoConnect")

    if not server_param and not autoconnect_param:
        # Redirect to add the autoConnect parameter (note: capital C)
        autoconnect_url = f"{request.url.scheme}://{request.url.netloc}/inspector?autoConnect={server_url}"
        return RedirectResponse(url=autoconnect_url, status_code=302)

    # Fetch the CDN file
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(INDEX_URL, follow_redirects=True)
            if response.status_code == 200:
                return HTMLResponse(response.text)
    except Exception:
        pass

    # CDN failed - return error page (no redirect to avoid loop)
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
        status_code=503
    )


async def _inspector_static(request: Request):
    """Serve static files from the CDN."""
    path = request.path_params.get("path", "")
    cdn_url = f"{CDN_BASE_URL}/{path}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(cdn_url, follow_redirects=True)
            if response.status_code == 200:
                return HTMLResponse(content=response.content, media_type=response.headers.get("Content-Type", "text/plain"))
    except Exception:
        pass

    return HTMLResponse("File not found", status_code=404)
