"""
Audited tool calls example for mcp_use.

This example demonstrates how to put a governance proxy between an
MCPAgent and an MCP server, so every tool call the agent makes is
checked against a policy and recorded in a tamper-evident audit trail
before it reaches the server. The proxy is just another stdio MCP
server in the config: no changes to mcp_use or to the upstream server.

This uses Vaara (https://github.com/vaaraio/vaara) as the proxy:

    pip install vaara

Special Thanks to https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
for the server.
"""

import asyncio
import sys

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient

# The same filesystem server as filesystem_use.py, but spawned and
# governed by the proxy. Arguments that start with a dash (like -y)
# must use the --upstream-arg=VALUE form.
config = {
    "mcpServers": {
        "filesystem-audited": {
            "command": sys.executable,
            "args": [
                "-m",
                "vaara.integrations.mcp_proxy",
                "--upstream",
                "npx",
                "--upstream-arg=-y",
                "--upstream-arg=@modelcontextprotocol/server-filesystem",
                "--upstream-arg=THE_PATH_TO_YOUR_DIRECTORY",
                "--db",
                "audit.db",
                "--agent-id",
                "mcp-use-agent",
            ],
        }
    }
}


async def main():
    """Run the example with every tool call audited."""
    # Load environment variables
    load_dotenv()

    # Create MCPClient from config
    client = MCPClient.from_dict(config)
    # Create LLM
    llm = ChatOpenAI(model="gpt-5")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30, pretty_print=True)

    # Run the query
    result = await agent.run(
        "Hello can you give me a list of files and directories in the current directory",
        max_steps=30,
    )
    print(f"\nResult: {result}")

    # Each tool call above is now a hash-chained sequence in audit.db:
    # action_requested -> risk_scored -> decision_made -> outcome_recorded.
    # Blocked calls come back as isError responses with the reason, and
    # the block lands in the same chain. Summarise what the policy did
    # (or would have done, with --shadow on the proxy) with:
    #   vaara trail shadow-report --db audit.db


if __name__ == "__main__":
    # Run the appropriate example
    asyncio.run(main())
