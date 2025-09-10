"""
Test case for LLMClient that compares output formats between OpenAI and Anthropic clients.

This test demonstrates how to use LLMClient with both providers and verify that
they produce consistent structured outputs using the instructor library.
"""

import os
from typing import Any, Optional
from unittest.mock import MagicMock, patch

import pytest
from pydantic import BaseModel, Field

from mcp_use.llm import LLMClient


class PersonInfo(BaseModel):
    """Test model for structured output validation."""

    name: str = Field(description="Full name of the person")
    age: int = Field(description="Age in years", ge=0, le=150)
    occupation: str = Field(description="Current job or profession")
    skills: list[str] = Field(description="List of key skills")
    bio: str | None = Field(default=None, description="Short biography")


class TestLLMClientOutputConsistency:
    """Test cases for LLMClient output format consistency across providers."""

    @pytest.fixture
    def mock_openai_response(self):
        """Mock response that matches PersonInfo structure."""
        return PersonInfo(
            name="John Doe",
            age=30,
            occupation="Software Engineer",
            skills=["Python", "Machine Learning", "API Design"],
            bio="Experienced software engineer with expertise in AI systems.",
        )

    @pytest.fixture
    def mock_anthropic_response(self):
        """Mock response that matches PersonInfo structure."""
        return PersonInfo(
            name="Jane Smith",
            age=28,
            occupation="Data Scientist",
            skills=["Python", "Statistics", "Deep Learning"],
            bio="Data scientist specializing in predictive modeling.",
        )

    @pytest.fixture
    def test_prompt(self):
        """Common prompt for both providers."""
        return """Extract information about a person from this text:
        'Alice Johnson is a 35-year-old UX Designer with skills in Figma,
        user research, and prototyping. She has been designing digital
        experiences for over 8 years and specializes in mobile applications.'"""

    @patch("instructor.from_provider")
    def test_output_format_consistency(
        self, mock_from_provider, test_prompt, mock_openai_response, mock_anthropic_response
    ):
        """
        Test that OpenAI and Anthropic clients produce consistent output formats
        when using structured output with Pydantic models.
        """
        # Mock instructor clients for both providers
        mock_openai_client = MagicMock()
        mock_anthropic_client = MagicMock()

        # Configure mock responses
        mock_openai_client.chat.completions.create.return_value = mock_openai_response
        mock_anthropic_client.chat.completions.create.return_value = mock_anthropic_response

        # Configure from_provider to return appropriate mocks
        def mock_from_provider_side_effect(provider_string, **kwargs):
            if "openai" in provider_string:
                return mock_openai_client
            elif "anthropic" in provider_string:
                return mock_anthropic_client
            else:
                raise ValueError(f"Unknown provider: {provider_string}")

        mock_from_provider.side_effect = mock_from_provider_side_effect

        # Initialize LLMClients for both providers
        openai_client = LLMClient(model_name="gpt-4", use_async=False)

        anthropic_client = LLMClient(model_name="claude-3-sonnet-20240229", use_async=False)

        # Verify that both clients were created with correct provider strings
        mock_from_provider.assert_any_call("openai/gpt-4", async_client=False)
        mock_from_provider.assert_any_call("anthropic/claude-3-sonnet-20240229", async_client=False)

        # Test structured output generation
        openai_result = openai_client.chat.completions.create(
            model="gpt-4", messages=[{"role": "user", "content": test_prompt}], response_model=PersonInfo
        )

        anthropic_result = anthropic_client.chat.completions.create(
            model="claude-3-sonnet-20240229",
            messages=[{"role": "user", "content": test_prompt}],
            response_model=PersonInfo,
        )

        # Verify both results are PersonInfo instances
        assert isinstance(openai_result, PersonInfo)
        assert isinstance(anthropic_result, PersonInfo)

        # Verify both have the same structure (all required fields present)
        openai_dict = openai_result.model_dump()
        anthropic_dict = anthropic_result.model_dump()

        assert set(openai_dict.keys()) == set(anthropic_dict.keys())

        # Verify field types are consistent
        for field_name in openai_dict.keys():
            openai_value = openai_dict[field_name]
            anthropic_value = anthropic_dict[field_name]

            # Both should have the same type
            assert type(openai_value) == type(
                anthropic_value
            ), f"Field '{field_name}' has inconsistent types: {type(openai_value)} vs {type(anthropic_value)}"

        # Verify Pydantic validation works for both
        assert openai_result.age >= 0 and openai_result.age <= 150
        assert anthropic_result.age >= 0 and anthropic_result.age <= 150
        assert isinstance(openai_result.skills, list)
        assert isinstance(anthropic_result.skills, list)

    @patch("instructor.from_provider")
    def test_async_client_initialization(self, mock_from_provider):
        """Test that async clients are properly initialized for both providers."""
        mock_client = MagicMock()
        mock_from_provider.return_value = mock_client

        # Test OpenAI async client
        LLMClient(model_name="gpt-4", use_async=True)

        mock_from_provider.assert_called_with("openai/gpt-4", async_client=True)

        # Reset mock for second test
        mock_from_provider.reset_mock()

        # Test Anthropic async client
        LLMClient(model_name="claude-3-sonnet-20240229", use_async=True)

        mock_from_provider.assert_called_with("anthropic/claude-3-sonnet-20240229", async_client=True)

    @patch("instructor.from_provider")
    def test_provider_string_mapping(self, mock_from_provider):
        """Test that model names are correctly mapped to provider strings."""
        mock_client = MagicMock()
        mock_from_provider.return_value = mock_client

        test_cases = [
            # OpenAI models
            ("gpt-4", "openai/gpt-4"),
            ("gpt-3.5-turbo", "openai/gpt-3.5-turbo"),
            ("o1-preview", "openai/o1-preview"),
            # Anthropic models
            ("claude-3-sonnet-20240229", "anthropic/claude-3-sonnet-20240229"),
            ("claude-3-opus-20240229", "anthropic/claude-3-opus-20240229"),
            # Google models
            ("gemini-pro", "google/gemini-pro"),
            # Mistral models
            ("mistral-large", "mistral/mistral-large"),
            # Pre-formatted provider strings
            ("openai/gpt-4", "openai/gpt-4"),
            ("anthropic/claude-3-sonnet", "anthropic/claude-3-sonnet"),
        ]

        for model_name, expected_provider_string in test_cases:
            mock_from_provider.reset_mock()

            LLMClient(
                model_name=model_name,
            )

            mock_from_provider.assert_called_once_with(expected_provider_string, async_client=True)

    @patch("instructor.from_provider")
    def test_unknown_model_raises_error(self, mock_from_provider):
        """Test that unknown model names raise appropriate errors."""
        with pytest.raises(ValueError) as exc_info:
            LLMClient(
                model_name="unknown-model",
            )

        assert "Unknown model type: unknown-model" in str(exc_info.value)
        assert "Use format 'provider/model'" in str(exc_info.value)

    @patch("instructor.from_provider")
    def test_attribute_delegation(self, mock_from_provider):
        """Test that LLMClient properly delegates attributes to the instructor client."""
        mock_client = MagicMock()
        mock_client.some_method.return_value = "test_result"
        mock_client.some_attribute = "test_attribute"
        mock_from_provider.return_value = mock_client

        llm_client = LLMClient(
            model_name="gpt-4",
        )

        # Test method delegation
        result = llm_client.some_method("test_arg")
        assert result == "test_result"
        mock_client.some_method.assert_called_once_with("test_arg")

        # Test attribute delegation
        assert llm_client.some_attribute == "test_attribute"

    def test_repr(self):
        """Test string representation of LLMClient."""
        with patch("instructor.from_provider") as mock_from_provider:
            mock_from_provider.return_value = MagicMock()

            client = LLMClient(model_name="gpt-4", use_async=False)

            repr_str = repr(client)
            assert "LLMClient(model_name='gpt-4', use_async=False)" == repr_str


class TestLLMClientIntegration:
    """Integration tests for LLMClient with real API calls (requires API keys)."""

    @pytest.mark.integration
    @pytest.mark.skipif(
        not (os.getenv("OPENAI_API_KEY") and os.getenv("ANTHROPIC_API_KEY")),
        reason="Requires OPENAI_API_KEY and ANTHROPIC_API_KEY environment variables",
    )
    def test_real_api_structured_consistency(self):
        """
        Integration test with real API calls to verify structured output consistency.
        This test is skipped unless API keys are available.
        """
        # Initialize real clients
        openai_client = LLMClient(model_name="gpt-4o-mini", use_async=False)

        anthropic_client = LLMClient(model_name="claude-3-haiku-20240307", use_async=False)

        prompt = """Extract person information:
        'Dr. Sarah Wilson is a 42-year-old Research Scientist at MIT.
        She specializes in quantum computing, machine learning, and has
        published over 50 papers. She leads a team of 12 researchers.'"""

        # Make real API calls with structured output
        openai_result = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_model=PersonInfo,
            max_tokens=500,
        )

        anthropic_result = anthropic_client.chat.completions.create(
            model="claude-3-haiku-20240307",
            messages=[{"role": "user", "content": prompt}],
            response_model=PersonInfo,
            max_tokens=500,
        )

        # Verify both are valid PersonInfo objects
        assert isinstance(openai_result, PersonInfo)
        assert isinstance(anthropic_result, PersonInfo)

        # Verify structure consistency
        openai_dict = openai_result.model_dump()
        anthropic_dict = anthropic_result.model_dump()

        assert set(openai_dict.keys()) == set(anthropic_dict.keys())

        # Verify data types are consistent
        for field_name in openai_dict.keys():
            openai_type = type(openai_dict[field_name])
            anthropic_type = type(anthropic_dict[field_name])
            assert (
                openai_type == anthropic_type
            ), f"Field '{field_name}' type mismatch: {openai_type} vs {anthropic_type}"

        print(f"OpenAI result: {openai_result}")
        print(f"Anthropic result: {anthropic_result}")

    @pytest.mark.integration
    @pytest.mark.skipif(
        not (os.getenv("OPENAI_API_KEY") and os.getenv("ANTHROPIC_API_KEY")),
        reason="Requires OPENAI_API_KEY and ANTHROPIC_API_KEY environment variables",
    )
    def test_real_api_raw_output_consistency(self):
        """
        Integration test with real API calls to verify raw output consistency.
        This test actually calls the APIs without structured output to compare raw responses.
        """
        # Initialize real clients
        openai_client = LLMClient(model_name="gpt-4o-mini", use_async=False)
        anthropic_client = LLMClient(model_name="claude-3-haiku-20240307", use_async=False)

        # Simple, deterministic prompt
        prompt = """Please respond with exactly: "The answer is 42" """

        # Make real API calls WITHOUT structured output (NO response_model at all!)
        openai_result = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=50,
            temperature=0,
            response_model=str,  # This will return just the string content
        )

        anthropic_result = anthropic_client.chat.completions.create(
            model="claude-3-haiku-20240307",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=50,
            temperature=0,
            response_model=str,  # This will return just the string content
        )

        # Test that both have the expected structure and content
        openai_content = openai_result
        anthropic_content = anthropic_result
        print(f"OpenAI: {openai_content}")
        print(f"Anthropic: {anthropic_content}")

        assert isinstance(openai_content, str) and isinstance(anthropic_content, str)
        assert "42" in openai_content and "42" in anthropic_content

        print(f"OpenAI: {openai_content}")
        print(f"Anthropic: {anthropic_content}")


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v"])
