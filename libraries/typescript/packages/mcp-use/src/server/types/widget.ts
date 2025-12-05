import type { AppsSdkMetadata } from "./resource.js";
import type { InputDefinition } from "./common.js";

export interface WidgetMetadata {
  title?: string;
  description?: string;
  inputs?: InputDefinition[];
  _meta?: Record<string, unknown>;
  appsSdkMetadata?: AppsSdkMetadata;
}
