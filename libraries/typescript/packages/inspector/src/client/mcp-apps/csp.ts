import type {
  CspViolation,
  WidgetDeclaredCsp,
} from "@/client/context/WidgetDebugContext";

type ParsedCspPolicy = Record<string, string[]>;

interface CspPolicyDiff {
  directive: string;
  requested: string[];
  effective: string[];
  status: "same" | "changed" | "missing" | "added";
}

interface CspFinding {
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
}

export function buildCSPString(csp: WidgetDeclaredCsp): string {
  const sanitize = (d: string) => d.replace(/['"<>;]/g, "").trim();
  const connectDomains = (csp.connectDomains || [])
    .map(sanitize)
    .filter(Boolean);
  const resourceDomains = (csp.resourceDomains || [])
    .map(sanitize)
    .filter(Boolean);
  const frameDomains = (csp.frameDomains || []).map(sanitize).filter(Boolean);
  const baseUriDomains = (csp.baseUriDomains || [])
    .map(sanitize)
    .filter(Boolean);
  const scriptDirectives = (csp.scriptDirectives || []).filter((directive) =>
    ["'unsafe-eval'", "'wasm-unsafe-eval'"].includes(directive)
  );

  const connectSrc =
    connectDomains.length > 0 ? connectDomains.join(" ") : "'none'";
  const resourceSrc =
    resourceDomains.length > 0
      ? ["data:", "blob:", ...resourceDomains].join(" ")
      : "data: blob:";
  const frameSrc = frameDomains.length > 0 ? frameDomains.join(" ") : "'none'";
  const baseUri =
    baseUriDomains.length > 0 ? baseUriDomains.join(" ") : "'none'";

  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resourceSrc}${
      scriptDirectives.length > 0 ? ` ${scriptDirectives.join(" ")}` : ""
    }`,
    `style-src 'unsafe-inline' ${resourceSrc}`,
    `img-src ${resourceSrc}`,
    `font-src ${resourceSrc}`,
    `media-src ${resourceSrc}`,
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "object-src 'none'",
    `base-uri ${baseUri}`,
  ].join("; ");
}

function parseCspPolicy(policy?: string): ParsedCspPolicy {
  if (!policy) return {};
  const parsed: ParsedCspPolicy = {};
  for (const rawDirective of policy.split(";")) {
    const [directive, ...values] = rawDirective.trim().split(/\s+/);
    if (directive) parsed[directive.toLowerCase()] = values;
  }
  return parsed;
}

export function getRequestedCspPolicy(
  declared?: WidgetDeclaredCsp
): ParsedCspPolicy {
  return declared ? parseCspPolicy(buildCSPString(declared)) : {};
}

export function getEffectiveCspPolicy(policy?: string): ParsedCspPolicy {
  return parseCspPolicy(policy);
}

export function getObservedCspPolicy(
  violations: CspViolation[]
): ParsedCspPolicy {
  const observed: ParsedCspPolicy = {};
  for (const violation of violations) {
    const directive = (
      violation.effectiveDirective ||
      violation.directive ||
      "unknown"
    ).toLowerCase();
    const blockedUri = violation.blockedUri || "(inline)";
    observed[directive] = Array.from(
      new Set([...(observed[directive] ?? []), blockedUri])
    ).sort();
  }
  return observed;
}

export function diffCspPolicies(
  requested: ParsedCspPolicy,
  effective: ParsedCspPolicy
): CspPolicyDiff[] {
  const directives = Array.from(
    new Set([...Object.keys(requested), ...Object.keys(effective)])
  ).sort();

  return directives.map((directive) => {
    const requestedValues = requested[directive] ?? [];
    const effectiveValues = effective[directive] ?? [];
    const normalizedRequested = Array.from(new Set(requestedValues)).sort();
    const normalizedEffective = Array.from(new Set(effectiveValues)).sort();
    const same =
      normalizedRequested.length === normalizedEffective.length &&
      normalizedRequested.every(
        (value, index) => value === normalizedEffective[index]
      );
    return {
      directive,
      requested: requestedValues,
      effective: effectiveValues,
      status: same
        ? "same"
        : requestedValues.length === 0
          ? "added"
          : effectiveValues.length === 0
            ? "missing"
            : "changed",
    };
  });
}

export function diagnoseCsp(options: {
  mode: "permissive" | "widget-declared";
  declared?: WidgetDeclaredCsp;
  effectivePolicy?: string;
  violations: CspViolation[];
}): CspFinding[] {
  const findings: CspFinding[] = [];
  if (!options.declared) {
    findings.push({
      severity: "warning",
      title: "No widget CSP declared",
      detail: "Widget-declared mode blocks external connections and resources.",
    });
  }
  if (options.mode === "permissive") {
    findings.push({
      severity: "info",
      title: "Permissive mode",
      detail: "Observed violations are requests a declared policy would block.",
    });
  }

  const observed = getObservedCspPolicy(options.violations);
  for (const [directive, blockedUris] of Object.entries(observed)) {
    findings.push({
      severity: options.mode === "permissive" ? "warning" : "error",
      title: `${blockedUris.length} blocked by ${directive}`,
      detail: blockedUris.join(", "),
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      title: "No CSP issues observed",
      detail: options.effectivePolicy
        ? "The effective policy has not produced violations."
        : "Load the widget to observe its effective policy.",
    });
  }
  return findings;
}
