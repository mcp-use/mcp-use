"""
Remote agent implementation for executing agents via API.
"""

import json
import os
from collections.abc import AsyncGenerator
from typing import Any, TypeVar
from uuid import UUID

import httpx
from langchain.schema import BaseMessage
from pydantic import BaseModel

from mcp_use.logging import logger

T = TypeVar("T", bound=BaseModel)

# API endpoint constants
API_CHATS_ENDPOINT = "/api/v1/chats/get-or-create"
API_CHAT_STREAM_ENDPOINT = "/api/v1/chats/{chat_id}/stream"
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
            logger.info(f"🔍 Attempting to validate result_data against {output_schema.__name__}")
            logger.info(f"🔍 Result data type: {type(result_data)}")
            logger.info(f"🔍 Result data: {result_data}")
            return output_schema.model_validate(result_data)
        except Exception as e:
            logger.warning(f"❌ Failed to parse structured output: {e}")
            logger.warning(f"🔍 Validation error details: {type(e).__name__}: {str(e)}")
            logger.warning(f"🔍 Result data that failed validation: {result_data}")

            # Fallback: try to parse it as raw content if the model has a content field
            if hasattr(output_schema, "model_fields") and "content" in output_schema.model_fields:
                logger.info("🔄 Attempting fallback with content field")
                try:
                    fallback_result = output_schema.model_validate({"content": str(result_data)})
                    logger.info("✅ Fallback parsing succeeded")
                    return fallback_result
                except Exception as fallback_e:
                    logger.error(f"❌ Fallback parsing also failed: {fallback_e}")
                    raise
            raise

    async def _upsert_chat_session(self) -> str:
        """Create or resume a persistent chat session for the agent via upsert.

        Returns:
            The chat session ID
        """
        chat_payload = {
            "id": self.chat_id,  # Include chat_id for resuming or None for creating
            "title": f"Remote Agent Session - {self.agent_id}",
            "agent_id": self.agent_id,
            "type": "agent_execution",
        }

        headers = {"Content-Type": "application/json", "x-api-key": self.api_key}
        chat_url = f"{self.base_url}{API_CHATS_ENDPOINT}"

        logger.info(f"📝 [{self.chat_id}] Upserting chat session for agent {self.agent_id}")

        try:
            chat_response = await self._client.post(chat_url, json=chat_payload, headers=headers)
            chat_response.raise_for_status()

            chat_data = chat_response.json()
            chat_id = chat_data["id"]
            if chat_response.status_code == 201:
                logger.info(f"✅ [{self.chat_id}] New chat session created")
            else:
                logger.info(f"✅ [{self.chat_id}] Resumed chat session")

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

    async def stream(
        self,
        query: str,
        max_steps: int | None = None,
        external_history: list[BaseMessage] | None = None,
        output_schema: type[T] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream the execution of a query on the remote agent using HTTP streaming."""
        if external_history is not None:
            logger.warning("External history is not yet supported for remote execution")

        if not self._session_established:
            logger.info(f"🔧 [{self.chat_id}] Establishing chat session for agent {self.agent_id}")
            self.chat_id = await self._upsert_chat_session()
            self._session_established = True

        chat_id = self.chat_id
        stream_url = f"{self.base_url}{API_CHAT_STREAM_ENDPOINT.format(chat_id=chat_id)}"

        # Prepare the request payload
        request_payload = {"messages": [{"role": "user", "content": query}], "max_steps": max_steps or 30}
        if output_schema is not None:
            request_payload["output_schema"] = self._pydantic_to_json_schema(output_schema)

        headers = {"Content-Type": "application/json", "x-api-key": self.api_key, "Accept": "text/event-stream"}

        try:
            logger.info(f"🌐 [{self.chat_id}] Connecting to HTTP stream for agent {self.agent_id}")

            async with self._client.stream("POST", stream_url, headers=headers, json=request_payload) as response:
                logger.info(f"✅ [{self.chat_id}] HTTP stream connection established")

                if response.status_code != 200:
                    error_text = await response.aread()
                    raise RuntimeError(f"Failed to stream from remote agent: {error_text.decode()}")

                # Read the streaming response line by line
                try:
                    async for line in response.aiter_lines():
                        if line:
                            yield line
                except UnicodeDecodeError as e:
                    logger.error(f"❌ [{self.chat_id}] UTF-8 decoding error at position {e.start}: {e.reason}")
                    logger.error(f"❌ [{self.chat_id}] Error occurred while reading stream for agent {self.agent_id}")
                    # Try to read raw bytes and decode with error handling
                    logger.info(f"🔄 [{self.chat_id}] Attempting to read raw bytes with error handling...")
                logger.info(f"✅ [{self.chat_id}] Agent execution stream completed")

        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            response_text = e.response.text

            if status_code == 404:
                raise RuntimeError(f"Chat or agent not found: {response_text}") from e
            else:
                raise RuntimeError(f"Failed to stream from remote agent: {status_code} - {response_text}") from e
        except Exception as e:
            logger.error(f"❌ [{self.chat_id}] An error occurred during HTTP streaming: {e}")
            raise RuntimeError(f"Failed to stream from remote agent: {str(e)}") from e

    async def run(
        self,
        query: str,
        max_steps: int | None = None,
        external_history: list[BaseMessage] | None = None,
        output_schema: type[T] | None = None,
    ) -> str | T:
        """
        Executes the agent and returns the final result.
        This method uses HTTP streaming to avoid timeouts for long-running tasks.
        It consumes the entire stream and returns only the final result.
        """
        final_result = None
        steps_taken = 0
        finished = False

        try:
            # Consume the ENTIRE stream to ensure proper execution
            async for event in self.stream(query, max_steps, external_history, output_schema):
                logger.debug(f"[{self.chat_id}] Processing stream event: {event}...")

                # Parse AI SDK format events to extract final result
                # The events follow the AI SDK streaming protocol
                if event.startswith("0:"):  # Text event
                    try:
                        text_data = json.loads(event[2:])  # Remove "0:" prefix
                        # Normal text accumulation
                        if final_result is None:
                            final_result = ""
                        final_result += text_data
                        result_preview = final_result[:200] if len(final_result) > 200 else final_result
                        logger.debug(f"Accumulated text result: {result_preview}...")
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse text event: {event[:100]}")
                        continue

                elif event.startswith("9:"):  # Tool call event
                    steps_taken += 1
                    logger.debug(f"Tool call executed, total steps: {steps_taken}")

                elif event.startswith("d:"):  # Finish event
                    logger.debug("Received finish event, marking as finished")
                    finished = True
                    # Continue consuming to ensure stream cleanup

                elif event.startswith("3:"):  # Error event
                    try:
                        error_data = json.loads(event[2:])
                        error_msg = error_data if isinstance(error_data, str) else json.dumps(error_data)
                        raise RuntimeError(f"Agent execution failed: {error_msg}")
                    except json.JSONDecodeError as e:
                        raise RuntimeError("Agent execution failed with unknown error") from e

                elif event.startswith("f:"):  # Structured final event
                    try:
                        structured_data = json.loads(event[2:])  # Remove "f:" prefix
                        logger.info(f"📋 [{self.chat_id}] Received structured final event")

                        # Replace accumulated text with structured output
                        final_result = structured_data
                        logger.info(f"📋 [{self.chat_id}] Replaced accumulated text with structured output")
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse structured final event: {event[:100]}")
                        continue

            # Log completion of stream consumption
            logger.info(f"Stream consumption complete. Finished: {finished}, Steps taken: {steps_taken}")

            if final_result is None:
                logger.warning(f"No final result captured from stream (structured output: {output_schema is not None})")
                final_result = ""  # Return empty string instead of error message

            # For structured output, try to parse the result
            if output_schema:
                logger.info(f"🔍 Attempting structured output parsing for schema: {output_schema.__name__}")
                logger.info(f"🔍 Raw final result type: {type(final_result)}")
                logger.info(f"🔍 Raw final result length: {len(str(final_result)) if final_result else 0}")
                logger.info(f"🔍 Raw final result preview: {str(final_result)[:500] if final_result else 'None'}...")

                if isinstance(final_result, str) and final_result:
                    try:
                        # Try to parse as JSON first
                        parsed_result = json.loads(final_result)
                        logger.info("✅ Successfully parsed structured result as JSON")
                        return self._parse_structured_response(parsed_result, output_schema)
                    except json.JSONDecodeError as e:
                        logger.warning(f"❌ Could not parse result as JSON: {e}")
                        logger.warning(f"🔍 Raw string content: {final_result[:1000]}...")
                        # Try to parse directly
                        return self._parse_structured_response({"content": final_result}, output_schema)
                else:
                    logger.warning(f"❌ Final result is empty or not string: {final_result}")
                    # Try to parse the result directly
                    return self._parse_structured_response(final_result, output_schema)

            # Regular string output
            return final_result if isinstance(final_result, str) else str(final_result)

        except RuntimeError:
            raise
        except Exception as e:
            logger.error(f"Error executing agent: {e}")
            raise RuntimeError(f"Failed to execute agent: {str(e)}") from e

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()
        logger.info("🔌 Remote agent client closed")
