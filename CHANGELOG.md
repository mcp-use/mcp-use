# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Support for Anthropic's DXT (Desktop Extension) format (#162)
  - New `DXTLoader` class for parsing and extracting DXT files
  - `MCPClient.from_dxt()` method for explicit DXT loading
  - Automatic DXT detection in `MCPClient.from_config_file()` based on file extension
  - Full support for Node.js, Python, and binary MCP servers packaged as DXT
  - Automatic extraction to temporary directory with proper cleanup
  - Support for `${__dirname}` variable substitution in DXT manifests
  - Comprehensive unit tests for DXT functionality
  - Example code demonstrating DXT usage
  - Documentation updates in README

### Changed
- `load_config_file()` now automatically detects and handles .dxt files
- `MCPClient.from_config_file()` documentation updated to mention DXT support

### Technical Details
- DXT files are zip archives containing a manifest.json and server files
- The manifest is validated for required fields (dxt_version, name, version, server)
- Server configurations are automatically converted to MCP-Use format
- Temporary extraction directories are cleaned up on failure or when no longer needed