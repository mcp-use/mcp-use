/**
 * Node.js ESM loader hook that resolves Next.js server-runtime modules to
 * no-op implementations when the MCP server runs outside of Next.js.
 *
 * Registered by `next-shims-register.mjs` when the CLI detects `next` in the
 * user's package.json. See cli/src/utils/next-shims.ts for the host wiring.
 *
 * The mapping covers modules that exist inside a Next.js runtime but have
 * no meaningful behavior outside of it. Each shim is a data: URL so the
 * loader has zero on-disk footprint.
 *
 * The list of specifiers we intercept lives in `next-shims-registry.json`
 * so this file and `next-shims-cjs.cjs` can't drift out of sync. The
 * per-module stub bodies (below) still live here because each one has its
 * own export surface.
 */

import registry from "./next-shims-registry.json" with { type: "json" };

const SHIMS = new Map([
  // `import "server-only"` — throws hard at import time in the real package.
  // In the MCP process there is no client/server boundary to enforce.
  ["server-only", "data:text/javascript,export{};"],

  // `import "client-only"` — symmetric case; also throws in its real form.
  ["client-only", "data:text/javascript,export{};"],

  // `import { revalidatePath, revalidateTag, unstable_cache } from "next/cache"`
  // revalidate* are side-effect functions; unstable_cache wraps a function
  // and returns a memoized version — here we return the original untouched.
  [
    "next/cache",
    "data:text/javascript," +
      encodeURIComponent(
        "export function revalidatePath(){}" +
          "export function revalidateTag(){}" +
          "export function unstable_cache(fn){return fn}" +
          "export function unstable_noStore(){}" +
          "export const unstable_cacheLife = ()=>{};" +
          "export const unstable_cacheTag = ()=>{};"
      ),
  ],

  // `import { headers, cookies, draftMode } from "next/headers"`
  // The real implementation requires an incoming RSC request context. For the
  // MCP server we return inert stand-ins — most tools only read metadata and
  // default to empty values when they're unavailable.
  [
    "next/headers",
    "data:text/javascript," +
      encodeURIComponent(
        "export function headers(){return new Headers();}" +
          "export function cookies(){return{get(){return undefined},getAll(){return []},has(){return false},set(){},delete(){}};}" +
          "export function draftMode(){return{isEnabled:false,enable(){},disable(){}};}"
      ),
  ],

  // `import { redirect, notFound } from "next/navigation"` — server-side
  // helpers. redirect/notFound throw special errors in Next; we keep their
  // throw semantics so callers fail loudly instead of silently continuing.
  [
    "next/navigation",
    "data:text/javascript," +
      encodeURIComponent(
        "export function redirect(u){const e=new Error('redirect('+u+') called outside Next.js');e.digest='NEXT_REDIRECT;'+u;throw e;}" +
          "export function permanentRedirect(u){return redirect(u);}" +
          "export function notFound(){const e=new Error('notFound() called outside Next.js');e.digest='NEXT_NOT_FOUND';throw e;}" +
          "export const RedirectType={push:'push',replace:'replace'};"
      ),
  ],

  // `import { NextResponse, NextRequest } from "next/server"` — thin wrappers
  // around Response/Request. The MCP server rarely needs them, but importing
  // the real module pulls in a lot of Next internals. Provide minimal stubs.
  [
    "next/server",
    "data:text/javascript," +
      encodeURIComponent(
        "export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),{...init,headers:{...(init&&init.headers),'content-type':'application/json'}});}static redirect(url,status){return new Response(null,{status:status||302,headers:{location:String(url)}});}static next(){return new Response(null);}static rewrite(){return new Response(null);}}" +
          "export class NextRequest extends Request{constructor(input,init){super(input,init);this.nextUrl=new URL(typeof input==='string'?input:input.url);this.cookies={get(){return undefined},getAll(){return []},has(){return false},set(){},delete(){}};}}" +
          "export const userAgent=()=>({ua:'',browser:{},device:{},engine:{},os:{},cpu:{},isBot:false});"
      ),
  ],
]);

// Sanity check: every entry in the registry must have a stub body in SHIMS,
// and every stub body must correspond to a registered specifier. Drift here
// means ESM imports succeed while CJS requires fall through (or vice versa),
// which is the exact invariant the registry exists to prevent.
{
  const registered = new Set(registry.shimmedModules);
  for (const key of SHIMS.keys()) {
    if (!registered.has(key)) {
      throw new Error(
        `next-shims-loader: "${key}" has a stub body but is not in next-shims-registry.json`
      );
    }
  }
  for (const key of registered) {
    if (!SHIMS.has(key)) {
      throw new Error(
        `next-shims-loader: "${key}" is in next-shims-registry.json but has no stub body in next-shims-loader.mjs`
      );
    }
  }
}

/**
 * @param {string} specifier
 * @param {{conditions: string[], importAssertions: object, parentURL?: string}} context
 * @param {(specifier: string, context: object) => Promise<{url: string, format?: string, shortCircuit?: boolean}>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  const shim = SHIMS.get(specifier);
  if (shim) {
    return { url: shim, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}
