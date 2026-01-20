"""
Research Agent Example using MCP-Use

This example shows how to build an autonomous AI research agent using
MCPAgent from the mcp_use framework.

What this script does:
- Accepts a research topic
- Uses an LLM to reason step-by-step
- Automatically decides which MCP tools to use
- Writes detailed research notes to a file
- Generates a final summarized report

Key concepts demonstrated:
- Multi-step agent reasoning
- Tool selection and execution
- File system interaction via MCP
- Safe execution with step limits

How to run:
1. Make sure your environment variables are set (OPENAI_API_KEY)
2. From project root, run:

   python examples/python/research_agent.py

Output:
- Creates a folder: research_output/
- Saves notes to: research_output/notes.txt
- Prints final summary in terminal
"""

import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient


async def main():
    load_dotenv()

    OUTPUT_DIR = "research_output"
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
        temperature=0
    )

    # 👇 IMPORTANT: match official examples
    agent = MCPAgent(
        llm=llm,
        client=client,
        max_steps=10,          # prevents infinite loop
        pretty_print=True
    )

    topic = "Latest trends in multi-agent AI systems"

    prompt = f"""
You are a research assistant.

Task:
1. Generate key points
2. Write notes to research_output/notes.txt
3. Produce final summary
4. STOP.

Topic:
{topic}
"""

    print("\n🔍 Starting research...\n")

    result = await agent.run(
        prompt,
        max_steps=10     # ALSO limit here
    )

    print("\n=== FINAL SUMMARY ===\n")
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
