import { lazyBinding, lazyClass, rootRequire } from "./lazy-deprecate.js";

const clientTarget = "@mcp-use/client";
const loadClient = () =>
  rootRequire<typeof import("../client.js")>("client.js");
const loadConfig = () =>
  rootRequire<typeof import("../config-file.js")>("config-file.js");
const loadConnectors = () =>
  rootRequire<typeof import("../connectors/base.js")>("connectors/base.js");
const loadHttp = () =>
  rootRequire<typeof import("../connectors/http.js")>("connectors/http.js");
const loadStdio = () =>
  rootRequire<typeof import("../connectors/stdio.js")>("connectors/stdio.js");
const loadElicitation = () => loadClient();
const loadErrors = () =>
  rootRequire<typeof import("../errors.js")>("errors.js");

export const MCPClient = lazyClass(
  "MCPClient",
  clientTarget,
  () => loadClient().MCPClient
);

export const loadConfigFile = lazyBinding(
  "loadConfigFile",
  clientTarget,
  () => loadConfig().loadConfigFile
);

export const BaseConnector = lazyClass(
  "BaseConnector",
  clientTarget,
  () => loadConnectors().BaseConnector
);

export const HttpConnector = lazyClass(
  "HttpConnector",
  clientTarget,
  () => loadHttp().HttpConnector
);

export const StdioConnector = lazyClass(
  "StdioConnector",
  clientTarget,
  () => loadStdio().StdioConnector
);

export const MCPSession = lazyClass(
  "MCPSession",
  clientTarget,
  () => loadClient().MCPSession
);

export const BaseCodeExecutor = lazyClass(
  "BaseCodeExecutor",
  clientTarget,
  () => loadClient().BaseCodeExecutor
);

export const E2BCodeExecutor = lazyClass(
  "E2BCodeExecutor",
  clientTarget,
  () => loadClient().E2BCodeExecutor
);

export const VMCodeExecutor = lazyClass(
  "VMCodeExecutor",
  clientTarget,
  () => loadClient().VMCodeExecutor
);

export const isVMAvailable = lazyBinding(
  "isVMAvailable",
  clientTarget,
  () => loadClient().isVMAvailable
);

export const accept = lazyBinding(
  "accept",
  clientTarget,
  () => loadElicitation().accept
);
export const acceptWithDefaults = lazyBinding(
  "acceptWithDefaults",
  clientTarget,
  () => loadElicitation().acceptWithDefaults
);
export const applyDefaults = lazyBinding(
  "applyDefaults",
  clientTarget,
  () => loadElicitation().applyDefaults
);
export const cancel = lazyBinding(
  "cancel",
  clientTarget,
  () => loadElicitation().cancel
);
export const decline = lazyBinding(
  "decline",
  clientTarget,
  () => loadElicitation().decline
);
export const getDefaults = lazyBinding(
  "getDefaults",
  clientTarget,
  () => loadElicitation().getDefaults
);
export const reject = lazyBinding(
  "reject",
  clientTarget,
  () => loadElicitation().reject
);
export const validate = lazyBinding(
  "validate",
  clientTarget,
  () => loadElicitation().validate
);

export const ElicitationDeclinedError = lazyClass(
  "ElicitationDeclinedError",
  clientTarget,
  () => loadErrors().ElicitationDeclinedError
);

export const ElicitationTimeoutError = lazyClass(
  "ElicitationTimeoutError",
  clientTarget,
  () => loadErrors().ElicitationTimeoutError
);

export const ElicitationValidationError = lazyClass(
  "ElicitationValidationError",
  clientTarget,
  () => loadErrors().ElicitationValidationError
);

export type { CallToolResult, Notification, Root, Tool } from "../session.js";

export type { NotificationHandler } from "../connectors/base.js";

export type {
  CodeModeConfig,
  E2BExecutorOptions,
  ExecutorOptions,
  MCPClientOptions,
  VMExecutorOptions,
} from "../client.js";

export type {
  ExecutionResult,
  SearchToolsFunction,
  ToolNamespaceInfo,
  ToolSearchResult,
} from "../client/codeExecutor.js";

export type {
  ElicitContent,
  ElicitValidationResult,
} from "../client/elicitation-helpers.js";

export type {
  OnElicitationCallback,
  OnNotificationCallback,
  OnSamplingCallback,
} from "../config.js";
