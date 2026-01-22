import { z } from "zod";

// Task schema
export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

export type Task = z.infer<typeof taskSchema>;

// Widget props schema
export const propSchema = z.object({
  initialTasks: z
    .array(taskSchema)
    .optional()
    .describe("Initial tasks to display"),
  title: z.string().optional().describe("Widget title"),
});

export type TaskManagerProps = z.infer<typeof propSchema>;
