"""
Quick test to demonstrate observability logging in mcp-use

This script shows how to enable logging to see observability configuration messages.
Run this to verify that the observability system is working correctly.

Usage:
    python examples/observability/quick_logging_test.py
"""

import logging
from unittest.mock import Mock

from mcp_use import LangfuseObservabilityConfig, MCPAgent


def setup_observability_logging():
    """Configure logging to see observability debug messages."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

    # Enable INFO level for mcp_use observability modules
    logging.getLogger("mcp_use.agents.mcpagent").setLevel(logging.INFO)
    logging.getLogger("mcp_use.observability").setLevel(logging.INFO)

    # Reduce noise from other libraries
    for lib in ["httpx", "langchain", "openai", "urllib3", "asyncio"]:
        logging.getLogger(lib).setLevel(logging.WARNING)


def test_observability_logging():
    """Test observability configuration logging."""
    print("🧪 Testing Observability Configuration Logging")
    print("=" * 60)
    print()

    # Setup logging
    setup_observability_logging()

    # Create observability configuration
    observability_config = {
        "langfuse": LangfuseObservabilityConfig(
            enabled=True,
            trace_level="detailed",
            capture_tool_inputs=True,
            capture_tool_outputs=True,
            capture_context=True,
            filter_sensitive_data=True,
            session_id="demo_session_123",
            user_id="demo_user",
            metadata={"environment": "development", "test_type": "logging_demo"},
        )
    }

    print("🔧 Creating MCPAgent with observability configuration...")
    print("   Look for observability messages in the logs below:")
    print()

    # Create mock objects
    mock_client = Mock()
    mock_llm = Mock()

    # Create agent with observability
    agent = MCPAgent(llm=mock_llm, client=mock_client, observability=observability_config, verbose=True)

    print()
    print("✅ MCPAgent created successfully!")
    print()

    # Test callback retrieval
    print("📊 Testing callback retrieval...")
    callbacks = agent.observability_manager.get_callbacks()

    print(f"🔍 Found {len(callbacks)} observability callback(s)")

    if callbacks:
        print("   Active callbacks:")
        for i, callback in enumerate(callbacks):
            print(f"   - Callback {i+1}: {type(callback).__name__}")
    else:
        print("   ℹ️  No callbacks returned (expected if Langfuse package not installed)")
        print("   ℹ️  To get actual callbacks, install: pip install langfuse")
        print("   ℹ️  And set environment variables: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY")

    print()
    print("🎯 WHAT TO LOOK FOR IN THE LOGS:")
    print("   ✅ '🔧 Configuring Langfuse observability' - Shows config is being applied")
    print("   ✅ '✅ Langfuse client initialized successfully' - Shows trace level")
    print("   ✅ '🔍 Observability enabled' - Shows callbacks are being used (when agent runs)")
    print()
    print("📋 This confirms the observability system is working correctly!")


if __name__ == "__main__":
    test_observability_logging()
