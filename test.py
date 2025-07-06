import asyncio
import sys
from datetime import datetime

from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


class StreamingUI:
    def __init__(self):
        self.current_thought = ""
        self.tool_outputs = []
        self.final_answer = ""

    def clear_line(self):
        """Clear the current line in terminal"""
        sys.stdout.write("\r\033[K")

    def print_status(self, status, tool=None):
        """Print colored status updates"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        if tool:
            print(f"\033[94m[{timestamp}] {status}: {tool}\033[0m")
        else:
            print(f"\033[92m[{timestamp}] {status}\033[0m")

    def print_thinking(self, text):
        """Print agent's reasoning in real-time"""
        self.clear_line()
        truncated = text[:80] + "..." if len(text) > 80 else text
        sys.stdout.write(f"\033[93m💭 Thinking: {truncated}\033[0m")
        sys.stdout.flush()

    def print_tool_result(self, tool_name, result):
        """Print tool execution results"""
        print(f"\n\033[96m🔧 {tool_name} result:\033[0m")
        # Truncate long results
        display_result = result[:200] + "..." if len(result) > 200 else result
        print(f"   {display_result}")


async def streaming_ui_example():
    config = {"mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]}}}

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4", streaming=True)
    agent = MCPAgent(llm=llm, client=client)

    ui = StreamingUI()

    query = "What are the current trending topics on Hacker News?"

    print("🤖 MCP Agent - Interactive Session")
    print("=" * 50)
    print(f"Query: {query}")
    print("=" * 50)

    current_tool = None
    current_reasoning = ""

    async for event in agent.astream_events(query):
        event_type = event.get("event")
        data = event.get("data", {})

        if event_type == "on_chat_model_start":
            ui.print_status("Starting to plan")

        elif event_type == "on_chat_model_stream":
            chunk = data.get("chunk", {})
            if hasattr(chunk, "content") and chunk.content:
                current_reasoning += chunk.content
                ui.print_thinking(current_reasoning)

        elif event_type == "on_tool_start":
            current_tool = data.get("input", {}).get("tool_name")
            if current_tool:
                print("\n")  # New line after thinking
                ui.print_status("Executing tool", current_tool)
                current_reasoning = ""  # Reset for next iteration

        elif event_type == "on_tool_end":
            output = data.get("output")
            if current_tool and output:
                ui.print_tool_result(current_tool, str(output))

        elif event_type == "on_chain_end":
            print("\n")
            ui.print_status("Task completed!")

            # Extract final answer
            final_output = data.get("output")
            if final_output:
                print("\n\033[92m📋 Final Answer:\033[0m")
                print(f"{final_output}")


if __name__ == "__main__":
    asyncio.run(streaming_ui_example())
