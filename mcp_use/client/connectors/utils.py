from typing import Any


def is_stdio_server(server_config: dict[str, Any]) -> bool:
    """Check if the server configuration is for a stdio server.

    Args:
        server_config: The server configuration section

    Returns:
        True if the server is a stdio server, False otherwise
    """
    return "command" in server_config and "args" in server_config
