/**
 * The embedding seam between the Events tab and a webhook inbox (D71).
 *
 * The built implementation, {@link HttpEventsInboxProvider}, talks to the
 * Inspector server's `StorageEventsInbox` routes under
 * `{base}/inspector/api/events`. A host embedding the tab may supply its own.
 */

/** Client profile deliveries are checked against. */
export type EventsInboxProfile = "auto" | "sep-3415" | "openai";

/** A webhook fault the inbox applies to incoming hooks. */
export interface EventsInboxFault {
  /** Fault id, e.g. `status-500`, `timeout`, `bad-challenge`. */
  type:
    | "status-500"
    | "status-410"
    | "status-413"
    | "redirect-307"
    | "timeout"
    | "slow-ack"
    | "pending-503"
    | "bad-challenge"
    | "echo-body";
  /** How many more hooks it applies to; absent means every hook. */
  remaining?: number;
  /** Delay for `timeout` and `slow-ack`, in milliseconds. */
  delayMs?: number;
}

/** One check the inbox ran on a delivery. */
export interface EventsInboxCheck {
  /** Stable check id. */
  id: string;
  /** How strongly the spec requires it. */
  level: "MUST" | "SHOULD" | "INFO";
  /** Whether the delivery passed. */
  ok: boolean;
  /** Human-readable detail. */
  detail?: string;
}

/** One hook the inbox received. */
export interface EventsInboxDelivery {
  /** Position in the inbox log. */
  seq: number;
  /** ISO time it arrived. */
  receivedAt: string;
  /** What the body is. */
  kind: "verification" | "event" | "gap" | "terminated" | "unknown";
  /** Selected request headers. */
  headers: Record<string, string>;
  /** The decoded body text. */
  body: string;
  /** What the inbox answered. */
  response: { status: number; faultApplied?: string };
  /** Checks run on the delivery. */
  checks: EventsInboxCheck[];
}

/** A created inbox. */
export interface EventsInbox {
  /** The inbox id. */
  inboxId: string;
  /** URL to pass as `delivery.url`. */
  callbackUrl: string;
  /** Webhook secret (`whsec_…`) to pass as `delivery.secret`. */
  secret: string;
  /** Bearer token for reading and managing the inbox. */
  readToken: string;
  /** The profile deliveries are checked against. */
  profile: EventsInboxProfile;
  /** The active fault preset. */
  fault: EventsInboxFault | null;
}

/** Changes accepted by {@link EventsInboxProvider.update}. */
export interface EventsInboxPatch {
  /** Mint a new secret; the previous one stays valid for 24 h. */
  rotateSecret?: boolean;
  /** Set or clear the fault preset. */
  fault?: EventsInboxFault | null;
  /** The profile deliveries are checked against. */
  profile?: EventsInboxProfile;
}

/** What the Events tab needs from an inbox. */
export interface EventsInboxProvider {
  /** Creates an inbox. */
  create(profile: EventsInboxProfile): Promise<EventsInbox>;
  /**
   * Streams deliveries after `after`, then live.
   *
   * @returns A function that stops the stream.
   */
  subscribe(
    inbox: EventsInbox,
    after: number | null,
    onDelivery: (delivery: EventsInboxDelivery) => void,
    onError?: (error: Error) => void
  ): () => void;
  /** Rotates the secret, sets a fault preset or the profile. */
  update(
    inbox: EventsInbox,
    patch: EventsInboxPatch
  ): Promise<Pick<EventsInbox, "secret" | "profile" | "fault">>;
  /** Removes the inbox. */
  remove(inbox: EventsInbox): Promise<void>;
}

function decodeBody(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

/**
 * {@link EventsInboxProvider} over the Inspector server routes.
 */
export class HttpEventsInboxProvider implements EventsInboxProvider {
  readonly #base: string;
  readonly #devToken: string | undefined;

  /**
   * @param basePath - Prefix the Inspector server is mounted under; default `""`.
   * @param devToken - `mcp-use dev` token, when the host injected one.
   */
  constructor(basePath = "", devToken?: string) {
    this.#base = `${basePath.replace(/\/$/, "")}/inspector/api/events`;
    this.#devToken = devToken;
  }

  async create(profile: EventsInboxProfile): Promise<EventsInbox> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.#devToken) headers["x-mcp-use-dev-token"] = this.#devToken;
    const res = await fetch(`${this.#base}/inboxes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ profile }),
    });
    if (!res.ok) throw new Error(`creating an inbox failed: ${res.status}`);
    return (await res.json()) as EventsInbox;
  }

  subscribe(
    inbox: EventsInbox,
    after: number | null,
    onDelivery: (delivery: EventsInboxDelivery) => void,
    onError?: (error: Error) => void
  ): () => void {
    const params = new URLSearchParams({ token: inbox.readToken });
    if (after !== null) params.set("after", String(after));
    const source = new EventSource(
      `${this.#base}/inboxes/${inbox.inboxId}/stream?${params}`
    );
    source.addEventListener("delivery", (ev) => {
      try {
        const { seq, delivery } = JSON.parse((ev as MessageEvent).data);
        onDelivery({ ...delivery, seq, body: decodeBody(delivery.body) });
      } catch (error) {
        onError?.(error as Error);
      }
    });
    source.onerror = () => onError?.(new Error("inbox stream interrupted"));
    return () => source.close();
  }

  async update(inbox: EventsInbox, patch: EventsInboxPatch) {
    const res = await fetch(`${this.#base}/inboxes/${inbox.inboxId}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${inbox.readToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`updating the inbox failed: ${res.status}`);
    return (await res.json()) as Pick<
      EventsInbox,
      "secret" | "profile" | "fault"
    >;
  }

  async remove(inbox: EventsInbox): Promise<void> {
    await fetch(`${this.#base}/inboxes/${inbox.inboxId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${inbox.readToken}` },
    });
  }
}
