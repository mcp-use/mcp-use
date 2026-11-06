import { readFile } from "node:fs/promises";
// Bundled validation used by the CLI.
// eslint-disable-next-line import/no-extraneous-dependencies
import { z } from "zod";
import { parseDocument } from "../../skills/vendor/yaml-2.8.3.min.js";
import { UsageError } from "../../core/errors.js";

const metric = z.enum([
  "cpu.busyPercent",
  "cpu.stealPercent",
  "memory.usagePercent",
  "request.requests",
  "request.errors",
  "request.errorPercent",
  "request.reachabilityRequests",
  "request.reachableRequests",
  "request.unreachablePercent",
  "deployment.failedCount",
  "deployment.latestOpenFailureAtMs",
  "runtime.serving",
  "tool.calls",
  "tool.errors",
  "tool.errorPercent",
  "authentication.requests",
  "authentication.rejections",
  "authentication.rejectionPercent",
  "token.requests",
  "token.errorPercent",
  "token.latencyP95Ms",
]);
const comparison = z.strictObject({
  metric,
  op: z.enum(["gt", "gte", "lt", "lte", "eq", "ne"]),
  value: z.number().finite(),
});
function group<T extends z.ZodType>(child: T) {
  return z.union([
    comparison,
    z.strictObject({ all: z.array(child).min(1).max(8) }),
    z.strictObject({ any: z.array(child).min(1).max(8) }),
  ]);
}
const condition = group(group(group(comparison)));
const duration = z
  .string()
  .regex(/^(0|[1-9]\d{0,3})[smh]$/)
  .refine((value) => {
    const amount = Number(value.slice(0, -1));
    return (
      amount * ({ s: 1, m: 60, h: 3600 }[value.at(-1)!] ?? Infinity) <= 3600
    );
  }, "Duration must be between 0s and 1h.");
const title = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\r\n]+$/);
const description = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[^\r\n]+$/);
const configSchema = z.strictObject({
  name: title,
  description: description.optional(),
  enabled: z.boolean().optional(),
  trigger: z.strictObject({ when: condition, for: duration }),
  recover: z.strictObject({
    name: title.optional(),
    description: description.optional(),
    when: condition,
    for: duration,
  }),
  notify: z
    .array(
      z.discriminatedUnion("type", [
        z.strictObject({
          type: z.literal("email"),
          recipients: z.array(z.email().max(254)).min(1).max(20).optional(),
        }),
        z.strictObject({
          type: z.literal("slack"),
          channel: z
            .string()
            .max(32)
            .regex(/^[CG][A-Z0-9]{8,}$/)
            .optional(),
        }),
      ])
    )
    .min(1)
    .max(2)
    .refine(
      (items) => new Set(items.map((item) => item.type)).size === items.length,
      "Each notification type may appear once."
    ),
});

/** Read the same public alert YAML fields accepted by the dashboard editor. */
export async function readAlertFile(path: string) {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new UsageError(`Could not read --file ${path}.`);
  }
  if (Buffer.byteLength(source) > 32768)
    throw new UsageError("The alert file must be at most 32 KiB.");
  const document = parseDocument(source, { prettyErrors: false });
  if (document.errors.length > 0)
    throw new UsageError(`Invalid alert YAML: ${document.errors[0]!.message}`);
  let value: unknown;
  try {
    value = document.toJSON();
  } catch {
    throw new UsageError("The alert file could not be decoded as YAML.");
  }
  const result = configSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new UsageError(
      `Invalid alert YAML at ${issue.path.join(".") || "rule"}: ${issue.message}`
    );
  }
  const config = result.data;
  return {
    name: config.name,
    ...(config.description === undefined
      ? {}
      : { description: config.description }),
    ...(config.enabled === undefined ? {} : { enabled: config.enabled }),
    trigger: config.trigger,
    recover: {
      when: config.recover.when,
      for: config.recover.for,
      ...(config.recover.name === undefined
        ? {}
        : { name: config.recover.name }),
      ...(config.recover.description === undefined
        ? {}
        : { description: config.recover.description }),
    },
    notify: config.notify.map((item) =>
      item.type === "email"
        ? {
            type: "email" as const,
            ...(item.recipients === undefined
              ? {}
              : { recipients: item.recipients }),
          }
        : {
            type: "slack" as const,
            ...(item.channel === undefined ? {} : { channel: item.channel }),
          }
    ),
  };
}
