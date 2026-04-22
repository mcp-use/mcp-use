import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const noop = require(
  path.resolve(__dirname, "../src/shims/next-shims-noop.cjs")
);

describe("next-shims-noop (CJS)", () => {
  describe("next/cache stubs", () => {
    it("revalidatePath is a no-op", () => {
      expect(noop.revalidatePath("/foo")).toBeUndefined();
    });

    it("revalidateTag is a no-op", () => {
      expect(noop.revalidateTag("tag")).toBeUndefined();
    });

    it("unstable_cache returns the wrapped function unchanged", () => {
      const fn = async () => 42;
      expect(noop.unstable_cache(fn)).toBe(fn);
    });

    it("unstable_noStore is a no-op", () => {
      expect(noop.unstable_noStore()).toBeUndefined();
    });
  });

  describe("next/headers stubs", () => {
    it("headers() returns an empty Headers instance", () => {
      const h = noop.headers();
      expect(h).toBeInstanceOf(Headers);
      expect([...h.entries()]).toEqual([]);
    });

    it("cookies() returns an object with the expected methods", () => {
      const c = noop.cookies();
      expect(c.get("session")).toBeUndefined();
      expect(c.getAll()).toEqual([]);
      expect(c.has("session")).toBe(false);
      expect(c.set("a", "b")).toBeUndefined();
      expect(c.delete("a")).toBeUndefined();
    });

    it("draftMode() returns { isEnabled: false }", () => {
      const dm = noop.draftMode();
      expect(dm.isEnabled).toBe(false);
      expect(dm.enable()).toBeUndefined();
      expect(dm.disable()).toBeUndefined();
    });
  });

  describe("next/navigation stubs", () => {
    it("redirect() throws with NEXT_REDIRECT digest", () => {
      try {
        noop.redirect("/login");
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.digest).toBe("NEXT_REDIRECT;/login");
      }
    });

    it("permanentRedirect() throws with NEXT_REDIRECT digest", () => {
      try {
        noop.permanentRedirect("/new-url");
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.digest).toMatch(/^NEXT_REDIRECT;/);
      }
    });

    it("notFound() throws with NEXT_NOT_FOUND digest", () => {
      try {
        noop.notFound();
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.digest).toBe("NEXT_NOT_FOUND");
      }
    });

    it("RedirectType has push and replace", () => {
      expect(noop.RedirectType.push).toBe("push");
      expect(noop.RedirectType.replace).toBe("replace");
    });
  });

  describe("next/server stubs", () => {
    it("NextResponse.json() returns a Response with JSON body", async () => {
      const res = noop.NextResponse.json({ ok: true });
      expect(res).toBeInstanceOf(Response);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("NextResponse.redirect() returns a 302 by default", () => {
      const res = noop.NextResponse.redirect("https://example.com");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://example.com");
    });

    it("NextResponse.redirect() accepts a custom status", () => {
      const res = noop.NextResponse.redirect("https://example.com", 301);
      expect(res.status).toBe(301);
    });

    it("NextResponse.next() returns a Response", () => {
      const res = noop.NextResponse.next();
      expect(res).toBeInstanceOf(Response);
    });

    it("NextRequest constructs with .nextUrl and .cookies", () => {
      const req = new noop.NextRequest("https://example.com/path?q=1");
      expect(req.nextUrl).toBeInstanceOf(URL);
      expect(req.nextUrl.pathname).toBe("/path");
      expect(req.nextUrl.searchParams.get("q")).toBe("1");
      expect(req.cookies.get("x")).toBeUndefined();
      expect(req.cookies.getAll()).toEqual([]);
      expect(req.cookies.has("x")).toBe(false);
    });

    it("userAgent() returns stub object", () => {
      const ua = noop.userAgent();
      expect(ua.isBot).toBe(false);
      expect(ua.ua).toBe("");
    });
  });
});
