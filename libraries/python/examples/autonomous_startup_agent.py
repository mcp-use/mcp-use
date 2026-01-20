"""
Autonomous Startup Builder Agent

This example demonstrates a high-level autonomous agent that:
- Identifies a startup idea
- Researches the market
- Designs a product
- Writes structured business docs

How to run:
python examples/python/autonomous_startup_agent.py
"""

import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient


async def main():
    load_dotenv()

    OUTPUT_DIR = "startup_output"
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    config = {
        "mcpServers": {
            "filesystem": {
                "command": "npx",
                "args": [
                    "-y",
                    "@modelcontextprotocol/server-filesystem",
                    OUTPUT_DIR,
                ]
            }
        }
    }

    client = MCPClient.from_dict(config)

    llm = ChatOpenAI(
        model="gpt-5",
        temperature=0.3
    )

    agent = MCPAgent(
        llm=llm,
        client=client,
        max_steps=20,
        pretty_print=True
    )

    prompt = """
You are a startup founder agent.

Goal:
Build a startup idea from scratch.

Steps:
1. Identify a painful real-world problem
2. Research existing solutions
3. Find a gap in the market
4. Design a product
5. Define pricing model
6. Write:
   - startup_output/idea.md
   - startup_output/market.md
   - startup_output/roadmap.md
7. STOP after writing all files.

Be practical and realistic.
"""

    print("\n🚀 Building a startup...\n")

    result = await agent.run(
        prompt,
        max_steps=20
    )

    print("\n=== FINAL OUTPUT ===\n")
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
