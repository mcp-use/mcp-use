#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = process.env.PORT || 3000;
const distDir = join(__dirname, "dist");

const mimeTypes = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  const filePath = join(
    distDir,
    req.url === "/" ? "react_example.html" : req.url
  );

  // Security check - prevent directory traversal
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(port, () => {
  console.log(`🚀 React example server running at http://localhost:${port}`);
  console.log(`📁 Serving files from: ${distDir}`);
});
