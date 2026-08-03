import {
  INVALID_PARAMS,
  ProtocolError,
  type McpServer,
  type StandardSchemaV1,
} from "@modelcontextprotocol/server";

import type { SkillsSnapshot } from "./types.js";

function schema<T>(
  validateValue: (value: unknown) => T
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "mcp-use",
      validate(value) {
        try {
          return { value: validateValue(value) };
        } catch (error) {
          return {
            issues: [
              {
                message: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      },
    },
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("params must be an object");
  }
  return value as Record<string, unknown>;
}

const listParams = schema<{ cursor?: string }>((value) => {
  const params = object(value);
  const cursor = params["cursor"];
  if (cursor !== undefined && typeof cursor !== "string") {
    throw new TypeError("cursor must be a string");
  }
  return cursor === undefined ? {} : { cursor };
});
const uriParams = schema<{ uri: string; cursor?: string }>((value) => {
  const params = object(value);
  if (typeof params["uri"] !== "string") {
    throw new TypeError("uri must be a string");
  }
  if (params["cursor"] !== undefined && typeof params["cursor"] !== "string") {
    throw new TypeError("cursor must be a string");
  }
  return {
    uri: params["uri"],
    ...(typeof params["cursor"] === "string" && { cursor: params["cursor"] }),
  };
});
const anyResult = schema<Record<string, unknown>>((value) => object(value));

/**
 * Register SEP-2640 handlers and skill resources on one SDK server.
 *
 * @param server - Fresh request-scoped SDK server.
 * @param snapshot - Immutable skill metadata and contents.
 *
 * @internal
 */
export function registerSkillsRuntime(
  server: McpServer,
  snapshot: SkillsSnapshot
): void {
  const skills = new Map(snapshot.skills.map((skill) => [skill.uri, skill]));
  for (const resource of snapshot.resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      { mimeType: resource.mimeType },
      async () => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            ...(resource.text !== undefined
              ? { text: resource.text }
              : { blob: resource.blob ?? "" }),
          },
        ],
      })
    );
  }

  server.server.setRequestHandler(
    "skills/list",
    { params: listParams, result: anyResult },
    async () => ({ skills: snapshot.skills })
  );
  server.server.setRequestHandler(
    "skills/get",
    { params: uriParams, result: anyResult },
    async ({ uri }) => {
      const skill = skills.get(uri);
      if (skill === undefined) {
        throw new ProtocolError(INVALID_PARAMS, `Unknown skill: ${uri}`);
      }
      return { skill };
    }
  );
  server.server.setRequestHandler(
    "resources/directory/read",
    { params: uriParams, result: anyResult },
    async ({ uri }) => {
      const normalized = uri.replace(/\/$/, "");
      const knownDirectories = new Set(
        snapshot.directories.map((item) => item.uri)
      );
      const prefix = `${normalized}/`;
      const children = new Map<
        string,
        { uri: string; name: string; mimeType: string }
      >();
      for (const resource of snapshot.resources) {
        if (!resource.uri.startsWith(prefix)) continue;
        const remainder = resource.uri.slice(prefix.length);
        const [name] = remainder.split("/");
        if (name === undefined || name === "") continue;
        const childUri = `${normalized}/${name}`;
        children.set(childUri, {
          uri: childUri,
          name: decodeURIComponent(name),
          mimeType: remainder.includes("/")
            ? "inode/directory"
            : resource.mimeType,
        });
      }
      for (const directory of snapshot.directories) {
        if (!directory.uri.startsWith(prefix)) continue;
        const remainder = directory.uri.slice(prefix.length);
        if (remainder === "" || remainder.includes("/")) continue;
        children.set(directory.uri, {
          uri: directory.uri,
          name: directory.name,
          mimeType: "inode/directory",
        });
      }
      if (!knownDirectories.has(normalized)) {
        throw new ProtocolError(
          INVALID_PARAMS,
          `Unknown skill directory: ${uri}`
        );
      }
      return {
        resources: [...children.values()].sort((left, right) =>
          left.uri.localeCompare(right.uri)
        ),
      };
    }
  );
}
