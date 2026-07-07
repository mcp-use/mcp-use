import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback when an error is caught. */
  fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
  /** Invoked when an error is caught. */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * Catches React errors in the view tree and renders a fallback instead of
 * crashing the iframe.
 */
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

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[mcp-use] View error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  override render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback !== undefined) {
        return typeof this.props.fallback === "function"
          ? this.props.fallback(this.state.error)
          : this.props.fallback;
      }

      return (
        <div
          style={{
            padding: "1rem",
            border: "1px solid #ef4444",
            borderRadius: "0.375rem",
            background: "#fef2f2",
            color: "#7f1d1d",
          }}
        >
          <strong>View error</strong>
          <pre style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
            {this.state.error.message}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}
