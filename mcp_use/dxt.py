"""
DXT (Desktop Extension) support for mcp-use.

This module provides functionality to load and parse .dxt files, which are
Anthropic's Desktop Extension format for packaging MCP servers.
"""

import json
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from mcp_use.logging import logger


class DXTError(Exception):
    """Base exception for DXT-related errors."""

    pass


class DXTManifestError(DXTError):
    """Exception raised for invalid DXT manifest files."""

    pass


class DXTConfigurationError(DXTError):
    """Exception raised for DXT configuration issues."""

    pass


class DXTParser:
    """Parser for DXT (Desktop Extension) files."""

    def __init__(self, dxt_path: str):
        """Initialize DXT parser.

        Args:
            dxt_path: Path to the .dxt file
        """
        self.dxt_path = Path(dxt_path)
        self.extract_dir: Path | None = None
        self.manifest: dict[str, Any] | None = None

        if not self.dxt_path.exists():
            raise DXTError(f"DXT file not found: {dxt_path}")

    def __enter__(self):
        """Context manager entry."""
        self.extract()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - cleanup temporary files."""
        self.cleanup()

    def extract(self) -> None:
        """Extract the DXT file to a temporary directory."""
        if self.extract_dir is not None:
            return  # Already extracted

        try:
            # Create temporary directory
            self.extract_dir = Path(tempfile.mkdtemp(prefix="dxt_"))

            # Extract zip file
            with zipfile.ZipFile(self.dxt_path, "r") as zip_ref:
                zip_ref.extractall(self.extract_dir)

            logger.debug(f"Extracted DXT file to: {self.extract_dir}")

            # Load and validate manifest
            self._load_manifest()

        except zipfile.BadZipFile as e:
            raise DXTError(f"Invalid DXT file (not a valid zip): {self.dxt_path}") from e
        except Exception as e:
            self.cleanup()
            raise DXTError(f"Failed to extract DXT file: {e}") from e

    def _load_manifest(self) -> None:
        """Load and validate the manifest.json file."""
        if not self.extract_dir:
            raise DXTError("DXT file not extracted")

        manifest_path = self.extract_dir / "manifest.json"
        if not manifest_path.exists():
            raise DXTManifestError("manifest.json not found in DXT file")

        try:
            with open(manifest_path) as f:
                self.manifest = json.load(f)
        except json.JSONDecodeError as e:
            raise DXTManifestError(f"Invalid manifest.json: {e}") from e

        # Validate required fields
        self._validate_manifest()

    def _validate_manifest(self) -> None:
        """Validate the manifest structure."""
        if not self.manifest:
            raise DXTManifestError("Manifest not loaded")

        required_fields = ["dxt_version", "name", "author", "server"]
        for field in required_fields:
            if field not in self.manifest:
                raise DXTManifestError(f"Missing required field in manifest: {field}")

        # Validate server configuration
        server_config = self.manifest["server"]
        if "mcp_config" not in server_config:
            raise DXTManifestError("Missing 'mcp_config' in server configuration")

        mcp_config = server_config["mcp_config"]
        if "command" not in mcp_config:
            raise DXTManifestError("Missing 'command' in mcp_config")

    def get_server_name(self) -> str:
        """Get the server name from the manifest."""
        if not self.manifest:
            raise DXTError("Manifest not loaded")
        return self.manifest["name"]

    def get_mcp_config(self, user_config: dict[str, Any] | None = None) -> dict[str, Any]:
        """Convert DXT manifest to mcp-use server configuration.

        Args:
            user_config: User-provided configuration values

        Returns:
            Server configuration compatible with mcp-use
        """
        if not self.manifest or not self.extract_dir:
            raise DXTError("DXT file not properly loaded")

        server_config = self.manifest["server"]
        mcp_config = server_config["mcp_config"].copy()

        # Process template variables
        mcp_config = self._process_templates(mcp_config, user_config or {})

        return mcp_config

    def _process_templates(self, config: Any, user_config: dict[str, Any]) -> Any:
        """Process template variables in the configuration.

        Args:
            config: Configuration object to process
            user_config: User-provided configuration values

        Returns:
            Processed configuration with templates resolved
        """
        if isinstance(config, dict):
            return {key: self._process_templates(value, user_config) for key, value in config.items()}
        elif isinstance(config, list):
            return [self._process_templates(item, user_config) for item in config]
        elif isinstance(config, str):
            return self._substitute_variables(config, user_config)
        else:
            return config

    def _substitute_variables(self, value: str, user_config: dict[str, Any]) -> str:
        """Substitute template variables in a string value.

        Args:
            value: String value that may contain template variables
            user_config: User-provided configuration values

        Returns:
            String with variables substituted
        """
        # Handle ${__dirname} - replace with extraction directory
        if "${__dirname}" in value:
            value = value.replace("${__dirname}", str(self.extract_dir))

        # Handle ${user_config.key} variables
        import re

        pattern = r"\$\{user_config\.([^}]+)\}"
        matches = re.findall(pattern, value)

        for match in matches:
            if match in user_config:
                value = value.replace(f"${{user_config.{match}}}", str(user_config[match]))
            else:
                # Check if this is a required config
                manifest_user_config = self.manifest.get("user_config", {})
                if match in manifest_user_config and manifest_user_config[match].get("required", False):
                    raise DXTConfigurationError(f"Required user configuration missing: {match}")

        # Handle environment variables like ${HOME}, ${TEMP}, etc.
        env_pattern = r"\$\{([A-Z_][A-Z0-9_]*)\}"
        env_matches = re.findall(env_pattern, value)

        for env_var in env_matches:
            if env_var in os.environ:
                value = value.replace(f"${{{env_var}}}", os.environ[env_var])

        return value

    def get_user_config_schema(self) -> dict[str, Any]:
        """Get the user configuration schema from the manifest.

        Returns:
            User configuration schema or empty dict if none defined
        """
        if not self.manifest:
            raise DXTError("Manifest not loaded")
        return self.manifest.get("user_config", {})

    def cleanup(self) -> None:
        """Clean up temporary files."""
        if self.extract_dir and self.extract_dir.exists():
            import shutil

            shutil.rmtree(self.extract_dir, ignore_errors=True)
            logger.debug(f"Cleaned up temporary directory: {self.extract_dir}")
            self.extract_dir = None


def load_dxt_config(dxt_path: str, user_config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Load DXT file and convert to mcp-use configuration format.

    Args:
        dxt_path: Path to the .dxt file
        user_config: Optional user configuration values

    Returns:
        Configuration dictionary compatible with mcp-use

    Raises:
        DXTError: If the DXT file cannot be processed
    """
    with DXTParser(dxt_path) as parser:
        server_name = parser.get_server_name()
        server_config = parser.get_mcp_config(user_config)

        return {"mcpServers": {server_name: server_config}}


def validate_user_config(dxt_path: str, user_config: dict[str, Any]) -> None:
    """Validate user configuration against DXT manifest requirements.

    Args:
        dxt_path: Path to the .dxt file
        user_config: User configuration to validate

    Raises:
        DXTConfigurationError: If required configuration is missing
    """
    with DXTParser(dxt_path) as parser:
        schema = parser.get_user_config_schema()

        for key, config_def in schema.items():
            if config_def.get("required", False) and key not in user_config:
                title = config_def.get("title", key)
                raise DXTConfigurationError(f"Required configuration missing: {title} ({key})")
