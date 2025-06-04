import argparse

from fastmcp import FastMCP

mcp = FastMCP()


@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b


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
