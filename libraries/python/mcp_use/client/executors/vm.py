"""In-process ("VM") code executor for MCP code mode.

.. warning::

    **This executor is NOT a security boundary.** It runs agent-generated Python
    in the host process with :func:`exec`. Restricting Python's namespace cannot
    contain hostile code: introspection such as
    ``().__class__.__base__.__subclasses__()`` reaches arbitrary objects and
    rebuilds ``__import__``, so a sufficiently determined payload (or a
    prompt-injected agent) can run anything the host process can. This is a
    documented limitation of in-process execution, not a bug to be patched away
    (see https://docs.python.org/3/library/functions.html#exec).

    Use this executor only for **trusted** code (local development, your own
    prompts, CI). For untrusted or production input, run code in a real sandbox
    (e.g. an E2B cloud sandbox) via a sandboxed executor.

To make accidental and low-effort escapes harder, this executor still applies
defense-in-depth: a strict AST check rejects imports, dunder attribute access,
and known escape primitives before execution, and the dangerous introspection
builtins (``getattr``, ``type``, ...) are withheld from the namespace. Treat
this as risk reduction, never as a guarantee.
"""

import ast
import asyncio
import io
import re
import time
import warnings
from contextlib import redirect_stderr, redirect_stdout
from typing import Any

from mcp_use.client.executors.base import BaseCodeExecutor, ExecutionResult
from mcp_use.logging import logger


class InsecureCodeExecutionWarning(UserWarning):
    """Warned once when agent code is executed in-process (no real isolation)."""


class UnsafeCodeError(ValueError):
    """Raised when agent code contains a known sandbox-escape pattern.

    This is best-effort defense-in-depth, not a security guarantee. See the
    :mod:`~mcp_use.client.executors.vm` module docstring.
    """


# Dunder attributes / names that gate every known namespace-escape chain.
_DUNDER_RE = re.compile(r"^__\w+__$")

# Names withheld from the namespace AND rejected by the AST check. Most are not in
# the safe builtins to begin with; rejecting them up front gives a clear error and
# closes indirect-lookup vectors.
_DENIED_NAMES = frozenset(
    {
        "__import__",
        "__builtins__",
        "__build_class__",
        "__loader__",
        "__spec__",
        "eval",
        "exec",
        "compile",
        "globals",
        "locals",
        "vars",
        "open",
        "input",
        "breakpoint",
        "memoryview",
        "getattr",
        "setattr",
        "delattr",
        "hasattr",
        "type",
        "object",
        "super",
        "classmethod",
        "staticmethod",
        "property",
        "dir",
        "help",
        "exit",
        "quit",
    }
)

# Dunder tokens that, as string literals, enable getattr/str.format-style escapes.
# This is an explicit denylist rather than "reject every __\\w+__ string" on purpose:
# the retrieval primitives a string escape needs (getattr/hasattr/type) are already
# withheld, so this rule is bonus defense-in-depth and we keep it permissive enough to
# allow common data like "__init__.py" filenames. A dynamically built dunder string is
# inert here because nothing can use it to fetch an attribute.
_DANGEROUS_DUNDER_STRINGS = (
    "__class__",
    "__subclasses__",
    "__bases__",
    "__base__",
    "__mro__",
    "__globals__",
    "__builtins__",
    "__import__",
    "__subclasshook__",
    "__init_subclass__",
    "__dict__",
    "__getattribute__",
    "__code__",
    "__closure__",
    "__func__",
    "__self__",
)


class VMCodeExecutor(BaseCodeExecutor):
    """Execute Python code in-process with MCP tools exposed as async functions.

    The default code-mode executor: fast, no external dependencies, and runs in
    the host event loop so tool calls are direct. It is **not** a security
    boundary, only suitable for trusted code. See the module docstring.
    """

    # Emit the in-process security warning only once per process.
    _warned: bool = False

    # Builtins exposed to executed code. The introspection helpers that make
    # namespace escapes trivial (getattr, type) are deliberately excluded.
    @staticmethod
    def _safe_builtins() -> dict[str, Any]:
        return {
            "print": print,
            "len": len,
            "range": range,
            "enumerate": enumerate,
            "zip": zip,
            "map": map,
            "filter": filter,
            "list": list,
            "dict": dict,
            "set": set,
            "tuple": tuple,
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "abs": abs,
            "min": min,
            "max": max,
            "sum": sum,
            "sorted": sorted,
            "any": any,
            "all": all,
            "isinstance": isinstance,
            "repr": repr,
            "None": None,
            "True": True,
            "False": False,
            # Exception types for error handling
            "Exception": Exception,
            "ValueError": ValueError,
            "TypeError": TypeError,
            "KeyError": KeyError,
            "IndexError": IndexError,
            "AttributeError": AttributeError,
            "RuntimeError": RuntimeError,
        }

    async def execute(self, code: str, timeout: float = 30.0) -> ExecutionResult:
        """Execute Python code in-process with access to MCP tools.

        Args:
            code: Python code to execute.
            timeout: Execution timeout in seconds.

        Returns:
            An :class:`ExecutionResult`. Security/validation failures are returned
            as ``error`` (never raised), matching how syntax/runtime errors are
            surfaced, so callers and agents get a structured result either way.
        """
        self._warn_insecure_once()

        # Ensure all servers are connected (lazy connection).
        await self._ensure_servers_connected()

        start_time = time.time()
        logs: list[str] = []
        result = None
        error = None

        # Capture stdout/stderr
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        try:
            # Build execution namespace
            namespace = await self._build_namespace()

            # Add print capture function
            def captured_print(*args, **kwargs):
                output = io.StringIO()
                print(*args, file=output, **kwargs)
                log_message = output.getvalue().rstrip("\n")
                logs.append(log_message)

            namespace["print"] = captured_print

            # Execute code with timeout
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                try:
                    result = await asyncio.wait_for(self._execute_code(code, namespace), timeout=timeout)
                except TimeoutError:
                    error = f"Execution timeout after {timeout} seconds"
                    logger.warning(f"Code execution timeout: {timeout}s")

        except UnsafeCodeError as e:
            error = f"Code rejected by security check: {e}"
            logger.warning(f"Blocked unsafe code in VMCodeExecutor: {e}")
        except Exception as e:
            error = str(e)
            logger.error(f"Code execution error: {e}")

        execution_time = time.time() - start_time

        # Capture any stdout/stderr that wasn't captured by our print wrapper
        if stdout_capture.getvalue():
            logs.extend(stdout_capture.getvalue().strip().split("\n"))
        if stderr_capture.getvalue():
            logs.extend([f"[ERROR] {line}" for line in stderr_capture.getvalue().strip().split("\n")])

        return {"result": result, "logs": logs, "error": error, "execution_time": execution_time}

    async def _execute_code(self, code: str, namespace: dict[str, Any]) -> Any:
        """Validate, compile and run code in the given namespace.

        Runs inside the caller's :func:`asyncio.wait_for`, so validation,
        compilation and execution are all covered by the timeout.

        Args:
            code: Python code to execute.
            namespace: Execution namespace with restricted globals.

        Returns:
            The code's return value.

        Raises:
            UnsafeCodeError: If the code contains a known escape pattern.
            SyntaxError: If the code (after wrapping) is not valid Python.
        """
        # Always wrap code in an async function to support top-level await
        # and return statements.
        wrapped_code = "async def __execute_wrapper__():\n"
        for line in code.split("\n"):
            wrapped_code += f"    {line}\n"

        # Defense-in-depth: reject known escape patterns before executing.
        self._validate_ast(wrapped_code)

        # Compile and execute the wrapper function definition
        compiled_wrapped = compile(wrapped_code, "<agent_code>", "exec")
        exec(compiled_wrapped, namespace)

        # Execute the wrapper and return its result
        return await namespace["__execute_wrapper__"]()

    async def _build_namespace(self) -> dict[str, Any]:
        """Build the restricted namespace with safe builtins and tool wrappers.

        Returns:
            Dictionary containing safe builtins, ``asyncio``, ``search_tools``,
            per-server tool namespaces, and ``__tool_namespaces`` metadata.
        """
        namespace: dict[str, Any] = {
            "__builtins__": self._safe_builtins(),
            "asyncio": asyncio,  # Allow async/await
        }

        # Add search_tools function
        namespace["search_tools"] = self.create_search_tools_function()

        # Add tool namespaces organized by server
        tool_namespaces = await self._build_tool_namespaces()
        namespace.update(tool_namespaces)

        # Add metadata about available namespaces
        namespace["__tool_namespaces"] = list(tool_namespaces.keys())
        logger.debug(f"Final execution namespace keys: {list(namespace.keys())}")

        return namespace

    @classmethod
    def _validate_ast(cls, source: str) -> None:
        """Reject code containing known sandbox-escape patterns.

        Best-effort defense-in-depth. Blocks imports, dunder attribute access,
        denied/dunder names, and dunder string literals. It does not (and cannot)
        catch every vector, e.g. a dunder name built dynamically at runtime.

        Args:
            source: The (wrapped) Python source to validate.

        Raises:
            UnsafeCodeError: If a disallowed pattern is found.
            SyntaxError: If the source is not valid Python.
        """
        tree = ast.parse(source)
        for node in ast.walk(tree):
            # 1) No imports.
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                raise UnsafeCodeError("import statements are not allowed in code mode")

            # 2) No dunder attribute access (kills the __class__/__subclasses__ walk).
            if isinstance(node, ast.Attribute) and _DUNDER_RE.match(node.attr):
                raise UnsafeCodeError(f"access to dunder attribute '{node.attr}' is not allowed")

            # 3) No denied names or bare dunder names.
            if isinstance(node, ast.Name) and (node.id in _DENIED_NAMES or _DUNDER_RE.match(node.id)):
                raise UnsafeCodeError(f"use of name '{node.id}' is not allowed")

            # 4) No dunder string literals (blocks getattr/str.format-style escapes).
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                if any(token in node.value for token in _DANGEROUS_DUNDER_STRINGS):
                    raise UnsafeCodeError("string literals referencing dunder attributes are not allowed")

    @classmethod
    def _warn_insecure_once(cls) -> None:
        """Emit the in-process execution warning a single time per process."""
        if not cls._warned:
            cls._warned = True
            warnings.warn(
                "VMCodeExecutor runs agent code in-process and is NOT a security boundary. "
                "Only use it for trusted code. For untrusted input, run code in an isolated "
                "sandbox (e.g. an E2B cloud sandbox) instead.",
                InsecureCodeExecutionWarning,
                stacklevel=3,
            )
