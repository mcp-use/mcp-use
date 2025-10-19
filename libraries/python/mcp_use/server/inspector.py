import httpx
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse

CDN_BASE_URL = "https://unpkg.com/@mcp-use/inspector/dist/client"
INDEX_URL = f"{CDN_BASE_URL}/index.html"


async def _inspector_index(request: Request):
    """Serve the inspector index.html file with autoconnect parameter."""
    # Get the server URL from the request
    server_url = f"{request.url.scheme}://{request.url.netloc}/mcp"

    # Check if server parameter is already present
    server_param = request.query_params.get("server")

    if not server_param:
        # Redirect to add the server parameter
        autoconnect_url = f"{request.url.scheme}://{request.url.netloc}/inspector?server={server_url}"
        return RedirectResponse(url=autoconnect_url, status_code=302)

    # Fetch the CDN file
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(INDEX_URL, follow_redirects=True)
            if response.status_code == 200:
                return HTMLResponse(response.text)
    except Exception:
        pass

    # Fallback: redirect to autoconnect URL
    autoconnect_url = f"{request.url.scheme}://{request.url.netloc}/inspector?server={server_url}"
    return RedirectResponse(url=autoconnect_url, status_code=302)


async def _inspector_static(request: Request):
    """Serve static files from the CDN."""
    path = request.path_params.get("path", "")
    # Build CDN URL
    cdn_url = f"{CDN_BASE_URL}/{path}"
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(cdn_url, follow_redirects=True)
            return HTMLResponse(content=response.content, media_type=response.headers.get("Content-Type", "text/plain"))
    except Exception:
        pass

    return HTMLResponse("File not found", status_code=404)
