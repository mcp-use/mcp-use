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
        from langfuse.langchain import CallbackHandler as LangfuseCallbackHandler

        # Create a custom CallbackHandler wrapper to add logging
        class LoggingCallbackHandler(LangfuseCallbackHandler):
            """Custom Langfuse CallbackHandler that logs intercepted requests."""

            def on_llm_start(self, *args, **kwargs):
                """Log when an LLM request is intercepted."""
                logger.debug(f"Langfuse: LLM start args: {args}, kwargs: {kwargs}")
                return super().on_llm_start(*args, **kwargs)

            def on_chain_start(self, *args, **kwargs):
                """Log when a chain request is intercepted."""
                logger.debug(f"Langfuse: Chain start args: {args}, kwargs: {kwargs}")
                return super().on_chain_start(*args, **kwargs)

            def on_tool_start(self, *args, **kwargs):
                """Log when a tool request is intercepted."""
                logger.debug(f"Langfuse: Tool start args: {args}, kwargs: {kwargs}")
                return super().on_tool_start(*args, **kwargs)

            def on_retriever_start(self, *args, **kwargs):
                """Log when a retriever request is intercepted."""
                logger.debug(f"Langfuse: Retriever start args: {args}, kwargs: {kwargs}")
                return super().on_retriever_start(*args, **kwargs)

        langfuse = Langfuse(
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
            host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
        langfuse_handler = LoggingCallbackHandler()
        logger.debug("Langfuse observability initialized successfully with logging enabled")
    except ImportError:
        logger.debug("Langfuse package not installed - tracing disabled. Install with: pip install langfuse")
        langfuse = None
        langfuse_handler = None
