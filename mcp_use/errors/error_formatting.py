import traceback

from ..logging import logger

retryable_exceptions = (TimeoutError, ConnectionError)  # We can add more exceptions here


def format_error(error: Exception, **context) -> dict:
    """
    Formats an exception into a structured format that can be understood by LLMs.

    Args:
        error: The exception to format.
        **context: Additional context to include in the formatted error.

    Returns:
        A dictionary containing the formatted error.
    """
    formatted_context = {
        "error": type(error).__name__,
        "details": str(error),
        "isRetryable": isinstance(error, retryable_exceptions),
        "stack": traceback.format_exc(),
        "code": getattr(error, "code", "UNKNOWN"),
    }
    formatted_context.update(context)

    logger.error(f"Structured error: {formatted_context}")  # For observability (maybe remove later)
    return formatted_context
