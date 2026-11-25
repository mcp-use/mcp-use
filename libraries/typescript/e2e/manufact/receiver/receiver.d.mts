/** Standard Webhooks v1 signature check over `${id}.${timestamp}.${body}`. */
export function verifySignature(
  secret: string | undefined,
  headers: Record<string, unknown>,
  rawBody: string
): boolean;

/** Starts the R1 receiver. `port` 0 picks a free port. */
export function startReceiver(options?: {
  port?: number;
  token?: string;
  host?: string;
}): Promise<{
  url: string;
  close: () => Promise<void>;
}>;
