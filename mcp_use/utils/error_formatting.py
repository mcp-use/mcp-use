import traceback

def format_error(error: Exception, **context) -> dict:
    formatted_context = {
        "error": type(error).__name__,
        "details": str(error),
        "isRetryable": isinstance(error, (TimeoutError, ConnectionError)),
        "stack": traceback.format_exc(),
        "code": getattr(error, "code", "UNKNOWN")
    }
    formatted_context.update(context)
    return formatted_context