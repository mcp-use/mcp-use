import os

from dotenv import load_dotenv

load_dotenv()

# Check if Laminar is disabled via environment variable
_laminar_disabled = os.getenv("MCP_USE_LAMINAR", "").lower() == "false"

# Only initialize if not disabled and API key is present
if not _laminar_disabled and os.getenv("LAMINAR_PROJECT_API_KEY"):
    try:
        from lmnr import Laminar

        Laminar.initialize(project_api_key=os.getenv("LAMINAR_PROJECT_API_KEY"))
    except ImportError:
        # lmnr package not installed
        pass
