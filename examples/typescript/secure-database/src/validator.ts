import pkg from "node-sql-parser";
import type { AST } from "node-sql-parser";

const { Parser } = pkg;

export type UserRole = "unauthenticated" | "public_viewer" | "analyst" | "admin";

export interface ValidationResult {
  valid: boolean;
  sanitizedQuery?: string | undefined;
  astType?: string | undefined;
  tablesAccessed: string[];
  columnsAccessed: string[];
  functionsUsed: string[];
  limitInjected?: number | undefined;
  error?: string | undefined;
}

export const MAX_QUERY_LENGTH = 8192;

export const ALLOWED_FUNCTIONS = new Set<string>([
  "abs",
  "avg",
  "coalesce",
  "count",
  "date",
  "datetime",
  "ifnull",
  "iif",
  "julianday",
  "length",
  "like",
  "lower",
  "ltrim",
  "max",
  "min",
  "nullif",
  "replace",
  "round",
  "rtrim",
  "strftime",
  "substr",
  "substring",
  "sum",
  "time",
  "total",
  "trim",
  "typeof",
  "upper",
]);

export const ROLE_ALLOWED_TABLES: Record<UserRole, readonly string[]> = {
  unauthenticated: [],
  public_viewer: ["customers", "products"],
  analyst: ["customers", "products", "orders"],
  admin: ["customers", "products", "orders", "api_secrets"],
};

export const PII_COLUMNS = new Set<string>([
  "billing_email",
  "stripe_customer_id",
  "secret_token",
  "salary_usd",
  "ssn",
]);

const parser = new Parser();

function isTautologicalCondition(expr: any): boolean {
  if (!expr || typeof expr !== "object") return false;

  // Direct boolean literal true or bare integer 1
  if (expr.type === "bool" && expr.value === true) return true;
  if (expr.type === "number" && expr.value === 1 && !expr.operator) return true;

  // Equality between two identical literals (e.g. 1 = 1, 'a' = 'a')
  if (expr.type === "binary_expr" && (expr.operator === "=" || expr.operator === "==")) {
    const isLit = (t: string) => ["number", "single_quote_string", "string", "bool"].includes(t);
    if (
      expr.left &&
      expr.right &&
      isLit(expr.left.type) &&
      isLit(expr.right.type) &&
      expr.left.type === expr.right.type &&
      expr.left.value === expr.right.value
    ) {
      return true;
    }
  }

  // Check composite conditions
  if (expr.type === "binary_expr") {
    if (expr.operator === "OR") {
      if (isTautologicalCondition(expr.left) || isTautologicalCondition(expr.right)) {
        return true;
      }
    } else if (expr.operator === "AND") {
      if (isTautologicalCondition(expr.left) && isTautologicalCondition(expr.right)) {
        return true;
      }
    }
  }

  return false;
}

function extractFunctionName(nameObj: any): string {
  if (typeof nameObj === "string") return nameObj.toLowerCase();
  if (nameObj && Array.isArray(nameObj.name)) {
    return nameObj.name.map((p: any) => p.value ?? p).join(".").toLowerCase();
  }
  if (nameObj && typeof nameObj.name === "string") return nameObj.name.toLowerCase();
  return String(nameObj ?? "").toLowerCase();
}

function walkAst(node: any, visitor: (n: any) => void) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) walkAst(item, visitor);
    } else if (typeof val === "object" && val !== null) {
      walkAst(val, visitor);
    }
  }
}

export class SQLValidator {
  private lexicalCheck(sql: string): { ok: boolean; reason?: string | undefined } {
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const next = sql[i + 1] ?? "";

      if (char === "'" && !inDoubleQuote) {
        if (inSingleQuote && next === "'") {
          i++;
        } else {
          inSingleQuote = !inSingleQuote;
        }
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        if (inDoubleQuote && next === '"') {
          i++;
        } else {
          inDoubleQuote = !inDoubleQuote;
        }
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote) {
        if (char === "-" && next === "-") {
          return { ok: false, reason: "SQL line comments (--) are prohibited outside string literals." };
        }
        if (char === "/" && next === "*") {
          return { ok: false, reason: "SQL block comments (/* */) are prohibited outside string literals." };
        }
        if (char === ";") {
          const rest = sql.slice(i + 1).trim();
          if (rest.length > 0) {
            return { ok: false, reason: "Stacked/multi-statement queries (;) are prohibited." };
          }
        }
      }
    }

    return { ok: true };
  }

  public validate(rawSql: string, role: UserRole = "analyst"): ValidationResult {
    if (typeof rawSql !== "string") {
      return { valid: false, tablesAccessed: [], columnsAccessed: [], functionsUsed: [], error: "Query must be a string." };
    }

    if (rawSql.length > MAX_QUERY_LENGTH) {
      return {
        valid: false,
        tablesAccessed: [],
        columnsAccessed: [],
        functionsUsed: [],
        error: `Query length (${rawSql.length}) exceeds maximum limit of ${MAX_QUERY_LENGTH} characters.`,
      };
    }

    const trimmed = rawSql.trim().replace(/;+$/, "");
    if (!trimmed) {
      return { valid: false, tablesAccessed: [], columnsAccessed: [], functionsUsed: [], error: "Query is empty." };
    }

    const lex = this.lexicalCheck(trimmed);
    if (!lex.ok) {
      return { valid: false, tablesAccessed: [], columnsAccessed: [], functionsUsed: [], error: lex.reason };
    }

    let ast: AST | AST[];
    try {
      ast = parser.astify(trimmed, { database: "sqlite" });
    } catch (err: any) {
      return {
        valid: false,
        tablesAccessed: [],
        columnsAccessed: [],
        functionsUsed: [],
        error: `SQL Parse Error: ${err.message}`,
      };
    }

    if (Array.isArray(ast)) {
      if (ast.length !== 1) {
        return { valid: false, tablesAccessed: [], columnsAccessed: [], functionsUsed: [], error: "Multi-statement queries are prohibited." };
      }
      ast = ast[0]!;
    }

    if (ast.type !== "select") {
      return {
        valid: false,
        tablesAccessed: [],
        columnsAccessed: [],
        functionsUsed: [],
        error: `Disallowed SQL statement '${ast.type.toUpperCase()}'. Only read-only SELECT statements are permitted.`,
      };
    }

    // 1. Identify CTE bindings (WITH clause) so they are not treated as physical tables
    const cteNames = new Set<string>();
    if (Array.isArray((ast as any).with)) {
      for (const w of (ast as any).with) {
        if (w.name) {
          cteNames.add(String(w.name.value ?? w.name).toLowerCase());
        }
      }
    }

    // 2. Validate joins in top-level FROM clause
    const fromList = (ast as any).from;
    if (Array.isArray(fromList)) {
      for (const item of fromList) {
        if (item.join) {
          const joinType = String(item.join).toUpperCase();
          if (joinType.includes("CROSS") || joinType.includes("NATURAL")) {
            return {
              valid: false,
              tablesAccessed: [],
              columnsAccessed: [],
              functionsUsed: [],
              error: `Disallowed join type '${joinType}'. Explicit JOIN with indexed keys required.`,
            };
          }

          if (item.on && isTautologicalCondition(item.on)) {
            return {
              valid: false,
              tablesAccessed: [],
              columnsAccessed: [],
              functionsUsed: [],
              error: "Tautological JOIN ON condition detected.",
            };
          }
        }
      }
    }

    // 3. Recursive AST traversal: check tables, columns, and functions across the entire query
    const tablesAccessed: string[] = [];
    const columnsAccessed: string[] = [];
    const functionsUsed: string[] = [];
    const allowedTables = new Set(ROLE_ALLOWED_TABLES[role]);

    let traversalError: string | undefined = undefined;

    walkAst(ast, (node) => {
      if (traversalError) return;

      // Check physical table access across all SELECT / subquery FROM clauses
      if (Array.isArray(node.from)) {
        for (const item of node.from) {
          if (item.table && typeof item.table === "string") {
            const tbl = item.table.toLowerCase();
            // Ignore CTE references, virtual tables, or empty values
            if (tbl && !cteNames.has(tbl)) {
              if (!tablesAccessed.includes(tbl)) {
                tablesAccessed.push(tbl);
              }
              if (!allowedTables.has(tbl)) {
                traversalError = `Access denied: table '${tbl}' is not authorized for role '${role}'.`;
                return;
              }
            }
          }
        }
      }

      // Check column references across all clauses
      if (node.type === "column_ref" && node.column) {
        const colName = String(node.column).toLowerCase();
        if (colName !== "*" && !columnsAccessed.includes(colName)) {
          columnsAccessed.push(colName);
        }
        if (PII_COLUMNS.has(colName) && role !== "admin") {
          traversalError = `Access denied: sensitive PII column '${colName}' requires admin privileges.`;
          return;
        }
      }

      // Check SQL functions used across all clauses
      if (node.type === "aggr_func" || node.type === "function") {
        const funcName = extractFunctionName(node.name);
        if (funcName) {
          if (!functionsUsed.includes(funcName)) {
            functionsUsed.push(funcName);
          }
          if (!ALLOWED_FUNCTIONS.has(funcName)) {
            traversalError = `Disallowed SQL function '${funcName}'. Only safe scalar/aggregate functions are allowed.`;
            return;
          }
        }
      }
    });

    if (traversalError) {
      return {
        valid: false,
        tablesAccessed,
        columnsAccessed,
        functionsUsed,
        error: traversalError,
      };
    }

    // 4. Validate and clamp LIMIT clauses
    let limitInjected: number | undefined = undefined;
    const limitObj = (ast as any).limit;

    if (!limitObj || !Array.isArray(limitObj.value) || limitObj.value.length === 0) {
      (ast as any).limit = {
        seperator: "",
        value: [{ type: "number", value: 100 }],
      };
      limitInjected = 100;
    } else {
      // Validate all limit values are non-negative integers
      for (const v of limitObj.value) {
        if (typeof v.value !== "number" || v.value < 0 || !Number.isInteger(v.value)) {
          return {
            valid: false,
            tablesAccessed,
            columnsAccessed,
            functionsUsed,
            error: "Invalid LIMIT clause: Negative or non-integer limit values are prohibited.",
          };
        }
      }

      // Determine which index holds the row count:
      // In comma syntax (LIMIT offset, count), separator is "," -> index 1 is count
      // In offset syntax (LIMIT count OFFSET offset), separator is "offset" -> index 0 is count
      // In single syntax (LIMIT count), separator is "" -> index 0 is count
      const countIdx = limitObj.seperator === "," && limitObj.value.length > 1 ? 1 : 0;
      if (limitObj.value[countIdx].value > 1000) {
        limitObj.value[countIdx].value = 1000;
        limitInjected = 1000;
      }
    }

    let sanitizedQuery = trimmed;
    try {
      sanitizedQuery = parser.sqlify(ast, { database: "sqlite" });
    } catch {
      if (limitInjected && !/\blimit\s+\d+/i.test(sanitizedQuery)) {
        sanitizedQuery = `${sanitizedQuery} LIMIT ${limitInjected}`;
      }
    }

    return {
      valid: true,
      sanitizedQuery,
      astType: "select",
      tablesAccessed,
      columnsAccessed,
      functionsUsed,
      limitInjected,
    };
  }
}

export const sqlValidator = new SQLValidator();
