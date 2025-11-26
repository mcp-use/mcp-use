"""
MCP Server Context Example

This example demonstrates all Context features available in mcp-use servers:
- Progress reporting
- Logging
- Request metadata access
- Resource reading from within tools
"""

import asyncio
from datetime import datetime

from mcp.server.fastmcp import Context
from mcp.types import ToolAnnotations

from mcp_use.server import MCPServer

server = MCPServer(
    name="Context Demo Server",
    version="1.0.0",
    instructions="A server demonstrating all Context features",
    debug=True,
)


# =============================================================================
# TOOLS WITH CONTEXT
# =============================================================================


@server.tool()
async def process_items(items: list[str], context: Context) -> str:
    """Process a list of items with progress reporting.

    Demonstrates: context.report_progress()
    """
    results = []
    total = len(items)

    for i, item in enumerate(items):
        # Report progress to the client
        await context.report_progress(i, total)

        # Simulate processing time
        await asyncio.sleep(0.1)
        results.append(f"Processed: {item.upper()}")

    # Report completion
    await context.report_progress(total, total)

    return "\n".join(results)


@server.tool()
async def log_demo(message: str, context: Context) -> str:
    """Demonstrate different logging levels.

    Demonstrates: context.debug(), context.info(), context.warning(), context.error()
    """
    # Different log levels available through context
    await context.debug(f"Debug: Processing message '{message}'")
    await context.info(f"Info: Message received with {len(message)} characters")
    await context.warning("Warning: This is a demo warning")
    # context.error() is also available for error logging

    return f"Logged message: {message}"


@server.tool()
async def get_request_info(context: Context) -> dict:
    """Get information about the current request.

    Demonstrates: context.request_id, context.client_id, context.session
    """
    info = {
        "request_id": str(context.request_id) if context.request_id else "N/A",
        "client_id": context.client_id if hasattr(context, "client_id") else "N/A",
        "timestamp": datetime.now().isoformat(),
    }

    await context.info(f"Request info retrieved: {info}")
    return info


@server.tool()
async def read_resource_from_tool(resource_uri: str, context: Context) -> str:
    """Read a resource from within a tool.

    Demonstrates: context.read_resource()

    Try with: "config://database" or "status://health"
    """
    try:
        # Read a resource using the context
        contents = await context.read_resource(resource_uri)
        await context.info(f"Successfully read resource: {resource_uri}")
        return f"Resource content:\n{contents}"
    except Exception as e:
        await context.warning(f"Failed to read resource {resource_uri}: {e}")
        return f"Error reading resource: {e}"


@server.tool(
    name="long_running_task",
    title="Long Running Task",
    description="Simulates a long-running task with detailed progress",
    annotations=ToolAnnotations(
        readOnlyHint=False,
        idempotentHint=True,
    ),
)
async def long_running_task(steps: int, delay_ms: int, context: Context) -> str:
    """Run a multi-step task with progress and logging.

    Demonstrates: Combined use of progress + logging

    Args:
        steps: Number of steps to perform (1-20)
        delay_ms: Delay between steps in milliseconds (10-1000)
    """
    # Validate inputs
    steps = max(1, min(20, steps))
    delay_ms = max(10, min(1000, delay_ms))
    delay_sec = delay_ms / 1000

    await context.info(f"Starting task with {steps} steps, {delay_ms}ms delay each")

    for i in range(steps):
        step_num = i + 1

        # Report progress
        await context.report_progress(i, steps)

        # Log each step
        await context.debug(f"Executing step {step_num}/{steps}")

        # Simulate work
        await asyncio.sleep(delay_sec)

        # Log milestone steps
        if step_num == steps // 2:
            await context.info("Reached halfway point")
        elif step_num == steps:
            await context.info("Task completed successfully")

    # Final progress report
    await context.report_progress(steps, steps)

    return f"Completed {steps} steps in {steps * delay_ms}ms"


# =============================================================================
# RESOURCES (can be read from tools via context.read_resource)
# =============================================================================


@server.resource(
    uri="config://database", name="database_config", title="Database Configuration", mime_type="application/json"
)
def database_config() -> str:
    """Database connection configuration."""
    return """{
    "host": "localhost",
    "port": 5432,
    "database": "myapp",
    "pool_size": 10
}"""


@server.resource(uri="config://cache", name="cache_config", title="Cache Configuration", mime_type="application/json")
def cache_config() -> str:
    """Cache configuration settings."""
    return """{
    "enabled": true,
    "ttl_seconds": 3600,
    "max_size_mb": 256
}"""


@server.resource(uri="status://health", name="health_status", title="Health Status", mime_type="application/json")
def health_status() -> str:
    """Current server health status."""
    return f"""{{
    "status": "healthy",
    "timestamp": "{datetime.now().isoformat()}",
    "uptime": "99.9%"
}}"""


@server.resource(
    uri="data://{data_type}",
    name="dynamic_data",
    title="Dynamic Data",
    description="Get data by type (users, products, orders)",
    mime_type="application/json",
)
def get_data(data_type: str) -> str:
    """Dynamic data resource with URI template."""
    data = {
        "users": '[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]',
        "products": '[{"id": 1, "name": "Widget", "price": 9.99}]',
        "orders": '[{"id": 1, "user_id": 1, "total": 29.97}]',
    }
    return data.get(data_type, '{"error": "Unknown data type"}')


# =============================================================================
# PROMPTS
# =============================================================================


@server.prompt(name="help", title="Help", description="Show available context features")
def help_prompt() -> str:
    """Help prompt showing available features."""
    return """# Context Demo Server

This server demonstrates MCP Context features:

## Tools with Context
- **process_items**: Progress reporting with `context.report_progress()`
- **log_demo**: Logging with `context.debug/info/warning/error()`
- **get_request_info**: Access request metadata
- **read_resource_from_tool**: Read resources with `context.read_resource()`
- **long_running_task**: Combined progress + logging

## Resources (readable via context)
- `config://database` - Database configuration
- `config://cache` - Cache configuration
- `status://health` - Health status
- `data://{type}` - Dynamic data (users, products, orders)

Try: "Process these items: apple, banana, cherry with progress reporting"
"""


@server.prompt(name="task_prompt")
def task_prompt(task_name: str) -> str:
    """Generate a task-specific prompt."""
    return f"""Please help me with the following task: {task_name}

Use the available tools to:
1. Track progress with process_items or long_running_task
2. Check logs with log_demo
3. Read configuration with read_resource_from_tool

Available resources:
- config://database
- config://cache
- status://health
- data://users, data://products, data://orders
"""


# =============================================================================
# RUN SERVER
# =============================================================================

if __name__ == "__main__":
    print("Starting Context Demo Server...")
    print("Features demonstrated:")
    print("  - context.report_progress(current, total)")
    print("  - context.debug/info/warning/error(message)")
    print("  - context.request_id")
    print("  - context.read_resource(uri)")
    print()
    server.run(transport="streamable-http", port=8000)
