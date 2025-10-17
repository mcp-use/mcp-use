# mcp_use/connectors/base.py
from typing_extensions import deprecated

from mcp_use.client.connectors.base import BaseConnector as _BaseConnector


@deprecated("Use mcp_use.client.connectors.base.BaseConnector")
class BaseConnector(_BaseConnector): ...
