import os

from dotenv import load_dotenv

load_dotenv()

# Check if Langfuse is disabled via environment variable
_langfuse_disabled = os.getenv("MCP_USE_LANGFUSE", "").lower() == "false"

# Only initialize if not disabled and required keys are present
if not _langfuse_disabled and os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"):
    try:
        from langfuse import Langfuse
        from langfuse.langchain import CallbackHandler

        langfuse = Langfuse(public_key=os.getenv("LANGFUSE_PUBLIC_KEY"), secret_key=os.getenv("LANGFUSE_SECRET_KEY"), host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"))
        langfuse_handler = CallbackHandler()
    except ImportError:
        # langfuse package not installed
        langfuse = None
        langfuse_handler = None
else:
    # Disabled or missing keys
    langfuse = None
    langfuse_handler = None
