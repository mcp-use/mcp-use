"""
Unit tests for system_prompt_builder.

Covers:
- Missing {tool_descriptions} placeholder logs via logger.warning, not print()
- Normal template formatting works correctly
- Additional instructions are appended
"""

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.tools import BaseTool

from mcp_use.agents.prompts.system_prompt_builder import (
    build_system_prompt_content,
    create_system_message,
    generate_tool_descriptions,
)


class TestGenerateToolDescriptions:
    def test_basic(self):
        tool = MagicMock(spec=BaseTool)
        tool.name = "my_tool"
        tool.description = "Does stuff"

        lines = generate_tool_descriptions([tool])
        assert lines == ["- my_tool: Does stuff"]

    def test_disallowed_excluded(self):
        t1 = MagicMock(spec=BaseTool)
        t1.name = "allowed"
        t1.description = "ok"
        t2 = MagicMock(spec=BaseTool)
        t2.name = "blocked"
        t2.description = "nope"

        lines = generate_tool_descriptions([t1, t2], disallowed_tools=["blocked"])
        assert len(lines) == 1
        assert "allowed" in lines[0]

    def test_curly_braces_escaped(self):
        tool = MagicMock(spec=BaseTool)
        tool.name = "t"
        tool.description = "Use {arg} to do {thing}"

        lines = generate_tool_descriptions([tool])
        assert "{{arg}}" in lines[0]
        assert "{{thing}}" in lines[0]


class TestBuildSystemPromptContent:
    def test_placeholder_substituted(self):
        result = build_system_prompt_content(
            template="Tools: {tool_descriptions}",
            tool_description_lines=["- t1: desc"],
        )
        assert result == "Tools: - t1: desc"

    def test_additional_instructions_appended(self):
        result = build_system_prompt_content(
            template="Base: {tool_descriptions}",
            tool_description_lines=[],
            additional_instructions="Extra note.",
        )
        assert result.endswith("Extra note.")

    def test_missing_placeholder_uses_logger_not_print(self):
        """When {tool_descriptions} is missing, logger.warning must be called — not print()."""
        with patch("mcp_use.agents.prompts.system_prompt_builder.logger") as mock_logger:
            result = build_system_prompt_content(
                template="No placeholder here.",
                tool_description_lines=["- t1: desc"],
            )

        mock_logger.warning.assert_called_once()
        # print() must NOT have been called (would pollute user stdout).
        assert "Available tools:" in result
        assert "- t1: desc" in result

    def test_missing_placeholder_no_stdout_pollution(self, capsys):
        """Missing placeholder must not write anything to stdout."""
        build_system_prompt_content(
            template="No placeholder.",
            tool_description_lines=["- x: y"],
        )
        captured = capsys.readouterr()
        assert captured.out == ""


class TestCreateSystemMessage:
    def _make_tool(self, name: str, desc: str) -> MagicMock:
        t = MagicMock(spec=BaseTool)
        t.name = name
        t.description = desc
        return t

    def test_returns_system_message_with_tool_descriptions(self):
        from langchain_core.messages import SystemMessage

        tool = self._make_tool("search", "Search the web")
        msg = create_system_message(
            tools=[tool],
            system_prompt_template="Tools: {tool_descriptions}",
            server_manager_template="SM: {tool_descriptions}",
            use_server_manager=False,
        )
        assert isinstance(msg, SystemMessage)
        assert "search" in msg.content

    def test_user_provided_prompt_bypasses_template(self):
        from langchain_core.messages import SystemMessage

        msg = create_system_message(
            tools=[],
            system_prompt_template="{tool_descriptions}",
            server_manager_template="{tool_descriptions}",
            use_server_manager=False,
            user_provided_prompt="Custom prompt",
        )
        assert msg.content == "Custom prompt"

    def test_server_manager_template_selected(self):
        from langchain_core.messages import SystemMessage

        msg = create_system_message(
            tools=[],
            system_prompt_template="DEFAULT {tool_descriptions}",
            server_manager_template="SM {tool_descriptions}",
            use_server_manager=True,
        )
        assert isinstance(msg, SystemMessage)
        assert msg.content.startswith("SM")
