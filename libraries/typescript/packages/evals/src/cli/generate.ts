import { Command } from "commander";
import { inspectServers } from "../generator/inspectServers.js";
import { planTests } from "../generator/planTests.js";
import { EvalCodeGenerator } from "../generator/codegen.js";
import type { ServerSchema } from "../generator/inspectServers.js";
import {
  selectOutputFormat,
  selectPlanAction,
  selectResources,
  selectServers,
  selectTools,
} from "./prompts.js";
import { writeOutput } from "./output.js";
import {
  CliExitError,
  EvalConfigError,
  PlannerError,
} from "../shared/errors.js";

export interface GenerateOptions {
  planner: string;
  config: string;
  output?: string;
  plannerBaseUrl?: string;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function sanitizeFilename(name: string): string {
  // Remove or replace filesystem-unfriendly characters
  let sanitized = name
    .replace(/[/\\:*?"<>|]/g, "-") // Replace forbidden characters
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
    .trim()
    .replace(/^\.+/, "") // Remove leading dots
    .replace(/\.+$/, ""); // Remove trailing dots

  // Collapse consecutive separators
  sanitized = sanitized.replace(/[-_]+/g, "-");

  // If sanitization yielded empty string, use a fallback
  if (!sanitized) {
    sanitized = "server";
  }

  return sanitized;
}

function parsePlanner(planner: string): {
  provider: "openai" | "anthropic";
  model: string;
} {
  const [provider, model] = planner.split(":");
  if (!provider || !model) {
    throw new CliExitError(
      "Planner must be in the format provider:model (e.g., openai:gpt-4o-mini)",
      4
    );
  }
  if (provider !== "openai" && provider !== "anthropic") {
    throw new CliExitError(`Unsupported planner provider: ${provider}`, 4);
  }
  return { provider, model };
}

function displayPlans(
  plans: Array<{ server?: string; tools: any[]; resources: any[] }>
) {
  log("\nProposed test plan:\n");
  for (const plan of plans) {
    log(`  ${plan.server ?? "server"}:`);
    for (const tool of plan.tools) {
      log(`    ${tool.name} (${tool.tests.length} tests)`);
    }
    for (const resource of plan.resources) {
      log(`    ${resource.name} (${resource.tests.length} tests)`);
    }
  }
  log("");
}

function filterSchemas(
  schemas: ServerSchema[],
  selections: Record<string, { tools: string[]; resources: string[] }>
): ServerSchema[] {
  return schemas.map((schema) => ({
    name: schema.name,
    tools: schema.tools.filter((tool) =>
      selections[schema.name]?.tools.includes(tool.name)
    ),
    resources: schema.resources.filter((resource) =>
      selections[schema.name]?.resources.includes(resource.name)
    ),
  }));
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  log("📡 Reading eval.config.json...");

  let schemas: ServerSchema[];
  try {
    schemas = await inspectServers({ configPath: options.config });
  } catch (error) {
    if (error instanceof EvalConfigError) {
      throw new CliExitError(error.message, 2, error);
    }
    throw new CliExitError(
      `Failed to connect to servers: ${error instanceof Error ? error.message : String(error)}`,
      3,
      error
    );
  }

  schemas.forEach((schema) => {
    log(
      `✓ Connected to: ${schema.name} (${schema.tools.length} tools, ${schema.resources.length} resources)`
    );
  });

  const selectedServers = await selectServers(schemas);
  if (!selectedServers.length) {
    throw new CliExitError("No servers selected", 130);
  }

  const selections: Record<string, { tools: string[]; resources: string[] }> =
    {};
  for (const serverName of selectedServers) {
    const schema = schemas.find((s) => s.name === serverName);
    if (!schema) continue;
    selections[serverName] = {
      tools: await selectTools(schema),
      resources: await selectResources(schema),
    };
  }

  const filteredSchemas = filterSchemas(
    schemas.filter((schema) => selectedServers.includes(schema.name)),
    selections
  );

  const { provider, model } = parsePlanner(options.planner);

  let plans: Awaited<ReturnType<typeof planTests>>;
  try {
    plans = await planTests(filteredSchemas, {
      provider,
      model,
      baseUrl: options.plannerBaseUrl,
    });
  } catch (error) {
    if (error instanceof PlannerError) {
      throw new CliExitError(error.message, 4, error);
    }
    throw error;
  }
  displayPlans(plans);

  let accepted = false;
  while (!accepted) {
    const action = await selectPlanAction();
    if (action === "yes") {
      accepted = true;
    } else if (action === "regenerate") {
      log("🤖 Regenerating plan...");
      try {
        plans = await planTests(filteredSchemas, {
          provider,
          model,
          baseUrl: options.plannerBaseUrl,
        });
      } catch (error) {
        if (error instanceof PlannerError) {
          throw new CliExitError(error.message, 4, error);
        }
        throw error;
      }
      displayPlans(plans);
    } else {
      throw new CliExitError("Generation cancelled", 130);
    }
  }

  log("🔨 Generating eval code...");
  const generator = new EvalCodeGenerator();

  // Generate code for each plan
  const generatedCodes = plans.map((plan) => generator.generate(plan));

  // Extract imports and bodies
  const importLines = new Set<string>();
  const bodies: string[] = [];

  for (const code of generatedCodes) {
    const lines = code.split("\n");
    let bodyStartIndex = 0;

    // Find where imports end and body begins
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? "";
      if (line.startsWith("import ")) {
        importLines.add(lines[i] ?? "");
      } else if (line && !line.startsWith("//")) {
        bodyStartIndex = i;
        break;
      }
    }

    // Extract body (everything after imports)
    bodies.push(lines.slice(bodyStartIndex).join("\n").trim());
  }

  // Consolidate: imports first, then bodies
  const consolidatedCode = [
    ...Array.from(importLines).sort(),
    "",
    ...bodies,
  ].join("\n");

  const outputMode = await selectOutputFormat();
  const filename =
    options.output ||
    `${selectedServers.map(sanitizeFilename).join("-")}.eval.test.ts`;

  await writeOutput(consolidatedCode, { mode: outputMode, filename });

  log(`\nRun with: npx vitest ${filename}`);
}

export function generateCommand(): Command {
  return new Command("generate")
    .description("Generate eval tests by inspecting MCP servers")
    .option("--planner <model>", "LLM for test planning", "openai:gpt-4o-mini")
    .option("--planner-base-url <url>", "Base URL for planner provider")
    .option("--config <path>", "Path to eval.config.json", "./eval.config.json")
    .option("--output <file>", "Output file path")
    .action(async (options: GenerateOptions) => {
      try {
        await runGenerate(options);
      } catch (error) {
        if (error instanceof CliExitError) {
          log(error.message);
          process.exit(error.exitCode);
        }
        log(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
