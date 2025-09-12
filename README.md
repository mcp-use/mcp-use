<div align="center">
<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="static/logo-gh.jpg">
    <source media="(prefers-color-scheme: light)" srcset="static/logo-gh.jpg">
    <img alt="mcp use logo" src="./static/logo-gh.jpg" width="80%" style="margin: 20px auto;">
  </picture>
</div>


<h1 align="center">🚀 Create MCP Clients and Agents</h1>
<p align="center">
    <a href="https://github.com/pietrozullo/mcp-use/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/pietrozullo/mcp-use?style=social" /></a>
    <a href="https://pypi.org/project/mcp_use/" alt="PyPI Downloads">
        <img src="https://static.pepy.tech/badge/mcp-use" /></a>
    <a href="https://pypi.org/project/mcp_use/" alt="PyPI Version">
        <img src="https://img.shields.io/pypi/v/mcp_use.svg"/></a>
    <a href="https://github.com/mcp-use/mcp-use-ts" alt="TypeScript">
      <img src="https://img.shields.io/badge/TypeScript-mcp--use-3178C6?logo=typescript&logoColor=white" /></a>
    <a href="https://github.com/pietrozullo/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/pietrozullo/mcp-use" /></a>
    <a href="https://docs.mcp-use.com" alt="Documentation">
        <img src="https://img.shields.io/badge/docs-mcp--use.com-blue" /></a>
    <a href="https://mcp-use.com" alt="Website">
        <img src="https://img.shields.io/badge/website-mcp--use.com-blue" /></a>
    </p>
    <p align="center">
    <a href="https://x.com/pietrozullo" alt="Twitter Follow - Pietro">
        <img src="https://img.shields.io/twitter/follow/Pietro?style=social" /></a>
    <a href="https://x.com/pederzh" alt="Twitter Follow - Luigi">
        <img src="https://img.shields.io/twitter/follow/Luigi?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>
</div>

🌐 MCP-Use is the open source way to connect **any LLM to any MCP server** and build custom MCP agents that have tool access, without using closed source or application clients.

💡 Let developers easily connect any LLM to tools like web browsing, file operations, and more.

- If you want to get started quickly check out [mcp-use.com website](https://mcp-use.com/) to build and deploy agents with your favorite MCP servers.
- Visit the [mcp-use docs](https://docs.mcp-use.com/) to get started with mcp-use library
- For the TypeScript version, visit [mcp-use-ts](https://github.com/mcp-use/mcp-use-ts)

| Supports       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primitives** | [![Tools](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=primitive-tools&label=Tools&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml) [![Resources](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=primitive-resources&label=Resources&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml) [![Prompts](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=primitive-prompts&label=Prompts&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml) [![Sampling](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=primitive-sampling&label=Sampling&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml) [![Elicitation](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=primitive-elicitation&label=Elicitation&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml) [![Authentication](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=primitive-authentication&label=Authentication&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml) |
| **Transports** | [![Stdio](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=transport-stdio&label=Stdio&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml) [![SSE](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=transport-sse&label=SSE&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml) [![Streamable HTTP](https://img.shields.io/github/actions/workflow/status/pietrozullo/mcp-use/tests.yml?job=transport-streamableHttp&label=Streamable%20HTTP&style=flat)](https://github.com/pietrozullo/mcp-use/actions/workflows/tests.yml)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Features

<table>
  <tr>
    <th width="400">Feature</th>
    <th>Description</th>
  </tr>
  <tr>
    <td>🔄 <a href="#quick-start"><strong>Ease of use</strong></a></td>
    <td>Create your first MCP capable agent you need only 6 lines of code</td>
  </tr>
  <tr>
    <td>🤖 <a href="#installing-langchain-providers"><strong>LLM Flexibility</strong></a></td>
    <td>Works with any langchain supported LLM that supports tool calling (OpenAI, Anthropic, Groq, LLama etc.)</td>
  </tr>
  <tr>
    <td>🌐 <a href="https://mcp-use.com/builder"><strong>Code Builder</strong></a></td>
    <td>Explore MCP capabilities and generate starter code with the interactive <a href="https://mcp-use.com/builder">code builder</a>.</td>
  </tr>
  <tr>
    <td>🔗 <a href="#http-connection-example"><strong>HTTP Support</strong></a></td>
    <td>Direct connection to MCP servers running on specific HTTP ports</td>
  </tr>
  <tr>
    <td>⚙️ <a href="#dynamic-server-selection-server-manager"><strong>Dynamic Server Selection</strong></a></td>
    <td>Agents can dynamically choose the most appropriate MCP server for a given task from the available pool</td>
  </tr>
  <tr>
    <td>🧩 <a href="#multi-server-support"><strong>Multi-Server Support</strong></a></td>
    <td>Use multiple MCP servers simultaneously in a single agent</td>
  </tr>
  <tr>
    <td>🛡️ <a href="#tool-access-control"><strong>Tool Restrictions</strong></a></td>
    <td>Restrict potentially dangerous tools like file system or network access</td>
  </tr>
  <tr>
    <td>🔧 <a href="#build-a-custom-agent"><strong>Custom Agents</strong></a></td>
    <td>Build your own agents with any framework using the LangChain adapter or create new adapters</td>
  </tr>
  <tr>
    <td>❓ <a href="https://mcp-use.com/what-should-we-build-next"><strong>What should we build next</strong></a></td>
    <td>Let us know what you'd like us to build next</td>
  </tr>
</table>

# Quick start

With pip:

```bash
pip install mcp-use
```

Or install from source:

```bash
git clone https://github.com/mcp-use/mcp-use.git
cd mcp-use
pip install -e .
```

### Installing LangChain Providers

mcp_use works with various LLM providers through LangChain. You'll need to install the appropriate LangChain provider package for your chosen LLM. For example:

```bash
# For OpenAI
pip install langchain-openai

# For Anthropic
pip install langchain-anthropic
```

For other providers, check the [LangChain chat models documentation](https://python.langchain.com/docs/integrations/chat/) and add your API keys for the provider you want to use to your `.env` file.

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

> **Important**: Only models with tool calling capabilities can be used with mcp_use. Make sure your chosen model supports function calling or tool use.

### Spin up your agent:

```python
import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient

async def main():
    # Load environment variables
    load_dotenv()

    # Create configuration dictionary
    config = {
      "mcpServers": {
        "playwright": {
          "command": "npx",
          "args": ["@playwright/mcp@latest"],
          "env": {
            "DISPLAY": ":1"
          }
        }
      }
    }

    # Create MCPClient from configuration dictionary
    client = MCPClient.from_dict(config)

    # Create LLM
    llm = ChatOpenAI(model="gpt-4o")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    # Run the query
    result = await agent.run(
        "Find the best restaurant in San Francisco",
    )
    print(f"\nResult: {result}")

if __name__ == "__main__":
    asyncio.run(main())
```

You can also add the servers configuration from a config file like this:

```python
client = MCPClient.from_config_file(
        os.path.join("browser_mcp.json")
    )
```

Example configuration file (`browser_mcp.json`):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "env": {
        "DISPLAY": ":1"
      }
    }
  }
}
```

For other settings, models, and more, check out the documentation.

## Streaming Agent Output

MCP-Use supports asynchronous streaming of agent output using the `astream` method on `MCPAgent`. This allows you to receive incremental results, tool actions, and intermediate steps as they are generated by the agent, enabling real-time feedback and progress reporting.

### How to use

Call `agent.astream(query)` and iterate over the results asynchronously:

```python
async for chunk in agent.astream("Find the best restaurant in San Francisco"):
    print(chunk["messages"], end="", flush=True)
```

Each chunk is a dictionary containing keys such as `actions`, `steps`, `messages`, and (on the last chunk) `output`. This enables you to build responsive UIs or log agent progress in real time.

#### Example: Streaming in Practice

```python
import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient

async def main():
    load_dotenv()
    client = MCPClient.from_config_file("browser_mcp.json")
    llm = ChatOpenAI(model="gpt-4o")
    agent = MCPAgent(llm=llm, client=client, max_steps=30)
    async for chunk in agent.astream("Look for job at nvidia for machine learning engineer."):
        print(chunk["messages"], end="", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
```

This streaming interface is ideal for applications that require real-time updates, such as chatbots, dashboards, or interactive notebooks.

# Example Use Cases

## Web Browsing with Playwright

```python
import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient

async def main():
    # Load environment variables
    load_dotenv()

    # Create MCPClient from config file
    client = MCPClient.from_config_file(
        os.path.join(os.path.dirname(__file__), "browser_mcp.json")
    )

    # Create LLM
    llm = ChatOpenAI(model="gpt-4o")
    # Alternative models:
    # llm = ChatAnthropic(model="claude-3-5-sonnet-20240620")
    # llm = ChatGroq(model="llama3-8b-8192")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    # Run the query
    result = await agent.run(
        "Find the best restaurant in San Francisco USING GOOGLE SEARCH",
        max_steps=30,
    )
    print(f"\nResult: {result}")

if __name__ == "__main__":
    asyncio.run(main())
```

## Airbnb Search

```python
import asyncio
import os
from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from mcp_use import MCPAgent, MCPClient

async def run_airbnb_example():
    # Load environment variables
    load_dotenv()

    # Create MCPClient with Airbnb configuration
    client = MCPClient.from_config_file(
        os.path.join(os.path.dirname(__file__), "airbnb_mcp.json")
    )

    # Create LLM - you can choose between different models
    llm = ChatAnthropic(model="claude-3-5-sonnet-20240620")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    try:
        # Run a query to search for accommodations
        result = await agent.run(
            "Find me a nice place to stay in Barcelona for 2 adults "
            "for a week in August. I prefer places with a pool and "
            "good reviews. Show me the top 3 options.",
            max_steps=30,
        )
        print(f"\nResult: {result}")
    finally:
        # Ensure we clean up resources properly
        if client.sessions:
            await client.close_all_sessions()

if __name__ == "__main__":
    asyncio.run(run_airbnb_example())
```

Example configuration file (`airbnb_mcp.json`):

```json
{
  "mcpServers": {
    "airbnb": {
      "command": "npx",
      "args": ["-y", "@openbnb/mcp-server-airbnb"]
    }
  }
}
```

## Blender 3D Creation

```python
import asyncio
from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from mcp_use import MCPAgent, MCPClient

async def run_blender_example():
    # Load environment variables
    load_dotenv()

    # Create MCPClient with Blender MCP configuration
    config = {"mcpServers": {"blender": {"command": "uvx", "args": ["blender-mcp"]}}}
    client = MCPClient.from_dict(config)

    # Create LLM
    llm = ChatAnthropic(model="claude-3-5-sonnet-20240620")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    try:
        # Run the query
        result = await agent.run(
            "Create an inflatable cube with soft material and a plane as ground.",
            max_steps=30,
        )
        print(f"\nResult: {result}")
    finally:
        # Ensure we clean up resources properly
        if client.sessions:
            await client.close_all_sessions()

if __name__ == "__main__":
    asyncio.run(run_blender_example())
```

# Configuration Support

## HTTP Connection Example

MCP-Use supports HTTP connections, allowing you to connect to MCP servers running on specific HTTP ports. This feature is particularly useful for integrating with web-based MCP servers.

Here's an example of how to use the HTTP connection feature:

```python
import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient

async def main():
    """Run the example using a configuration file."""
    # Load environment variables
    load_dotenv()

    config = {
        "mcpServers": {
            "http": {
                "url": "http://localhost:8931/sse"
            }
        }
    }

    # Create MCPClient from config file
    client = MCPClient.from_dict(config)

    # Create LLM
    llm = ChatOpenAI(model="gpt-4o")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    # Run the query
    result = await agent.run(
        "Find the best restaurant in San Francisco USING GOOGLE SEARCH",
        max_steps=30,
    )
    print(f"\nResult: {result}")

if __name__ == "__main__":
    # Run the appropriate example
    asyncio.run(main())
```

This example demonstrates how to connect to an MCP server running on a specific HTTP port. Make sure to start your MCP server before running this example.

# Multi-Server Support

MCP-Use allows configuring and connecting to multiple MCP servers simultaneously using the `MCPClient`. This enables complex workflows that require tools from different servers, such as web browsing combined with file operations or 3D modeling.

## Configuration

You can configure multiple servers in your configuration file:

```json
{
  "mcpServers": {
    "airbnb": {
      "command": "npx",
      "args": ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"]
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "env": {
        "DISPLAY": ":1"
      }
    }
  }
}
```

## Usage

The `MCPClient` class provides methods for managing connections to multiple servers. When creating an `MCPAgent`, you can provide an `MCPClient` configured with multiple servers.

By default, the agent will have access to tools from all configured servers. If you need to target a specific server for a particular task, you can specify the `server_name` when calling the `agent.run()` method.

```python
# Example: Manually selecting a server for a specific task
result = await agent.run(
    "Search for Airbnb listings in Barcelona",
    server_name="airbnb" # Explicitly use the airbnb server
)

result_google = await agent.run(
    "Find restaurants near the first result using Google Search",
    server_name="playwright" # Explicitly use the playwright server
)
```

## Dynamic Server Selection (Server Manager)

For enhanced efficiency and to reduce potential agent confusion when dealing with many tools from different servers, you can enable the Server Manager by setting `use_server_manager=True` during `MCPAgent` initialization.

When enabled, the agent intelligently selects the correct MCP server based on the tool chosen by the LLM for a specific step. This minimizes unnecessary connections and ensures the agent uses the appropriate tools for the task.

```python
import asyncio
from mcp_use import MCPClient, MCPAgent
from langchain_anthropic import ChatAnthropic

async def main():
    # Create client with multiple servers
    client = MCPClient.from_config_file("multi_server_config.json")

    # Create agent with the client
    agent = MCPAgent(
        llm=ChatAnthropic(model="claude-3-5-sonnet-20240620"),
        client=client,
        use_server_manager=True  # Enable the Server Manager
    )

    try:
        # Run a query that uses tools from multiple servers
        result = await agent.run(
            "Search for a nice place to stay in Barcelona on Airbnb, "
            "then use Google to find nearby restaurants and attractions."
        )
        print(result)
    finally:
        # Clean up all sessions
        await client.close_all_sessions()

if __name__ == "__main__":
    asyncio.run(main())
```

# Tool Access Control

MCP-Use allows you to restrict which tools are available to the agent, providing better security and control over agent capabilities:

```python
import asyncio
from mcp_use import MCPAgent, MCPClient
from langchain_openai import ChatOpenAI

async def main():
    # Create client
    client = MCPClient.from_config_file("config.json")

    # Create agent with restricted tools
    agent = MCPAgent(
        llm=ChatOpenAI(model="gpt-4"),
        client=client,
        disallowed_tools=["file_system", "network"]  # Restrict potentially dangerous tools
    )

    # Run a query with restricted tool access
    result = await agent.run(
        "Find the best restaurant in San Francisco"
    )
    print(result)

    # Clean up
    await client.close_all_sessions()

if __name__ == "__main__":
    asyncio.run(main())
```

# Sandboxed Execution

MCP-Use supports running MCP servers in a sandboxed environment using E2B's cloud infrastructure. This allows you to run MCP servers without having to install dependencies locally, making it easier to use tools that might have complex setups or system requirements.

## Installation

To use sandboxed execution, you need to install the E2B dependency:

```bash
# Install mcp-use with E2B support
pip install "mcp-use[e2b]"

# Or install the dependency directly
pip install e2b-code-interpreter
```

You'll also need an E2B API key. You can sign up at [e2b.dev](https://e2b.dev) to get your API key.

## Configuration

To enable sandboxed execution, use the sandbox parameter when creating your `MCPClient`:

```python
import asyncio
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient
from mcp_use.types.sandbox import SandboxOptions

async def main():
    # Load environment variables (needs E2B_API_KEY)
    load_dotenv()

    # Define MCP server configuration
    server_config = {
        "mcpServers": {
            "everything": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-everything"],
            }
        }
    }

    # Define sandbox options
    sandbox_options: SandboxOptions = {
        "api_key": os.getenv("E2B_API_KEY"),  # API key can also be provided directly
        "sandbox_template_id": "base",  # Use base template
    }

    # Create client with sandboxed mode enabled
    client = MCPClient(
        config=server_config,
        sandbox=True,
        sandbox_options=sandbox_options,

    )

    # Create agent with the sandboxed client
    llm = ChatOpenAI(model="gpt-4o")
    agent = MCPAgent(llm=llm, client=client)

    # Run your agent
    result = await agent.run("Use the command line tools to help me add 1+1")
    print(result)

    # Clean up
    await client.close_all_sessions()

if __name__ == "__main__":
    asyncio.run(main())
```

## Sandbox Options

The `SandboxOptions` type provides configuration for the sandbox environment:

| Option                 | Description                                                                              | Default               |
| ---------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| `api_key`              | E2B API key. Required - can be provided directly or via E2B_API_KEY environment variable | None                  |
| `sandbox_template_id`  | Template ID for the sandbox environment                                                  | "base"                |
| `supergateway_command` | Command to run supergateway                                                              | "npx -y supergateway" |

## Benefits of Sandboxed Execution

- **No local dependencies**: Run MCP servers without installing dependencies locally
- **Isolation**: Execute code in a secure, isolated environment
- **Consistent environment**: Ensure consistent behavior across different systems
- **Resource efficiency**: Offload resource-intensive tasks to cloud infrastructure

# Direct Tool Calls (Without LLM)

You can call MCP server tools directly without an LLM when you need programmatic control:

```python
import asyncio
from mcp_use import MCPClient

async def call_tool_example():
    config = {
        "mcpServers": {
            "everything": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-everything"],
            }
        }
    }

    client = MCPClient.from_dict(config)

    try:
        await client.create_all_sessions()
        session = client.get_session("everything")

        # Call tool directly
        result = await session.call_tool(
            name="add",
            arguments={"a": 1, "b": 2}
        )

        print(f"Result: {result.content[0].text}")  # Output: 3

    finally:
        await client.close_all_sessions()

if __name__ == "__main__":
    asyncio.run(call_tool_example())
```

See the complete example: [examples/direct_tool_call.py](examples/direct_tool_call.py)

# Build a Custom Agent:

You can also build your own custom agent using the LangChain adapter:

```python
import asyncio
from langchain_openai import ChatOpenAI
from mcp_use.client import MCPClient
from mcp_use.adapters.langchain_adapter import LangChainAdapter
from dotenv import load_dotenv

load_dotenv()


async def main():
    # Initialize MCP client
    client = MCPClient.from_config_file("examples/browser_mcp.json")
    llm = ChatOpenAI(model="gpt-4o")

    # Create adapter instance
    adapter = LangChainAdapter()
    # Get LangChain tools with a single line
    tools = await adapter.create_tools(client)

    # Create a custom LangChain agent
    llm_with_tools = llm.bind_tools(tools)
    result = await llm_with_tools.ainvoke("What tools do you have available ? ")
    print(result)


if __name__ == "__main__":
    asyncio.run(main())


```

# Debugging

MCP-Use provides a built-in debug mode that increases log verbosity and helps diagnose issues in your agent implementation.

## Enabling Debug Mode

There are two primary ways to enable debug mode:

### 1. Environment Variable (Recommended for One-off Runs)

Run your script with the `DEBUG` environment variable set to the desired level:

```bash
# Level 1: Show INFO level messages
DEBUG=1 python3.11 examples/browser_use.py

# Level 2: Show DEBUG level messages (full verbose output)
DEBUG=2 python3.11 examples/browser_use.py
```

This sets the debug level only for the duration of that specific Python process.

Alternatively you can set the following environment variable to the desired logging level:

```bash
export MCP_USE_DEBUG=1 # or 2
```

### 2. Setting the Debug Flag Programmatically

You can set the global debug flag directly in your code:

```python
import mcp_use

mcp_use.set_debug(1)  # INFO level
# or
mcp_use.set_debug(2)  # DEBUG level (full verbose output)
```

### 3. Agent-Specific Verbosity

If you only want to see debug information from the agent without enabling full debug logging, you can set the `verbose` parameter when creating an MCPAgent:

```python
# Create agent with increased verbosity
agent = MCPAgent(
    llm=your_llm,
    client=your_client,
    verbose=True  # Only shows debug messages from the agent
)
```

This is useful when you only need to see the agent's steps and decision-making process without all the low-level debug information from other components.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=pietrozullo/mcp-use&type=Date)](https://www.star-history.com/#pietrozullo/mcp-use&Date)

# Contributing

We love contributions! Feel free to open issues for bugs or feature requests. Look at [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Contributors

Thanks to all our amazing contributors!

<a href="https://github.com/mcp-use/mcp-use/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mcp-use/mcp-use" />
</a>

## Top Starred Dependents

<!-- gh-dependents-info-used-by-start -->

<table>
  <tr>
    <th width="400">Repository</th>
    <th>Stars</th>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/38653995?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/patchy631/ai-engineering-hub"><strong>patchy631/ai-engineering-hub</strong></a></td>
    <td>⭐ 17917</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/164294848?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/buildfastwithai/gen-ai-experiments"><strong>buildfastwithai/gen-ai-experiments</strong></a></td>
    <td>⭐ 178</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/187057607?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/hud-evals/hud-python"><strong>hud-evals/hud-python</strong></a></td>
    <td>⭐ 159</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/170207473?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/tavily-ai/meeting-prep-agent"><strong>tavily-ai/meeting-prep-agent</strong></a></td>
    <td>⭐ 136</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/20041231?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/krishnaik06/MCP-CRASH-Course"><strong>krishnaik06/MCP-CRASH-Course</strong></a></td>
    <td>⭐ 72</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/54944174?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/larksuite/lark-samples"><strong>larksuite/lark-samples</strong></a></td>
    <td>⭐ 40</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/892404?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/truemagic-coder/solana-agent-app"><strong>truemagic-coder/solana-agent-app</strong></a></td>
    <td>⭐ 29</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/8344498?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/schogini/techietalksai"><strong>schogini/techietalksai</strong></a></td>
    <td>⭐ 24</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/201161342?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/autometa-dev/whatsapp-mcp-voice-agent"><strong>autometa-dev/whatsapp-mcp-voice-agent</strong></a></td>
    <td>⭐ 23</td>
  </tr>
  <tr>
    <td><img src="https://avatars.githubusercontent.com/u/100749943?s=40&v=4" width="20" height="20" style="vertical-align: middle; margin-right: 8px;"> <a href="https://github.com/Deniscartin/mcp-cli"><strong>Deniscartin/mcp-cli</strong></a></td>
    <td>⭐ 20</td>
  </tr>
</table>

<!-- gh-dependents-info-used-by-end -->

# Requirements

- Python 3.11+
- MCP implementation (like Playwright MCP)
- LangChain and appropriate model libraries (OpenAI, Anthropic, etc.)

# License

MIT

# Citation

If you use MCP-Use in your research or project, please cite:

```bibtex
@software{mcp_use2025,
  author = {Zullo, Pietro},
  title = {MCP-Use: MCP Library for Python},
  year = {2025},
  publisher = {GitHub},
  url = {https://github.com/pietrozullo/mcp-use}
}
```

<img referrerpolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=732589b6-6850-4b8c-aa25-906c0979e426&page=README.md" />
