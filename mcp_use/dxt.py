"""
DXT (Desktop Extension) format support for MCP-Use.

This module provides functionality to load and parse Anthropic's DXT format,
which allows one-click installation of MCP servers.
"""

import json
import os
import tempfile
import zipfile
from typing import Any

from .logging import logger


class DXTLoader:
    """Loader for DXT (Desktop Extension) files."""

    def __init__(self, dxt_path: str):
        """Initialize a DXT loader.

        Args:
            dxt_path: Path to the .dxt file
        """
        self.dxt_path = dxt_path
        self._validate_file()

    def _validate_file(self) -> None:
        """Validate that the file exists and has .dxt extension."""
        if not os.path.exists(self.dxt_path):
            raise FileNotFoundError(f"DXT file not found: {self.dxt_path}")

        if not self.dxt_path.lower().endswith(".dxt"):
            raise ValueError(f"File must have .dxt extension: {self.dxt_path}")

    def load_manifest(self) -> dict[str, Any]:
        """Load and parse the manifest.json from the DXT file.

        Returns:
            The parsed manifest dictionary

        Raises:
            ValueError: If manifest.json is missing or invalid
        """
        try:
            with zipfile.ZipFile(self.dxt_path, "r") as dxt_zip:
                # Check if manifest.json exists
                if "manifest.json" not in dxt_zip.namelist():
                    raise ValueError("DXT file missing required manifest.json")

                # Read and parse manifest
                with dxt_zip.open("manifest.json") as manifest_file:
                    manifest = json.load(manifest_file)

                # Validate required fields
                self._validate_manifest(manifest)
                return manifest

        except zipfile.BadZipFile as e:
            raise ValueError(f"Invalid DXT file (not a valid zip): {self.dxt_path}") from e

    def _validate_manifest(self, manifest: dict[str, Any]) -> None:
        """Validate the manifest has required fields.

        Args:
            manifest: The manifest dictionary to validate

        Raises:
            ValueError: If required fields are missing
        """
        required_fields = ["dxt_version", "name", "version", "server"]
        for field in required_fields:
            if field not in manifest:
                raise ValueError(f"Manifest missing required field: {field}")

        # Validate server configuration
        server_config = manifest.get("server", {})
        if "type" not in server_config:
            raise ValueError("Server configuration missing 'type' field")
        if "mcp_config" not in server_config:
            raise ValueError("Server configuration missing 'mcp_config' field")

    def extract_to_temp(self) -> str:
        """Extract the DXT file to a temporary directory.

        Returns:
            Path to the temporary directory containing extracted files
        """
        temp_dir = tempfile.mkdtemp(prefix="mcp_dxt_")
        logger.debug(f"Extracting DXT to temporary directory: {temp_dir}")

        try:
            with zipfile.ZipFile(self.dxt_path, "r") as dxt_zip:
                dxt_zip.extractall(temp_dir)
            return temp_dir
        except Exception as e:
            # Clean up on failure
            import shutil

            shutil.rmtree(temp_dir, ignore_errors=True)
            raise e

    def to_mcp_config(self) -> dict[str, Any]:
        """Convert DXT manifest to MCP-Use configuration format.

        Returns:
            Configuration dictionary compatible with MCPClient

        Raises:
            ValueError: If conversion fails
        """
        manifest = self.load_manifest()
        temp_dir = self.extract_to_temp()

        try:
            # Get the MCP configuration from manifest
            mcp_config = manifest["server"]["mcp_config"].copy()

            # Process command and args based on server type
            server_type = manifest["server"]["type"]

            if server_type == "node":
                # For Node.js servers, update paths to extracted location
                if "args" in mcp_config:
                    # Replace ${__dirname} with actual temp directory
                    args = []
                    for arg in mcp_config["args"]:
                        if "${__dirname}" in arg:
                            arg = arg.replace("${__dirname}", temp_dir)
                        args.append(arg)
                    mcp_config["args"] = args

            elif server_type == "python":
                # Similar handling for Python servers
                if "args" in mcp_config:
                    args = []
                    for arg in mcp_config["args"]:
                        if "${__dirname}" in arg:
                            arg = arg.replace("${__dirname}", temp_dir)
                        args.append(arg)
                    mcp_config["args"] = args

            elif server_type == "binary":
                # For binary servers, update the command path
                if "command" in mcp_config and "${__dirname}" in mcp_config["command"]:
                    mcp_config["command"] = mcp_config["command"].replace("${__dirname}", temp_dir)

            # Create the full configuration
            config = {
                "mcpServers": {
                    manifest["name"]: mcp_config,
                }
            }

            # Add metadata for reference
            config["_dxt_metadata"] = {
                "name": manifest["name"],
                "version": manifest["version"],
                "description": manifest.get("description", ""),
                "temp_dir": temp_dir,
            }

            logger.info(f"Successfully loaded DXT: {manifest['name']} v{manifest['version']}")
            return config

        except Exception as e:
            # Clean up temporary directory on failure
            import shutil

            shutil.rmtree(temp_dir, ignore_errors=True)
            raise e


def load_dxt_file(filepath: str) -> dict[str, Any]:
    """Load a DXT file and convert it to MCP configuration.

    Args:
        filepath: Path to the .dxt file

    Returns:
        Configuration dictionary compatible with MCPClient

    Raises:
        FileNotFoundError: If the file doesn't exist
        ValueError: If the file is invalid or conversion fails
    """
    loader = DXTLoader(filepath)
    return loader.to_mcp_config()
