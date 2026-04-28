"""
Per-tool authorization middleware example.

Demonstrates how to use ToolAuthorizationMiddleware to enforce fine-grained
access control over which MCP tools an agent is allowed to invoke.

Four patterns are shown:
1. Allowlist — only the listed tools may be called (and appear in tool list).
2. Denylist — all tools except the listed ones may be called.
3. Agent identity context — pass caller identity to the authorizer.
4. Custom authorizer — delegate the decision to an async function (e.g. an
   external permission engine, OAuth token validation, etc.).
"""

import asyncio

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient, ToolAuthorizationMiddleware

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
# Pattern 1: Allowlist — research agent can only navigate and snapshot
# Denied tools are also hidden from the LLM's tool list.
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
# Pattern 3: Agent identity context + custom authorizer
# The agent_context dict is forwarded to the authorizer so you can make
# identity-aware decisions without coupling the middleware to a specific
# auth system.
# ---------------------------------------------------------------------------
async def run_identity_aware_agent():
    PERMITTED_BY_ROLE = {
        "admin": {"browser_navigate", "browser_snapshot", "browser_file_upload"},
        "reader": {"browser_navigate", "browser_snapshot"},
    }

    async def role_authorizer(tool_name: str, arguments: dict, agent_context: dict) -> bool:
        role = agent_context.get("role", "reader")
        allowed = tool_name in PERMITTED_BY_ROLE.get(role, set())
        print(f"[auth] agent={agent_context.get('agent_id')!r} role={role!r} tool={tool_name!r} allowed={allowed}")
        return allowed

    client = MCPClient(
        config=CONFIG,
        middleware=[
            ToolAuthorizationMiddleware(
                agent_context={"agent_id": "sub-agent-42", "role": "reader"},
                authorizer=role_authorizer,
            )
        ],
    )
    llm = ChatOpenAI(model="gpt-4o-mini")
    agent = MCPAgent(llm=llm, client=client, max_steps=10)
    result = await agent.run("Navigate to https://example.com.")
    print("Identity-aware agent result:", result)


# ---------------------------------------------------------------------------
# Pattern 4: External permission engine
# ---------------------------------------------------------------------------
async def run_external_auth_agent():
    PERMITTED = {"browser_navigate", "browser_snapshot"}

    async def external_check(tool_name: str, arguments: dict, agent_context: dict) -> bool:
        # Replace with a real HTTP call to your permission engine
        token = agent_context.get("token")
        print(f"[auth] Checking token={token!r} for tool={tool_name!r}")
        return tool_name in PERMITTED

    client = MCPClient(
        config=CONFIG,
        middleware=[
            ToolAuthorizationMiddleware(
                agent_context={"token": "Bearer eyJ..."},
                authorizer=external_check,
            )
        ],
    )
    llm = ChatOpenAI(model="gpt-4o-mini")
    agent = MCPAgent(llm=llm, client=client, max_steps=10)
    result = await agent.run("Navigate to https://example.com.")
    print("External auth agent result:", result)


if __name__ == "__main__":
    asyncio.run(run_research_agent())
