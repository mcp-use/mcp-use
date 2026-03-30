import { MCPServer, text } from "mcp-use/server";
import z from "zod";

/**
 * Elicitation Demo — minimal example showing both elicitation modes.
 *
 * Form mode:  ctx.elicit(message, zodSchema) — structured input inline
 * URL mode:   ctx.elicit(message, url)       — opens a page in the browser
 *
 * When the user submits on a URL page, the server calls
 * send_elicit_complete() to tell Claude Code the interaction is done.
 *
 * @see https://code.claude.com/docs/en/hooks#elicitation
 */

const PORT = 3000;

// Stores page submissions and session refs for signaling completion
const submissions: Map<string, Record<string, string>> = new Map();
const pendingElicitations: Map<
  string,
  { sendNotification: any; elicitationId: string }
> = new Map();
let counter = 0;

const server = new MCPServer({
  name: "elicitation-demo",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// URL elicitation pages (plain HTML with real inputs)
// ---------------------------------------------------------------------------

server.get("/consent", (c) => {
  const id = c.req.query("id") ?? "";
  const scope = c.req.query("scope") ?? "read your data";
  return c.html(`<!DOCTYPE html>
<html><body>
  <h2>Authorization Required</h2>
  <p>The application is requesting permission to: <strong>${scope}</strong></p>
  <p><label><input type="checkbox" id="agree"> I agree to grant this permission</label></p>
  <button id="btn" disabled onclick="
    fetch('/submit?id=${id}&agreed=true', {method:'POST'}).then(function() {
      document.getElementById('hint').hidden=false;
    });
    this.textContent='Granted';
    this.disabled=true;
  ">Grant Access</button>
  <p id="hint" hidden><strong>Done!</strong> Claude Code has been notified.</p>
  <script>
    document.getElementById('agree').onchange = function() {
      document.getElementById('btn').disabled = !this.checked;
    };
  </script>
</body></html>`);
});

server.get("/verify", (c) => {
  const id = c.req.query("id") ?? "";
  return c.html(`<!DOCTYPE html>
<html><body>
  <h2>Verification</h2>
  <p>Enter the 4-digit PIN sent to your email:</p>
  <input id="pin" type="text" maxlength="4" placeholder="0000"
    oninput="document.getElementById('btn').disabled = this.value.length !== 4">
  <button id="btn" disabled onclick="
    fetch('/submit?id=${id}&pin=' + document.getElementById('pin').value, {method:'POST'}).then(function() {
      document.getElementById('hint').hidden=false;
    });
    this.textContent='Verified';
    this.disabled=true;
    document.getElementById('pin').disabled=true;
  ">Verify</button>
  <p id="hint" hidden><strong>Done!</strong> Claude Code has been notified.</p>
</body></html>`);
});

// Endpoint for pages to POST submitted data + signal completion
server.post("/submit", async (c) => {
  const url = new URL(c.req.url);
  const id = url.searchParams.get("id") ?? "";
  const data: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== "id") data[k] = v;
  }
  submissions.set(id, data);

  // Signal Claude Code that the URL interaction is complete
  const pending = pendingElicitations.get(id);
  if (pending) {
    pendingElicitations.delete(id);
    await pending.sendNotification("notifications/elicitation/complete", {
      elicitationId: pending.elicitationId,
    });
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Tools — Form elicitation
// ---------------------------------------------------------------------------

/** Form elicitation — collects a text answer */
server.tool(
  {
    name: "ask-question",
    description: "Ask the user a question via form elicitation",
    schema: z.object({
      question: z.string().describe("The question to ask"),
    }),
  },
  async ({ question }, ctx) => {
    const result = await ctx.elicit(
      question,
      z.object({
        answer: z.string().describe("Your answer").default(""),
      })
    );
    if (result.action === "accept") {
      return text(`Answer: ${result.data.answer}`);
    }
    return text(`User ${result.action}d.`);
  }
);

/** Form elicitation — all supported field types */
server.tool(
  {
    name: "collect-feedback",
    description:
      "Collect feedback showing all supported field types (string, number, boolean)",
  },
  async (_params, ctx) => {
    const result = await ctx.elicit(
      "Please share your feedback",
      z.object({
        name: z.string().describe("Your name").default("Anonymous"),
        rating: z.number().min(1).max(10).describe("Rating (1-10)").default(5),
        score: z.number().describe("Score").default(7.5),
        subscribe: z.boolean().describe("Subscribe to updates?").default(false),
        comments: z.string().describe("Any comments?").default(""),
      })
    );
    if (result.action === "accept") {
      const { name, rating, score, subscribe, comments } = result.data;
      return text(
        `Name: ${name}, Rating: ${rating}, Score: ${score}, ` +
          `Subscribe: ${subscribe}, Comments: ${comments}`
      );
    }
    return text(`User ${result.action}d.`);
  }
);

// ---------------------------------------------------------------------------
// Tools — URL elicitation
// ---------------------------------------------------------------------------

/** URL elicitation — consent screen with checkbox */
server.tool(
  {
    name: "request-consent",
    description:
      "Open a consent page where the user must check a box and click Grant",
    schema: z.object({
      scope: z.string().describe("What permission to request"),
    }),
  },
  async ({ scope }, ctx) => {
    const id = String(++counter);
    const elicitationId = `consent-${id}`;

    // Store sendNotification so /submit can signal completion
    pendingElicitations.set(id, {
      sendNotification: ctx.sendNotification,
      elicitationId,
    });

    const url =
      `http://localhost:${PORT}/consent` +
      `?id=${id}&scope=${encodeURIComponent(scope)}`;

    const result = await ctx.elicit(`Grant permission to: ${scope}`, url);

    if (result.action === "accept") {
      const data = submissions.get(id);
      submissions.delete(id);
      pendingElicitations.delete(id);
      if (data?.agreed) {
        return text(`GRANTED: permission to ${scope}`);
      }
      return text(
        "DENIED: elicitation accepted but consent box was not checked on the page."
      );
    }
    pendingElicitations.delete(id);
    return text(`User ${result.action}d.`);
  }
);

/** URL elicitation — PIN verification */
server.tool(
  {
    name: "verify-pin",
    description:
      "Open a verification page where the user enters a 4-digit PIN",
  },
  async (_params, ctx) => {
    const id = String(++counter);
    const elicitationId = `verify-${id}`;

    pendingElicitations.set(id, {
      sendNotification: ctx.sendNotification,
      elicitationId,
    });

    const url = `http://localhost:${PORT}/verify?id=${id}`;
    const result = await ctx.elicit("Enter your verification PIN", url);

    if (result.action === "accept") {
      const data = submissions.get(id);
      submissions.delete(id);
      pendingElicitations.delete(id);
      if (data?.pin) {
        return text(`VERIFIED: PIN is ${data.pin}`);
      }
      return text(
        "FAILED: elicitation accepted but no PIN was entered on the page."
      );
    }
    pendingElicitations.delete(id);
    return text(`User ${result.action}d.`);
  }
);

await server.listen(PORT);
