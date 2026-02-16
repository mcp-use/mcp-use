import { onMcpAuthorization } from "mcp-use/react";
import { useEffect } from "react";

/**
 * OAuth callback page for MCP authentication
 * This page handles the OAuth redirect and exchanges the authorization code for tokens
 */
export default function OAuthCallback() {
  useEffect(() => {
    // Handle the OAuth callback when the component mounts
    onMcpAuthorization();
  }, []);

  return (
    <div
      style={{
        padding: "40px",
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
        maxWidth: "600px",
        margin: "0 auto",
      }}
    >
      <h1>🔐 Authenticating...</h1>
      <p>Please wait while we complete your authentication.</p>
      <p style={{ color: "#6c757d", fontSize: "0.9em" }}>
        This window should close automatically once authentication is complete.
      </p>

      <div
        style={{
          marginTop: "30px",
          padding: "20px",
          backgroundColor: "#f8f9fa",
          borderRadius: "8px",
          fontSize: "0.9em",
        }}
      >
        <p>
          If this window doesn't close automatically, you can close it manually
          and return to the main application.
        </p>
      </div>
    </div>
  );
}
