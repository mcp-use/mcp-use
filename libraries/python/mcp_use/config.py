# mcp_use/config.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.config import (
    create_connector_from_config as _create_connector_from_config,
)
from mcp_use.client.config import (
    load_config_file as _load_config_file,
)

warnings.warn(
    "mcp_use.config is deprecated. Use mcp_use.client.config. This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.config.load_config_file")
def load_config_file(*args, **kwargs):
    return _load_config_file(*args, **kwargs)


@deprecated("Use mcp_use.client.config.create_connector_from_config")
def create_connector_from_config(*args, **kwargs):
    return _create_connector_from_config(*args, **kwargs)
