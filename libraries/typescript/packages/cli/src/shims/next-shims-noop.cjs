/**
 * No-op CommonJS module used by the CJS shim.
 *
 * `Module._resolveFilename` in `next-shims-cjs.cjs` redirects every shimmed
 * specifier (`server-only`, `next/cache`, etc.) to this file. A single
 * flexible module satisfies all of them because each caller only accesses
 * the exports relevant to its specifier; anything it doesn't touch is
 * harmless.
 *
 * Keep exports aligned with `next-shims-loader.mjs`.
 */

"use strict";

// --- next/cache ------------------------------------------------------------
function revalidatePath() {}
function revalidateTag() {}
function unstable_cache(fn) {
  return fn;
}
function unstable_noStore() {}
const unstable_cacheLife = () => {};
const unstable_cacheTag = () => {};

// --- next/headers ----------------------------------------------------------
function headers() {
  return new Headers();
}
function cookies() {
  return {
    get() {
      return undefined;
    },
    getAll() {
      return [];
    },
    has() {
      return false;
    },
    set() {},
    delete() {},
  };
}
function draftMode() {
  return {
    isEnabled: false,
    enable() {},
    disable() {},
  };
}

// --- next/navigation -------------------------------------------------------
function redirect(url) {
  const err = new Error(`redirect(${url}) called outside Next.js`);
  err.digest = "NEXT_REDIRECT;" + url;
  throw err;
}
function permanentRedirect(url) {
  return redirect(url);
}
function notFound() {
  const err = new Error("notFound() called outside Next.js");
  err.digest = "NEXT_NOT_FOUND";
  throw err;
}
const RedirectType = { push: "push", replace: "replace" };

// --- next/server -----------------------------------------------------------
class NextResponse extends Response {
  static json(data, init) {
    const headers = { ...((init && init.headers) || {}) };
    headers["content-type"] = "application/json";
    return new Response(JSON.stringify(data), { ...init, headers });
  }
  static redirect(url, status) {
    return new Response(null, {
      status: status || 302,
      headers: { location: String(url) },
    });
  }
  static next() {
    return new Response(null);
  }
  static rewrite() {
    return new Response(null);
  }
}

class NextRequest extends Request {
  constructor(input, init) {
    super(input, init);
    this.nextUrl = new URL(typeof input === "string" ? input : input.url);
    this.cookies = {
      get() {
        return undefined;
      },
      getAll() {
        return [];
      },
      has() {
        return false;
      },
      set() {},
      delete() {},
    };
  }
}

function userAgent() {
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

// --- export surface --------------------------------------------------------
// `server-only` / `client-only` exports nothing; the import itself is the
// side effect. Everything else is exported below; callers only read the
// names their specifier exposes.
module.exports = {
  // next/cache
  revalidatePath,
  revalidateTag,
  unstable_cache,
  unstable_noStore,
  unstable_cacheLife,
  unstable_cacheTag,
  // next/headers
  headers,
  cookies,
  draftMode,
  // next/navigation
  redirect,
  permanentRedirect,
  notFound,
  RedirectType,
  // next/server
  NextResponse,
  NextRequest,
  userAgent,
};
