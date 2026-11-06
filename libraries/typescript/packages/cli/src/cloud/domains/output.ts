import { fields, plain, record, table } from "../../core/format.js";

/** Show readiness and copyable DNS records without assuming verification success. */
export function formatDomain(
  value: unknown,
  serverName: string,
  mcpUrl?: string | null
): string {
  const item = record(value);
  if (!item.domain)
    return [
      `Domains · ${plain(serverName)}`,
      "",
      fields([["MCP URL", mcpUrl]]),
      "No custom domain configured.",
      "Add one: mcp-use domains add mcp.example.com",
    ]
      .filter(Boolean)
      .join("\n");
  const lines = [
    plain(item.domain),
    "",
    fields([
      ["Verification", item.verified ? "Verified" : "Pending"],
      [
        "Hostname",
        item.hostnameReady === undefined
          ? item.status
          : item.hostnameReady
            ? "Ready"
            : "Pending",
      ],
      [
        "Certificate",
        item.certificateReady === undefined
          ? item.sslStatus
          : item.certificateReady
            ? "Ready"
            : "Pending",
      ],
      [
        "DNS connected",
        typeof item.dnsConnected === "boolean"
          ? item.dnsConnected
            ? "Yes"
            : "No"
          : undefined,
      ],
    ]),
  ];
  const records: unknown[][] = [];
  if (typeof item.cnameTarget === "string")
    records.push(["CNAME", item.domain, item.cnameTarget]);
  if (Array.isArray(item.validationRecords))
    for (const value of item.validationRecords) {
      const entry = record(value);
      records.push([entry.type, entry.name, entry.value]);
    }
  if (records.length)
    lines.push("", "DNS records", table(["TYPE", "NAME", "VALUE"], records));
  if (Array.isArray(item.verificationErrors))
    for (const error of item.verificationErrors)
      lines.push(`! ${plain(error)}`);
  if (!item.verified)
    lines.push("", `After updating DNS: mcp-use domains verify`);
  return lines.join("\n");
}
