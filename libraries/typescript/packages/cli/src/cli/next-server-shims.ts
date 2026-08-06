/**
 * Inert Next server-runtime exports for a separately running MCP process.
 *
 * @internal
 */
/* eslint-disable jsdoc/require-jsdoc -- shim surface mirrors Next APIs; no-ops need no per-export docs. */
export function revalidatePath(): void {}
export function revalidateTag(): void {}
export function unstable_noStore(): void {}
export function unstable_cacheLife(): void {}
export function unstable_cacheTag(): void {}
export function unstable_cache<T extends (...args: never[]) => unknown>(
  fn: T
): T {
  return fn;
}

export async function headers(): Promise<Headers> {
  return new Headers();
}

const emptyCookies = {
  get: () => undefined,
  getAll: () => [],
  has: () => false,
  set: () => {},
  delete: () => {},
};

export async function cookies(): Promise<typeof emptyCookies> {
  return emptyCookies;
}

export async function draftMode() {
  return { isEnabled: false as const, enable() {}, disable() {} };
}

export function redirect(url: string | URL): never {
  const error = new Error(`redirect(${String(url)}) called outside Next.js`);
  Object.assign(error, { digest: `NEXT_REDIRECT;${String(url)}` });
  throw error;
}
export const permanentRedirect = redirect;

export function notFound(): never {
  const error = new Error("notFound() called outside Next.js");
  Object.assign(error, { digest: "NEXT_NOT_FOUND" });
  throw error;
}

export const RedirectType = { push: "push", replace: "replace" } as const;

export class NextResponse extends Response {
  static override json(data: unknown, init?: ResponseInit): NextResponse {
    const responseHeaders = new Headers(init?.headers);
    responseHeaders.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(data), {
      ...init,
      headers: responseHeaders,
    });
  }

  static override redirect(url: string | URL, status = 302): NextResponse {
    return new NextResponse(null, {
      status,
      headers: { location: String(url) },
    });
  }

  static next(): NextResponse {
    return new NextResponse(null);
  }

  static rewrite(): NextResponse {
    return new NextResponse(null);
  }
}

export class NextRequest extends Request {
  readonly nextUrl: URL;
  readonly cookies = emptyCookies;

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
  }
}

export function userAgent(): Record<string, unknown> {
  return {
    ua: "",
    browser: {},
    device: {},
    engine: {},
    os: {},
    cpu: {},
    isBot: false,
  };
}
/* eslint-enable jsdoc/require-jsdoc */
