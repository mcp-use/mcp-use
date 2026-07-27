export default {
  paths: {
    tools: "src/tools",
    prompts: false,
    resources: false,
  },
  http: {
    port: Number(process.env.PORT ?? "43100"),
    host: "0.0.0.0",
    endpoint: "/mcp",
  },
};
