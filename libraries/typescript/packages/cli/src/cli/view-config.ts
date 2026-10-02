import { readFileSync } from "node:fs";
import { parseSync, type ESTree } from "vite";
import type { ViewConfig } from "../views/types.js";

/**
 * Extract the immutable named `viewConfig` export without executing browser
 * components or their imports. Object/array literals, local constants, spreads,
 * and TypeScript `as` / `satisfies` wrappers are supported.
 * @param path - Absolute view module path.
 * @returns Static frontend config, or undefined when the export is absent.
 * @throws When an exported config cannot be evaluated statically.
 * @internal
 */
export function readViewConfig(path: string): ViewConfig | undefined {
  const parsed = parseSync(path, readFileSync(path, "utf8"));
  if (parsed.errors.length) {
    throw new Error(
      `Cannot parse viewConfig in ${path}: ${parsed.errors[0]?.message}`
    );
  }
  const constants = new Map<string, ESTree.Expression>();
  let exported: string | undefined;
  function bindsViewConfig(node: ESTree.Node): boolean {
    switch (node.type) {
      case "Identifier":
        return node.name === "viewConfig";
      case "ObjectPattern":
        return node.properties.some((property) =>
          bindsViewConfig(
            property.type === "RestElement" ? property.argument : property.value
          )
        );
      case "ArrayPattern":
        return node.elements.some(
          (element) => element !== null && bindsViewConfig(element)
        );
      case "RestElement":
        return bindsViewConfig(node.argument);
      case "AssignmentPattern":
        return bindsViewConfig(node.left);
      default:
        return false;
    }
  }
  for (const statement of parsed.program.body) {
    if (
      statement.type === "ExportAllDeclaration" &&
      statement.exported &&
      statement.exportKind !== "type"
    ) {
      const name =
        statement.exported.type === "Identifier"
          ? statement.exported.name
          : statement.exported.value;
      if (name === "viewConfig") throw invalid();
    }
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type === "VariableDeclaration") {
      for (const item of declaration.declarations) {
        if (
          statement.type === "ExportNamedDeclaration" &&
          bindsViewConfig(item.id)
        ) {
          if (
            declaration.kind !== "const" ||
            item.id.type !== "Identifier" ||
            !item.init
          )
            throw invalid();
        }
        if (
          declaration.kind !== "const" ||
          item.id.type !== "Identifier" ||
          !item.init
        )
          continue;
        constants.set(item.id.name, item.init);
        if (
          statement.type === "ExportNamedDeclaration" &&
          item.id.name === "viewConfig"
        ) {
          exported = item.id.name;
        }
      }
    }
    if (
      statement.type === "ExportNamedDeclaration" &&
      statement.exportKind !== "type"
    ) {
      if (
        declaration &&
        "id" in declaration &&
        declaration.id?.type === "Identifier" &&
        declaration.id.name === "viewConfig"
      )
        throw invalid();
      for (const specifier of statement.specifiers) {
        if (specifier.exportKind === "type") continue;
        const name =
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported.value;
        if (name === "viewConfig") {
          if (statement.source) throw invalid();
          if (specifier.local.type !== "Identifier") throw invalid();
          exported = specifier.local.name;
        }
      }
    }
  }
  function invalid(): Error {
    return new Error(
      `Cannot statically extract viewConfig in ${path}. Use an object literal with literal values or local const references; imported values and runtime expressions are not supported.`
    );
  }
  const resolving = new Set<string>();
  function evaluate(node: ESTree.Expression): unknown {
    switch (node.type) {
      case "Literal":
        return node.value;
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
      case "TSNonNullExpression":
        return evaluate(node.expression);
      case "Identifier": {
        if (node.name === "undefined") return undefined;
        const value = constants.get(node.name);
        if (!value || resolving.has(node.name)) throw invalid();
        resolving.add(node.name);
        const result = evaluate(value);
        resolving.delete(node.name);
        return result;
      }
      case "ArrayExpression": {
        const result: unknown[] = [];
        for (const item of node.elements) {
          if (!item) throw invalid();
          if (item.type === "SpreadElement") {
            const value = evaluate(item.argument);
            if (!Array.isArray(value)) throw invalid();
            result.push(...(value as unknown[]));
          } else {
            result.push(evaluate(item));
          }
        }
        return result;
      }
      case "ObjectExpression": {
        const result: Record<string, unknown> = {};
        for (const property of node.properties) {
          if (property.type === "SpreadElement") {
            const value = evaluate(property.argument);
            if (
              typeof value !== "object" ||
              value === null ||
              Array.isArray(value)
            )
              throw invalid();
            Object.assign(result, value);
            continue;
          }
          if (property.kind !== "init" || property.method || property.computed)
            throw invalid();
          const key =
            property.key.type === "Identifier"
              ? property.key.name
              : property.key.type === "Literal"
                ? property.key.value
                : undefined;
          if (typeof key !== "string") throw invalid();
          Object.defineProperty(result, key, {
            value: evaluate(property.value),
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return result;
      }
      default:
        throw invalid();
    }
  }
  if (exported === undefined) return undefined;
  const expression = constants.get(exported);
  if (!expression) throw invalid();
  const config = evaluate(expression);
  if (config === undefined) return undefined;
  if (typeof config !== "object" || config === null || Array.isArray(config))
    throw invalid();
  // The server and browser share semantic validation through normalizeViewConfig.
  return config as ViewConfig;
}
