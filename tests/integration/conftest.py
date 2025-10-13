import asyncio
import logging
import subprocess
from pathlib import Path

import pytest

logger = logging.getLogger(__name__)


@pytest.fixture(scope="session")
async def primitive_server():
    """Starts the primitive_server.py as a subprocess for integration tests."""
    server_path = Path(__file__).parent / "servers_for_testing" / "primitive_server.py"
    logger.info(f"Starting primitive server: python {server_path}")

    # Use sys.executable to ensure we use the same Python interpreter
    # that has the required dependencies installed
    import sys

    process = subprocess.Popen(
        [sys.executable, str(server_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Allow server to initialize
    await asyncio.sleep(2)

    yield "http://127.0.0.1:8080"

    logger.info("Cleaning up primitive server process")
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            logger.warning("Server process did not terminate gracefully, killing.")
            process.kill()
            process.wait()
    logger.info("Primitive server cleanup complete.")


@pytest.fixture(scope="session")
async def auth_server():
    """Starts the auth_server.py as a subprocess for integration tests."""
    server_path = Path(__file__).parent / "servers_for_testing" / "auth_server.py"
    logger.info(f"Starting auth server: python {server_path}")

    # Use sys.executable to ensure we use the same Python interpreter
    # that has the required dependencies installed
    import sys

    process = subprocess.Popen(
        [sys.executable, str(server_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Allow server to initialize
    await asyncio.sleep(2)

    yield "http://127.0.0.1:8081"

    logger.info("Cleaning up auth server process")
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            logger.warning("Server process did not terminate gracefully, killing.")
            process.kill()
            process.wait()
    logger.info("Auth server cleanup complete.")
