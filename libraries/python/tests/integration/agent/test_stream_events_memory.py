"""
Integration test for stream_events memory functionality.

Tests that stream_events properly stores AI messages in conversation history.
"""

import sys
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.logging import logger


@pytest.mark.asyncio
@pytest.mark.integration
async def test_stream_events_keeps_ai_messages_in_memory():
    """Test that stream_events properly stores AI messages in conversation history."""
    server_path = Path(__file__).parent.parent / "servers_for_testing" / "simple_server.py"

    config = {
        "mcpServers": {
            "simple": {
                "command": sys.executable,
                "args": [str(server_path), "--transport", "stdio"]
            }
        }
    }

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    agent = MCPAgent(llm=llm, client=client, max_steps=5, memory_enabled=True)

    try:
        # First query
        logger.info("\n" + "=" * 80)
        logger.info("TEST: First query - Add 2 and 2")
        logger.info("=" * 80)
        
        first_response_chunks = []
        async for event in agent.stream_events("Add 2 and 2 using the add tool"):
            if event.get("event") == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content"):
                    first_response_chunks.append(chunk.content)
        
        first_response = "".join(first_response_chunks)
        logger.info(f"First response: {first_response[:100]}")
        
        # Check conversation history after first query
        logger.info(f"\nConversation history length: {len(agent._conversation_history)}")
        for i, msg in enumerate(agent._conversation_history):
            content = msg.content[:50] if hasattr(msg, 'content') else str(msg)
            logger.info(f"  {i}: {type(msg).__name__}: {content}")
        
        # Assert we have at least 2 messages (1 human + 1 AI)
        assert len(agent._conversation_history) >= 2, \
            f"Expected at least 2 messages after first query, got {len(agent._conversation_history)}"
        
        # Check message types
        assert isinstance(agent._conversation_history[0], HumanMessage), \
            "First message should be HumanMessage"
        assert isinstance(agent._conversation_history[-1], AIMessage), \
            "Last message should be AIMessage"
        
        # Check that AI message has content
        assert len(agent._conversation_history[-1].content) > 0, \
            "AI message should have content"
        
        # Second query - should maintain context
        logger.info("\n" + "=" * 80)
        logger.info("TEST: Second query - What was my previous question")
        logger.info("=" * 80)
        
        second_response_chunks = []
        async for event in agent.stream_events("What was my previous question?"):
            if event.get("event") == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content"):
                    second_response_chunks.append(chunk.content)
        
        second_response = "".join(second_response_chunks)
        logger.info(f"Second response: {second_response[:200]}")
        
        # Check conversation history after second query
        logger.info(f"\nConversation history length: {len(agent._conversation_history)}")
        for i, msg in enumerate(agent._conversation_history):
            content = msg.content[:50] if hasattr(msg, 'content') else str(msg)
            logger.info(f"  {i}: {type(msg).__name__}: {content}")
        
        # Assert we have at least 4 messages (2 human + 2 AI)
        assert len(agent._conversation_history) >= 4, \
            f"Expected at least 4 messages after second query, got {len(agent._conversation_history)}"
        
        # Verify message order and types
        messages = agent._conversation_history
        assert isinstance(messages[0], HumanMessage), "Message 0 should be HumanMessage"
        assert isinstance(messages[1], AIMessage), "Message 1 should be AIMessage"
        assert isinstance(messages[2], HumanMessage), "Message 2 should be HumanMessage"
        assert isinstance(messages[3], AIMessage), "Message 3 should be AIMessage"
        
        # Verify all AI messages have content
        for i, msg in enumerate(messages):
            if isinstance(msg, AIMessage):
                assert len(msg.content) > 0, f"AI message at index {i} should have content"
        
        logger.info("=" * 80 + "\n")
        logger.info("✅ Test passed: stream_events properly stores AI messages in memory")
        
    finally:
        await agent.close()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_stream_events_memory_disabled():
    """Test that stream_events respects memory_enabled=False."""
    server_path = Path(__file__).parent.parent / "servers_for_testing" / "simple_server.py"

    config = {
        "mcpServers": {
            "simple": {
                "command": sys.executable,
                "args": [str(server_path), "--transport", "stdio"]
            }
        }
    }

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    agent = MCPAgent(llm=llm, client=client, max_steps=5, memory_enabled=False)

    try:
        # First query
        async for event in agent.stream_events("Add 2 and 2 using the add tool"):
            pass
        
        # With memory disabled, history should be empty
        assert len(agent._conversation_history) == 0, \
            f"Expected empty history with memory_enabled=False, got {len(agent._conversation_history)}"
        
        logger.info("✅ Test passed: stream_events respects memory_enabled=False")
        
    finally:
        await agent.close()
