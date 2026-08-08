import type {
  CompleteRequestParams,
  CompleteResult,
  Prompt,
  Resource,
  ResourceTemplateType as ResourceTemplate,
  Tool,
} from "@modelcontextprotocol/client";
import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { MCPConnection } from "../core/session.js";
import { Tel } from "../telemetry/telemetry-browser.js";
import { formatMcpNotReadyReason } from "./useMcp-helpers.js";
import type { UseMcpResult } from "./types.js";

type AddLog = (
  level: UseMcpResult["log"][number]["level"],
  message: string,
  ...args: unknown[]
) => void;

type Params = {
  stateRef: RefObject<UseMcpResult["state"]>;
  connectionRef: RefObject<MCPConnection | null>;
  hasClient: () => boolean;
  isMounted: () => boolean;
  setTools: Dispatch<SetStateAction<Tool[]>>;
  setResources: Dispatch<SetStateAction<Resource[]>>;
  setResourceTemplates: Dispatch<SetStateAction<ResourceTemplate[]>>;
  setPrompts: Dispatch<SetStateAction<Prompt[]>>;
  setSkills: Dispatch<SetStateAction<import("../core/skills.js").Skill[]>>;
  addLog: AddLog;
};

function requireConnection(params: Params, operation: string): MCPConnection {
  const connection = params.connectionRef.current;
  if (
    params.stateRef.current !== "ready" ||
    !params.hasClient() ||
    !connection
  ) {
    throw new Error(
      `MCP client is not ready (${formatMcpNotReadyReason(
        params.stateRef.current,
        params.hasClient()
      )}). Cannot ${operation}.`
    );
  }
  return connection;
}

export function useMcpOperations(params: Params) {
  const callTool = useCallback<UseMcpResult["callTool"]>(
    async (name, args, options) => {
      const connection = requireConnection(params, `call tool "${name}"`);
      params.addLog("info", `Calling tool: ${name}`, args);
      const startedAt = Date.now();
      try {
        const result = await connection.callTool(name, args || {}, options);
        params.addLog("info", `Tool "${name}" call successful:`, result);
        Tel.getInstance()
          .trackUseMcpToolCall({
            toolName: name,
            success: true,
            executionTimeMs: Date.now() - startedAt,
          })
          .catch(() => {});
        return result;
      } catch (error) {
        params.addLog("error", `Tool "${name}" call failed:`, error);
        Tel.getInstance()
          .trackUseMcpToolCall({
            toolName: name,
            success: false,
            errorType: error instanceof Error ? error.name : "UnknownError",
            executionTimeMs: Date.now() - startedAt,
          })
          .catch(() => {});
        throw error;
      }
    },
    [params.addLog]
  );

  const listResources = useCallback(async () => {
    const connection = requireConnection(params, "list resources");
    params.addLog("info", "Listing resources");
    const result = await connection.listAllResources();
    params.setResources(result.resources || []);
  }, [params.addLog]);

  const readResource = useCallback(
    async (uri: string) => {
      const connection = requireConnection(params, "read resource");
      params.addLog("info", `Reading resource: ${uri}`);
      try {
        const result = await connection.readResource(uri);
        Tel.getInstance()
          .trackUseMcpResourceRead({ resourceUri: uri, success: true })
          .catch(() => {});
        return result;
      } catch (error) {
        Tel.getInstance()
          .trackUseMcpResourceRead({
            resourceUri: uri,
            success: false,
            errorType: error instanceof Error ? error.name : "UnknownError",
          })
          .catch(() => {});
        throw error;
      }
    },
    [params.addLog]
  );

  const listSkills = useCallback(async () => {
    const connection = requireConnection(params, "list skills");
    params.addLog("info", "Listing skills");
    const result = await connection.listAllSkills();
    params.setSkills(result.skills);
  }, [params.addLog]);

  const getSkill = useCallback(
    async (uri: string) => {
      const connection = requireConnection(params, "get skill");
      params.addLog("info", `Getting skill: ${uri}`);
      return connection.getSkill(uri);
    },
    [params.addLog]
  );

  const readResourceDirectory = useCallback(
    async (uri: string, cursor?: string) => {
      const connection = requireConnection(params, "read resource directory");
      params.addLog("info", `Reading resource directory: ${uri}`);
      return connection.readResourceDirectory(uri, cursor);
    },
    [params.addLog]
  );

  const listPrompts = useCallback(async () => {
    const connection = requireConnection(params, "list prompts");
    params.addLog("info", "Listing prompts");
    const result = await connection.listPrompts();
    params.setPrompts(result.prompts || []);
  }, [params.addLog]);

  const refreshTools = useCallback(async () => {
    if (params.stateRef.current !== "ready" || !params.connectionRef.current)
      return;
    try {
      params.setTools((await params.connectionRef.current.listTools()) || []);
    } catch (error) {
      params.addLog("error", "Failed to refresh tools:", error);
    }
  }, [params.addLog]);

  const refreshResources = useCallback(async () => {
    if (params.stateRef.current !== "ready" || !params.connectionRef.current)
      return;
    try {
      const result = await params.connectionRef.current.listAllResources();
      params.setResources(result.resources || []);
    } catch (error) {
      params.addLog("warn", "Failed to refresh resources:", error);
    }
  }, [params.addLog]);

  const refreshPrompts = useCallback(async () => {
    if (params.stateRef.current !== "ready" || !params.connectionRef.current)
      return;
    try {
      const result = await params.connectionRef.current.listPrompts();
      params.setPrompts(result.prompts || []);
    } catch (error) {
      params.addLog("warn", "Failed to refresh prompts:", error);
    }
  }, [params.addLog]);

  const refreshSkills = useCallback(async () => {
    if (params.stateRef.current !== "ready" || !params.connectionRef.current)
      return;
    try {
      const result = await params.connectionRef.current.listAllSkills();
      params.setSkills(result.skills);
    } catch (error) {
      // A development reload may remove the final skills directory, in which
      // case the replacement server intentionally no longer exposes the
      // extension. Clear the prior snapshot without treating that transition
      // as a connection failure.
      params.setSkills([]);
      params.addLog("debug", "Skills are unavailable after refresh:", error);
    }
  }, [params.addLog]);

  const refreshResourceTemplates = useCallback(async () => {
    const connection = requireConnection(params, "refresh resource templates");
    const result = await connection.listResourceTemplates();
    if (params.isMounted()) {
      params.setResourceTemplates(result.resourceTemplates || []);
    }
  }, [params.addLog]);

  const refreshAll = useCallback(
    () =>
      Promise.all([
        refreshTools(),
        refreshResources(),
        refreshResourceTemplates(),
        refreshPrompts(),
      ]).then(() => undefined),
    [refreshTools, refreshResources, refreshResourceTemplates, refreshPrompts]
  );

  const getPrompt = useCallback(
    async (name: string, args?: Record<string, unknown>) => {
      const connection = requireConnection(params, "get prompt");
      return connection.getPrompt(name, args || {});
    },
    [params.addLog]
  );

  const complete = useCallback(
    async (request: CompleteRequestParams): Promise<CompleteResult> =>
      requireConnection(params, "request completion").complete(request),
    [params.addLog]
  );

  return {
    callTool,
    listResources,
    readResource,
    listSkills,
    getSkill,
    readResourceDirectory,
    listPrompts,
    refreshTools,
    refreshResources,
    refreshPrompts,
    refreshSkills,
    refreshResourceTemplates,
    refreshAll,
    getPrompt,
    complete,
  };
}
