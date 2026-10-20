import { z } from "zod";

/**
 * The ingest edge's per-event validation, copied from the gateway
 * (`gateway.mcp-use/src/services/sdk-events.ts`, `SdkEventSchema`). The edge
 * rejects a whole event on the first field that fails, so every event the
 * SDK builds must pass it.
 */
const INT32_MAX = 2_147_483_647;
const int32 = z.number().int().min(-2_147_483_648).max(INT32_MAX);
const byteSize = z.number().int().nonnegative().max(INT32_MAX);
const text = (max: number) => z.string().max(max).nullish();
const RESERVED_METHOD =
  /^(?:gateway\/|sse\/|client\/response$|elicitation\/response:|unknown$)/;

const EdgeEventSchema = z.object({
  id: z.string().min(1).max(200),
  time: z.union([
    z
      .string()
      .max(64)
      .regex(/^\d{4}-\d{2}-\d{2}T/),
    z.number(),
  ]),
  duration_ms: z.number().nonnegative().nullish(),
  method: z
    .string()
    .min(1)
    .max(200)
    .refine((method) => !RESERVED_METHOD.test(method), "Reserved method"),
  request_id: z.union([z.string().max(200), z.number()]).nullish(),
  target: text(4096),
  outcome: z.enum(["success", "tool_error", "error"]).nullish(),
  error: z
    .object({ code: int32.nullish(), message: z.string().nullish() })
    .nullish(),
  session_id: text(512),
  conversation_id: text(512),
  client: z.object({ name: text(256), version: text(256) }).nullish(),
  client_info: z.record(z.string(), z.unknown()).nullish(),
  protocol_version: text(64),
  transport: text(32),
  stateless: z.boolean().nullish(),
  http: z
    .object({
      status: z.number().int().min(100).max(599).nullish(),
      method: text(16),
      path: text(2048),
      host: text(260),
      user_agent: text(4096),
      origin: text(2048),
      referer: text(4096),
      country: text(16),
    })
    .nullish(),
  actor: z
    .object({
      token_hash: z
        .string()
        .regex(/^[0-9a-f]{64}$/i)
        .nullish(),
      name: text(1024),
      email: text(1024),
    })
    .nullish(),
  openai: z
    .object({
      session: text(512),
      subject: text(512),
      organization: text(512),
      country: text(16),
    })
    .nullish(),
  trace_id: z
    .string()
    .regex(/^[0-9a-f]{1,64}$/i)
    .nullish(),
  request_size: byteSize.nullish(),
  response_size: byteSize.nullish(),
  request_payload: z.unknown().optional(),
  response_payload: z.unknown().optional(),
});

/** Why the edge would reject `event` (`field: message`), or undefined when it accepts it. */
export function edgeRejection(event: unknown): string | undefined {
  const parsed = EdgeEventSchema.safeParse(event);
  if (parsed.success) return undefined;
  const issue = parsed.error.issues[0];
  return `${issue?.path.join(".") || "event"}: ${issue?.message ?? "invalid"}`;
}
