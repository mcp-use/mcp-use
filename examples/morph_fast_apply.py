import asyncio
import os
from dotenv import load_dotenv

from mcp_use import MCPClient, MCPAgent

# Choose any tool-using LLM you already support in your local setup.
# Example here uses langchain_anthropic (Claude), but you can swap this to your preferred tool-calling LLM.
from langchain_anthropic import ChatAnthropic


async def main():
    load_dotenv()  # Optional: loads from .env file. Otherwise export MORPH_API_KEY in your shell.
    
    # Build config with actual env var values (JSON doesn't expand ${VAR} syntax)
    config = {
        "mcpServers": {
            "filesystem-with-morph": {
                "command": "npx",
                "args": ["@morph-llm/morph-fast-apply"],
                "env": {
                    "MORPH_API_KEY": os.getenv("MORPH_API_KEY", ""),
                    "ALL_TOOLS": "false"
                }
            }
        }
    }
    client = MCPClient.from_dict(config)

    # Any modern tool-calling LLM works; adjust as needed.
    llm = ChatAnthropic(model="claude-3-5-sonnet-20241022", temperature=0)

    # Standard mcp-use agent that can call MCP tools discovered from Morph
    agent = MCPAgent(llm=llm, client=client, max_steps=15)

    # Demo: ask Morph's edit tool to modify README.md
    result = await agent.run(
        "Open README.md and append a new line saying: 'Integrated with Morph via MCP.' Use the edit tool."
    )
    print(result)

if __name__ == "__main__":
    asyncio.run(main())