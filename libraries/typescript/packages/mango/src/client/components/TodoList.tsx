/**
 * TodoList Component
 * Displays real-time todo status from the agent
 */
import React from "react";

export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

interface TodoListProps {
  todos: Todo[];
}

export function TodoList({ todos }: TodoListProps) {
  if (!todos || todos.length === 0) {
    return null;
  }

  const getStatusIcon = (status: Todo["status"]) => {
    switch (status) {
      case "pending":
        return "⏳";
      case "in_progress":
        return "🔧";
      case "completed":
        return "✅";
      case "cancelled":
        return "❌";
      default:
        return "○";
    }
  };

  const getStatusColor = (status: Todo["status"]) => {
    switch (status) {
      case "pending":
        return "text-gray-500 dark:text-gray-400";
      case "in_progress":
        return "text-blue-600 dark:text-blue-400 font-medium";
      case "completed":
        return "text-green-600 dark:text-green-400";
      case "cancelled":
        return "text-red-600 dark:text-red-400 line-through";
      default:
        return "text-gray-500";
    }
  };

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const totalCount = todos.length;
  const progressPercentage = (completedCount / totalCount) * 100;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Task Progress
        </h3>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {completedCount} / {totalCount} completed
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-4">
        <div
          className="bg-green-600 dark:bg-green-500 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* Todo items */}
      <ul className="space-y-2">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className={`flex items-start gap-2 text-sm ${getStatusColor(todo.status)}`}
          >
            <span className="text-base leading-none flex-shrink-0">
              {getStatusIcon(todo.status)}
            </span>
            <span className="flex-1">{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
