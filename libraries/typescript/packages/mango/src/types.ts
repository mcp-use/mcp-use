/**
 * Shared types for Mango AI agent
 */

export interface WorkspaceConfig {
  workspaceDir?: string;
  maxProjects?: number;
}

export interface ProjectInfo {
  name: string;
  path: string;
  template?: string;
  createdAt: Date;
  files: string[];
}

export interface ServerProcess {
  projectName: string;
  pid: number;
  port: number;
  url: string;
  startedAt: Date;
}

export interface MangoConfig {
  workspaceDir?: string;
  llmProvider?: string;
  llmApiKey?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export interface MangoError {
  code: string;
  message: string;
  details?: unknown;
}
