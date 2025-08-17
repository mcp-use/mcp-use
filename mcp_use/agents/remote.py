"""
Remote agent implementation for executing agents via API.
"""

import json
import os
from typing import Any, TypeVar
from uuid import UUID

import httpx
from langchain.schema import BaseMessage
from pydantic import BaseModel

from ..logging import logger

T = TypeVar("T", bound=BaseModel)

# API endpoint constants
API_CHATS_ENDPOINT = "/api/v1/chats/get-or-create"
API_CHAT_EXECUTE_ENDPOINT = "/api/v1/chats/{chat_id}/execute"
API_CHAT_DELETE_ENDPOINT = "/api/v1/chats/{chat_id}"

UUID_ERROR_MESSAGE = """A UUID is a 36 character string of the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \n
Example: 123e4567-e89b-12d3-a456-426614174000
To generate a UUID, you can use the following command:
import uuid

# Generate a random UUID
my_uuid = uuid.uuid4()
print(my_uuid)
"""


class RemoteAgent:
    """Agent that executes remotely via API."""

    def __init__(
        self,
        agent_id: str,
        chat_id: str | None = None,
        api_key: str | None = None,
        base_url: str = "https://cloud.mcp-use.com",
    ):
        """Initialize remote agent.

        Args:
            agent_id: The ID of the remote agent to execute
            chat_id: The ID of the chat session to use. If None, a new chat session will be created.
            api_key: API key for authentication. If None, will check MCP_USE_API_KEY env var
            base_url: Base URL for the remote API
        """

        if chat_id is not None:
            try:
                chat_id = str(UUID(chat_id))
            except ValueError as e:
                raise ValueError(
                    f"Invalid chat ID: {chat_id}, make sure to provide a valid UUID.\n{UUID_ERROR_MESSAGE}"
                ) from e

        self.agent_id = agent_id
        self.chat_id = chat_id
        self._session_established = False
        self.base_url = base_url

        # Handle API key validation
        if api_key is None:
            api_key = os.getenv("MCP_USE_API_KEY")
        if not api_key:
            raise ValueError(
                "API key is required for remote execution. "
                "Please provide it as a parameter or set the MCP_USE_API_KEY environment variable. "
                "You can get an API key from https://cloud.mcp-use.com"
            )

        self.api_key = api_key
        # Configure client with reasonable timeouts for agent execution
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=10.0,  # 10 seconds to establish connection
                read=300.0,  # 5 minutes to read response (agents can take time)
                write=10.0,  # 10 seconds to send request
                pool=10.0,  # 10 seconds to get connection from pool
            )
        )

    def _pydantic_to_json_schema(self, model_class: type[T]) -> dict[str, Any]:
        """Convert a Pydantic model to JSON schema for API transmission.

        Args:
            model_class: The Pydantic model class to convert

        Returns:
            JSON schema representation of the model
        """
        return model_class.model_json_schema()

    def _parse_structured_response(self, response_data: Any, output_schema: type[T]) -> T:
        """Parse the API response into the structured output format.

        Args:
            response_data: Raw response data from the API
            output_schema: The Pydantic model to parse into

        Returns:
            Parsed structured output
        """
        # Handle different response formats
        if isinstance(response_data, dict):
            if "result" in response_data:
                outer_result = response_data["result"]
                # Check if this is a nested result structure (agent execution response)
                if isinstance(outer_result, dict) and "result" in outer_result:
                    # Extract the actual structured output from the nested result
                    result_data = outer_result["result"]
                else:
                    # Use the outer result directly
                    result_data = outer_result
            else:
                result_data = response_data
        elif isinstance(response_data, str):
            try:
                result_data = json.loads(response_data)
            except json.JSONDecodeError:
                # If it's not valid JSON, try to create the model from the string content
                result_data = {"content": response_data}
        else:
            result_data = response_data

        # Parse into the Pydantic model
        try:
            return output_schema.model_validate(result_data)
        except Exception as e:
            logger.warning(f"Failed to parse structured output: {e}")
            # Fallback: try to parse it as raw content if the model has a content field
            if hasattr(output_schema, "model_fields") and "content" in output_schema.model_fields:
                return output_schema.model_validate({"content": str(result_data)})
            raise

    async def _upsert_chat_session(self) -> str:
        """Create or resume a persistent chat session for the agent via upsert."""
        chat_payload = {
            "id": self.chat_id,  # Include chat_id for resuming or None for creating
            "title": f"Remote Agent Session - {self.agent_id}",
            "agent_id": self.agent_id,
            "type": "agent_execution",
        }

        headers = {"Content-Type": "application/json", "x-api-key": self.api_key}
        chat_url = f"{self.base_url}{API_CHATS_ENDPOINT}"

        logger.info(f"📝 Upserting chat session for agent {self.agent_id}")

        try:
            chat_response = await self._client.post(chat_url, json=chat_payload, headers=headers)
            chat_response.raise_for_status()

            chat_data = chat_response.json()
            chat_id = chat_data["id"]
            if chat_response.status_code == 201:
                logger.info(f"✅ New chat session created: {chat_id}")
            else:
                logger.info(f"✅ Resumed chat session: {chat_id}")

            return chat_id

        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            response_text = e.response.text

            if status_code == 404:
                raise RuntimeError(
                    f"Agent not found: Agent '{self.agent_id}' does not exist or you don't have access to it. "
                    "Please verify the agent ID and ensure it exists in your account."
                ) from e
            else:
                raise RuntimeError(f"Failed to create chat session: {status_code} - {response_text}") from e
        except Exception as e:
            raise RuntimeError(f"Failed to create chat session: {str(e)}") from e

    async def run(
        self,
        query: str,
        max_steps: int | None = None,
        external_history: list[BaseMessage] | None = None,
        output_schema: type[T] | None = None,
    ) -> str | T:
        """Run a query on the remote agent.

        Args:
            query: The query to execute
            max_steps: Maximum number of steps (default: 10)
            manage_connector: Ignored for remote execution
        external_history: Ignored for remote execution (not supported yet)
            output_schema: Optional Pydantic model for structured output

        Returns:
            A tuple containing:
                - The result from the remote agent execution (string or structured output)
                - The chat ID of the execution
        """
        if external_history is not None:
            logger.warning("External history is not yet supported for remote execution")

        try:
            logger.info(f"🌐 Executing query on remote agent {self.agent_id}")

            # Step 1: Ensure chat session exists on the backend by upserting.
            # This happens once per agent instance.
            if not self._session_established:
                logger.info(f"🔧 Establishing chat session for agent {self.agent_id}")
                self.chat_id = await self._upsert_chat_session()
                self._session_established = True

            chat_id = self.chat_id

            # Step 2: Execute the agent within the chat context
            execution_payload = {"query": query, "max_steps": max_steps or 10}

            # Add structured output schema if provided
            if output_schema is not None:
                execution_payload["output_schema"] = self._pydantic_to_json_schema(output_schema)
                logger.info(f"🔧 Using structured output with schema: {output_schema.__name__}")

            headers = {"Content-Type": "application/json", "x-api-key": self.api_key}
            execution_url = f"{self.base_url}{API_CHAT_EXECUTE_ENDPOINT.format(chat_id=chat_id)}"
            logger.info(f"🚀 Executing agent in chat {chat_id}")

            response = await self._client.post(execution_url, json=execution_payload, headers=headers)
            response.raise_for_status()

            result = response.json()
            logger.info(f"🔧 Response: {result}")
            logger.info("✅ Remote execution completed successfully")

            # Check for error responses (even with 200 status)
            if isinstance(result, dict):
                # Check for actual error conditions (not just presence of error field)
                if result.get("status") == "error" or (result.get("error") is not None):
                    error_msg = result.get("error", str(result))
                    logger.error(f"❌ Remote agent execution failed: {error_msg}")
                    raise RuntimeError(f"Remote agent execution failed: {error_msg}")

                # Check if the response indicates agent initialization failure
                if "failed to initialize" in str(result):
                    logger.error(f"❌ Agent initialization failed: {result}")
                    raise RuntimeError(
                        f"Agent initialization failed on remote server. "
                        f"This usually indicates:\n"
                        f"• Invalid agent configuration (LLM model, system prompt)\n"
                        f"• Missing or invalid MCP server configurations\n"
                        f"• Network connectivity issues with MCP servers\n"
                        f"• Missing environment variables or credentials\n"
                        f"Raw error: {result}"
                    )

            # Handle structured output
            if output_schema is not None:
                return self._parse_structured_response(result, output_schema)

            # Regular string output
            if isinstance(result, dict) and "result" in result:
                return result["result"]
            elif isinstance(result, str):
                return result
            else:
                return str(result)

        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            response_text = e.response.text

            # Provide specific error messages based on status code
            if status_code == 401:
                logger.error(f"❌ Authentication failed: {response_text}")
                raise RuntimeError(
                    "Authentication failed: Invalid or missing API key. "
                    "Please check your API key and ensure the MCP_USE_API_KEY environment variable is set correctly."
                ) from e
            elif status_code == 403:
                logger.error(f"❌ Access forbidden: {response_text}")
                raise RuntimeError(
                    f"Access denied: You don't have permission to execute agent '{self.agent_id}'. "
                    "Check if the agent exists and you have the necessary permissions."
                ) from e
            elif status_code == 404:
                logger.error(f"❌ Agent not found: {response_text}")
                raise RuntimeError(
                    f"Agent not found: Agent '{self.agent_id}' does not exist or you don't have access to it. "
                    "Please verify the agent ID and ensure it exists in your account."
                ) from e
            elif status_code == 422:
                logger.error(f"❌ Validation error: {response_text}")
                raise RuntimeError(
                    f"Request validation failed: {response_text}. "
                    "Please check your query parameters and output schema format."
                ) from e
            elif status_code == 500:
                logger.error(f"❌ Server error: {response_text}")
                raise RuntimeError(
                    "Internal server error occurred during agent execution. "
                    "Please try again later or contact support if the issue persists."
                ) from e
            else:
                logger.error(f"❌ Remote execution failed with status {status_code}: {response_text}")
                raise RuntimeError(f"Remote agent execution failed: {status_code} - {response_text}") from e
        except httpx.TimeoutException as e:
            logger.error(f"❌ Remote execution timed out: {e}")
            raise RuntimeError(
                "Remote agent execution timed out. The server may be overloaded or the query is taking too long to "
                "process. Try again or use a simpler query."
            ) from e
        except httpx.ConnectError as e:
            logger.error(f"❌ Remote execution connection error: {e}")
            raise RuntimeError(
                f"Remote agent connection failed: Cannot connect to {self.base_url}. "
                f"Check if the server is running and the URL is correct."
            ) from e
        except Exception as e:
            logger.error(f"❌ Remote execution error: {e}")
            raise RuntimeError(f"Remote agent execution failed: {str(e)}") from e

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()
        logger.info("🔌 Remote agent client closed")
