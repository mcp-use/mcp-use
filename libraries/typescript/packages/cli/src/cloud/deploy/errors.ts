/** Recovery for a create request that may have succeeded before the timeout. */
export function serverCreationTimeout() {
  return {
    timeout: {
      message:
        "Cloud timed out while creating the server. Creation may still have succeeded. Check your servers before running deploy again.",
      nextSteps: [
        {
          description: "Check whether the server was created",
          command: "mcp-use servers list --json",
        },
        {
          description: "Link this project to an existing server",
          command: "mcp-use link --server <id-or-slug>",
        },
      ],
    },
  };
}

/** Inspect an existing server before starting another deployment. */
export function deploymentStartTimeout(serverId: string) {
  return {
    timeout: {
      message:
        "Cloud timed out while starting the deployment. It may still have started. Check the server's deployments before running deploy again.",
      nextSteps: [
        {
          description: "Check the server's deployments",
          command: `mcp-use deployments list --server ${serverId} --json`,
        },
      ],
    },
  };
}
