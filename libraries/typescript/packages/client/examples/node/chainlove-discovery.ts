import { MCPClient, type MCPConnection } from "@mcp-use/client";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const networksSchema = z.object({
  networks: z.array(z.object({ chain: z.string() })),
});

const categoriesSchema = z.object({
  exists: z.boolean(),
  categories: z.array(z.object({ name: z.string() })),
});

const searchSchema = z.object({
  results: z.array(
    z.object({
      service_id: z.string(),
      provider: z.string(),
      title: z.string(),
    })
  ),
  total: z.number().int().nonnegative(),
});

interface DiscoveryClient {
  connect(name: string): Promise<Pick<MCPConnection, "callTool">>;
  close(): Promise<void>;
}

function readResult(
  name: string,
  result: Awaited<ReturnType<MCPConnection["callTool"]>>
): unknown {
  if (result.isError) throw new Error(`${name} returned a tool error`);
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content.find((item) => item.type === "text");
  if (!text) throw new Error(`${name} returned no JSON content`);
  return JSON.parse(text.text) as unknown;
}

export async function discoverInfrastructure(
  client: DiscoveryClient,
  chain = "filecoin",
  category = "apis"
): Promise<z.infer<typeof searchSchema>> {
  try {
    const connection = await client.connect("chainlove");
    const call = async (
      name: string,
      args: Record<string, unknown> = {}
    ): Promise<unknown> =>
      readResult(
        name,
        await connection.callTool(name, args, { timeout: 30_000 })
      );

    const { networks } = networksSchema.parse(await call("discover_networks"));
    if (!networks.some((network) => network.chain === chain)) {
      throw new Error(
        `Unknown network "${chain}". Available: ${networks.map((n) => n.chain).join(", ")}`
      );
    }

    const { exists, categories } = categoriesSchema.parse(
      await call("discover_categories", { chain })
    );
    if (!exists || !categories.some((item) => item.name === category)) {
      throw new Error(
        `Unknown category "${category}" for ${chain}. Available: ${categories.map((c) => c.name).join(", ")}`
      );
    }

    return searchSchema.parse(
      await call("search", { chain, category, limit: 3 })
    );
  } finally {
    await client.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const client = new MCPClient({
    mcpServers: {
      chainlove: {
        url: "https://app.chain.love/mcp",
        oauth: false,
        timeout: 30_000,
      },
    },
  });

  discoverInfrastructure(client, process.argv[2], process.argv[3])
    .then(({ results, total }) => {
      console.log(`Showing ${results.length} of ${total} matching services.`);
      console.table(results);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
