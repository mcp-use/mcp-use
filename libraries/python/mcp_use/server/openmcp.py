from typing import TYPE_CHECKING, Any

from mcp import Resource, ServerCapabilities, Tool
from mcp.server.lowlevel.server import NotificationOptions
from mcp.types import Prompt, ResourceTemplate
from starlette.responses import JSONResponse

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer


class OpenMCPInfo:
    """OpenMCP server info structure."""

    def __init__(self, title: str, version: str | None = None, description: str | None = None):
        self.title = title
        self.version = version or "0.0.0"
        self.description = description


class OpenMCPResponse:
    """Strongly typed OpenMCP response structure."""

    def __init__(
        self,
        info: OpenMCPInfo,
        capabilities: ServerCapabilities,
        tools: list[Tool],
        resources: list[Resource],
        resources_templates: list[ResourceTemplate],
        prompts: list[Prompt],
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
        self.resources_templates = resources_templates
        self.prompts = prompts

    def serialize_resource(self, resource: Resource) -> dict[str, Any]:
        return {
            "uri": str(resource.uri),
            "description": resource.description,
            "mimeType": resource.mimeType,
            "size": resource.size,
            "icons": resource.icons,
            "annotations": resource.annotations,
            "meta": resource.meta,
            "model_config": resource.model_config,
        }

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "openmcp": self.openmcp,
            "info": self.info,
            "capabilities": self.capabilities.model_dump(),
            "tools": [tool.model_dump() for tool in self.tools],
            "resources": [self.serialize_resource(resource) for resource in self.resources],
            "resources_templates": [resource_template.model_dump() for resource_template in self.resources_templates],
            "prompts": [prompt.model_dump() for prompt in self.prompts],
        }


async def get_openmcp_json(server: "MCPServer") -> JSONResponse:
    """
    Generate OpenMCP JSON response for a FastMCP server.

    Args:
        server: The FastMCP server instance
    Returns:
        JSONResponse containing the OpenMCP server description
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        # Gather server information
        logger.debug("Gathering server information for OpenMCP JSON response")

        try:
            tools = await server.list_tools()
            logger.debug(f"Successfully retrieved {len(tools)} tools")
        except Exception as e:
            logger.error(f"Failed to retrieve tools: {e}")
            tools = []

        try:
            resources = await server.list_resources()
            logger.debug(f"Successfully retrieved {len(resources)} resources")
        except Exception as e:
            logger.error(f"Failed to retrieve resources: {e}")
            resources = []

        try:
            resources_templates = await server.list_resource_templates()
            logger.debug(f"Successfully retrieved {len(resources_templates)} resource templates")
        except Exception as e:
            logger.error(f"Failed to retrieve resource templates: {e}")
            resources_templates = []

        try:
            capabilities = server._mcp_server.get_capabilities(NotificationOptions(), experimental_capabilities={})
            logger.debug("Successfully retrieved server capabilities")
        except Exception as e:
            logger.error(f"Failed to retrieve capabilities: {e}")
            capabilities = ServerCapabilities()

        try:
            prompts = await server.list_prompts()
            logger.debug(f"Successfully retrieved {len(prompts)} prompts")
        except Exception as e:
            logger.error(f"Failed to retrieve prompts: {e}")
            prompts = []

        # Create server info
        try:
            info = OpenMCPInfo(title=server.name, version=server._mcp_server.version, description=server.instructions)
            logger.debug("Successfully created server info")
        except Exception as e:
            logger.error(f"Failed to create server info: {e}")
            info = OpenMCPInfo(title="Unknown", version="0.0.0", description=None)

        # Build the response
        try:
            response = OpenMCPResponse(
                info=info,
                capabilities=capabilities,
                tools=tools,
                resources=resources,
                resources_templates=resources_templates,
                prompts=prompts,
            )
            logger.debug("Successfully created OpenMCP response")
        except Exception as e:
            logger.error(f"Failed to create OpenMCP response: {e}")
            # Fallback response
            response = OpenMCPResponse(
                info=info,
                capabilities=ServerCapabilities(),
                tools=[],
                resources=[],
                resources_templates=[],
                prompts=[],
            )

        try:
            result = JSONResponse(response.to_dict())
            logger.debug("Successfully generated JSON response")
            return result
        except Exception as e:
            logger.error(f"Failed to generate JSON response: {e}")
            # Return minimal fallback response
            fallback_response = {
                "openmcp": "1.0",
                "info": {"title": "Error", "version": "0.0.0", "description": "Failed to generate response"},
                "capabilities": {},
                "tools": [],
                "resources": [],
                "resources_templates": [],
                "prompts": [],
            }
            return JSONResponse(fallback_response)

    except Exception as e:
        logger.error(f"Unexpected error in get_openmcp_json: {e}")
        # Return minimal error response
        error_response = {
            "openmcp": "1.0",
            "info": {"title": "Error", "version": "0.0.0", "description": "Server error occurred"},
            "capabilities": {},
            "tools": [],
            "resources": [],
            "resources_templates": [],
            "prompts": [],
        }
        return JSONResponse(error_response)
