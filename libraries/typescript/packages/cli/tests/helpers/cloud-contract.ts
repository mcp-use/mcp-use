/**
 * Route lookup for the fake Cloud: which generated Cloud route a concrete
 * path belongs to, and the success status it answers with.
 *
 * Reply bodies are checked at compile time instead: `cloud.on` types each
 * reply from the generated client's response types, so a fixture that no
 * longer matches Cloud fails `typecheck` after the client is regenerated.
 */
import {
  cloudRouteKeys,
  cloudRouteSuccessStatus,
  type CloudRoutes,
} from "./cloud-routes.gen.js";

/**
 * The routes (`METHOD /template`) a concrete path matches, most specific
 * first: a literal segment beats a `{param}` segment at the same position.
 */
export function routesMatching(
  method: string,
  path: string
): (keyof CloudRoutes)[] {
  const segments = path.split("/");
  const prefix = `${method.toUpperCase()} `;
  return cloudRouteKeys
    .filter((key) => {
      if (!key.startsWith(prefix)) return false;
      const template = key.slice(prefix.length).split("/");
      return (
        template.length === segments.length &&
        template.every(
          (part, index) =>
            part === segments[index] ||
            (isParam(part) && segments[index] !== "")
        )
      );
    })
    .sort((a, b) => paramCount(a) - paramCount(b));
}

/** The status a reply with no explicit status answers with. */
export function defaultStatus(route: keyof CloudRoutes): number {
  return cloudRouteSuccessStatus[route];
}

function isParam(segment: string): boolean {
  return segment.startsWith("{") && segment.endsWith("}");
}

function paramCount(route: string): number {
  return route.split("/").filter(isParam).length;
}
