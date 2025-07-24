"""
Unit tests for DXT (Desktop Extension) functionality.
"""

import json
import tempfile
import zipfile
from pathlib import Path

import pytest

from mcp_use.dxt import (
    DXTConfigurationError,
    DXTError,
    DXTManifestError,
    DXTParser,
    load_dxt_config,
    validate_user_config,
)


@pytest.fixture
def sample_manifest():
    """Sample valid DXT manifest."""
    return {
        "dxt_version": "0.1",
        "name": "test-extension",
        "version": "1.0.0",
        "description": "A test extension",
        "author": {"name": "Test Author"},
        "server": {
            "type": "node",
            "entry_point": "server/index.js",
            "mcp_config": {
                "command": "node",
                "args": ["${__dirname}/server/index.js"],
                "env": {
                    "API_KEY": "${user_config.api_key}"
                }
            }
        },
        "user_config": {
            "api_key": {
                "type": "string",
                "title": "API Key",
                "description": "Your API key",
                "required": True
            }
        }
    }


@pytest.fixture
def create_dxt_file():
    """Factory to create temporary DXT files for testing."""
    def _create_dxt_file(manifest_data, include_server_file=True):
        # Create temporary directory
        temp_dir = Path(tempfile.mkdtemp())
        dxt_path = temp_dir / "test.dxt"
        
        # Create zip file
        with zipfile.ZipFile(dxt_path, 'w') as zip_file:
            # Add manifest
            zip_file.writestr("manifest.json", json.dumps(manifest_data))
            
            # Add server file if requested
            if include_server_file:
                zip_file.writestr("server/index.js", "// Test server file\nconsole.log('Hello from server');")
        
        return dxt_path
    
    return _create_dxt_file


class TestDXTParser:
    """Test DXTParser functionality."""

    def test_init_with_nonexistent_file(self):
        """Test initialization with non-existent file."""
        with pytest.raises(DXTError, match="DXT file not found"):
            DXTParser("nonexistent.dxt")

    def test_valid_dxt_file(self, sample_manifest, create_dxt_file):
        """Test parsing a valid DXT file."""
        dxt_path = create_dxt_file(sample_manifest)
        
        with DXTParser(str(dxt_path)) as parser:
            assert parser.get_server_name() == "test-extension"
            assert parser.manifest["dxt_version"] == "0.1"
            assert parser.manifest["author"]["name"] == "Test Author"

    def test_missing_manifest(self, create_dxt_file):
        """Test DXT file without manifest.json."""
        # Create DXT without manifest
        temp_dir = Path(tempfile.mkdtemp())
        dxt_path = temp_dir / "test.dxt"
        
        with zipfile.ZipFile(dxt_path, 'w') as zip_file:
            zip_file.writestr("server/index.js", "// Test server file")
        
        with pytest.raises(DXTManifestError, match="manifest.json not found"):
            with DXTParser(str(dxt_path)) as parser:
                pass

    def test_invalid_manifest_json(self, create_dxt_file):
        """Test DXT file with invalid JSON in manifest."""
        temp_dir = Path(tempfile.mkdtemp())
        dxt_path = temp_dir / "test.dxt"
        
        with zipfile.ZipFile(dxt_path, 'w') as zip_file:
            zip_file.writestr("manifest.json", "{ invalid json")
        
        with pytest.raises(DXTManifestError, match="Invalid manifest.json"):
            with DXTParser(str(dxt_path)) as parser:
                pass

    def test_missing_required_fields(self, create_dxt_file):
        """Test manifest missing required fields."""
        incomplete_manifest = {
            "dxt_version": "0.1",
            "name": "test-extension"
            # Missing author and server fields
        }
        dxt_path = create_dxt_file(incomplete_manifest)
        
        with pytest.raises(DXTManifestError, match="Missing required field"):
            with DXTParser(str(dxt_path)) as parser:
                pass

    def test_template_substitution(self, sample_manifest, create_dxt_file):
        """Test template variable substitution."""
        dxt_path = create_dxt_file(sample_manifest)
        user_config = {"api_key": "test_key_123"}
        
        with DXTParser(str(dxt_path)) as parser:
            mcp_config = parser.get_mcp_config(user_config)
            
            # Check that ${__dirname} was replaced
            assert "${__dirname}" not in str(mcp_config["args"])
            assert str(parser.extract_dir) in mcp_config["args"][0]
            
            # Check that user config was substituted
            assert mcp_config["env"]["API_KEY"] == "test_key_123"

    def test_missing_required_user_config(self, sample_manifest, create_dxt_file):
        """Test error when required user config is missing."""
        dxt_path = create_dxt_file(sample_manifest)
        
        with pytest.raises(DXTConfigurationError, match="Required user configuration missing"):
            with DXTParser(str(dxt_path)) as parser:
                parser.get_mcp_config({})  # Empty user config

    def test_user_config_schema(self, sample_manifest, create_dxt_file):
        """Test getting user config schema."""
        dxt_path = create_dxt_file(sample_manifest)
        
        with DXTParser(str(dxt_path)) as parser:
            schema = parser.get_user_config_schema()
            
            assert "api_key" in schema
            assert schema["api_key"]["required"] is True
            assert schema["api_key"]["title"] == "API Key"

    def test_context_manager_cleanup(self, sample_manifest, create_dxt_file):
        """Test that context manager properly cleans up."""
        dxt_path = create_dxt_file(sample_manifest)
        
        with DXTParser(str(dxt_path)) as parser:
            extract_dir = parser.extract_dir
            assert extract_dir.exists()
        
        # After context manager, directory should be cleaned up
        assert not extract_dir.exists()


class TestDXTFunctions:
    """Test module-level DXT functions."""

    def test_load_dxt_config(self, sample_manifest, create_dxt_file):
        """Test load_dxt_config function."""
        dxt_path = create_dxt_file(sample_manifest)
        user_config = {"api_key": "test_key"}
        
        config = load_dxt_config(str(dxt_path), user_config)
        
        assert "mcpServers" in config
        assert "test-extension" in config["mcpServers"]
        
        server_config = config["mcpServers"]["test-extension"]
        assert server_config["command"] == "node"
        assert server_config["env"]["API_KEY"] == "test_key"

    def test_validate_user_config_success(self, sample_manifest, create_dxt_file):
        """Test successful user config validation."""
        dxt_path = create_dxt_file(sample_manifest)
        user_config = {"api_key": "valid_key"}
        
        # Should not raise an exception
        validate_user_config(str(dxt_path), user_config)

    def test_validate_user_config_missing_required(self, sample_manifest, create_dxt_file):
        """Test user config validation with missing required field."""
        dxt_path = create_dxt_file(sample_manifest)
        user_config = {}  # Missing required api_key
        
        with pytest.raises(DXTConfigurationError, match="Required configuration missing"):
            validate_user_config(str(dxt_path), user_config)

    def test_load_dxt_config_no_user_config_required(self, create_dxt_file):
        """Test loading DXT with no user config requirements."""
        manifest = {
            "dxt_version": "0.1",
            "name": "simple-extension",
            "author": {"name": "Test Author"},
            "server": {
                "type": "node",
                "mcp_config": {
                    "command": "node",
                    "args": ["${__dirname}/server/index.js"]
                }
            }
        }
        dxt_path = create_dxt_file(manifest)
        
        config = load_dxt_config(str(dxt_path))
        
        assert "mcpServers" in config
        assert "simple-extension" in config["mcpServers"]

    def test_environment_variable_substitution(self, create_dxt_file, monkeypatch):
        """Test environment variable substitution."""
        manifest = {
            "dxt_version": "0.1",
            "name": "env-extension",
            "author": {"name": "Test Author"},
            "server": {
                "type": "node",
                "mcp_config": {
                    "command": "node",
                    "args": ["${__dirname}/server/index.js"],
                    "env": {
                        "HOME_DIR": "${HOME}",
                        "TEMP_DIR": "${TMPDIR}"
                    }
                }
            }
        }
        
        # Set environment variables for testing
        monkeypatch.setenv("HOME", "/home/test")
        monkeypatch.setenv("TMPDIR", "/tmp/test")
        
        dxt_path = create_dxt_file(manifest)
        
        config = load_dxt_config(str(dxt_path))
        server_config = config["mcpServers"]["env-extension"]
        
        assert server_config["env"]["HOME_DIR"] == "/home/test"
        assert server_config["env"]["TEMP_DIR"] == "/tmp/test"


class TestDXTErrors:
    """Test DXT error handling."""

    def test_invalid_zip_file(self, create_dxt_file):
        """Test handling of invalid zip files."""
        # Create a file that's not a valid zip
        temp_dir = Path(tempfile.mkdtemp())
        dxt_path = temp_dir / "invalid.dxt"
        dxt_path.write_text("This is not a zip file")
        
        with pytest.raises(DXTError, match="Invalid DXT file"):
            with DXTParser(str(dxt_path)) as parser:
                pass

    def test_server_config_missing_mcp_config(self, create_dxt_file):
        """Test manifest with server missing mcp_config."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-extension",
            "author": {"name": "Test Author"},
            "server": {
                "type": "node",
                "entry_point": "server/index.js"
                # Missing mcp_config
            }
        }
        dxt_path = create_dxt_file(manifest)
        
        with pytest.raises(DXTManifestError, match="Missing 'mcp_config'"):
            with DXTParser(str(dxt_path)) as parser:
                pass

    def test_mcp_config_missing_command(self, create_dxt_file):
        """Test mcp_config missing command field."""
        manifest = {
            "dxt_version": "0.1",
            "name": "test-extension",
            "author": {"name": "Test Author"},
            "server": {
                "type": "node",
                "mcp_config": {
                    "args": ["index.js"]
                    # Missing command
                }
            }
        }
        dxt_path = create_dxt_file(manifest)
        
        with pytest.raises(DXTManifestError, match="Missing 'command'"):
            with DXTParser(str(dxt_path)) as parser:
                pass 