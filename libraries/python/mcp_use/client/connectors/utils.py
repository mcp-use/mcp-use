from typing import Any


def is_stdio_server(server_config: dict[str, Any]) -> bool:
    """Check if the server configuration is for a stdio server.

    Args:
        server_config: The server configuration section

    Returns:
        True if the server is a stdio server, False otherwise

    Raises:
        TypeError: If server_config is not a dictionary.
        ValueError: If 'command' or 'args' have invalid types.
    """
    if not isinstance(server_config, dict):
        raise TypeError(f"server_config must be a dict, got {type(server_config).__name__}")

    # Check if required keys exist
    if "command" not in server_config or "args" not in server_config:
        return False

    command = server_config.get("command")
    args = server_config.get("args")

    # Validate types
    if not isinstance(command, str):
        raise ValueError(f"'command' must be a string, got {type(command).__name__}")
    if not isinstance(args, list):
        raise ValueError(f"'args' must be a list, got {type(args).__name__}")

    return True
