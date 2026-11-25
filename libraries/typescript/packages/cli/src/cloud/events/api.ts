/**
 * Manufact Cloud transport for `mcp-use events …` (PLAN.md §11.4). The
 * operations are listed in `scripts/generate-cloud-client.mjs` but are not in
 * the generated Cloud client until the platform spec ships them, so requests
 * go through the connection's fetch client untyped and are typed by
 * `contract.ts` instead. Errors are mapped by the shared `call`.
 */
import type { Client } from "openapi-fetch";

import type { ResolvedProject } from "../project/resolve.js";
import type { CloudEventsResponses } from "./contract.js";

/** Which Cloud environment a command targets; null means production for reads. */
export type CloudTarget = { branch: string } | { production: true } | null;

/** A Cloud events client bound to one server. */
export interface CloudEventsApi {
  /** GET a path relative to `/servers/{id}/events`. */
  get<K extends keyof CloudEventsResponses>(
    op: K,
    path: string,
    query?: Record<string, string | undefined>
  ): Promise<CloudEventsResponses[K]>;
  /** POST a path relative to `/servers/{id}/events`. */
  post<K extends keyof CloudEventsResponses>(
    op: K,
    path: string,
    body?: Record<string, unknown>
  ): Promise<CloudEventsResponses[K]>;
}

/**
 * Bind the events operations to a server id and environment.
 *
 * @param cloud - The project's Cloud connection.
 * @param serverId - The resolved server id.
 * @param target - `--branch`, `--production`, or null.
 */
export function cloudEventsApi(
  cloud: ResolvedProject["cloud"],
  serverId: string,
  target: CloudTarget
): CloudEventsApi {
  // Routes are not in the generated spec yet (see the module comment).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = cloud.client as unknown as Client<any>;
  const base = `/api/v1/servers/${encodeURIComponent(serverId)}/events`;
  const context = { notFound: { code: "not_found" } };
  const scope: Record<string, string | boolean> =
    target === null
      ? {}
      : "branch" in target
        ? { branch: target.branch }
        : { production: true };
  return {
    async get<K extends keyof CloudEventsResponses>(
      _op: K,
      path: string,
      query: Record<string, string | undefined> = {}
    ) {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries({ ...query, ...scope }))
        if (value !== undefined) params[key] = String(value);
      const data: unknown = await cloud.call(
        client.GET(`${base}${path}`, { params: { query: params } }),
        context
      );
      return data as CloudEventsResponses[K];
    },
    async post<K extends keyof CloudEventsResponses>(
      _op: K,
      path: string,
      body: Record<string, unknown> = {}
    ) {
      const data: unknown = await cloud.call(
        client.POST(`${base}${path}`, { body: { ...body, ...scope } }),
        context
      );
      return data as CloudEventsResponses[K];
    },
  };
}
