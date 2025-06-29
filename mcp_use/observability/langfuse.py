import logging
import os

logger = logging.getLogger(__name__)

# Check if Langfuse is disabled via environment variable
_langfuse_disabled = os.getenv("MCP_USE_LANGFUSE", "").lower() == "false"

# Only initialize if not disabled and required keys are present
if _langfuse_disabled:
    logger.debug("Langfuse tracing disabled via MCP_USE_LANGFUSE environment variable")
    langfuse = None
    langfuse_handler = None
elif not os.getenv("LANGFUSE_PUBLIC_KEY") or not os.getenv("LANGFUSE_SECRET_KEY"):
    logger.debug(
        "Langfuse API keys not found - tracing disabled. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to enable"
    )
    langfuse = None
    langfuse_handler = None
else:
    try:
        from langfuse import Langfuse
        from langfuse.langchain import CallbackHandler

        langfuse = Langfuse(
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
            host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
        langfuse_handler = CallbackHandler()
        logger.debug("Langfuse observability initialized successfully")
    except ImportError:
        logger.debug("Langfuse package not installed - tracing disabled. Install with: pip install langfuse")
        langfuse = None
        langfuse_handler = None
