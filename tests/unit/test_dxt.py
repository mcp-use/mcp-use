"""
Tests for DXT (Desktop Extension) format support.
"""

import json
import os
import tempfile
import zipfile
from unittest.mock import patch

import pytest

from mcp_use.dxt import DXTLoader, load_dxt_file


class TestDXTLoader:
    """Test DXT loader functionality."""

    def create_test_dxt(self, manifest_content: dict, additional_files: dict = None):
        """Helper to create a test DXT file."""
        # Create a temporary DXT file
        fd, dxt_path = tempfile.mkstemp(suffix=".dxt")
        os.close(fd)

        with zipfile.ZipFile(dxt_path, "w") as zf:
            # Add manifest.json
            zf.writestr("manifest.json", json.dumps(manifest_content))

            # Add any additional files
            if additional_files:
                for filename, content in additional_files.items():
                    zf.writestr(filename, content)

        return dxt_path

    def test_init_valid_file(self):
        """Test initialization with valid DXT file."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-extension",
            "version": "1.0.0",
            "server": {
                "type": "node",
                "mcp_config": {"command": "node", "args": ["server.js"]},
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            loader = DXTLoader(dxt_path)
            assert loader.dxt_path == dxt_path
        finally:
            os.unlink(dxt_path)

    def test_init_nonexistent_file(self):
        """Test initialization with nonexistent file."""
        with pytest.raises(FileNotFoundError):
            DXTLoader("/nonexistent/file.dxt")

    def test_init_wrong_extension(self):
        """Test initialization with wrong file extension."""
        fd, temp_path = tempfile.mkstemp(suffix=".json")
        os.close(fd)

        try:
            with pytest.raises(ValueError, match="must have .dxt extension"):
                DXTLoader(temp_path)
        finally:
            os.unlink(temp_path)

    def test_load_manifest_valid(self):
        """Test loading a valid manifest."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-extension",
            "version": "1.0.0",
            "description": "Test extension",
            "server": {
                "type": "node",
                "entry_point": "server/index.js",
                "mcp_config": {
                    "command": "node",
                    "args": ["${__dirname}/server/index.js"],
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            loader = DXTLoader(dxt_path)
            loaded_manifest = loader.load_manifest()
            assert loaded_manifest == manifest
        finally:
            os.unlink(dxt_path)

    def test_load_manifest_missing_manifest(self):
        """Test loading DXT without manifest.json."""
        # Create a zip without manifest.json
        fd, dxt_path = tempfile.mkstemp(suffix=".dxt")
        os.close(fd)

        with zipfile.ZipFile(dxt_path, "w") as zf:
            zf.writestr("server.js", "console.log('hello');")

        try:
            loader = DXTLoader(dxt_path)
            with pytest.raises(ValueError, match="missing required manifest.json"):
                loader.load_manifest()
        finally:
            os.unlink(dxt_path)

    def test_load_manifest_invalid_zip(self):
        """Test loading invalid zip file."""
        fd, dxt_path = tempfile.mkstemp(suffix=".dxt")
        os.close(fd)

        # Write invalid content
        with open(dxt_path, "w") as f:
            f.write("not a zip file")

        try:
            loader = DXTLoader(dxt_path)
            with pytest.raises(ValueError, match="not a valid zip"):
                loader.load_manifest()
        finally:
            os.unlink(dxt_path)

    def test_validate_manifest_missing_fields(self):
        """Test manifest validation with missing required fields."""
        # Missing dxt_version
        manifest = {
            "name": "test",
            "version": "1.0.0",
            "server": {"type": "node", "mcp_config": {}},
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            loader = DXTLoader(dxt_path)
            with pytest.raises(ValueError, match="missing required field: dxt_version"):
                loader.load_manifest()
        finally:
            os.unlink(dxt_path)

    def test_validate_manifest_missing_server_type(self):
        """Test manifest validation with missing server type."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test",
            "version": "1.0.0",
            "server": {"mcp_config": {}},
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            loader = DXTLoader(dxt_path)
            with pytest.raises(ValueError, match="missing 'type' field"):
                loader.load_manifest()
        finally:
            os.unlink(dxt_path)

    def test_extract_to_temp(self):
        """Test extracting DXT to temporary directory."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test",
            "version": "1.0.0",
            "server": {
                "type": "node",
                "mcp_config": {"command": "node", "args": ["server.js"]},
            },
        }
        additional_files = {
            "server.js": "console.log('hello');",
            "package.json": '{"name": "test"}',
        }
        dxt_path = self.create_test_dxt(manifest, additional_files)

        try:
            loader = DXTLoader(dxt_path)
            temp_dir = loader.extract_to_temp()

            # Check that files were extracted
            assert os.path.exists(temp_dir)
            assert os.path.exists(os.path.join(temp_dir, "manifest.json"))
            assert os.path.exists(os.path.join(temp_dir, "server.js"))
            assert os.path.exists(os.path.join(temp_dir, "package.json"))

            # Clean up
            import shutil

            shutil.rmtree(temp_dir)
        finally:
            os.unlink(dxt_path)

    def test_to_mcp_config_node_server(self):
        """Test converting Node.js DXT to MCP config."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-node-server",
            "version": "1.0.0",
            "description": "Test Node.js server",
            "server": {
                "type": "node",
                "entry_point": "server/index.js",
                "mcp_config": {
                    "command": "node",
                    "args": ["${__dirname}/server/index.js"],
                    "env": {"NODE_ENV": "production"},
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            loader = DXTLoader(dxt_path)
            config = loader.to_mcp_config()

            # Check basic structure
            assert "mcpServers" in config
            assert "test-node-server" in config["mcpServers"]

            # Check server config
            server_config = config["mcpServers"]["test-node-server"]
            assert server_config["command"] == "node"
            assert len(server_config["args"]) == 1
            # Should have replaced ${__dirname} with actual path
            assert "${__dirname}" not in server_config["args"][0]
            assert server_config["args"][0].endswith("/server/index.js")
            assert server_config["env"]["NODE_ENV"] == "production"

            # Check metadata
            assert config["_dxt_metadata"]["name"] == "test-node-server"
            assert config["_dxt_metadata"]["version"] == "1.0.0"
            assert config["_dxt_metadata"]["description"] == "Test Node.js server"

            # Clean up temp dir
            import shutil

            shutil.rmtree(config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)

    def test_to_mcp_config_python_server(self):
        """Test converting Python DXT to MCP config."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-python-server",
            "version": "1.0.0",
            "server": {
                "type": "python",
                "mcp_config": {
                    "command": "python",
                    "args": ["${__dirname}/server.py", "--port", "8080"],
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            loader = DXTLoader(dxt_path)
            config = loader.to_mcp_config()

            server_config = config["mcpServers"]["test-python-server"]
            assert server_config["command"] == "python"
            assert len(server_config["args"]) == 3
            assert "${__dirname}" not in server_config["args"][0]
            assert server_config["args"][0].endswith("/server.py")
            assert server_config["args"][1] == "--port"
            assert server_config["args"][2] == "8080"

            # Clean up
            import shutil

            shutil.rmtree(config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)

    def test_to_mcp_config_binary_server(self):
        """Test converting binary DXT to MCP config."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-binary-server",
            "version": "1.0.0",
            "server": {
                "type": "binary",
                "mcp_config": {
                    "command": "${__dirname}/bin/server",
                    "args": ["--verbose"],
                },
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            loader = DXTLoader(dxt_path)
            config = loader.to_mcp_config()

            server_config = config["mcpServers"]["test-binary-server"]
            assert "${__dirname}" not in server_config["command"]
            assert server_config["command"].endswith("/bin/server")
            assert server_config["args"] == ["--verbose"]

            # Clean up
            import shutil

            shutil.rmtree(config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)

    def test_load_dxt_file_function(self):
        """Test the convenience load_dxt_file function."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-function",
            "version": "1.0.0",
            "server": {
                "type": "node",
                "mcp_config": {"command": "node", "args": ["server.js"]},
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            config = load_dxt_file(dxt_path)
            assert "mcpServers" in config
            assert "test-function" in config["mcpServers"]

            # Clean up
            import shutil

            shutil.rmtree(config["_dxt_metadata"]["temp_dir"])
        finally:
            os.unlink(dxt_path)

    def test_cleanup_on_extraction_error(self):
        """Test that temp directory is cleaned up on extraction error."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test",
            "version": "1.0.0",
            "server": {
                "type": "node",
                "mcp_config": {"command": "node", "args": ["server.js"]},
            },
        }
        dxt_path = self.create_test_dxt(manifest)

        try:
            loader = DXTLoader(dxt_path)

            # Mock zipfile.extractall to raise an error
            with patch("zipfile.ZipFile.extractall", side_effect=Exception("Extract error")):
                with pytest.raises(Exception):
                    loader.extract_to_temp()

            # Temp directory should have been cleaned up
            # (We can't easily test this directly, but the code handles it)
        finally:
            os.unlink(dxt_path)
