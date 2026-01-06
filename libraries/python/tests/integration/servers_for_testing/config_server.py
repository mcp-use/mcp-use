import argparse

from fastmcp import FastMCP
from langchain_core.runnables import RunnableConfig

from mcp_use.logging import logger

mcp = FastMCP()


@mcp.tool()
def check_config(config: RunnableConfig | None = None):
    """Validate the config structure and compute a total from metadata.

    Args:
        config: Configuration dictionary expected to contain:
            - "metadata": a dict with keys "a" and "b" (numeric values).

    Returns:
        The sum of metadata["a"] and metadata["b"].

    Raises:
        ValueError: If config is None, missing required keys, or values are not numeric."""

    if config is None:
        raise ValueError("check_config: 'config' cannot be None.")
    logger.info(f" the config = {config}")
    metadata = config.get("metadata")
    if metadata is None or not isinstance(metadata, dict):
        raise ValueError("check_config: 'config[\"metadata\"]' must be a dict with keys 'a' and 'b'.")

    try:
        a = metadata["a"]
        b = metadata["b"]
    except KeyError as exc:
        raise ValueError(f"check_config: missing required metadata key: {exc!s}") from exc

    try:
        total = a + b
    except TypeError as exc:
        raise ValueError(f"check_config: 'a' and 'b' must be numeric, got a={a!r}, b={b!r}.") from exc

    logger.info("check_config: validated metadata with keys %s", list(metadata.keys()))
    return total


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run MCP test server.")
    parser.add_argument(
        "--transport",
        type=str,
        choices=["stdio", "streamable-http", "sse"],
        default="stdio",
        help="MCP transport type to use (default: stdio)",
    )
    args = parser.parse_args()

    print(f"Starting MCP server with transport: {args.transport}")

    if args.transport == "streamable-http":
        mcp.run(transport="streamable-http", host="127.0.0.1", port=8000)
    elif args.transport == "sse":
        mcp.run(transport="sse", host="127.0.0.1", port=8000)
    elif args.transport == "stdio":
        mcp.run(transport="stdio")
