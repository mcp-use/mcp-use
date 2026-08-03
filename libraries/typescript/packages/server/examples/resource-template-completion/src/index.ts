import { MCPServer } from "mcp-use";

const server = new MCPServer({
  name: "resource-template-completion-example",
  version: "1.0.0",
});

const repositories: Record<string, readonly string[]> = {
  openai: ["codex", "openai-node"],
  modelcontextprotocol: ["typescript-sdk", "specification"],
};

server.resourceTemplate(
  {
    name: "repository-file",
    uriTemplate: "repo://{owner}/{repository}/{path}",
    complete: {
      owner: ["openai", "modelcontextprotocol"],
      repository: (value, context) => {
        const owner = context?.arguments?.owner ?? "";
        return (repositories[owner] ?? []).filter((repository) =>
          repository.startsWith(value)
        );
      },
      path: async (value) =>
        ["README.md", "package.json", "src/index.ts"].filter((path) =>
          path.startsWith(value)
        ),
    },
  },
  async (uri, { owner, repository, path }) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: `${String(owner)}/${String(repository)}/${String(path)}`,
      },
    ],
  })
);

export default server;
