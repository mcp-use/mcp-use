/**
 * Script to verify discrepancies by checking actual SDK exports
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_ROOT = path.resolve(__dirname, "../..");

async function checkSDKExports() {
  console.log("🔍 Verifying Discrepancies Against Actual SDK...\n");

  const typesToCheck = [
    "ToolAnnotations",
    "PromptResult",
    "McpUseProvider",
    "ThemeProvider",
    "AuthRule",
    "AppsSDKUIProvider",
  ];

  const findings: Record<
    string,
    { found: boolean; location?: string; note?: string }
  > = {};

  // Check main server exports
  const serverIndexPath = path.join(PACKAGE_ROOT, "src/server/index.ts");
  const serverIndexContent = fs.readFileSync(serverIndexPath, "utf-8");

  // Check types directory
  const typesPath = path.join(PACKAGE_ROOT, "src/server/types");
  const typeFiles = fs.readdirSync(typesPath).filter((f) => f.endsWith(".ts"));

  // Check react exports (for React components)
  const reactIndexPath = path.join(PACKAGE_ROOT, "src/react/index.ts");
  const reactIndexContent = fs.existsSync(reactIndexPath)
    ? fs.readFileSync(reactIndexPath, "utf-8")
    : "";

  for (const type of typesToCheck) {
    let found = false;
    let location = "";
    let note = "";

    // Check in server exports
    if (serverIndexContent.includes(type)) {
      found = true;
      location = "mcp-use/server";
    }

    // Check in type files
    for (const typeFile of typeFiles) {
      const typeFilePath = path.join(typesPath, typeFile);
      const content = fs.readFileSync(typeFilePath, "utf-8");

      if (
        content.includes(`export type ${type}`) ||
        content.includes(`export interface ${type}`) ||
        content.includes(`export class ${type}`)
      ) {
        found = true;
        location = `mcp-use/server (types/${typeFile})`;
        break;
      }
    }

    // Check React exports (for UI components)
    if (!found && reactIndexContent.includes(type)) {
      found = true;
      location = "mcp-use/react";
      note = "This is a React component, should be imported from mcp-use/react";
    }

    // Special cases
    if (!found) {
      if (type === "McpUseProvider" || type === "ThemeProvider") {
        note =
          "React component - should be imported from mcp-use/react or documented separately";
      } else if (type === "AppsSDKUIProvider") {
        note = "External package - from @mcp-ui/server, not mcp-use";
      } else if (type === "ToolAnnotations") {
        note = "May be internal type or from @modelcontextprotocol/sdk";
      } else if (type === "PromptResult") {
        note = "May be internal type or from @modelcontextprotocol/sdk";
      } else if (type === "AuthRule") {
        note = "May be internal type not exported";
      }
    }

    findings[type] = { found, location, note };
  }

  // Print findings
  console.log("Verification Results:\n");
  console.log(
    "Type                    | Found | Location                          | Note"
  );
  console.log(
    "------------------------|-------|-----------------------------------|------------------------------------------"
  );

  for (const [type, result] of Object.entries(findings)) {
    const typeCol = type.padEnd(23);
    const foundCol = (result.found ? "✅ Yes" : "❌ No").padEnd(7);
    const locCol = (result.location || "-").padEnd(35);
    const noteCol = result.note || "-";
    console.log(`${typeCol} | ${foundCol} | ${locCol} | ${noteCol}`);
  }

  console.log("\n");

  // Summary
  const notFound = Object.entries(findings).filter(([, r]) => !r.found);
  const foundWithNote = Object.entries(findings).filter(
    ([, r]) => r.found && r.note
  );

  if (notFound.length > 0) {
    console.log(`⚠️  ${notFound.length} types not found in SDK:`);
    notFound.forEach(([type, result]) => {
      console.log(
        `   - ${type}: ${result.note || "Not exported from mcp-use"}`
      );
    });
    console.log("");
  }

  if (foundWithNote.length > 0) {
    console.log(`ℹ️  ${foundWithNote.length} types found with notes:`);
    foundWithNote.forEach(([type, result]) => {
      console.log(`   - ${type}: ${result.note}`);
    });
    console.log("");
  }

  const actualIssues = notFound.filter(
    ([, r]) =>
      !r.note?.includes("React component") &&
      !r.note?.includes("External package")
  );

  console.log("📊 Analysis Complete!");
  console.log(`   Total types checked: ${typesToCheck.length}`);
  console.log(
    `   Found in SDK: ${Object.values(findings).filter((r) => r.found).length}`
  );
  console.log(`   Actual documentation issues: ${actualIssues.length}`);
  console.log("");

  return findings;
}

checkSDKExports().catch(console.error);
