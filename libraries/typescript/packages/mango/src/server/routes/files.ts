/**
 * File API Routes - Interact with E2B sandbox filesystem
 */
import { Hono } from "hono";
import { conversationSandboxes } from "./chat.js";

const app = new Hono();

/**
 * GET /api/files/tree - Get file tree structure
 */
app.get("/tree", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");

    if (!conversationId) {
      return c.json({ error: "conversationId is required" }, 400);
    }

    const sandboxInfo = conversationSandboxes?.get(conversationId);
    if (!sandboxInfo?.sandbox) {
      return c.json({ error: "Sandbox not found for this conversation" }, 404);
    }

    const sandbox = sandboxInfo.sandbox;

    // List files in /home/user/mcp_project
    const projectPath = "/home/user/mcp_project";

    // Use exec to get tree structure with proper error handling
    const result = await sandbox.commands.run(
      `cd ${projectPath} && find . -type f -o -type d | sort`
    );

    if (!result.stdout) {
      return c.json({ tree: [] });
    }

    // Parse the file tree
    const lines = result.stdout.split("\n").filter((line) => line.trim());
    const tree: any[] = [];

    for (const line of lines) {
      const path = line.replace("./", "");
      if (!path) continue;

      const parts = path.split("/");
      const isDirectory = !path.includes(".");

      tree.push({
        path,
        name: parts[parts.length - 1],
        type: isDirectory ? "directory" : "file",
        depth: parts.length - 1,
      });
    }

    return c.json({ tree });
  } catch (error: any) {
    console.error("Error fetching file tree:", error);
    return c.json({ error: error.message || "Failed to fetch file tree" }, 500);
  }
});

/**
 * GET /api/files/content - Get file content
 */
app.get("/content", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");
    const filePath = c.req.query("filePath");

    if (!conversationId || !filePath) {
      return c.json({ error: "conversationId and filePath are required" }, 400);
    }

    const sandboxInfo = conversationSandboxes?.get(conversationId);
    if (!sandboxInfo?.sandbox) {
      return c.json({ error: "Sandbox not found for this conversation" }, 404);
    }

    const sandbox = sandboxInfo.sandbox;

    // Read file content
    const fullPath = `/home/user/mcp_project/${filePath}`;
    const result = await sandbox.commands.run(`cat "${fullPath}"`);

    if (result.exitCode !== 0) {
      return c.json({ error: `Failed to read file: ${result.stderr}` }, 500);
    }

    return c.json({ content: result.stdout, filePath });
  } catch (error: any) {
    console.error("Error reading file:", error);
    return c.json({ error: error.message || "Failed to read file" }, 500);
  }
});

/**
 * POST /api/files/save - Save file to sandbox
 */
app.post("/save", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");
    const body = await c.req.json();
    const { filePath, content } = body;

    if (!conversationId || !filePath || content === undefined) {
      return c.json(
        { error: "conversationId, filePath, and content are required" },
        400
      );
    }

    const sandboxInfo = conversationSandboxes?.get(conversationId);
    if (!sandboxInfo?.sandbox) {
      return c.json({ error: "Sandbox not found for this conversation" }, 404);
    }

    const sandbox = sandboxInfo.sandbox;

    // Write file content (escape content for shell)
    const fullPath = `/home/user/mcp_project/${filePath}`;
    const escapedContent = content.replace(/'/g, "'\\''");
    const result = await sandbox.commands.run(
      `cat > "${fullPath}" << 'EOF'\n${content}\nEOF`
    );

    if (result.exitCode !== 0) {
      return c.json({ error: `Failed to save file: ${result.stderr}` }, 500);
    }

    return c.json({ success: true, filePath });
  } catch (error: any) {
    console.error("Error saving file:", error);
    return c.json({ error: error.message || "Failed to save file" }, 500);
  }
});

export default app;
