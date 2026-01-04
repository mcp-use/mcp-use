import sys
from unittest.mock import MagicMock

# --- THE DEPENDENCY BYPASS ---
# We force Python to believe that 'scarf' is installed.
# This prevents the "ModuleNotFoundError" crash on Windows/Python 3.13.

mock_scarf = MagicMock()
sys.modules["scarf"] = mock_scarf

# We also verify 'mcp' is mocked or present if needed, 
# but usually mocking the top-level blocker is enough.