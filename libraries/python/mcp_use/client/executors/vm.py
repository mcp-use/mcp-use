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
non-dunder interpreter-introspection attributes (``f_globals``, ``gi_frame``,
``tb_frame``, ...), and known escape primitives before execution; the dangerous
introspection builtins (``getattr``, ``type``, ...) are withheld from the
namespace; and only a curated facade of :mod:`asyncio` is exposed instead of the
real module (the real one transitively re-exposes ``os``/``subprocess`` through
plain attribute chains like ``asyncio.base_events.os``). Treat all of this as
risk reduction, never as a guarantee: a sufficiently determined payload can
still escape an in-process interpreter, which is why untrusted code belongs in a
real sandbox. The execution timeout likewise bounds only ``await`` points, not
synchronous CPU- or memory-bound code; hard resource limits require the
out-of-process (E2B) executor.

One residual is worth calling out explicitly: ``str.format``/``format_map`` and
f-strings perform attribute and item access at *runtime* (``"{0.attr}".format(x)``),
so a dynamically built format string (e.g. ``"{0.__glo" + "bals__}"``) can read a
dunder the AST never sees and walk an exposed object's ``__globals__`` to module
state. This is **information disclosure only**, not code execution: the format
machinery stringifies whatever it reaches, it cannot call it or return a live
handle, so it yields a repr (which may still leak env vars or paths), never an
``os.system`` style payload. It is inherent to exposing any real callable next to
``str.format`` in-process and cannot be closed without breaking legitimate string
formatting; treat env/secret confidentiality as another reason to use the E2B
executor for untrusted input.
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

# Non-dunder introspection attributes that expose interpreter internals (frames,
# code objects, generator/coroutine/traceback state). These are *not* dunders, so
# the regex above misses them, yet they are a direct escape route: from any frame
# you can read ``f_globals``/``f_builtins`` (plain dicts holding the real
# ``__import__``) or walk ``f_back`` to a host frame that already imported ``os``.
# A generator/coroutine an agent defines exposes its frame via ``gi_frame``/
# ``cr_frame``; ``sys.exc_info()`` hands back a traceback whose ``tb_frame`` does
# the same. Legitimate code-mode code never touches these, so rejecting them is
# cheap defense-in-depth with negligible false-positive risk.
_DENIED_ATTRS = frozenset(
    {
        # frame objects
        "f_globals",
        "f_builtins",
        "f_locals",
        "f_back",
        "f_code",
        "f_trace",
        # generator objects
        "gi_frame",
        "gi_code",
        "gi_yieldfrom",
        # coroutine objects
        "cr_frame",
        "cr_code",
        "cr_await",
        "cr_origin",
        # async-generator objects
        "ag_frame",
        "ag_code",
        # traceback objects
        "tb_frame",
        "tb_next",
        # event-loop accessors on asyncio Futures/Tasks/sync primitives. The
        # curated asyncio facade still returns real Future/Lock/... objects, and
        # the running loop exposes os/subprocess (e.g. loop.subprocess_shell). The
        # loop is only reachable through these names, so block them.
        "get_loop",
        "_get_loop",
        "_loop",
    }
)

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
# allow common data like "__init__.py" filenames. A dunder string built at runtime
# (e.g. "__cl" + "ass__") evades this literal scan. ``str.format``/``format_map`` then
# perform real attribute/item access for that field, so a dynamically built field can
# walk an exposed object's ``__globals__`` (or a generator's frame) all the way to real
# modules and ``__builtins__``. That is information disclosure, NOT code execution: the
# format machinery only ever returns the *repr string* of what it reaches, never a live
# or callable handle, so it cannot escalate to RCE (getattr/type are also withheld). See
# the module docstring's residual note; in-process execution cannot close this.
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


class _AsyncioFacade:
    """A closed, curated subset of :mod:`asyncio` exposed to executed code.

    Code mode needs *some* of ``asyncio`` (e.g. ``await asyncio.sleep(...)`` and
    ``asyncio.gather(...)`` for concurrent tool calls), but injecting the real
    module hands hostile code a transitive path to the host: ``asyncio`` imports
    ``os``/``sys``/``subprocess``, all reachable through plain non-dunder
    attribute chains such as ``asyncio.base_events.os`` or
    ``asyncio.events.sys.modules``. This facade exposes only the coroutine
    helpers an agent legitimately needs.

    It is a **closed allowlist**, not a forwarding proxy: ``__slots__`` is empty
    and there is no ``__getattr__``, so any attribute that is not listed below
    (``base_events``, ``events``, ``get_event_loop``, ``run``, ...) simply raises
    ``AttributeError``. The exposed callables do not themselves leak a module
    graph: a function's ``__globals__`` is a dunder attribute already blocked by
    the AST check. (This narrows the surface; it is not a security boundary on
    its own -- see the module docstring.)
    """

    __slots__ = ()

    # Coroutine combinators.
    sleep = staticmethod(asyncio.sleep)
    gather = staticmethod(asyncio.gather)
    wait = staticmethod(asyncio.wait)
    wait_for = staticmethod(asyncio.wait_for)
    as_completed = staticmethod(asyncio.as_completed)
    shield = staticmethod(asyncio.shield)
    # Synchronization primitives / queues for structuring concurrent work.
    Lock = asyncio.Lock
    Event = asyncio.Event
    Condition = asyncio.Condition
    Semaphore = asyncio.Semaphore
    BoundedSemaphore = asyncio.BoundedSemaphore
    Queue = asyncio.Queue
    QueueEmpty = asyncio.QueueEmpty
    QueueFull = asyncio.QueueFull
    # Exception types for error handling around the above.
    TimeoutError = asyncio.TimeoutError
    CancelledError = asyncio.CancelledError


# Single shared instance; it is immutable (empty __slots__) so sharing is safe.
_ASYNCIO_FACADE = _AsyncioFacade()


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
            # A curated facade, NOT the real module: the real asyncio transitively
            # re-exposes os/sys/subprocess via non-dunder attribute chains.
            "asyncio": _ASYNCIO_FACADE,
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

        Best-effort defense-in-depth. Blocks imports, dunder and interpreter-
        introspection attribute access (``__class__``, ``f_globals``, ``gi_frame``,
        ...), denied/dunder names, and dunder string literals. It does not (and
        cannot) catch every vector, e.g. a dunder name built dynamically at runtime.

        Args:
            source: The (wrapped) Python source to validate.

        Raises:
            UnsafeCodeError: If a disallowed pattern is found.
            SyntaxError: If the source is not valid Python.
        """
        tree = ast.parse(source)

        # Names the code binds locally (assignments, for-targets, with/except-as,
        # function args, comprehension vars). A Load of such a name refers to the
        # local, not the builtin, so it is safe and must not be rejected by rule 3
        # (otherwise harmless code like `type = row["type"]; use(type)` breaks).
        assigned_names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                assigned_names.add(node.id)
            elif isinstance(node, ast.arg):
                assigned_names.add(node.arg)

        for node in ast.walk(tree):
            # 1) No imports.
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                raise UnsafeCodeError("import statements are not allowed in code mode")

            # 2) No dunder attribute access (kills the __class__/__subclasses__ walk)
            #    and no non-dunder interpreter-introspection attributes (frame/code/
            #    generator/coroutine/traceback state that re-expose real globals).
            if isinstance(node, ast.Attribute) and (_DUNDER_RE.match(node.attr) or node.attr in _DENIED_ATTRS):
                raise UnsafeCodeError(f"access to attribute '{node.attr}' is not allowed")

            # 3) No denied names or bare dunder names, but only where they are READ
            #    (ast.Load). Rejecting Store/Del too would break harmless locals like
            #    `type = row["type"]`; the danger is only invoking the real builtin,
            #    which requires a Load. (The builtins themselves are not in the
            #    namespace, so this rule is for clear errors + indirect-lookup defense.)
            if (
                isinstance(node, ast.Name)
                and isinstance(node.ctx, ast.Load)
                and node.id not in assigned_names
                and (node.id in _DENIED_NAMES or _DUNDER_RE.match(node.id))
            ):
                raise UnsafeCodeError(f"use of name '{node.id}' is not allowed")

            # 4) No dunder string literals (blocks getattr/str.format-style escapes).
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                if any(token in node.value for token in _DANGEROUS_DUNDER_STRINGS):
                    raise UnsafeCodeError("string literals referencing dunder attributes are not allowed")

            # 5) No dunder / introspection attribute names in class match patterns.
            #    `case Cls(__class__=x)` performs getattr(subject, "__class__")
            #    internally; the attribute name lives in MatchClass.kwd_attrs as a
            #    plain string, so rules 2-4 never see it. Block the same attribute
            #    set here so pattern matching is not a getattr bypass.
            if isinstance(node, ast.MatchClass):
                for attr_name in node.kwd_attrs:
                    if _DUNDER_RE.match(attr_name) or attr_name in _DENIED_ATTRS:
                        raise UnsafeCodeError(f"access to attribute '{attr_name}' is not allowed")

    @classmethod
    def _warn_insecure_once(cls) -> None:
        """Emit the in-process execution warning a single time per process.

        Guarded so it can never raise: under warnings-as-errors
        (``warnings.simplefilter("error")``) ``warnings.warn`` would otherwise
        raise out of :meth:`execute`, breaking its always-return-an-
        :class:`ExecutionResult` contract.
        """
        if not cls._warned:
            cls._warned = True
            try:
                warnings.warn(
                    "VMCodeExecutor runs agent code in-process and is NOT a security boundary. "
                    "Only use it for trusted code. For untrusted input, run code in an isolated "
                    "sandbox (e.g. an E2B cloud sandbox) instead.",
                    InsecureCodeExecutionWarning,
                    stacklevel=3,
                )
            except InsecureCodeExecutionWarning:
                pass
