import logging
import os

logger = logging.getLogger(__name__)

# Check if Laminar is disabled via environment variable
_laminar_disabled = os.getenv("MCP_USE_LAMINAR", "").lower() == "false"

# Only initialize if not disabled and API key is present
if _laminar_disabled:
    logger.debug("Laminar tracing disabled via MCP_USE_LAMINAR environment variable")
elif not os.getenv("LAMINAR_PROJECT_API_KEY"):
    logger.debug("Laminar API key not found - tracing disabled. Set LAMINAR_PROJECT_API_KEY to enable")
else:
    try:
        from lmnr import Laminar

        Laminar.initialize(project_api_key=os.getenv("LAMINAR_PROJECT_API_KEY"))
        logger.debug("Laminar observability initialized successfully")
    except ImportError:
        logger.debug("Laminar package not installed - tracing disabled. Install with: pip install lmnr")
