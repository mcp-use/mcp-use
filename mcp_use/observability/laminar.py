"""
Laminar observability integration for MCP-use.

This module provides automatic instrumentation and optional callback handler
for Laminar AI observability platform.
"""

import logging
import os

logger = logging.getLogger(__name__)

# Check if Laminar is disabled via environment variable
_laminar_disabled = os.getenv("MCP_USE_LAMINAR", "").lower() == "false"

# Track if Laminar is initialized for other modules to check
laminar_initialized = False
laminar_handler = None  # Initialize to None by default

# Only initialize if not disabled and API key is present
if _laminar_disabled:
    logger.debug("Laminar tracing disabled via MCP_USE_LAMINAR environment variable")
elif not os.getenv("LAMINAR_PROJECT_API_KEY"):
    logger.debug("Laminar API key not found - tracing disabled. Set LAMINAR_PROJECT_API_KEY to enable")
else:
    try:
        from lmnr import Instruments, Laminar
        from opentelemetry import trace
        from opentelemetry.sdk.trace import SpanProcessor

        # Create a custom span processor that logs when spans are created
        class LoggingSpanProcessor(SpanProcessor):
            """Custom span processor that logs when LangChain operations are traced."""

            def on_start(self, span, parent_context=None):
                """Called when a span is started."""
                span_name = span.name

                # Log different types of operations
                if "langchain" in span_name.lower():
                    logger.debug(f"Laminar: Span attributes: {dict(span.attributes or {})}")
                elif "openai" in span_name.lower() or "chat" in span_name.lower():
                    logger.debug(f"Laminar: Span attributes: {dict(span.attributes or {})}")
                elif "tool" in span_name.lower():
                    logger.debug(f"Laminar: Span attributes: {dict(span.attributes or {})}")
                elif any(keyword in span_name.lower() for keyword in ["chain", "agent", "executor"]):
                    logger.debug(f"Laminar: Span attributes: {dict(span.attributes or {})}")

            def on_end(self, span):
                """Called when a span is ended."""
                pass  # We only care about logging when operations start

            def shutdown(self):
                """Called when the processor is being shut down."""
                pass

            def force_flush(self, timeout_millis=30000):
                """Forces a flush of any pending spans."""
                return True

        # Initialize Laminar with LangChain instrumentation
        logger.debug("Laminar: Initializing automatic instrumentation for LangChain")

        # Initialize with specific instruments
        instruments = {Instruments.LANGCHAIN, Instruments.OPENAI}
        logger.debug(f"Laminar: Enabling instruments: {[i.name for i in instruments]}")

        Laminar.initialize(project_api_key=os.getenv("LAMINAR_PROJECT_API_KEY"), instruments=instruments)

        # Add our custom logging span processor
        try:
            tracer_provider = trace.get_tracer_provider()
            if hasattr(tracer_provider, "add_span_processor"):
                logging_processor = LoggingSpanProcessor()
                tracer_provider.add_span_processor(logging_processor)
                logger.debug("Laminar: Added custom logging span processor")
        except Exception as e:
            logger.debug(f"Could not add custom span processor: {e}")

        laminar_initialized = True
        logger.debug("Laminar observability initialized successfully with LangChain instrumentation")

        # Create a simple LangChain callback handler for Laminar (optional, as auto-instrumentation handles most)
        try:
            from langchain_core.callbacks.base import BaseCallbackHandler

            class LaminarCallbackHandler(BaseCallbackHandler):
                """Simple LangChain callback handler for Laminar observability."""

                def __init__(self):
                    """Initialize the Laminar callback handler."""
                    super().__init__()
                    logger.debug("Laminar: Created custom LangChain callback handler")

                def on_llm_start(self, serialized, prompts, **kwargs):
                    """Log when an LLM starts."""
                    logger.debug(f"Laminar CallbackHandler: Prompts: {prompts[:100] if prompts else 'None'}...")

                def on_chain_start(self, serialized, inputs, **kwargs):
                    """Log when a chain starts."""
                    logger.debug(f"Laminar CallbackHandler: Inputs: {str(inputs)[:100] if inputs else 'None'}...")

                def on_tool_start(self, serialized, input_str, **kwargs):
                    """Log when a tool starts."""
                    logger.debug(f"Laminar CallbackHandler: Tool input: {input_str[:100] if input_str else 'None'}...")

                def on_agent_action(self, action, **kwargs):
                    """Log when an agent takes an action."""
                    logger.debug(f"Laminar CallbackHandler: Action: {str(action)[:100]}...")

            # Export the handler for use in MCPAgent
            laminar_handler = LaminarCallbackHandler()
            logger.debug("Laminar: Custom callback handler created and ready for use")

        except Exception as e:
            logger.debug(f"Could not create Laminar callback handler: {e}")
            laminar_handler = None

    except ImportError:
        logger.debug("Laminar package not installed - tracing disabled. Install with: pip install lmnr")
        laminar_handler = None
    except Exception as e:
        logger.error(f"Failed to initialize Laminar: {e}")
        laminar_handler = None
