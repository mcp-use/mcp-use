import logging
from typing import Any

import mcp.types as types
from mcp.client.session import ClientSession
from mcp.shared.session import RequestResponder
from mcp.types import JSONRPCNotification
from pydantic import ValidationError

# Define MessageType (reuse from client_session.py for consistency)
MessageType = (
    RequestResponder[types.ServerRequest, types.ClientResult]
    | types.ServerNotification
    | Exception
    | JSONRPCNotification
)


class McpUseClientSession(ClientSession):
    """
    A patched version of ClientSession that gracefully handles unknown or non-standard
    JSON-RPC notifications from the server.

    Motivation:
    -------------
    The base ClientSession (and BaseSession) attempts to parse all incoming notifications
    as known ServerNotification types using Pydantic. If the notification does not match
    any known type (e.g., a server sends a custom notification like 'notifications/stderr'),
    Pydantic raises a validation error and logs a warning, but does not forward the raw
    notification to the client message handler.

    This subclass overrides the _receive_loop method to catch validation errors when parsing
    notifications. If validation fails, it forwards the raw JSONRPCNotification to the
    message handler, allowing the client to handle or ignore unknown notifications as needed.
    This prevents noisy Pydantic validation warnings and gives the client full visibility
    into all notifications, even those not covered by the protocol schema.
    """

    async def _receive_loop(self) -> None:
        """
        Override the main receive loop to catch validation errors when parsing notifications.
        If a notification cannot be parsed as a known type, forward the raw JSONRPCNotification
        to the message handler instead of just logging a warning.
        """
        async with (
            self._read_stream,
            self._write_stream,
        ):
            async for message in self._read_stream:
                if isinstance(message, Exception):
                    await self._handle_incoming(message)
                elif isinstance(message.message.root, types.JSONRPCRequest):
                    validated_request = self._receive_request_type.model_validate(
                        message.message.root.model_dump(
                            by_alias=True, mode="json", exclude_none=True
                        )
                    )

                    responder = RequestResponder(
                        request_id=message.message.root.id,
                        request_meta=validated_request.root.params.meta
                        if validated_request.root.params
                        else None,
                        request=validated_request,
                        session=self,
                        on_complete=lambda r: self._in_flight.pop(r.request_id, None),
                    )

                    self._in_flight[responder.request_id] = responder
                    await self._received_request(responder)

                    if not responder._completed:  # type: ignore[reportPrivateUsage]
                        await self._handle_incoming(responder)

                elif isinstance(message.message.root, types.JSONRPCNotification):
                    try:
                        notification = self._receive_notification_type.model_validate(
                            message.message.root.model_dump(
                                by_alias=True, mode="json", exclude_none=True
                            )
                        )
                        # Handle cancellation notifications if needed (optional)
                        await self._received_notification(notification)
                        await self._handle_incoming(notification)
                    except Exception as e:
                        # Instead of just logging, call your handler with the raw notification
                        if self._message_handler:
                            await self._message_handler(message.message.root)
                        else:
                            logging.warning(
                                f"Failed to validate notification: {e}. "
                                f"Message was: {message.message.root}"
                            )
                else:  # Response or error
                    stream = self._response_streams.pop(message.message.root.id, None)
                    if stream:
                        await stream.send(message.message.root)
                    else:
                        await self._handle_incoming(
                            RuntimeError(
                                "Received response with an unknown " f"request ID: {message}"
                            )
                        )

    async def _received_notification(self, notification: Any) -> None:
        """
        Override to ensure that if a notification is a raw JSONRPCNotification (not a known type),
        it is still forwarded to the message handler.
        """
        try:
            # Call parent notification handler first
            await super()._received_notification(notification)

        except (ValidationError, Exception):
            # If the notification is a JSONRPCNotification, forward it to the message handler
            if self._message_handler and isinstance(notification, JSONRPCNotification):
                await self._message_handler(notification)

    async def _handle_incoming(self, req: MessageType) -> None:
        """
        Override to ensure the message handler always receives the full MessageType union,
        including raw JSONRPCNotification objects.
        """
        if self._message_handler:
            await self._message_handler(req)
