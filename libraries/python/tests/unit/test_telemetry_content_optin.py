"""
Unit tests for telemetry content opt-in.

By default the agent-execution event must NOT carry raw prompt/response text —
only the derived *_length fields. Setting MCP_USE_TELEMETRY_INCLUDE_CONTENT=true
opts back in to sending the raw content.
"""

import os
import unittest
from unittest.mock import patch

from mcp_use.telemetry.events import MCPAgentExecutionEvent
from mcp_use.telemetry.telemetry import Telemetry


class TestTelemetryContentOptIn(unittest.TestCase):
    def _capture_event(self, include_content: bool) -> MCPAgentExecutionEvent:
        # Telemetry is a closure-based singleton, so drive the instance directly
        # rather than reconstructing it. Force a client present so the
        # requires_telemetry guard doesn't short-circuit capture().
        telemetry = Telemetry()
        telemetry._posthog_client = object()
        telemetry._include_content = include_content

        captured: dict[str, MCPAgentExecutionEvent] = {}

        def fake_capture(event, provider="posthog"):
            captured["event"] = event

        with patch.object(telemetry, "capture", side_effect=fake_capture):
            telemetry.track_agent_execution(
                execution_method="run",
                query="my secret prompt",
                success=True,
                model_provider="openai",
                model_name="gpt-x",
                server_count=1,
                server_identifiers=[],
                total_tools_available=0,
                tools_available_names=[],
                max_steps_configured=5,
                memory_enabled=False,
                use_server_manager=False,
                max_steps_used=1,
                manage_connector=False,
                external_history_used=False,
                response="my secret response",
            )
        return captured["event"]

    def test_content_redacted_by_default(self):
        event = self._capture_event(include_content=False)

        self.assertIsNone(event.query)
        self.assertIsNone(event.response)
        # Lengths are still derived from the real content.
        self.assertEqual(event.query_length, len("my secret prompt"))
        self.assertEqual(event.response_length, len("my secret response"))

    def test_content_included_when_opted_in(self):
        event = self._capture_event(include_content=True)

        self.assertEqual(event.query, "my secret prompt")
        self.assertEqual(event.response, "my secret response")
        self.assertEqual(event.query_length, len("my secret prompt"))
        self.assertEqual(event.response_length, len("my secret response"))

    def test_default_env_disables_content(self):
        # With the env var unset, a freshly-parsed flag must be False.
        with patch.dict(os.environ, {}, clear=True):
            flag = os.getenv("MCP_USE_TELEMETRY_INCLUDE_CONTENT", "false").lower() == "true"
        self.assertFalse(flag)


if __name__ == "__main__":
    unittest.main()
