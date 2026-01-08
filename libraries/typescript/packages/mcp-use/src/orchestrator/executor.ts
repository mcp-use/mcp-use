import type { MCPAgent } from "mcp-use";
import type {
    OrchestratorOptions,
    StepResult,
    WorkflowContext,
    WorkflowDefinition,
    WorkflowStep,
} from "./types.js";

/**
 * Workflow executor - handles step execution (sequential & parallel)
 */
export class WorkflowExecutor {
    constructor(
        private agents: Record<string, MCPAgent>,
        private options: {
            parallelization?: boolean;
            errorRecovery?: "retry" | "fallback" | "skip";
            maxRetries?: number;
            verbose?: boolean;
        }
    ) { }

    /**
     * Execute workflow steps sequentially
     */
    async executeSequential(
        steps: WorkflowStep[],
        context: WorkflowContext
    ): Promise<StepResult[]> {
        const results: StepResult[] = [];

        for (const step of steps) {
            // Check condition
            if (step.condition && !step.condition(context)) {
                if (this.options.verbose) {
                    console.log(`⏭️  Skipping step ${step.id} (condition not met)`);
                }
                continue;
            }

            const result = await this.executeWithRetry(step, context);
            results.push(result);

            // Store result in context if outputKey is specified
            if (step.outputKey && result.success) {
                context.set(step.outputKey, result.output);
            }

            // Stop on error if not configured to continue
            if (!result.success && this.options.errorRecovery !== "skip") {
                break;
            }
        }

        return results;
    }

    /**
     * Execute workflow steps in parallel
     */
    async executeParallel(
        steps: WorkflowStep[],
        context: WorkflowContext
    ): Promise<StepResult[]> {
        // Filter steps by condition
        const stepsToRun = steps.filter((step) => {
            if (step.condition) {
                return step.condition(context);
            }
            return true;
        });

        if (this.options.verbose) {
            console.log(
                `⚡ Running ${stepsToRun.length} steps in parallel: ${stepsToRun.map((s) => s.id).join(", ")}`
            );
        }

        // Execute all steps in parallel
        const resultPromises = stepsToRun.map((step) =>
            this.executeWithRetry(step, context)
        );

        const results = await Promise.all(resultPromises);

        // Store results in context
        results.forEach((result, index) => {
            const step = stepsToRun[index];
            if (step.outputKey && result.success) {
                context.set(step.outputKey, result.output);
            }
        });

        return results;
    }

    /**
     * Execute a single step with retry logic
     */
    async executeWithRetry(
        step: WorkflowStep,
        context: WorkflowContext
    ): Promise<StepResult> {
        const maxRetries = step.maxRetries ?? this.options.maxRetries ?? 3;
        let retries = 0;
        let lastError: Error | undefined;

        while (retries <= maxRetries) {
            const startTime = Date.now();

            try {
                // Get agent
                const agent = this.agents[step.agent];
                if (!agent) {
                    throw new Error(`Agent not found: ${step.agent}`);
                }

                // Resolve input
                const input =
                    typeof step.input === "function"
                        ? step.input(context)
                        : step.input || "";

                if (this.options.verbose) {
                    console.log(`🚀 Executing step ${step.id} with agent ${step.agent}`);
                    if (retries > 0) {
                        console.log(`  ↻ Retry ${retries}/${maxRetries}`);
                    }
                }

                // Execute agent
                const output = await agent.run(input);

                const durationMs = Date.now() - startTime;

                if (this.options.verbose) {
                    console.log(`✅ Step ${step.id} completed in ${durationMs}ms`);
                }

                return {
                    stepId: step.id,
                    agent: step.agent,
                    input,
                    output,
                    success: true,
                    retries,
                    durationMs,
                    timestamp: new Date(),
                };
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                retries++;

                if (this.options.verbose) {
                    console.error(
                        `❌ Step ${step.id} failed:`,
                        lastError.message
                    );
                }

                // Check if we should retry
                const shouldRetry =
                    retries <= maxRetries &&
                    (step.retryOn === "always" ||
                        step.retryOn === "error" ||
                        this.options.errorRecovery === "retry");

                if (!shouldRetry) {
                    // Try fallback agent if configured
                    if (step.fallbackAgent && this.agents[step.fallbackAgent]) {
                        if (this.options.verbose) {
                            console.log(
                                `🔄 Trying fallback agent: ${step.fallbackAgent}`
                            );
                        }

                        const fallbackStep = { ...step, agent: step.fallbackAgent };
                        return this.executeWithRetry(fallbackStep, context);
                    }

                    // No more retries, return failure
                    break;
                }

                // Wait before retry (exponential backoff)
                const backoffMs = Math.min(1000 * Math.pow(2, retries - 1), 10000);
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }

        // Failed after all retries
        const durationMs = 0;  // Duration not tracked for failed attempts
        return {
            stepId: step.id,
            agent: step.agent,
            input: typeof step.input === "function" ? step.input(context) : step.input || "",
            output: null,
            success: false,
            error: lastError,
            retries: retries - 1,
            durationMs,
            timestamp: new Date(),
        };
    }
}
