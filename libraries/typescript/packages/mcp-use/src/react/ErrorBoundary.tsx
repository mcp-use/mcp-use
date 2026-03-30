import React from "react";
import { Logger } from "../logging.js";

const logger = Logger.get("ErrorBoundary");

/**
 * ErrorBoundary that catches React errors and displays a friendly error message
 *
 * This component catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing the entire app.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback UI to render when an error is caught. Receives the error object. */
  fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
  /** Callback invoked when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  { hasError: boolean; error: Error | null }
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error("Widget Error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback !== undefined) {
        return typeof this.props.fallback === "function"
          ? this.props.fallback(this.state.error)
          : this.props.fallback;
      }

      return (
        <div className="p-4 border border-red-500 bg-red-50 text-red-900 rounded-md dark:bg-red-900/20 dark:text-red-100">
          <h3 className="font-bold mb-2">Widget Error</h3>
          <pre className="text-sm whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}
