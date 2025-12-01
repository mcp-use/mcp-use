/**
 * Type guards and utilities for accessing SEP-973 icon metadata on entities
 * until SDK types are updated.
 * 
 * @see https://github.com/modelcontextprotocol/specification/blob/main/SEPs/sep-973-icons-and-website-url.md
 */

import type { Tool, Resource, Prompt } from "@modelcontextprotocol/sdk/types.js";
import type { Icon } from "@/client/components/shared/IconRenderer";

/**
 * Extended Tool type with SEP-973 icon support
 */
export interface ToolWithIcons extends Tool {
  icons?: Icon[];
}

/**
 * Extended Resource type with SEP-973 icon support
 */
export interface ResourceWithIcons extends Resource {
  icons?: Icon[];
}

/**
 * Extended Prompt type with SEP-973 icon support
 */
export interface PromptWithIcons extends Prompt {
  icons?: Icon[];
}

/**
 * Type guard to check if a tool has icons
 */
export function hasToolIcons(tool: Tool): tool is ToolWithIcons {
  return "icons" in tool && Array.isArray((tool as ToolWithIcons).icons);
}

/**
 * Type guard to check if a resource has icons
 */
export function hasResourceIcons(resource: Resource): resource is ResourceWithIcons {
  return "icons" in resource && Array.isArray((resource as ResourceWithIcons).icons);
}

/**
 * Type guard to check if a prompt has icons
 */
export function hasPromptIcons(prompt: Prompt): prompt is PromptWithIcons {
  return "icons" in prompt && Array.isArray((prompt as PromptWithIcons).icons);
}

/**
 * Safely get icons from a tool
 */
export function getToolIcons(tool: Tool): Icon[] | undefined {
  return hasToolIcons(tool) ? tool.icons : undefined;
}

/**
 * Safely get icons from a resource
 */
export function getResourceIcons(resource: Resource): Icon[] | undefined {
  return hasResourceIcons(resource) ? resource.icons : undefined;
}

/**
 * Safely get icons from a prompt
 */
export function getPromptIcons(prompt: Prompt): Icon[] | undefined {
  return hasPromptIcons(prompt) ? prompt.icons : undefined;
}
