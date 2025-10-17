# mcp_use/connectors/http.py
from typing_extensions import deprecated

from mcp_use.client.connectors.http import HttpConnector as _HttpConnector


@deprecated("Use mcp_use.client.connectors.http.HttpConnector")
class HttpConnector(_HttpConnector): ...
