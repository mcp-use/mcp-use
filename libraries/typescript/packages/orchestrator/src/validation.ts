import type { WorkflowDefinition } from "./types.js";

/**
 * Validate workflow definition
 */
export function validateWorkflow(
    workflow: WorkflowDefinition,
    agents: Record<string, any>
): void {
    const errors: string[] = [];

    // Validate workflow has steps
    if (!workflow.steps || workflow.steps.length === 0) {
        errors.push("Workflow must have at least one step");
    }

    const stepIds = new Set<string>();

    // Validate each step
    for (const step of workflow.steps) {
        // Check for duplicate step IDs
        if (stepIds.has(step.id)) {
            errors.push(`Duplicate step ID: ${step.id}`);
        }
        stepIds.add(step.id);

        // Validate agent exists
        if (!agents[step.agent]) {
            errors.push(`Step ${step.id}: Agent not found: ${step.agent}`);
        }

        // Validate fallback agent exists
        if (step.fallbackAgent && !agents[step.fallbackAgent]) {
            errors.push(
                `Step ${step.id}: Fallback agent not found: ${step.fallbackAgent}`
            );
        }

        // Validate parallel references
        if (step.parallel) {
            for (const parallelId of step.parallel) {
                if (!workflow.steps.find((s) => s.id === parallelId)) {
                    errors.push(
                        `Step ${step.id}: Parallel step not found: ${parallelId}`
                    );
                }
            }
        }
    }

    // Check for cycles in workflow (basic check)
    detectCycles(workflow.steps);

    if (errors.length > 0) {
        throw new Error(
            `Workflow validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
        );
    }
}

/**
 * Detect cycles in workflow steps (basic implementation)
 */
function detectCycles(steps: any[]): void {
    // For now, we don't support complex dependencies that could cause cycles
    // This is a placeholder for future cycle detection logic
    // In a more complex implementation, we'd build a dependency graph and check for cycles
}
