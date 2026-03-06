"""CLI tool to scaffold a new MCP server project using mcp-use."""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm
from rich.status import Status

console = Console()

TEMPLATES_DIR = Path(__file__).parent

TEMPLATE_SUFFIX = ".tmpl"

LOGO = r"""
 [bold white] ███╗   ███╗   ██████╗  ██████╗         ██╗   ██╗  ███████╗  ███████╗[/bold white]
 [bold white] ████╗ ████║  ██╔════╝  ██╔══██╗        ██║   ██║  ██╔════╝  ██╔════╝[/bold white]
 [bold white] ██╔████╔██║  ██║       ██████╔╝  ━━━━  ██║   ██║  ███████╗  █████╗  [/bold white]
 [bold white] ██║╚██╔╝██║  ██║       ██╔═══╝   ━━━━  ██║   ██║  ╚════██║  ██╔══╝  [/bold white]
 [bold white] ██║ ╚═╝ ██║  ╚██████╗  ██║             ╚██████╔╝  ███████║  ███████╗[/bold white]
 [bold white] ╚═╝     ╚═╝   ╚═════╝  ╚═╝              ╚═════╝   ╚══════╝  ╚══════╝[/bold white]
"""


def get_available_templates() -> list[str]:
    """Returns the list of available templates."""
    return [
        d.name for d in TEMPLATES_DIR.iterdir() if d.is_dir() and d.name != "__pycache__" and not d.name.startswith(".")
    ]


def validate_project_name(name: str) -> str:
    """Check if the inserted name is a valid project name."""
    if not re.match(r"^[a-zA-Z0-9_-]+$", name):
        console.print(
            f"[red]Error:[/red] Invalid project name '{name}'. Use only letters, numbers, hyphens, underscores."
        )
        sys.exit(1)
    if name in {"src", "dist", ".git", ".env", "node_modules"}:
        console.print(f"[red]Error:[/red] '{name}' is a reserved name.")
        sys.exit(1)
    return name


def render_template(content: str, context: dict[str, str]) -> str:
    """Replace {{KEY}} placeholders with context values."""
    for key, value in context.items():
        content = content.replace(f"{{{{{key}}}}}", value)
    return content


def copy_template(template_dir: Path, target_dir: Path, context: dict[str, str]) -> None:
    """Copy the template to the target folder after replacing placeholders."""
    for src_path in template_dir.rglob("*"):
        if src_path.is_dir() or "__pycache__" in src_path.parts:
            continue

        rel_path = src_path.relative_to(template_dir)

        # Strip .tmpl suffix and handle gitignore
        dest_name = rel_path.name
        if dest_name.endswith(TEMPLATE_SUFFIX):
            dest_name = dest_name[: -len(TEMPLATE_SUFFIX)]
        if dest_name == "gitignore":
            dest_name = ".gitignore"

        dest_path = target_dir / rel_path.parent / dest_name
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        content = src_path.read_text(encoding="utf-8")
        rendered = render_template(content, context)
        dest_path.write_text(rendered, encoding="utf-8")


def detect_installer() -> tuple[str, list[str]]:
    """Detect the best available package installer. Returns (name, install_command)."""
    if shutil.which("uv"):
        return ("uv", ["uv", "pip", "install", "."])
    if shutil.which("pip"):
        return ("pip", ["pip", "install", "."])
    return ("", [])


def run_install(name: str, cmd: list[str], target_dir: Path) -> bool:
    """Run the installer, capturing output. Returns True on success."""
    with Status(f"  Installing dependencies with [bold]{name}[/bold]...", console=console):
        result = subprocess.run(cmd, cwd=target_dir, capture_output=True, text=True)
    if result.returncode == 0:
        console.print("  [green]✓[/green] Dependencies installed.")
        return True
    else:
        console.print("  [red]✗[/red] Installation failed.")
        if result.stderr:
            console.print(f"\n{result.stderr.strip()}")
        console.print(f"\n  Run manually:\n    cd {target_dir.name}\n    {' '.join(cmd)}")
        return False


def install_dependencies(target_dir: Path) -> bool:
    """Prompt user to install dependencies and run the installer. Returns True if installed."""
    name, cmd = detect_installer()
    if not name:
        console.print("[yellow]No package installer found (uv or pip).[/yellow]")
        console.print(f"  Install dependencies manually:\n    cd {target_dir.name}\n    pip install .")
        return False

    try:
        if Confirm.ask(f"\n  Install dependencies with [bold]{name}[/bold]?", default=True, console=console):
            return run_install(name, cmd, target_dir)
    except (EOFError, KeyboardInterrupt):
        console.print()
    return False


def main():
    parser = argparse.ArgumentParser(
        prog="create-mcp-use", description="Scaffold a new MCP server project using mcp-use"
    )

    # This argument is optional (for example in case of --list-templates)
    parser.add_argument("project_name", nargs="?", help="Name of the project to create")
    parser.add_argument(
        "-t",
        "--template",
        default="starter",
        choices=get_available_templates(),
        help="Template to use (default: starter)",
    )
    parser.add_argument("--list-templates", action="store_true", help="List available templates")
    parser.add_argument("--install", action="store_true", default=None, help="Install dependencies automatically")
    parser.add_argument("--no-install", action="store_true", help="Skip installing dependencies")

    args = parser.parse_args()

    if not args.list_templates and not args.project_name:
        parser.error("project_name is required")

    if args.list_templates:
        console.print("\n[bold]Available templates:[/bold]")
        for t in get_available_templates():
            console.print(f"  • {t}")
        sys.exit(0)

    project_name = validate_project_name(args.project_name)
    target_dir = Path.cwd() / project_name

    if target_dir.exists():
        console.print(f"[red]Error:[/red] Directory '{project_name}' already exists.")
        sys.exit(1)

    template_dir = TEMPLATES_DIR / args.template
    if not template_dir.exists():
        console.print(f"[red]Error:[/red] Template '{args.template}' not found.")
        sys.exit(1)

    # Derive a Python safe module name for use in imports
    module_name = project_name.replace("-", "_")

    context = {
        "PROJECT_NAME": project_name,
        "MODULE_NAME": module_name,
    }

    console.print(LOGO)
    console.print(
        f"  Creating MCP server [bold cyan]{project_name}[/bold cyan] with template [bold]{args.template}[/bold]...\n"
    )
    copy_template(template_dir, target_dir, context)
    console.print(f"  [green]✓[/green] Project created at [bold]./{project_name}/[/bold]")

    # Handle dependency installation
    installed = False
    installer_name = None
    if args.no_install:
        pass
    elif args.install:
        installer_name, cmd = detect_installer()
        if installer_name:
            installed = run_install(installer_name, cmd, target_dir)
    else:
        installer_name, _ = detect_installer()
        installed = install_dependencies(target_dir)

    # Track CLI usage
    try:
        from mcp_use.telemetry import Telemetry
        from mcp_use.telemetry.events import CreateMCPUseEvent

        telemetry = Telemetry()
        telemetry.capture(
            CreateMCPUseEvent(
                project_name=project_name,
                template=args.template,
                install_deps=not args.no_install,
                deps_installed=installed,
                installer=installer_name,
            )
        )
        telemetry.flush()
    except Exception:
        pass

    # Build the "get started" instructions
    steps = f"cd {project_name}\n"
    if not installed:
        steps += "pip install .\n"
    steps += "python server.py"

    console.print()
    console.print(Panel(steps, title="[bold]Get started[/bold]", border_style="cyan", padding=(1, 2)))
    console.print(
        "  Docs: [link=https://mcp-use.com/docs/python/server]https://mcp-use.com/docs/python/server[/link]\n"
    )
