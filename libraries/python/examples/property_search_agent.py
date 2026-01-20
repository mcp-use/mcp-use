"""
Property Search Agent Example

This example demonstrates how to use MCPAgent to:
- Understand user requirements (city, budget, type)
- Reason over constraints
- Generate matching property suggestions
- Save results to a file

How to run:
python examples/python/property_search_agent.py
"""

import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient


async def main():
    load_dotenv()

    OUTPUT_DIR = "property_output"
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
        temperature=0.2
    )

    agent = MCPAgent(
        llm=llm,
        client=client,
        max_steps=15,
        pretty_print=True
    )

    # Example user requirements
    city = "Bangalore"
    budget = "₹80,000/month"
    purpose = "Rent"
    bedrooms = "2 BHK"

    prompt = f"""
You are a real estate assistant agent.

User requirements:
- City: {city}
- Budget: {budget}
- Purpose: {purpose}
- Bedrooms: {bedrooms}

Steps:
1. Generate 5 realistic property listings
2. For each property include:
   - Location
   - Estimated price
   - Key features
   - Pros & cons
3. Compare options and recommend best 2
4. Write all results to:
   property_output/results.md
5. STOP.

Be practical and realistic.
"""

    print("\n🏠 Searching properties...\n")

    result = await agent.run(
        prompt,
        max_steps=15
    )

    print("\n=== FINAL RECOMMENDATION ===\n")
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
