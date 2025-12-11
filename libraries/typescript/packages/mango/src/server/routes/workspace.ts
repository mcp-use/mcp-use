import { Hono } from "hono";
import { getWorkspaceDir, listProjects } from "../workspace.js";
import { processManager } from "../process-manager.js";

export const workspaceRoutes = new Hono();

/**
 * GET /api/workspace/info
 * Get workspace directory information
 */
workspaceRoutes.get("/info", async (c) => {
  try {
    const workspaceDir = getWorkspaceDir();

    return c.json({
      workspaceDir,
      exists: true,
    });
  } catch (error: any) {
    console.error("Workspace info error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/workspace/projects
 * List all projects in the workspace
 */
workspaceRoutes.get("/projects", async (c) => {
  try {
    const projects = listProjects();

    // Add running status to each project
    const projectsWithStatus = projects.map((project) => ({
      ...project,
      running: processManager.isServerRunning(project.name),
      serverInfo: processManager.getServerStatus(project.name),
    }));

    return c.json({
      projects: projectsWithStatus,
      count: projectsWithStatus.length,
    });
  } catch (error: any) {
    console.error("List projects error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/workspace/projects/:name
 * Get details about a specific project
 */
workspaceRoutes.get("/projects/:name", async (c) => {
  try {
    const projectName = c.req.param("name");
    const projects = listProjects();
    const project = projects.find((p) => p.name === projectName);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const running = processManager.isServerRunning(projectName);
    const serverInfo = processManager.getServerStatus(projectName);

    return c.json({
      ...project,
      running,
      serverInfo: serverInfo
        ? {
            port: serverInfo.port,
            url: serverInfo.url,
            startedAt: serverInfo.startedAt.toISOString(),
          }
        : null,
    });
  } catch (error: any) {
    console.error("Get project error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/workspace/projects/:name/start
 * Start an MCP server for a project
 */
workspaceRoutes.post("/projects/:name/start", async (c) => {
  try {
    const projectName = c.req.param("name");
    const { port } = await c.req.json().catch(() => ({}));

    const projects = listProjects();
    const project = projects.find((p) => p.name === projectName);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const serverProcess = await processManager.startServer(
      project.path,
      projectName,
      port
    );

    return c.json({
      success: true,
      message: "Server started successfully",
      server: {
        projectName: serverProcess.projectName,
        port: serverProcess.port,
        url: serverProcess.url,
        startedAt: serverProcess.startedAt.toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Start server error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/workspace/projects/:name/stop
 * Stop a running MCP server
 */
workspaceRoutes.post("/projects/:name/stop", async (c) => {
  try {
    const projectName = c.req.param("name");

    await processManager.stopServer(projectName);

    return c.json({
      success: true,
      message: "Server stopped successfully",
      projectName,
    });
  } catch (error: any) {
    console.error("Stop server error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/workspace/servers
 * Get all running servers
 */
workspaceRoutes.get("/servers", async (c) => {
  try {
    const servers = processManager.getRunningServers();

    return c.json({
      servers: servers.map((s) => ({
        projectName: s.projectName,
        port: s.port,
        url: s.url,
        startedAt: s.startedAt.toISOString(),
      })),
      count: servers.length,
    });
  } catch (error: any) {
    console.error("Get servers error:", error);
    return c.json({ error: error.message }, 500);
  }
});
