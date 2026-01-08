import type { MCPAgent } from "mcp-use";

/**
 * Workflow step definition
 */
export interface WorkflowStep {
    /** Unique step identifier */
    id: string;

    /** Agent name to execute (references orchestrator config) */
    agent: string;

    /** Input for this step (string or function that accesses context) */
    input?: string | ((context: WorkflowContext) => string);

    /** Key to store the result in context */
    outputKey?: string;

    /** Condition to determine if step should run */
    condition?: (context: WorkflowContext) => boolean;

    /** Other step IDs to run in parallel with this one */
    parallel?: string[];

    /** When to retry this step */
    retryOn?: "error" | "validation" | "always";

    /** Fallback agent name if this step fails */
    fallbackAgent?: string;

    /** Maximum retries (default: 3) */
    maxRetries?: number;
}

/**
 * Workflow definition
 */
export interface WorkflowDefinition {
    /** Workflow name */
    name: string;

    /** Description of what this workflow does */
    description?: string;

    /** Ordered list of steps */
    steps: WorkflowStep[];

    /** Error handling strategy */
    onError?: "stop" | "continue" | "rollback";

    /** Timeout in milliseconds for entire workflow */
    timeoutMs?: number;
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorOptions {
    /** Map of agent name to MCPAgent instance */
    agents: Record<string, MCPAgent>;

    /** Workflow definition */
    workflow: WorkflowDefinition;

    /** Enable parallel execution where possible */
    parallelization?: boolean;

    /** Error recovery strategy */
    errorRecovery?: "retry" | "fallback" | "skip";

    /** Maximum retries per step */
    maxRetries?: number;

    /** Verbose logging */
    verbose?: boolean;
}

/**
 * Result of a single workflow step
 */
export interface StepResult {
    /** Step ID */
    stepId: string;

    /** Agent name that executed */
    agent: string;

    /** Step input */
    input: string;

    /** Step output */
    output: any;

    /** Success status */
    success: boolean;

    /** Error if failed */
    error?: Error;

    /** Retry count */
    retries: number;

    /** Execution time in ms */
    durationMs: number;

    /** Timestamp */
    timestamp: Date;
}

/**
 * Final workflow result
 */
export interface WorkflowResult {
    /** Workflow name */
    workflow: string;

    /** Success status */
    success: boolean;

    /** Final output (from last step) */
    output: any;

    /** All step results */
    steps: StepResult[];

    /** Total duration in ms */
    totalDurationMs: number;

    /** Context data */
    context: Record<string, any>;

    /** Error if workflow failed */
    error?: Error;
}

/**
 * Workflow execution context
 */
export class WorkflowContext {
    private data: Map<string, any>;

    constructor(initialData?: Record<string, any>) {
        this.data = new Map(Object.entries(initialData || {}));
    }

    set(key: string, value: any): void {
        this.data.set(key, value);
    }

    get(key: string): any {
        return this.data.get(key);
    }

    has(key: string): boolean {
        return this.data.has(key);
    }

    getAll(): Record<string, any> {
        return Object.fromEntries(this.data.entries());
    }

    clear(): void {
        this.data.clear();
    }
}
