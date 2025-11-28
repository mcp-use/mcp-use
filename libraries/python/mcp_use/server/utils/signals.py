"""Signal handling for graceful server shutdown."""

import os
import signal
import sys


def setup_signal_handlers():
    """Set up signal handlers for immediate shutdown."""

    def force_exit_handler(signum, frame):
        print("\n⏹  Force quitting...", file=sys.stderr)
        os._exit(0)

    signal.signal(signal.SIGINT, force_exit_handler)
    signal.signal(signal.SIGTERM, force_exit_handler)
