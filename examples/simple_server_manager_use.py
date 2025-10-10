import asyncio
import sys
from pathlib import Path

from langchain_core.tools import BaseTool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from mcp_use.agents.mcpagent import MCPAgent

# Add the project root to the Python path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mcp_use.managers.base import BaseServerManager


class DynamicTool(BaseTool):
    """A tool that is created dynamically."""

    name: str
    description: str
    args_schema: type[BaseModel] | None = None

    def _run(self) -> str:
        return f"Hello from {self.name}!"

    async def _arun(self) -> str:
        return f"Hello from {self.name}!"


class HelloWorldTool(BaseTool):
    """A simple tool that returns a greeting and adds a new tool."""

    name: str = "hello_world"
    description: str = "Returns the string 'Hello, World!' and adds a new dynamic tool."
    args_schema: type[BaseModel] | None = None
    server_manager: "SimpleServerManager"

    def _run(self) -> str:
        new_tool = DynamicTool(
            name=f"dynamic_tool_{len(self.server_manager.tools)}", description="A dynamically created tool."
        )
        self.server_manager.add_tool(new_tool)
        return "Hello, World! I've added a new tool. You can use it now."

    async def _arun(self) -> str:
        new_tool = DynamicTool(
            name=f"dynamic_tool_{len(self.server_manager.tools)}", description="A dynamically created tool."
        )
        self.server_manager.add_tool(new_tool)
        return "Hello, World! I've added a new tool. You can use it now."


class SimpleServerManager(BaseServerManager):
    """A simple server manager that provides a HelloWorldTool."""

    def __init__(self):
        self._tools: list[BaseTool] = []
        self._initialized = False
        # Pass a reference to the server manager to the tool
        self._tools.append(HelloWorldTool(server_manager=self))

    def add_tool(self, tool: BaseTool):
        self._tools.append(tool)

    async def initialize(self) -> None:
        self._initialized = True

    @property
    def tools(self) -> list[BaseTool]:
        return self._tools

    def has_tool_changes(self, current_tool_names: set[str]) -> bool:
        new_tool_names = {tool.name for tool in self.tools}
        return new_tool_names != current_tool_names


async def main():
    # Initialize the LLM
    llm = ChatOpenAI(model="gpt-4o")

    # Instantiate the custom server manager
    simple_server_manager = SimpleServerManager()

    # Create an MCPAgent with the custom server manager
    agent = MCPAgent(
        llm=llm,
        use_server_manager=True,
        server_manager=simple_server_manager,
    )

    # Manually initialize the agent
    await agent.initialize()

    # Run the agent with a query that uses the custom tool
    print("--- First run: calling hello_world ---")
    result = await agent.run("Use the hello_world tool", manage_connector=False)
    print(result)
    # Clear the conversation history to avoid confusion
    agent.clear_conversation_history()

    # Run the agent again to show that the new tool is available
    print("\n--- Second run: calling the new dynamic tool ---")
    result = await agent.run("Use the dynamic_tool_1", manage_connector=False)
    print(result)
    # Manually close the agent
    await agent.close()


if __name__ == "__main__":
    asyncio.run(main())
