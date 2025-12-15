import asyncio
import base64
from pathlib import Path

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


async def main():
    client = MCPClient()
    agent = MCPAgent(
        llm=ChatOpenAI(model_name="gpt-5"),
        client=client,
    )

    image_bytes = base64.b64encode(Path("static/logo-gh.jpg").read_bytes()).decode("utf-8")
    human_message = HumanMessage(
        content=[
            {"type": "text", "text": "What is in this image?"},
            {
                "type": "image",
                "base64": image_bytes,
                "mime_type": "image/jpeg",
            },
        ]
    )

    async for step in agent.stream(human_message, max_steps=10):
        print(step)


if __name__ == "__main__":
    asyncio.run(main())
