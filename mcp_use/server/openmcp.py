from typing import TYPE_CHECKING, Any

from mcp.server.lowlevel.server import NotificationOptions
from starlette.responses import JSONResponse

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer


class OpenMCPInfo:
    """OpenMCP server info structure."""

    def __init__(self, title: str, version: str, description: str | None = None):
        self.title = title
        self.version = version
        self.description = description


class OpenMCPResponse:
    """Strongly typed OpenMCP response structure."""

    def __init__(
        self,
        info: OpenMCPInfo,
        capabilities: dict[str, Any],
        tools: list[dict[str, Any]],
        resources: list[dict[str, Any]],
        prompts: list[dict[str, Any]],
    ):
        self.openmcp = "1.0"
        self.info = {
            "title": info.title,
            "version": info.version,
            "description": info.description,
        }
        self.capabilities = capabilities
        self.tools = tools
        self.resources = resources
        self.prompts = prompts

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "openmcp": self.openmcp,
            "info": self.info,
            "capabilities": self.capabilities,
            "tools": self.tools,
            "resources": self.resources,
            "prompts": self.prompts,
        }


async def get_openmcp_json(server: "MCPServer") -> JSONResponse:
    """
    Generate OpenMCP JSON response for a FastMCP server.

    Args:
        server: The FastMCP server instance
    Returns:
        JSONResponse containing the OpenMCP server description
    """
    # Gather server information
    tools = await server.list_tools()
    resources = await server.list_resources()
    capabilities = server._mcp_server.get_capabilities(NotificationOptions(), experimental_capabilities={})
    prompts = await server.list_prompts()

    # Create server info
    info = OpenMCPInfo(title=server.name, version=server._mcp_server.version, description=server.instructions)

    # Build the response
    response = OpenMCPResponse(
        info=info,
        capabilities=capabilities.model_dump(),
        tools=[tool.model_dump() for tool in tools],
        resources=[resource.model_dump() for resource in resources],
        prompts=[prompt.model_dump() for prompt in prompts],
    )

    return JSONResponse(response.to_dict())
