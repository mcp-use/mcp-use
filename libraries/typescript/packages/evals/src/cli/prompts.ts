import { checkbox, select } from "@inquirer/prompts";
import type { ServerSchema } from "../generator/inspectServers.js";

/**
 * Prompt user to select which servers to test.
 *
 * @param schemas - Available server schemas
 * @returns Array of selected server names
 * @internal
 */
export async function selectServers(
  schemas: ServerSchema[]
): Promise<string[]> {
  if (!schemas.length) {
    console.log("No servers available");
    return [];
  }
  return checkbox({
    message: "Select servers to test:",
    choices: schemas.map((schema) => ({
      name: `${schema.name} (${schema.tools.length} tools, ${schema.resources.length} resources)`,
      value: schema.name,
      checked: true,
    })),
  });
}

/**
 * Prompt user to select which tools to test from a server.
 *
 * @param schema - Server schema with available tools
 * @returns Array of selected tool names
 * @internal
 */
export async function selectTools(schema: ServerSchema): Promise<string[]> {
  if (!schema.tools.length) return [];
  return checkbox({
    message: `Select tools from ${schema.name}:`,
    choices: schema.tools.map((tool) => ({
      name: `${tool.name} - ${tool.description}`,
      value: tool.name,
      checked: true,
    })),
  });
}

/**
 * Prompt user to select which resources to test from a server.
 *
 * @param schema - Server schema with available resources
 * @returns Array of selected resource names
 * @internal
 */
export async function selectResources(schema: ServerSchema): Promise<string[]> {
  if (!schema.resources.length) return [];
  return checkbox({
    message: `Select resources from ${schema.name}:`,
    choices: schema.resources.map((resource) => ({
      name: `${resource.name} - ${resource.description || resource.uri}`,
      value: resource.name,
      checked: true,
    })),
  });
}

/**
 * Prompt user to accept, regenerate, or cancel a test plan.
 *
 * @returns User's choice
 * @internal
 */
export async function selectPlanAction(): Promise<
  "yes" | "regenerate" | "cancel"
> {
  return select({
    message: "Accept plan?",
    choices: [
      { name: "Yes - generate code", value: "yes" },
      { name: "Regenerate - ask LLM for new plan", value: "regenerate" },
      { name: "Cancel", value: "cancel" },
    ],
  });
}

export async function selectOutputFormat(): Promise<
  "file" | "stdout" | "clipboard" | "all"
> {
  return select({
    message: "Output format:",
    choices: [
      { name: "Write to file", value: "file" },
      { name: "Copy to clipboard", value: "clipboard" },
      { name: "Print to stdout", value: "stdout" },
      { name: "All of the above", value: "all" },
    ],
  });
}
