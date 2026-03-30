"""
Elicitation Demo — minimal example showing both elicitation modes.

Form mode:  ctx.elicit(message, schema)  — structured input inline
URL mode:   ctx.elicit_url(message, url) — opens a page in the browser

The URL pages are hosted on this server. When the user submits on
the page, the server calls send_elicit_complete() to tell Claude Code
the interaction is done, which auto-resolves the elicitation.

Run with:  python elicitation_demo.py

See: https://code.claude.com/docs/en/hooks#elicitation
"""

import argparse
from dataclasses import dataclass
from html import escape

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse

from mcp_use.server import Context, MCPServer

PORT = 8000
BASE_URL = f"http://localhost:{PORT}"

# Stores page submissions and the session/elicitation_id needed to signal completion
submissions: dict[str, dict[str, str]] = {}
pending_elicitations: dict[str, dict] = {}  # id -> {session, elicitation_id, request_id}
counter = 0

server = MCPServer(name="elicitation-demo", version="1.0.0")

# ---------------------------------------------------------------------------
# URL elicitation pages (plain HTML with real inputs)
# ---------------------------------------------------------------------------


@server.custom_route("/consent", methods=["GET"])
async def consent_page(request: Request) -> HTMLResponse:
    rid = escape(request.query_params.get("id", ""))
    scope = escape(request.query_params.get("scope", "read your data"))
    return HTMLResponse(f"""<!DOCTYPE html>
<html><body>
  <h2>Authorization Required</h2>
  <p>The application is requesting permission to: <strong>{scope}</strong></p>
  <p><label><input type="checkbox" id="agree"> I agree to grant this permission</label></p>
  <button id="btn" disabled onclick="
    fetch('/submit?id={rid}&agreed=true', {{method:'POST'}}).then(function() {{
      document.getElementById('hint').hidden=false;
    }});
    this.textContent='Granted';
    this.disabled=true;
  ">Grant Access</button>
  <p id="hint" hidden><strong>Done!</strong> Claude Code has been notified.</p>
  <script>
    document.getElementById('agree').onchange = function() {{
      document.getElementById('btn').disabled = !this.checked;
    }};
  </script>
</body></html>""")


@server.custom_route("/verify", methods=["GET"])
async def verify_page(request: Request) -> HTMLResponse:
    rid = escape(request.query_params.get("id", ""))
    return HTMLResponse(f"""<!DOCTYPE html>
<html><body>
  <h2>Verification</h2>
  <p>Enter the 4-digit PIN sent to your email:</p>
  <input id="pin" type="text" maxlength="4" placeholder="0000"
    oninput="document.getElementById('btn').disabled = this.value.length !== 4">
  <button id="btn" disabled onclick="
    fetch('/submit?id={rid}&pin=' + document.getElementById('pin').value, {{method:'POST'}}).then(function() {{
      document.getElementById('hint').hidden=false;
    }});
    this.textContent='Verified';
    this.disabled=true;
    document.getElementById('pin').disabled=true;
  ">Verify</button>
  <p id="hint" hidden><strong>Done!</strong> Claude Code has been notified.</p>
</body></html>""")


@server.custom_route("/submit", methods=["POST"])
async def submit_route(request: Request) -> JSONResponse:
    params = dict(request.query_params)
    rid = params.pop("id", "")
    submissions[rid] = params
    print(f"[submit] id={rid}, data={params}, pending_keys={list(pending_elicitations.keys())}")

    # Signal Claude Code that the URL interaction is complete
    pending = pending_elicitations.pop(rid, None)
    if pending:
        print(f"[submit] sending elicit_complete for elicitation_id={pending['elicitation_id']}")
        try:
            await pending["session"].send_elicit_complete(
                elicitation_id=pending["elicitation_id"],
                related_request_id=pending["request_id"],
            )
            print("[submit] elicit_complete sent successfully")
        except Exception as e:
            print(f"[submit] elicit_complete FAILED: {e}")
    else:
        print(f"[submit] WARNING: no pending elicitation found for id={rid}")

    return JSONResponse({"ok": True})


# ---------------------------------------------------------------------------
# Tools — Form elicitation
# ---------------------------------------------------------------------------


@dataclass
class AnswerSchema:
    answer: str = ""


@server.tool()
async def ask_question(question: str, context: Context = None) -> str:  # type: ignore[assignment]
    """Ask the user a question via form elicitation."""
    result = await context.elicit(message=question, schema=AnswerSchema)
    if result.action == "accept":
        return f"Answer: {result.data.answer}"
    return f"User {result.action}d."


@dataclass
class FeedbackSchema:
    """Shows all supported field types in form elicitation."""

    name: str = "Anonymous"
    rating: int = 5
    score: float = 7.5
    subscribe: bool = False
    comments: str = ""


@server.tool()
async def collect_feedback(context: Context = None) -> str:  # type: ignore[assignment]
    """Collect feedback using all supported field types (str, int, float, bool)."""
    result = await context.elicit(message="Please share your feedback", schema=FeedbackSchema)
    if result.action == "accept":
        d = result.data
        return (
            f"Name: {d.name}, Rating: {d.rating}, Score: {d.score}, "
            f"Subscribe: {d.subscribe}, Comments: {d.comments}"
        )
    return f"User {result.action}d."


# ---------------------------------------------------------------------------
# Tools — URL elicitation
# ---------------------------------------------------------------------------


@server.tool()
async def request_consent(scope: str, context: Context = None) -> str:  # type: ignore[assignment]
    """Open a consent page where the user must check a box and click Grant."""
    global counter  # noqa: PLW0603
    counter += 1
    rid = str(counter)
    elicitation_id = f"consent-{rid}"

    # Store session so /submit can call send_elicit_complete
    pending_elicitations[rid] = {
        "session": context.request_context.session,
        "elicitation_id": elicitation_id,
        "request_id": context.request_id,
    }
    print(f"[consent] registered pending id={rid}, elicitation_id={elicitation_id}")

    url = f"{BASE_URL}/consent?id={rid}&scope={scope}"
    result = await context.elicit_url(f"Grant permission to: {scope}", url, elicitation_id=elicitation_id)
    print(f"[consent] elicit_url returned: action={result.action}")

    if result.action == "accept":
        data = submissions.pop(rid, None)
        pending_elicitations.pop(rid, None)
        if data and data.get("agreed"):
            return f"GRANTED: permission to {scope}"
        return "DENIED: elicitation accepted but consent box was not checked on the page."
    pending_elicitations.pop(rid, None)
    return f"User {result.action}d."


@server.tool()
async def verify_pin(context: Context = None) -> str:  # type: ignore[assignment]
    """Open a verification page where the user enters a 4-digit PIN."""
    global counter  # noqa: PLW0603
    counter += 1
    rid = str(counter)
    elicitation_id = f"verify-{rid}"

    pending_elicitations[rid] = {
        "session": context.request_context.session,
        "elicitation_id": elicitation_id,
        "request_id": context.request_id,
    }
    print(f"[verify] registered pending id={rid}, elicitation_id={elicitation_id}")

    url = f"{BASE_URL}/verify?id={rid}"
    result = await context.elicit_url("Enter your verification PIN", url, elicitation_id=elicitation_id)
    print(f"[verify] elicit_url returned: action={result.action}")

    if result.action == "accept":
        data = submissions.pop(rid, None)
        pending_elicitations.pop(rid, None)
        if data and data.get("pin"):
            return f"VERIFIED: PIN is {data['pin']}"
        return "FAILED: elicitation accepted but no PIN was entered on the page."
    pending_elicitations.pop(rid, None)
    return f"User {result.action}d."


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Elicitation Demo")
    parser.add_argument("--transport", default="streamable-http", choices=["stdio", "streamable-http"])
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    server.run(transport=args.transport, host="127.0.0.1", port=args.port)  # type: ignore[arg-type]
