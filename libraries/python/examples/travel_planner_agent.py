"""
Travel Planner Agent Example

This example demonstrates how to use MCPAgent to:
- Understand travel requirements
- Plan a multi-day itinerary
- Suggest hotels & attractions
- Save the travel plan to a file

How to run:
python examples/python/travel_planner_agent.py
"""

import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient


async def main():
    load_dotenv()

    OUTPUT_DIR = "travel_output"
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
        max_steps=15,
        pretty_print=True
    )

    # Example travel preferences
    destination = "Paris"
    budget = "€1500"
    days = "5"
    travel_style = "budget"

    prompt = f"""
You are a professional travel planner.

User preferences:
- Destination: {destination}
- Budget: {budget}
- Trip duration: {days} days
- Travel style: {travel_style}

Steps:
1. Create a day-by-day itinerary
2. Suggest:
   - Hotels
   - Local food spots
   - Attractions
3. Provide budget breakdown
4. Write full plan to:
   travel_output/itinerary.md
5. STOP.

Be realistic and practical.
"""

    print("\n✈️ Planning your trip...\n")

    result = await agent.run(
        prompt,
        max_steps=15
    )

    print("\n=== TRAVEL PLAN SUMMARY ===\n")
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
