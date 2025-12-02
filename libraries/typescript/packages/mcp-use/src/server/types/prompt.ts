import type {
  GetPromptResult,
  GetPromptRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { Icon, InputDefinition } from "./common.js";

export type PromptCallback = (
  params: GetPromptRequest
) => Promise<GetPromptResult>;

export interface PromptDefinition {
  /** Unique identifier for the prompt */
  name: string;
  /** Human-readable title for the prompt */
  title?: string;
  /** Description of what the prompt does */
  description?: string;
  /** Argument definitions */
  args?: InputDefinition[];
  /**
   * An optional list of icons for a prompt.
   * This can be used by clients to display the prompt's icon in a user interface.
   * Each icon should have a `src` property that points to the icon file or data representation, and may also include a `mimeType` and `sizes` property.
   * The `mimeType` property should be a valid MIME type for the icon file, such as "image/png" or "image/svg+xml".
   * The `sizes` property should be a string that specifies one or more sizes at which the icon file can be used, such as "48x48" or "any" for scalable formats like SVG.
   * The `sizes` property is optional, and if not provided, the client should assume that the icon can be used at any size.
   */
  icons?: Icon[];
  /** Async callback function that generates the prompt */
  cb: PromptCallback;
}
