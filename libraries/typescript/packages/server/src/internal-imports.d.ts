declare module "#mcp-use-node-http" {
  export const createServer: typeof import("node:http").createServer;
}

declare module "#mcp-use-skills-loader" {
  export function discoverConfiguredSkills(
    config: boolean | import("./skills/types.js").SkillsOptions | undefined,
    projectRoot: string,
    conventionalDirectory?: string
  ): import("./skills/types.js").SkillsSnapshot | undefined;
}
