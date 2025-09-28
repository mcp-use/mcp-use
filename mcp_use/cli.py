#!/usr/bin/env python
"""
MCP-Use CLI Tool - All-in-one CLI for creating and deploying MCP projects.
"""

import argparse
import sys
import threading
import time
from pathlib import Path

from mcp_use import __version__

# ============= SPINNER CLASS =============


class Spinner:
    """Simple loading spinner similar to UV's style."""

    def __init__(self, message: str = "Loading"):
        self.message = message
        self.running = False
        self.thread = None
        self.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        self.current = 0

    def start(self):
        """Start the spinner."""
        self.running = True
        self.thread = threading.Thread(target=self._spin)
        self.thread.daemon = True
        self.thread.start()

    def _spin(self):
        """Spin animation loop."""
        while self.running:
            frame = self.frames[self.current % len(self.frames)]
            print(f"\r{frame} {self.message}...", end="", flush=True)
            self.current += 1
            time.sleep(0.1)

    def stop(self, success_message=None):
        """Stop the spinner and optionally print success message."""
        self.running = False
        if self.thread:
            self.thread.join()
        if success_message:
            print(f"\r✓ {success_message}        ")
        else:
            print("\r" + " " * (len(self.message) + 10), end="\r")


# ============= PROJECT CREATION FUNCTIONS =============


def print_header():
    """Print the CLI header."""
    print("\n mcp-use create")
    print("━" * 50)
    print()


def get_project_name() -> str:
    """Get project name from user."""
    while True:
        name = input("📝 Project name: ").strip().replace("-", "_")
        if not name:
            print("   ⚠️  Project name cannot be empty")
            continue
        if " " in name:
            print("   ⚠️  Project name cannot contain spaces")
            continue
        if Path(name).exists():
            print(f"   ⚠️  Directory '{name}' already exists")
            continue
        return name


def get_project_type() -> str:
    """Get project type from user."""
    print("\n📦 What would you like to create?")
    print("   1) Server + Agent")
    print("   2) Server only")
    print("   3) Agent only")

    while True:
        choice = input("\n   Choice (1-3): ").strip()
        if choice == "1":
            return "server_agent"
        elif choice == "2":
            return "server"
        elif choice == "3":
            return "agent"
        else:
            print("   ⚠️  Please enter 1, 2, or 3")


def create_server_structure(project_dir: Path, project_name: str):
    """Create server file in nested project folder."""
    # Create nested project folder
    nested_dir = project_dir / project_name
    nested_dir.mkdir(parents=True)

    # Create server.py
    server_content = f'''"""
MCP Server for {project_name}
"""

from mcp.server import FastMCP

# Create server instance
server = FastMCP("{project_name}-server")


# ============= TOOLS =============


@server.tool()
async def add_numbers(a: float, b: float) -> str:
    """Add two numbers together."""
    result = a + b
    return f"{{result}}"


# ============= RESOURCES =============


@server.resource("config://app")
async def get_app_config() -> str:
    """Get the application configuration."""
    return "App: {project_name}, Version: 0.1.0, Status: Active"


# ============= PROMPTS =============


@server.prompt()
async def assistant_prompt() -> str:
    """Generate a helpful assistant prompt."""
    return "You are a helpful assistant for {project_name}. Be concise and friendly."


# ============= MAIN =============

if __name__ == "__main__":
    server.run("stdio")
'''
    (nested_dir / "server.py").write_text(server_content)


def create_agent_structure(project_dir: Path, project_name: str, project_type: str):
    """Create agent file in nested project folder."""
    # Create nested project folder if it doesn't exist
    nested_dir = project_dir / project_name
    if not nested_dir.exists():
        nested_dir.mkdir(parents=True)

    if project_type == "server_agent":
        # For server_agent mode, embed config directly in agent.py
        agent_content = f'''"""
MCP Agent implementation for {project_name}
"""

from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient

config = {{
    "mcpServers": {{
        "{project_name}": {{
            "command": "python",
            "args": ["{project_name}/server.py"],
        }}
    }}
}}

client = MCPClient(config=config)
agent = MCPAgent(llm=ChatOpenAI(model="gpt-4o"), client=client, max_steps=10, memory_enabled=True)
'''
    else:
        # For agent-only mode, use external JSON config file
        agent_content = f'''"""
MCP Agent implementation for {project_name}
"""

from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient

client = MCPClient.from_config_file("{project_name}/mcp_servers.json")
agent = MCPAgent(llm=ChatOpenAI(model="gpt-4o"), client=client, max_steps=10, memory_enabled=True)
'''
        # Create mcp_servers.json for agent-only mode
        mcp_servers_json = (
            '''{
    "mcpServers": {
        "'''
            + project_name
            + """": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-everything"]
        }
    }
}"""
        )
        (nested_dir / "mcp_servers.json").write_text(mcp_servers_json)

    (nested_dir / "agent.py").write_text(agent_content)


def create_common_files(project_dir: Path, project_name: str, project_type: str):
    """Create common project files."""

    # pyproject.toml
    pyproject = f"""[project]
name = "{project_name}"
version = "0.1.0"
description = "An MCP project"
requires-python = ">=3.10"
dependencies = [
    "mcp>=1.0.0",
    "mcp-use>=0.1.0",
    "langchain-openai>=0.1.0",
    "python-dotenv>=1.0.0",
]
"""
    (project_dir / "pyproject.toml").write_text(pyproject)

    # requirements.txt
    requirements = """mcp>=1.0.0
mcp-use>=0.1.0
langchain-openai>=0.1.0
python-dotenv>=1.0.0
"""
    (project_dir / "requirements.txt").write_text(requirements)

    # .gitignore
    gitignore = """__pycache__/
*.py[cod]
.env
venv/
.venv/
*.egg-info/
dist/
build/
.pytest_cache/
.coverage
"""
    (project_dir / ".gitignore").write_text(gitignore)

    # README.md
    readme = f"""# {project_name}

An MCP project created with mcp-use.

## Project Structure

```
{project_name}/
"""

    if project_type in ["server_agent", "server"]:
        readme += f"""├── {project_name}/
│   ├── server.py    # MCP server with all components
"""

    if project_type in ["server_agent", "agent"]:
        if project_type == "agent":
            readme += f"""├── {project_name}/
│   ├── agent.py     # MCP agent implementation
│   └── mcp_servers.json  # Server configuration
"""
        else:
            readme += """│   └── agent.py     # MCP agent implementation
"""

    if project_type in ["server_agent", "agent"]:
        readme += """├── run.py           # Simple example
├── chat.py          # Interactive chat
"""

    readme += """├── pyproject.toml
├── requirements.txt
├── .gitignore
└── README.md
```

## Setup

1. Install dependencies:
```bash
   pip install -r requirements.txt
```

2. Configure environment:
```bash
   export OPENAI_API_KEY=your-api-key-here
```
"""

    if project_type in ["server_agent", "server"]:
        readme += f"""
## Running the Server

```bash
python {project_name}/server.py
```

The server uses FastMCP and includes:
- **Tools**: Simple tool functions (e.g., add_numbers)
- **Resources**: Data resources (e.g., config)
- **Prompts**: Prompt templates for the LLM
"""

    if project_type in ["server_agent", "agent"]:
        readme += f"""
## Using the Agent

```python
from {project_name}.agent import agent

result = await agent.run("Your prompt")
```
"""

    (project_dir / "README.md").write_text(readme)


def create_example_files(project_dir: Path, project_name: str):
    """Create example files."""

    # run.py
    run_content = f'''"""
Example usage of {project_name}.
"""

import asyncio
import os

from dotenv import load_dotenv

from {project_name}.agent import agent


async def main():
    load_dotenv()

    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY not found")
        return

    result = await agent.run("What tools are available?")
    print(f"Result: {{result}}")


if __name__ == "__main__":
    asyncio.run(main())
'''
    (project_dir / "run.py").write_text(run_content)

    # chat.py
    chat_content = f'''"""
Interactive chat for {project_name}.
"""

import asyncio
import os

from dotenv import load_dotenv

from {project_name}.agent import agent


async def chat():
    load_dotenv()

    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY not found")
        return

    print("Chat started (type 'exit' to quit)")

    while True:
        user_input = input("\\nYou: ")
        if user_input.lower() == "exit":
            break

        print("Assistant: ", end="", flush=True)
        response = await agent.run(user_input)
        print(response)


if __name__ == "__main__":
    asyncio.run(chat())
'''
    (project_dir / "chat.py").write_text(chat_content)


def create_project(project_name: str, project_type: str) -> bool:
    """Create the project structure."""
    project_dir = Path.cwd() / project_name

    try:
        # Create main directory
        spinner = Spinner("Creating project directory")
        spinner.start()
        time.sleep(0.5)  # Simulate work
        project_dir.mkdir(parents=True)
        spinner.stop("Created project directory")

        # Create server if needed
        if project_type in ["server_agent", "server"]:
            spinner = Spinner("Creating server")
            spinner.start()
            time.sleep(0.3)
            create_server_structure(project_dir, project_name)
            spinner.stop("Created server structure")

        # Create agent if needed
        if project_type in ["server_agent", "agent"]:
            spinner = Spinner("Creating agent")
            spinner.start()
            time.sleep(0.3)
            create_agent_structure(project_dir, project_name, project_type)
            spinner.stop("Created agent structure")

        # Create common files
        spinner = Spinner("Creating configuration files")
        spinner.start()
        time.sleep(0.3)
        create_common_files(project_dir, project_name, project_type)
        spinner.stop("Created configuration files")

        # Create examples for server_agent and agent
        if project_type in ["server_agent", "agent"]:
            spinner = Spinner("Creating example files")
            spinner.start()
            time.sleep(0.3)
            create_example_files(project_dir, project_name)
            spinner.stop("Created example files")

        return True

    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        return False


# ============= MAIN CLI FUNCTIONS =============


def show_help():
    """Show the main help message."""
    help_text = """
╔══════════════════════════════════════════════════════════════════╗
║                       MCP-Use CLI Tool                           ║
║                                                                  ║
║  Create and deploy MCP servers and agents with ease              ║
╚══════════════════════════════════════════════════════════════════╝

Usage: uvx mcp-use <command> [options]

Available Commands:
  create     🚀 Create a new MCP project (server, agent, or both)
             Interactive wizard to scaffold your MCP project

  run        🏃 Run an MCP server from a Python file
             Start your MCP server with various transport options

  deploy     ☁️  Deploy your MCP project to the cloud
             (Coming soon - Cloud deployment from CLI)

Examples:
  uvx mcp-use create                    # Start interactive project creation
  uvx mcp-use run server.py             # Run server with default settings
  uvx mcp-use run @server.py            # Run server (@ syntax supported)
  uvx mcp-use run server.py --reload    # Run with auto-reload
  uvx mcp-use run server.py --transport sse --port 3000
  uvx mcp-use deploy                    # Deploy to cloud (coming soon)
  uvx mcp-use --help                    # Show this help message
  uvx mcp-use --version                 # Show version information

For more information, visit: https://mcp-use.com
    """
    print(help_text)


def handle_create():
    """Handle the create command."""
    print_header()

    # Get project configuration
    project_name = get_project_name()
    project_type = get_project_type()

    print(f"\n⚙️  Creating {project_type.replace('_', ' + ')} project: {project_name}")
    print()

    # Create the project
    if create_project(project_name, project_type):
        print(f"\n✨ Successfully created '{project_name}'!")
        print("\n📋 Next steps:")
        print(f"   cd {project_name}")
        print("   pip install -r requirements.txt")
        print("   export OPENAI_API_KEY=your-api-key-here")

        if project_type in ["server_agent", "server"]:
            print("\n   # Test the server:")
            print(f"   python {project_name}/server.py")

        if project_type in ["server_agent", "agent"]:
            print("\n   # Run examples:")
            print("   python run.py    # Simple example")
            print("   python chat.py   # Interactive chat")

        print()
    else:
        sys.exit(1)


def handle_run(args):
    """Handle the run command to start an MCP server."""
    from mcp_use.server.cli import handle_server_run

    try:
        handle_server_run(
            server_file=args.server, transport=args.transport, host=args.host, port=args.port, reload=args.reload
        )
    except Exception as e:
        print(f"❌ Error running server: {str(e)}")
        sys.exit(1)


def handle_deploy():
    """Handle the deploy command (placeholder for future implementation)."""
    print("\n" + "=" * 60)
    print("🚀 MCP Cloud Deployment")
    print("=" * 60)

    print("\n📝 Please login to MCP Cloud to continue...")
    print("   Visit: https://cloud.mcp-use.com/login")
    print()

    # Simulate login prompt
    print("Enter your MCP Cloud credentials:")
    email = input("Email: ")

    if email:
        print(f"\n✨ Welcome {email}!")
        print()
        print("ℹ️  Deployment from CLI is coming soon!")
        print("   For now, please use the web interface at:")
        print("   https://cloud.mcp-use.com/deploy")
        print()
        print("Stay tuned for updates! 🎉")
    else:
        print("\n❌ Login cancelled")

    print("=" * 60)


def main(args=None):
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        prog="mcp-use",
        description="MCP-Use CLI Tool - Create and deploy MCP projects",
        add_help=False,  # We'll handle help ourselves
    )

    # Add version argument
    parser.add_argument(
        "--version", "-v", action="version", version=f"mcp-use {__version__}", help="Show version information"
    )

    # Add help argument
    parser.add_argument("--help", "-h", action="store_true", help="Show help message")

    # Add subcommands
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Create command
    subparsers.add_parser("create", help="Create a new MCP project")

    # Run command
    run_parser = subparsers.add_parser("run", help="Run an MCP server")
    run_parser.add_argument("server", help="Path to the server Python file")
    run_parser.add_argument("--reload", action="store_true", help="Enable auto-reload on file changes")
    run_parser.add_argument(
        "--transport",
        choices=["stdio", "sse", "streamable-http"],
        default="streamable-http",
        help="Transport type (default: streamable-http)",
    )
    run_parser.add_argument("--host", default="127.0.0.1", help="Host to bind to (default: 127.0.0.1)")
    run_parser.add_argument("--port", type=int, default=8000, help="Port to bind to (default: 8000)")

    # Deploy command
    subparsers.add_parser("deploy", help="Deploy MCP project to cloud")

    # Parse arguments
    parsed_args = parser.parse_args(args)

    # Handle help flag or no command
    if parsed_args.help or not parsed_args.command:
        show_help()
        sys.exit(0)

    # Handle commands
    if parsed_args.command == "create":
        handle_create()
    elif parsed_args.command == "run":
        handle_run(parsed_args)
    elif parsed_args.command == "deploy":
        handle_deploy()
    else:
        print(f"Unknown command: {parsed_args.command}")
        show_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
