import json

from litellm import Message

from mcp_use.agents.base import BaseAgent
from mcp_use.llm.engine import LLM
from mcp_use.llm.responses import ToolMessage
from mcp_use.llm.tools import Tool


class ToolCallingAgent(BaseAgent):
    def __init__(self, llm: LLM, name: str, instructions: str, tools: list[Tool]):
        super().__init__(llm, name, instructions, tools)

    async def step(self) -> bool:
        """Performs a single step of the agent's logic.

        This involves calling the LLM, processing any tool calls, and updating the
        message history.

        Returns:
            A boolean indicating whether the conversation has finished.
        """
        response = await self.llm.run(messages=self.messages, tools=self.tools)
        response_message = response.choices[0].message
        self.messages.append(response_message)

        if response.choices[0].finish_reason == "tool_calls":
            for tool_call in response_message.tool_calls:
                tool_name = tool_call.function.name
                if tool_name in self.tools_map:
                    tool_to_call = self.tools_map[tool_name]
                    arguments = json.loads(tool_call.function.arguments)  # noqa: F821
                    print("-" * 100)
                    print(arguments)
                    print("-" * 100)
                    result = tool_to_call(**arguments if arguments else {})
                    self.messages.append(
                        ToolMessage(
                            role="tool",
                            tool_call_id=tool_call.id,
                            content=str(result),
                            name=tool_name,
                        )
                    )
            return False

        return True

    async def run(self, query: str):
        self.messages.append(Message(role="user", content=query))

        for _ in range(6):  # Limit to 6 steps
            finished = await self.step()
            if finished:
                break

        return self.messages[-1]

    async def stream(self, query: str):
        self.messages.append(Message(role="user", content=query))
        for _ in range(6):
            async for chunk in self.llm.stream(messages=self.messages, tools=self.tools):
                yield chunk

            if chunk.choices[0].finish_reason == "stop":
                break

            if chunk.choices[0].finish_reason == "tool_calls":
                for tool_call in chunk.choices[0].delta.tool_calls:
                    tool_name = tool_call.function.name
                    if tool_name in self.tools_map:
                        tool_to_call = self.tools_map[tool_name]
                        arguments = json.loads(tool_call.function.arguments)
                        yield {"type": "tool_call", "tool_name": tool_name, "arguments": arguments}
                        result = tool_to_call(**arguments)
                        yield {
                            "tool_name": tool_name,
                            "result": result,
                        }
                        self.messages.append(
                            ToolMessage(
                                role="tool",
                                tool_call_id=tool_call.id,
                                content=str(result),
                                name=tool_name,
                            )
                        )
            else:
                yield {
                    "content": chunk.choices[0].delta.content,
                }
                break
