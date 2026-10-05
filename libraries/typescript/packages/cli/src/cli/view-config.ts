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
  let wildcardExport = false;
  const usedConstants = new Set<string>();
  const constantValues = new Map<string, unknown>();
  const scopes = indexScopes(parsed.program);
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
      statement.exportKind !== "type"
    ) {
      if (!statement.exported) {
        wildcardExport = true;
        continue;
      }
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
        if ("regex" in node || "bigint" in node) throw invalid();
        return node.value;
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
      case "TSNonNullExpression":
        return evaluate(node.expression);
      case "Identifier": {
        if (node.name === "undefined" && !scopes.root.bindings.has(node.name))
          return undefined;
        const value = constants.get(node.name);
        if (!value || resolving.has(node.name)) throw invalid();
        resolving.add(node.name);
        const result = evaluate(value);
        constantValues.set(node.name, result);
        if (typeof result === "object" && result !== null)
          usedConstants.add(node.name);
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
  if (exported === undefined) {
    if (wildcardExport) throw invalid();
    return undefined;
  }
  const expression = constants.get(exported);
  if (!expression) throw invalid();
  const config = evaluate(expression);
  usedConstants.add(exported);
  constantValues.set(exported, config);
  assertImmutable(scopes, usedConstants, constantValues, invalid);
  if (config === undefined) return undefined;
  if (typeof config !== "object" || config === null || Array.isArray(config))
    throw invalid();
  // The server and browser share semantic validation through normalizeViewConfig.
  return config as ViewConfig;
}

type Identifier = Extract<ESTree.Node, { type: "Identifier" }>;

type Scope = {
  parent?: Scope;
  functionScope: boolean;
  owner?: ESTree.Node;
  bindings: Map<string, Identifier>;
};
type ScopedNode = {
  node: ESTree.Node;
  scope: Scope;
  parent?: ESTree.Node | undefined;
};

function children(node: ESTree.Node): ESTree.Node[] {
  return Object.values(node).flatMap((value: unknown) => {
    const values = Array.isArray(value) ? value : [value];
    return values.filter(
      (child): child is ESTree.Node =>
        child !== null && typeof child === "object" && "type" in child
    );
  });
}

function bindingIdentifiers(node: ESTree.Node): Identifier[] {
  switch (node.type) {
    case "Identifier":
      return [node];
    case "ObjectPattern":
      return node.properties.flatMap((property) =>
        bindingIdentifiers(
          property.type === "RestElement" ? property.argument : property.value
        )
      );
    case "ArrayPattern":
      return node.elements.flatMap((item) =>
        item ? bindingIdentifiers(item) : []
      );
    case "AssignmentPattern":
      return bindingIdentifiers(node.left);
    case "RestElement":
      return bindingIdentifiers(node.argument);
    default:
      return [];
  }
}

// Resolve references by lexical binding so browser components may freely reuse
// config variable names without being mistaken for writes to the module config.
function indexScopes(program: ESTree.Program) {
  const root: Scope = { functionScope: true, bindings: new Map() };
  const nodes: ScopedNode[] = [];
  const bindings = new Set<ESTree.Node>();
  function bind(pattern: ESTree.Node, scope: Scope) {
    for (const id of bindingIdentifiers(pattern)) {
      scope.bindings.set(id.name, id);
      bindings.add(id);
    }
  }
  function visit(node: ESTree.Node, scope: Scope, parent?: ESTree.Node) {
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "ClassDeclaration") &&
      node.id
    )
      bind(node.id, scope);
    const isFunction =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";
    if (
      isFunction ||
      node.type === "BlockStatement" ||
      node.type === "CatchClause" ||
      node.type === "SwitchStatement" ||
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    )
      scope = {
        parent: scope,
        functionScope: isFunction,
        ...(isFunction ? { owner: node } : {}),
        bindings: new Map(),
      };
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      if (node.type === "FunctionExpression" && node.id) bind(node.id, scope);
      for (const param of node.params) bind(param, scope);
    }
    if (node.type === "CatchClause" && node.param) bind(node.param, scope);
    if (node.type === "VariableDeclaration") {
      let target = scope;
      if (node.kind === "var")
        while (!target.functionScope && target.parent) target = target.parent;
      for (const declaration of node.declarations) bind(declaration.id, target);
    }
    if (node.type === "ImportDeclaration" && node.importKind !== "type")
      for (const specifier of node.specifiers)
        if (
          !(
            specifier.type === "ImportSpecifier" &&
            specifier.importKind === "type"
          )
        )
          bind(specifier.local, scope);
    nodes.push({ node, scope, parent });
    // Type annotations do not contain runtime references.
    if (node.type.startsWith("TS")) {
      if ("expression" in node)
        visit(node.expression as ESTree.Node, scope, node);
      return;
    }
    for (const child of children(node)) visit(child, scope, node);
  }
  visit(program, root);
  return { root, nodes, bindings };
}

function assertImmutable(
  indexed: ReturnType<typeof indexScopes>,
  names: Set<string>,
  constantValues: Map<string, unknown>,
  invalid: () => Error
): void {
  const protectedBindings = new Set<Identifier>();
  for (const name of names) {
    const binding = indexed.root.bindings.get(name);
    if (binding) protectedBindings.add(binding);
  }
  const values = new Map<Identifier, unknown>();
  for (const [name, value] of constantValues) {
    const binding = indexed.root.bindings.get(name);
    if (binding) values.set(binding, value);
  }
  const references = new Map<ESTree.Node, Identifier>();
  for (const { node, scope, parent } of indexed.nodes) {
    if (node.type !== "Identifier" || indexed.bindings.has(node)) continue;
    if (
      parent?.type === "MemberExpression" &&
      parent.property === node &&
      !parent.computed
    )
      continue;
    if (
      (parent?.type === "Property" ||
        parent?.type === "MethodDefinition" ||
        parent?.type === "PropertyDefinition") &&
      parent.key === node &&
      !parent.computed
    )
      continue;
    let current: Scope | undefined = scope;
    while (current) {
      const binding = current.bindings.get(node.name);
      if (binding) {
        references.set(node, binding);
        break;
      }
      current = current.parent;
    }
  }
  const unknown = Symbol("unknown static value");
  // Calls in deferred browser components may consume config references. Calls
  // made while initializing the module must still be checked, including local
  // helpers, aliases, object methods, IIFEs, and callbacks passed to other code.
  const initializers = new Map<Identifier, ESTree.Node>();
  for (const { node } of indexed.nodes) {
    if (node.type === "VariableDeclarator" && node.init) {
      for (const binding of bindingIdentifiers(node.id))
        initializers.set(binding, node.init);
    } else if (
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ClassDeclaration") &&
      node.id
    ) {
      initializers.set(node.id, node);
    }
  }
  const initializingFunctions = new Set<ESTree.Node>();
  function initializationScope(scope: Scope): boolean {
    if (scope.functionScope)
      return !scope.owner || initializingFunctions.has(scope.owner);
    return scope.parent ? initializationScope(scope.parent) : true;
  }
  function activateFunctions(node: ESTree.Node, seen = new Set<ESTree.Node>()) {
    if (seen.has(node)) return;
    seen.add(node);
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      initializingFunctions.add(node);
      return;
    }
    const binding = references.get(node);
    const initializer = binding && initializers.get(binding);
    if (initializer) activateFunctions(initializer, seen);
    for (const child of children(node)) activateFunctions(child, seen);
  }
  let activeCount: number;
  do {
    activeCount = initializingFunctions.size;
    for (const { node, scope } of indexed.nodes) {
      if (!initializationScope(scope)) continue;
      if (node.type === "CallExpression" || node.type === "NewExpression") {
        activateFunctions(node.callee);
        for (const argument of node.arguments) activateFunctions(argument);
      } else if (node.type === "TaggedTemplateExpression") {
        activateFunctions(node.tag);
        for (const expression of node.quasi.expressions)
          activateFunctions(expression);
      }
    }
  } while (activeCount !== initializingFunctions.size);
  function staticValue(node: ESTree.Node): unknown {
    const binding = references.get(node);
    if (binding && values.has(binding)) return values.get(binding);
    if (node.type === "Literal") return node.value;
    if (node.type.startsWith("TS") && "expression" in node)
      return staticValue(node.expression as ESTree.Node);
    if (node.type === "MemberExpression") {
      const object = staticValue(node.object);
      const key =
        !node.computed && node.property.type === "Identifier"
          ? node.property.name
          : staticValue(node.property);
      if (
        object !== null &&
        typeof object === "object" &&
        (typeof key === "string" || typeof key === "number") &&
        Object.hasOwn(object, key)
      )
        return (object as Record<string | number, unknown>)[key];
    }
    return unknown;
  }
  function primitive(value: unknown): boolean {
    return value !== unknown && (value === null || typeof value !== "object");
  }
  function containsProtected(node: ESTree.Node): boolean {
    // Primitive reads cannot leak an object reference to a caller. A shallow
    // copy of primitives likewise has no mutable aliases back to the config.
    if (primitive(staticValue(node))) return false;
    if (node.type === "SpreadElement") {
      const value = staticValue(node.argument);
      if (
        value !== null &&
        typeof value === "object" &&
        Object.values(value).every(primitive)
      )
        return false;
    }
    const binding = references.get(node);
    return (
      (binding !== undefined && protectedBindings.has(binding)) ||
      children(node).some(containsProtected)
    );
  }
  function writeTarget(node: ESTree.Node): boolean {
    if (node.type === "MemberExpression") return containsProtected(node.object);
    const binding = references.get(node);
    return (
      (binding !== undefined && protectedBindings.has(binding)) ||
      children(node).some(writeTarget)
    );
  }
  function aliasValue(
    pattern: ESTree.Node,
    binding: Identifier,
    value: unknown
  ): unknown {
    if (pattern === binding) return value;
    if (
      pattern.type === "ObjectPattern" &&
      value !== null &&
      typeof value === "object"
    ) {
      for (const property of pattern.properties) {
        if (property.type !== "Property" || property.computed) continue;
        const key =
          property.key.type === "Identifier"
            ? property.key.name
            : staticValue(property.key);
        if (typeof key === "string" && Object.hasOwn(value, key)) {
          const result = aliasValue(
            property.value,
            binding,
            (value as Record<string, unknown>)[key]
          );
          if (result !== unknown) return result;
        }
      }
    }
    if (pattern.type === "ArrayPattern" && Array.isArray(value)) {
      for (const [index, item] of pattern.elements.entries()) {
        if (!item) continue;
        const result = aliasValue(item, binding, value[index]);
        if (result !== unknown) return result;
      }
    }
    return unknown;
  }
  // Track aliases, including destructuring and containers holding a config
  // reference. Reject their writes too, without trying to execute statements.
  let changed = true;
  while (changed) {
    changed = false;
    for (const { node } of indexed.nodes) {
      if (
        node.type !== "VariableDeclarator" ||
        !node.init ||
        !containsProtected(node.init)
      )
        continue;
      for (const binding of bindingIdentifiers(node.id)) {
        if (!protectedBindings.has(binding)) {
          protectedBindings.add(binding);
          values.set(
            binding,
            aliasValue(node.id, binding, staticValue(node.init))
          );
          changed = true;
        }
      }
    }
  }
  for (const { node, scope } of indexed.nodes) {
    if (
      (node.type === "AssignmentExpression" &&
        (writeTarget(node.left) || containsProtected(node.right))) ||
      (node.type === "UpdateExpression" && writeTarget(node.argument)) ||
      (node.type === "UnaryExpression" &&
        node.operator === "delete" &&
        writeTarget(node.argument)) ||
      ((node.type === "CallExpression" || node.type === "NewExpression") &&
        initializationScope(scope) &&
        (containsProtected(
          node.callee.type === "MemberExpression"
            ? node.callee.object
            : node.callee
        ) ||
          node.arguments.some(containsProtected))) ||
      ((node.type === "ForInStatement" || node.type === "ForOfStatement") &&
        node.left.type !== "VariableDeclaration" &&
        writeTarget(node.left)) ||
      (node.type === "TaggedTemplateExpression" &&
        initializationScope(scope) &&
        containsProtected(node)) ||
      (node.type === "ReturnStatement" &&
        initializationScope(scope) &&
        node.argument &&
        containsProtected(node.argument))
    )
      throw invalid();
  }
}
