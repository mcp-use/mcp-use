"""
Laminar observability integration for MCP-use.

This module provides automatic instrumentation for Laminar AI observability platform.
"""

import logging
import os

logger = logging.getLogger(__name__)

# Check if Laminar is disabled via environment variable
_laminar_disabled = os.getenv("MCP_USE_LAMINAR", "").lower() == "false"

# Track if Laminar is initialized for other modules to check
laminar_initialized = False

# Only initialize if not disabled and API key is present
if _laminar_disabled:
    logger.debug("Laminar tracing disabled via MCP_USE_LAMINAR environment variable")
elif not os.getenv("LAMINAR_PROJECT_API_KEY"):
    logger.debug("Laminar API key not found - tracing disabled. Set LAMINAR_PROJECT_API_KEY to enable")
else:
    try:
        from lmnr import Instruments, Laminar

        # Initialize Laminar with LangChain instrumentation
        logger.debug("Laminar: Initializing automatic instrumentation for LangChain")

        # Initialize with specific instruments
        instruments = {Instruments.LANGCHAIN, Instruments.OPENAI}
        logger.debug(f"Laminar: Enabling instruments: {[i.name for i in instruments]}")

        Laminar.initialize(project_api_key=os.getenv("LAMINAR_PROJECT_API_KEY"), instruments=instruments)

        laminar_initialized = True
        logger.debug("Laminar observability initialized successfully with LangChain instrumentation")

    except ImportError:
        logger.debug("Laminar package not installed - tracing disabled. Install with: pip install lmnr")
    except Exception as e:
        logger.error(f"Failed to initialize Laminar: {e}")
