"""OAuth callback server implementation."""

import asyncio
from dataclasses import dataclass

import anyio
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse
from starlette.routing import Route

from ..logging import logger


@dataclass
class CallbackResponse:
    """Response data from OAuth callback."""

    code: str | None = None
    state: str | None = None
    error: str | None = None
    error_description: str | None = None
    error_uri: str | None = None


class OAuthCallbackServer:
    """Local server to handle OAuth callback."""

    def __init__(self, port: int | None = None):
        """Initialize the callback server.

        Args:
            port: Port to listen on. If None, will find an available port.
        """
        self.port = port or 0
        self.redirect_uri: str | None = None
        self.response_queue: asyncio.Queue[CallbackResponse] = asyncio.Queue(maxsize=1)
        self.server: uvicorn.Server | None = None
        self._shutdown_event = anyio.Event()

    async def start(self) -> str:
        """Start the callback server and return the redirect URI."""
        app = self._create_app()

        # Create the server
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=self.port,
            log_level="error",  # Suppress uvicorn logs
        )
        self.server = uvicorn.Server(config)

        # Find available port if needed
        if self.port == 0:
            import socket

            sock = socket.socket()
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
            sock.close()
            config.port = self.port

        # Start server in background
        self._server_task = asyncio.create_task(self.server.serve())

        # Wait a moment for server to start
        await asyncio.sleep(0.1)

        self.redirect_uri = f"http://127.0.0.1:{self.port}/callback"
        return self.redirect_uri

    async def wait_for_code(self, timeout: float = 300) -> CallbackResponse:
        """Wait for the OAuth callback with a timeout (default 5 minutes)."""
        try:
            response = await asyncio.wait_for(self.response_queue.get(), timeout=timeout)
            return response
        except TimeoutError:
            raise TimeoutError(f"OAuth callback not received within {timeout} seconds") from None
        finally:
            await self.shutdown()

    async def shutdown(self):
        """Shutdown the callback server."""
        self._shutdown_event.set()
        if self.server:
            self.server.should_exit = True
            if hasattr(self, "_server_task"):
                try:
                    await asyncio.wait_for(self._server_task, timeout=5.0)
                except TimeoutError:
                    self._server_task.cancel()

    def _create_app(self) -> Starlette:
        """Create the Starlette application."""

        async def callback(request: Request) -> HTMLResponse:
            """Handle the OAuth callback."""
            params = request.query_params

            # Extract OAuth parameters
            response = CallbackResponse(
                code=params.get("code"),
                state=params.get("state"),
                error=params.get("error"),
                error_description=params.get("error_description"),
                error_uri=params.get("error_uri"),
            )

            # Log the callback response
            logger.debug(
                f"OAuth callback received: error={response.error}, error_description={response.error_description}"
            )
            if response.code:
                logger.debug("OAuth callback received authorization code")
            else:
                logger.error(f"OAuth callback error: {response.error} - {response.error_description}")

            # Put response in queue
            try:
                self.response_queue.put_nowait(response)
            except asyncio.QueueFull:
                pass  # Ignore if queue is already full

            # Return success page
            if response.code:
                html = self._success_html()
            else:
                html = self._error_html(response.error, response.error_description)

            return HTMLResponse(content=html)

        routes = [Route("/callback", callback)]
        return Starlette(routes=routes)

    def _success_html(self) -> str:
        """HTML response for successful authorization."""
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Authorization Successful</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f5f5f5;
                }
                .container {
                    text-align: center;
                    padding: 2rem;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                h1 { color: #22c55e; margin-bottom: 0.5rem; }
                p { color: #666; margin-top: 0.5rem; }
                .icon { font-size: 48px; margin-bottom: 1rem; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">✅</div>
                <h1>Authorization Successful!</h1>
                <p>You can now close this window and return to your application.</p>
            </div>
            <script>
                // Auto-close after 3 seconds
                setTimeout(() => window.close(), 3000);
            </script>
        </body>
        </html>
        """

    def _error_html(self, error: str | None, description: str | None) -> str:
        """HTML response for authorization error."""
        error_msg = error or "Unknown error"
        desc_msg = description or "Authorization was not completed successfully."

        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Authorization Error</title>
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f5f5f5;
                }}
                .container {{
                    text-align: center;
                    padding: 2rem;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    max-width: 500px;
                }}
                h1 {{ color: #ef4444; margin-bottom: 0.5rem; }}
                .error {{ color: #dc2626; font-weight: 600; margin: 1rem 0; }}
                .description {{ color: #666; margin-top: 0.5rem; }}
                .icon {{ font-size: 48px; margin-bottom: 1rem; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">❌</div>
                <h1>Authorization Error</h1>
                <p class="error">{error_msg}</p>
                <p class="description">{desc_msg}</p>
            </div>
        </body>
        </html>
        """
