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
    def _capture_event(
        self, include_content: bool, response: str | None = "my secret response"
    ) -> MCPAgentExecutionEvent:
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
                response=response,
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

    def test_empty_response_keeps_its_length(self):
        """An empty response is still a response: report length 0, not None."""
        event = self._capture_event(include_content=False, response="")

        self.assertIsNone(event.response)
        self.assertEqual(event.response_length, 0)

    def test_absent_response_has_no_length(self):
        event = self._capture_event(include_content=False, response=None)

        self.assertIsNone(event.response)
        self.assertIsNone(event.response_length)

    # --- Telemetry.__init__ env parsing -------------------------------------
    # Telemetry is wrapped in @singleton, so calling Telemetry() returns the
    # cached instance and never re-runs __init__. Reach the real class through
    # the instance and initialize a throwaway object to exercise the default.
    # MCP_USE_ANONYMIZED_TELEMETRY=false keeps __init__ on its early branch, so
    # no PostHog/Scarf clients are constructed.

    def _init_flag(self, env: dict[str, str]) -> bool:
        cls = type(Telemetry())
        with patch.dict(os.environ, {"MCP_USE_ANONYMIZED_TELEMETRY": "false", **env}, clear=True):
            fresh = object.__new__(cls)
            cls.__init__(fresh)
        return fresh._include_content

    def test_include_content_defaults_to_false(self):
        self.assertFalse(self._init_flag({}))

    def test_include_content_opt_in_via_env(self):
        self.assertTrue(self._init_flag({"MCP_USE_TELEMETRY_INCLUDE_CONTENT": "true"}))
        self.assertTrue(self._init_flag({"MCP_USE_TELEMETRY_INCLUDE_CONTENT": "TRUE"}))

    def test_include_content_ignores_other_values(self):
        self.assertFalse(self._init_flag({"MCP_USE_TELEMETRY_INCLUDE_CONTENT": "false"}))
        self.assertFalse(self._init_flag({"MCP_USE_TELEMETRY_INCLUDE_CONTENT": "1"}))


if __name__ == "__main__":
    unittest.main()
