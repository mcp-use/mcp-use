import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React, { useState } from "react";
import "../styles.css";
import type { Task, TaskManagerProps } from "./types";
import { propSchema } from "./types";

// Widget metadata for registration - using MCP Apps type
export const widgetMetadata: WidgetMetadata = {
  type: "mcpApp",
  description: "Task manager widget using MCP Apps standard",
  props: propSchema,
};

// Host type badge component
const HostBadge: React.FC<{ hostType: string }> = ({ hostType }) => {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-sm font-medium host-mcp-app">
      <span className="w-2 h-2 rounded-full bg-white/50 animate-pulse" />
      <span>MCP Apps</span>
    </div>
  );
};

// Task item component
const TaskItem: React.FC<{
  task: Task;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ task, onToggle, onDelete }) => {
  const priorityColors = {
    high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    medium:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => onToggle(task.id)}
        className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        aria-label={`Mark ${task.title} as ${task.completed ? "incomplete" : "complete"}`}
      />
      <span
        className={`flex-1 ${task.completed ? "line-through text-gray-400" : "text-gray-900 dark:text-gray-100"}`}
      >
        {task.title}
      </span>
      <span
        className={`px-2 py-0.5 text-xs rounded-full ${priorityColors[task.priority]}`}
      >
        {task.priority}
      </span>
      <button
        onClick={() => onDelete(task.id)}
        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
        aria-label={`Delete ${task.title}`}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
    </div>
  );
};

// Main Task Manager component
const TaskManager: React.FC = () => {
  const { props, callTool, sendFollowUpMessage, theme } =
    useWidget<TaskManagerProps>();

  console.log(props);
  console.log(callTool);
  console.log(sendFollowUpMessage);
  console.log(theme);

  // Default tasks if none provided
  const defaultTasks: Task[] = [
    {
      id: "1",
      title: "Learn about MCP Apps standard",
      completed: false,
      priority: "high",
    },
    {
      id: "2",
      title: "Build a widget with ext-apps",
      completed: false,
      priority: "medium",
    },
    {
      id: "3",
      title: "Test in MCP Apps host",
      completed: true,
      priority: "low",
    },
  ];

  const [tasks, setTasks] = useState<Task[]>(
    props?.initialTasks || defaultTasks
  );
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] =
    useState<Task["priority"]>("medium");
  const [actionLog, setActionLog] = useState<string[]>([]);

  const addLog = (message: string) => {
    setActionLog((prev) => [
      ...prev.slice(-4),
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  };

  const handleToggle = (id: string) => {
    setTasks(
      tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
    const task = tasks.find((t) => t.id === id);
    if (task) {
      addLog(`Toggled: ${task.title}`);
    }
  };

  const handleDelete = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    setTasks(tasks.filter((t) => t.id !== id));
    if (task) {
      addLog(`Deleted: ${task.title}`);
    }
  };

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;

    const newTask: Task = {
      id: Date.now().toString(),
      title: newTaskTitle.trim(),
      completed: false,
      priority: newTaskPriority,
    };
    setTasks([...tasks, newTask]);
    addLog(`Added: ${newTask.title}`);
    setNewTaskTitle("");
  };

  const handleCallTool = async () => {
    try {
      addLog("Calling get-widget-info tool via MCP Apps...");
      const result = await callTool("get-widget-info", {});
      addLog(`Tool returned: ${result.content.length} item(s)`);
    } catch (error) {
      addLog(`Tool error: ${(error as Error).message}`);
    }
  };

  const handleSendMessage = async () => {
    const completedCount = tasks.filter((t) => t.completed).length;
    const totalCount = tasks.length;
    const message = `Task summary: ${completedCount}/${totalCount} tasks completed`;

    try {
      addLog(`Sending message via MCP Apps: "${message}"`);
      await sendFollowUpMessage(message);
      addLog("Message sent successfully");
    } catch (error) {
      addLog(`Message error: ${(error as Error).message}`);
    }
  };

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <div
      className={`min-h-screen p-6 ${theme === "dark" ? "dark bg-gray-900" : "bg-gray-100"}`}
    >
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {props?.title || "Task Manager"}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {completedCount}/{tasks.length} tasks completed
            </p>
          </div>
          <HostBadge hostType="mcp-app" />
        </div>

        {/* Add Task Form */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex gap-3">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
              placeholder="Add a new task..."
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <select
              value={newTaskPriority}
              onChange={(e) =>
                setNewTaskPriority(e.target.value as Task["priority"])
              }
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              aria-label="Task priority"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button
              onClick={handleAddTask}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              Add
            </button>
          </div>
        </div>

        {/* Task List */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-2">
          {tasks.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              No tasks yet. Add one above!
            </p>
          ) : (
            tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>

        {/* Host Actions */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            MCP Apps Actions
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            These actions use @modelcontextprotocol/ext-apps for communication
            with the host.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleCallTool}
              className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
            >
              Call Tool
            </button>
            <button
              onClick={handleSendMessage}
              className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
            >
              Send Message
            </button>
          </div>
        </div>

        {/* Action Log */}
        {actionLog.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 shadow-sm border border-gray-700">
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Action Log
            </h3>
            <div className="space-y-1 font-mono text-xs text-green-400">
              {actionLog.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Host Info */}
        <div className="text-center text-xs text-gray-400 dark:text-gray-500">
          <p>
            MCP Apps Standard | MIME: text/html;profile=mcp-app |
            @modelcontextprotocol/ext-apps
          </p>
        </div>
      </div>
    </div>
  );
};

// Wrapped component with provider
const TaskManagerWidget: React.FC = () => {
  return (
    <McpUseProvider debugger viewControls autoSize>
      <TaskManager />
    </McpUseProvider>
  );
};

export default TaskManagerWidget;
