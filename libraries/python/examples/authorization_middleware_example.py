"""
Per-tool authorization middleware example.

Demonstrates how to use ToolAuthorizationMiddleware to enforce fine-grained
access control over which MCP tools an agent is allowed to invoke.

Three patterns are shown:
1. Allowlist — only the listed tools may be called.
2. Denylist — all tools except the listed ones may be called.
3. Custom authorizer — delegate the decision to an async function (e.g. an
   external permission engine, OAuth token validation, etc.).
"""

import asyncio

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.client.middleware import ToolAuthorizationMiddleware

load_dotenv()

CONFIG = {
    "mcpServers": {
        "demo": {
            "command": "npx",
            "args": ["@playwright/mcp@latest"],
            "env": {"DISPLAY": ":1"},
        }
    }
}


# ---------------------------------------------------------------------------
# Pattern 1: Allowlist — research agent can only search
# ---------------------------------------------------------------------------
async def run_research_agent():
    client = MCPClient(
        config=CONFIG,
        middleware=[ToolAuthorizationMiddleware(allowed_tools=["browser_navigate", "browser_snapshot"])],
    )
    llm = ChatOpenAI(model="gpt-4o-mini")
    agent = MCPAgent(llm=llm, client=client, max_steps=10)
    result = await agent.run("Navigate to https://example.com and take a snapshot.")
    print("Research agent result:", result)


# ---------------------------------------------------------------------------
# Pattern 2: Denylist — block only destructive tools
# ---------------------------------------------------------------------------
async def run_content_agent():
    client = MCPClient(
        config=CONFIG,
        middleware=[ToolAuthorizationMiddleware(denied_tools=["browser_file_upload", "browser_close"])],
    )
    llm = ChatOpenAI(model="gpt-4o-mini")
    agent = MCPAgent(llm=llm, client=client, max_steps=10)
    result = await agent.run("Navigate to https://example.com and describe the page.")
    print("Content agent result:", result)


# ---------------------------------------------------------------------------
# Pattern 3: Custom authorizer backed by an external permission engine
# ---------------------------------------------------------------------------
async def run_custom_auth_agent():
    # Simulate an external permission check
    PERMITTED = {"browser_navigate", "browser_snapshot"}

    async def my_authorizer(tool_name: str, arguments: dict) -> bool:
        allowed = tool_name in PERMITTED
        print(f"[auth] tool={tool_name!r} allowed={allowed}")
        return allowed

    client = MCPClient(
        config=CONFIG,
        middleware=[ToolAuthorizationMiddleware(authorizer=my_authorizer)],
    )
    llm = ChatOpenAI(model="gpt-4o-mini")
    agent = MCPAgent(llm=llm, client=client, max_steps=10)
    result = await agent.run("Navigate to https://example.com.")
    print("Custom auth agent result:", result)


if __name__ == "__main__":
    asyncio.run(run_research_agent())
