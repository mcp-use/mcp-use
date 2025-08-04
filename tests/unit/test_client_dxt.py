"""
Tests for MCPClient DXT support.
"""

import json
import os
import tempfile
import zipfile
from unittest.mock import MagicMock, patch

import pytest

from mcp_use.client import MCPClient
from mcp_use.config import load_config_file


class TestMCPClientDXT:
    """Test MCPClient DXT functionality."""

    def create_test_dxt(self, manifest_content: dict):
        """Helper to create a test DXT file."""
        fd, dxt_path = tempfile.mkstemp(suffix=".dxt")
        os.close(fd)

        with zipfile.ZipFile(dxt_path, "w") as zf:
            zf.writestr("manifest.json", json.dumps(manifest_content))
            zf.writestr("server.js", "// Test server")

        return dxt_path

    def test_from_config_file_with_dxt(self):
        """Test creating MCPClient from DXT file using from_config_file."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-dxt-server",
            "version": "1.0.0",
            "server": {
                "type": "node",
                "mcp_config": {
                    "command": "node",
                    "args": ["${__dirname}/server.js"],
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            client = MCPClient.from_config_file(dxt_path)

            # Check that the server was loaded
            assert "mcpServers" in client.config
            assert "test-dxt-server" in client.config["mcpServers"]
            assert client.config["mcpServers"]["test-dxt-server"]["command"] == "node"

            # Clean up temp directory
            if "_dxt_metadata" in client.config:
                import shutil

                shutil.rmtree(client.config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)

    def test_from_dxt_method(self):
        """Test creating MCPClient using the dedicated from_dxt method."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-dxt-method",
            "version": "1.0.0",
            "server": {
                "type": "python",
                "mcp_config": {
                    "command": "python",
                    "args": ["${__dirname}/server.py"],
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            client = MCPClient.from_dxt(dxt_path)

            # Check configuration
            assert "mcpServers" in client.config
            assert "test-dxt-method" in client.config["mcpServers"]
            server_config = client.config["mcpServers"]["test-dxt-method"]
            assert server_config["command"] == "python"
            assert len(server_config["args"]) == 1
            assert "${__dirname}" not in server_config["args"][0]

            # Clean up
            if "_dxt_metadata" in client.config:
                import shutil

                shutil.rmtree(client.config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)

    def test_from_dxt_with_wrong_extension_warning(self):
        """Test that from_dxt warns when file doesn't have .dxt extension."""
        # Create a JSON file
        fd, json_path = tempfile.mkstemp(suffix=".json")
        os.close(fd)

        config = {"mcpServers": {"test": {"command": "test"}}}
        with open(json_path, "w") as f:
            json.dump(config, f)

        try:
            with pytest.warns(UserWarning, match="does not have .dxt extension"):
                client = MCPClient.from_dxt(json_path)
                assert client.config == config
        finally:
            os.unlink(json_path)

    def test_from_dxt_with_sandbox_options(self):
        """Test creating MCPClient from DXT with sandbox options."""
        manifest = {
            "dxt_version": "0.1",
            "name": "sandbox-test",
            "version": "1.0.0",
            "server": {
                "type": "node",
                "mcp_config": {
                    "command": "node",
                    "args": ["server.js"],
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            sandbox_options = {"api_key": "test-key"}
            client = MCPClient.from_dxt(dxt_path, sandbox=True, sandbox_options=sandbox_options)

            assert client.sandbox is True
            assert client.sandbox_options == sandbox_options

            # Clean up
            if "_dxt_metadata" in client.config:
                import shutil

                shutil.rmtree(client.config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)

    def test_load_config_file_with_dxt_extension(self):
        """Test that load_config_file correctly handles .dxt files."""
        manifest = {
            "dxt_version": "0.1",
            "name": "config-load-test",
            "version": "1.0.0",
            "server": {
                "type": "node",
                "mcp_config": {
                    "command": "node",
                    "args": ["server.js"],
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            config = load_config_file(dxt_path)

            assert "mcpServers" in config
            assert "config-load-test" in config["mcpServers"]
            assert "_dxt_metadata" in config

            # Clean up
            import shutil

            shutil.rmtree(config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)

    def test_load_config_file_with_json_extension(self):
        """Test that load_config_file still works with JSON files."""
        fd, json_path = tempfile.mkstemp(suffix=".json")
        os.close(fd)

        config = {"mcpServers": {"json-test": {"command": "test", "args": []}}}
        with open(json_path, "w") as f:
            json.dump(config, f)

        try:
            loaded_config = load_config_file(json_path)
            assert loaded_config == config
        finally:
            os.unlink(json_path)

    async def test_create_session_from_dxt(self):
        """Test creating a session from a DXT-loaded configuration."""
        manifest = {
            "dxt_version": "0.1",
            "name": "session-test",
            "version": "1.0.0",
            "server": {
                "type": "node",
                "mcp_config": {
                    "command": "echo",
                    "args": ["test"],
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            client = MCPClient.from_dxt(dxt_path)

            # Mock the session creation
            with patch("mcp_use.client.MCPSession") as mock_session_class:
                mock_session = MagicMock()
                mock_session.name = "session-test"
                mock_session_class.return_value = mock_session

                session = await client.create_session("session-test", auto_initialize=False)

                assert session is not None
                assert session.name == "session-test"
                mock_session_class.assert_called_once()

            # Clean up
            if "_dxt_metadata" in client.config:
                import shutil

                shutil.rmtree(client.config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)
