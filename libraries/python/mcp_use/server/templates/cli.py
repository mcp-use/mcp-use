"""CLI tool to scaffold a new MCP server project using mcp-use."""

import argparse
import re
import sys
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent

TEMPLATE_SUFFIX = ".tmpl"


def get_available_templates() -> list[str]:
    """Returns the list of available templates."""
    return [
        d.name for d in TEMPLATES_DIR.iterdir() if d.is_dir() and d.name != "__pycache__" and not d.name.startswith(".")
    ]


def validate_project_name(name: str) -> str:
    """Check if the inserted name is a valid project name."""
    if not re.match(r"^[a-zA-Z0-9_-]+$", name):
        print(f"Error: Invalid project name '{name}'. Use only letters, numbers, hyphens, underscores.")
        sys.exit(1)
    if name in {"src", "dist", ".git", ".env", "node_modules"}:
        print(f"Error: '{name}' is a reserved name.")
        sys.exit(1)
    return name


def render_template(content: str, context: dict[str, str]) -> str:
    """Replace {{KEY}} placeholders with context values."""
    for key, value in context.items():
        content = content.replace(f"{{{{{key}}}}}", value)
    return content


def copy_template(template_dir: Path, target_dir: Path, context: dict[str, str]) -> None:
    """Cope the template to the target folder after replacing placeholders"""
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

    args = parser.parse_args()

    if not args.list_templates and not args.project_name:
        parser.error("project_name is required")

    if args.list_templates:
        print("Available templates:")
        for t in get_available_templates():
            print(f"  {t}")
        sys.exit(0)

    project_name = validate_project_name(args.project_name)
    target_dir = Path.cwd() / project_name

    if target_dir.exists():
        print(f"Error: Directory '{project_name}' already exists.")
        sys.exit(1)

    template_dir = TEMPLATES_DIR / args.template
    if not template_dir.exists():
        print(f"Error: Template '{args.template}' not found.")
        sys.exit(1)

    # Derive a Python safe module name for use in imports
    module_name = project_name.replace("-", "_")

    context = {
        "PROJECT_NAME": project_name,
        "MODULE_NAME": module_name,
    }

    print(f"Creating MCP server '{project_name}' with template '{args.template}'...")
    copy_template(template_dir, target_dir, context)

    print()
    print(f"  Project created at ./{project_name}/")
    print()
    print("  To get started:")
    print(f"    cd {project_name}")
    print("     python server.py")
    print()
    print("  Docs: https://mcp-use.com/docs/python/server")
