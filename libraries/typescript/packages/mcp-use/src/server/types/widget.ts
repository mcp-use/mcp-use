import type { AppsSdkMetadata } from "./resource.js";

export interface WidgetMetadata {
  title?: string;
  description?: string;
  inputs?: any;
  _meta?: Record<string, unknown>;
  appsSdkMetadata?: AppsSdkMetadata;
}
