import type { MCPAgent } from "mcp-use";
import { WorkflowContext } from "./context.js";
import { WorkflowExecutor } from "./executor.js";
import type {
    OrchestratorOptions,
    StepResult,
    WorkflowResult,
    WorkflowStep,
} from "./types.js";
import { validateWorkflow } from "./validation.js";

/**
 * Multi-Agent Orchestrator
 *
 * Manages execution of multi-agent workflows with support for:
 * - Sequential and parallel execution
 * - Agent-to-agent data passing via context
 * - Error recovery with retry and fallback strategies
 * - Conditional step execution
 *
 * @example
 * ```typescript
 * const orchestrator = new MCPOrchestrator({
 *   agents: {
 *     researcher: new MCPAgent({ llm, client }),
 *     writer: new MCPAgent({ llm, client }),
 *   },
 *   workflow: {
 *     name: "research-and-write",
 *     steps: [
 *       { id: "research", agent: "researcher", outputKey: "research" },
 *       { id: "write", agent: "writer", input: (ctx) => ctx.get("research") },
 *     ],
 *   },
 * });
 *
 * const result = await orchestrator.run("Write about AI agents");
 * ```
 */
export class MCPOrchestrator {
    private agents: Record<string, MCPAgent>;
    private workflow: OrchestratorOptions["workflow"];
    private options: Pick<
        OrchestratorOptions,
        "parallelization" | "errorRecovery" | "maxRetries" | "verbose"
    >;
    private executor: WorkflowExecutor;
    private executionTrace: StepResult[] = [];

    constructor(options: OrchestratorOptions) {
        this.agents = options.agents;
        this.workflow = options.workflow;
        this.options = {
            parallelization: options.parallelization ?? true,
            errorRecovery: options.errorRecovery ?? "retry",
            maxRetries: options.maxRetries ?? 3,
            verbose: options.verbose ?? false,
        };

        // Validate workflow
        validateWorkflow(this.workflow, this.agents);

        // Create executor
        this.executor = new WorkflowExecutor(this.agents, this.options);

        if (this.options.verbose) {
            console.log(`🎯 Orchestrator initialized for workflow: ${this.workflow.name}`);
            console.log(`   Agents: ${Object.keys(this.agents).join(", ")}`);
            console.log(`   Steps: ${this.workflow.steps.length}`);
        }
    }

    /**
     * Run the complete workflow
     */
    async run(initialInput: string): Promise<WorkflowResult> {
        const startTime = Date.now();
        const context = new WorkflowContext({ input: initialInput });
        this.executionTrace = [];

        if (this.options.verbose) {
            console.log(`\n🚀 Starting workflow: ${this.workflow.name}`);
            console.log(`   Input: ${initialInput}\n`);
        }

        try {
            // Group steps by parallelization
            const stepGroups = this.groupStepsByParallelization();

            // Execute each group
            for (const group of stepGroups) {
                let groupResults: StepResult[];

                if (group.length === 1) {
                    // Single step - execute sequentially
                    groupResults = await this.executor.executeSequential(group, context);
                } else if (this.options.parallelization) {
                    // Multiple steps - execute in parallel
                    groupResults = await this.executor.executeParallel(group, context);
                } else {
                    // Parallelization disabled - execute sequentially
                    groupResults = await this.executor.executeSequential(group, context);
                }

                this.executionTrace.push(...groupResults);

                // Check for failures
                const failed = groupResults.filter((r) => !r.success);
                if (failed.length > 0 && this.workflow.onError === "stop") {
                    throw new Error(
                        `Workflow stopped due to step failures: ${failed.map((r) => r.stepId).join(", ")}`
                    );
                }
            }

            const totalDurationMs = Date.now() - startTime;

            // Get final output (from last successful step)
            const lastSuccessful = [...this.executionTrace]
                .reverse()
                .find((r) => r.success);

            const result: WorkflowResult = {
                workflow: this.workflow.name,
                success: this.executionTrace.every((r) => r.success),
                output: lastSuccessful?.output,
                steps: this.executionTrace,
                totalDurationMs,
                context: context.getAll(),
            };

            if (this.options.verbose) {
                console.log(`\n✅ Workflow completed in ${totalDurationMs}ms`);
                console.log(`   Total steps: ${this.executionTrace.length}`);
                console.log(
                    `   Successful: ${this.executionTrace.filter((r) => r.success).length}`
                );
                console.log(
                    `   Failed: ${this.executionTrace.filter((r) => !r.success).length}\n`
                );
            }

            return result;
        } catch (error) {
            const totalDurationMs = Date.now() - startTime;

            if (this.options.verbose) {
                console.error(`\n❌ Workflow failed after ${totalDurationMs}ms`);
                console.error(`   Error: ${error instanceof Error ? error.message : String(error)}\n`);
            }

            return {
                workflow: this.workflow.name,
                success: false,
                output: null,
                steps: this.executionTrace,
                totalDurationMs,
                context: context.getAll(),
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    /**
     * Run a single step (useful for testing or manual execution)
     */
    async runStep(stepId: string, input: any): Promise<StepResult> {
        const step = this.workflow.steps.find((s) => s.id === stepId);
        if (!step) {
            throw new Error(`Step not found: ${stepId}`);
        }

        const context = new WorkflowContext({ manualInput: input });
        return this.executor.executeWithRetry(step, context);
    }

    /**
     * Get execution trace (all step results)
     */
    getExecutionTrace(): StepResult[] {
        return [...this.executionTrace];
    }

    /**
     * Group steps by parallelization hints
     */
    private groupStepsByParallelization(): WorkflowStep[][] {
        const groups: WorkflowStep[][] = [];
        const processed = new Set<string>();

        for (const step of this.workflow.steps) {
            if (processed.has(step.id)) continue;

            // If step has parallel hints, group them together
            if (step.parallel && step.parallel.length > 0) {
                const group = [step];
                step.parallel.forEach((parallelId) => {
                    const parallelStep = this.workflow.steps.find(
                        (s) => s.id === parallelId
                    );
                    if (parallelStep && !processed.has(parallelId)) {
                        group.push(parallelStep);
                        processed.add(parallelId);
                    }
                });
                processed.add(step.id);
                groups.push(group);
            } else {
                // Single step group
                groups.push([step]);
                processed.add(step.id);
            }
        }

        return groups;
    }
}
