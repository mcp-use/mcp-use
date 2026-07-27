import { z } from "zod";
import type { InferSchema, ToolMetadata } from "xmcp";

export const schema = {
  message: z.string(),
};

export const metadata: ToolMetadata = {
  name: "benchmark_echo",
  description: "Return the supplied message.",
};

export default function benchmarkEcho({
  message,
}: InferSchema<typeof schema>) {
  return {
    content: [{ type: "text", text: message }],
  };
}
