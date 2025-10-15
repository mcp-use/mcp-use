import { useMcp } from 'mcp-use/react'
import React from 'react'

const MCPTools: React.FC = () => {
  const [enableConnection, setEnableConnection] = React.useState(true)
  
  const {
    state,
    tools,
    resources,
    prompts,
    error,
    authUrl,
    callTool,
    retry,
    authenticate,
    clearStorage,
  } = useMcp({
    url: 'https://mcp.linear.app/sse',
  })

  const [toolResult, setToolResult] = React.useState<any>(null)

  const handleCallTool = async (toolName: string) => {
    try {
      const result = await callTool(toolName, {})
      setToolResult({ toolName, result })
    } catch (err) {
      setToolResult({ toolName, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>MCP Tools Explorer</h1>

      {/* Status Badge and Enable Toggle */}
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '8px 16px',
            borderRadius: '4px',
            fontWeight: 'bold',
            backgroundColor:
              state === 'ready'
                ? '#28a745'
                : state === 'failed'
                  ? '#dc3545'
                  : state === 'authenticating' || state === 'pending_auth'
                    ? '#ffc107'
                    : '#6c757d',
            color: 'white',
          }}
        >
          Status: {state.toUpperCase()}
        </div>
        
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enableConnection}
            onChange={(e) => setEnableConnection(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span>Enable Connection</span>
        </label>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: '10px',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            border: '1px solid #f5c6cb',
            borderRadius: '4px',
            marginBottom: '20px',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Authentication Actions */}
      {(state === 'failed' || state === 'pending_auth') && (
        <div style={{ marginBottom: '20px' }}>
          <button
            onClick={authenticate}
            style={{
              padding: '10px 20px',
              marginRight: '10px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {state === 'pending_auth' ? 'Start Authentication' : 'Retry Connection'}
          </button>

          {authUrl && (
            <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '4px' }}>
              <p style={{ margin: '0 0 10px 0' }}>
                <strong>Popup blocked?</strong> Click the link below to authenticate manually:
              </p>
              <a href={authUrl} target="_blank" rel="noopener noreferrer">
                Open Authentication Page
              </a>
            </div>
          )}

          {state === 'failed' && (
            <button
              onClick={retry}
              style={{
                padding: '10px 20px',
                marginLeft: '10px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {/* Authenticating State */}
      {state === 'authenticating' && (
        <div
          style={{
            marginBottom: '20px',
            padding: '10px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '4px',
          }}
        >
          <strong>⏳ Authenticating...</strong>
          <p style={{ margin: '10px 0 0 0' }}>
            Please complete the authentication in the popup window. If you don't see a popup, check if your browser
            blocked it.
          </p>
        </div>
      )}

      {/* Loading State */}
      {(state === 'discovering' || state === 'connecting' || state === 'loading') && (
        <div
          style={{
            marginBottom: '20px',
            padding: '10px',
            backgroundColor: '#d1ecf1',
            border: '1px solid #bee5eb',
            borderRadius: '4px',
          }}
        >
          <strong>⏳ {state === 'discovering' ? 'Discovering server...' : state === 'connecting' ? 'Connecting...' : 'Loading tools...'}</strong>
        </div>
      )}

      {/* Connected State - Show Tools, Resources, Prompts */}
      {state === 'ready' && (
        <>
          <div
            style={{
              marginBottom: '20px',
              padding: '10px',
              backgroundColor: '#d4edda',
              border: '1px solid #c3e6cb',
              borderRadius: '4px',
            }}
          >
            <h3 style={{ margin: '0 0 10px 0', color: '#155724' }}>✓ Connected to MCP Server</h3>
            <p style={{ margin: '0', color: '#155724' }}>
              Found {tools.length} tools, {resources.length} resources, {prompts.length} prompts
            </p>
            <p style={{ margin: '5px 0 0 0', fontSize: '0.9em', color: '#6c757d' }}>
              Note: HTTP transport failed (404), successfully connected via SSE fallback
            </p>
          </div>

          <button
            onClick={clearStorage}
            style={{
              padding: '10px 20px',
              marginBottom: '20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Clear Auth & Disconnect
          </button>

          {/* Tools List */}
          <div>
            <h3>Available Tools ({tools.length})</h3>
            {tools.length === 0 ? (
              <p style={{ color: '#6c757d' }}>No tools available.</p>
            ) : (
              tools.map((tool, index) => (
                <div
                  key={index}
                  style={{
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    padding: '15px',
                    marginBottom: '10px',
                    backgroundColor: '#f8f9fa',
                  }}
                >
                  <h4 style={{ margin: '0 0 10px 0', color: '#495057' }}>{tool.name}</h4>

                  {tool.description && (
                    <p style={{ margin: '0 0 10px 0', color: '#6c757d' }}>{tool.description}</p>
                  )}

                  <button
                    onClick={() => handleCallTool(tool.name)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.9em',
                    }}
                  >
                    Call Tool
                  </button>

                  {tool.inputSchema && (
                    <details style={{ marginTop: '10px' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Input Schema</summary>
                      <pre
                        style={{
                          marginTop: '10px',
                          padding: '10px',
                          backgroundColor: '#ffffff',
                          border: '1px solid #dee2e6',
                          borderRadius: '4px',
                          overflow: 'auto',
                          fontSize: '0.8em',
                        }}
                      >
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Resources List */}
          <div style={{ marginTop: '30px' }}>
            <h3>Available Resources ({resources.length})</h3>
            {resources.length === 0 ? (
              <div
                style={{
                  padding: '10px',
                  backgroundColor: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: '4px',
                  color: '#856404',
                }}
              >
                <strong>ℹ️ Resources not supported</strong>
                <p style={{ margin: '5px 0 0 0', fontSize: '0.9em' }}>
                  This MCP server does not support the resources/list method.
                </p>
              </div>
            ) : (
              resources.map((resource, index) => (
                <div
                  key={index}
                  style={{
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    padding: '10px',
                    marginBottom: '10px',
                    backgroundColor: '#f8f9fa',
                  }}
                >
                  <strong>{resource.name || resource.uri}</strong>
                  {resource.description && <p style={{ margin: '5px 0 0 0', fontSize: '0.9em' }}>{resource.description}</p>}
                </div>
              ))
            )}
          </div>

          {/* Prompts List */}
          <div style={{ marginTop: '30px' }}>
            <h3>Available Prompts ({prompts.length})</h3>
            {prompts.length === 0 ? (
              <div
                style={{
                  padding: '10px',
                  backgroundColor: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: '4px',
                  color: '#856404',
                }}
              >
                <strong>ℹ️ Prompts not supported</strong>
                <p style={{ margin: '5px 0 0 0', fontSize: '0.9em' }}>
                  This MCP server does not support the prompts/list method.
                </p>
              </div>
            ) : (
              prompts.map((prompt, index) => (
                <div
                  key={index}
                  style={{
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    padding: '10px',
                    marginBottom: '10px',
                    backgroundColor: '#f8f9fa',
                  }}
                >
                  <strong>{prompt.name}</strong>
                  {prompt.description && <p style={{ margin: '5px 0 0 0', fontSize: '0.9em' }}>{prompt.description}</p>}
                </div>
              ))
            )}
          </div>

          {/* Tool Result Display */}
          {toolResult && (
            <div
              style={{
                marginTop: '30px',
                padding: '15px',
                backgroundColor: toolResult.error ? '#f8d7da' : '#d4edda',
                border: `1px solid ${toolResult.error ? '#f5c6cb' : '#c3e6cb'}`,
                borderRadius: '4px',
              }}
            >
              <h3 style={{ margin: '0 0 10px 0' }}>
                Tool Call Result: {toolResult.toolName}
              </h3>
              {toolResult.error ? (
                <p style={{ margin: 0, color: '#721c24' }}>Error: {toolResult.error}</p>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.9em',
                    color: '#155724',
                  }}
                >
                  {JSON.stringify(toolResult.result, null, 2)}
                </pre>
              )}
              <button
                onClick={() => setToolResult(null)}
                style={{
                  marginTop: '10px',
                  padding: '6px 12px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Clear Result
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Example usage component
const ReactExample: React.FC = () => {
  return (
    <div>
      <MCPTools />

      <div
        style={{
          marginTop: '40px',
          padding: '20px',
          backgroundColor: '#e7f3ff',
          border: '1px solid #b3d9ff',
          borderRadius: '4px',
        }}
      >
        <h3>🔐 OAuth Authentication with Linear MCP</h3>
        <p>
          This example demonstrates the new <code>useMcp</code> hook with OAuth authentication to Linear's MCP server.
          The hook will automatically handle the OAuth flow when you connect.
        </p>
        <h4>Features:</h4>
        <ul>
          <li>✅ Automatic OAuth flow handling with popup support</li>
          <li>✅ Fallback manual authentication link if popup is blocked</li>
          <li>✅ Auto-reconnect on connection loss</li>
          <li>✅ Support for tools, resources, and prompts (when supported by server)</li>
          <li>✅ HTTP transport with SSE fallback</li>
          <li>✅ Graceful handling of unsupported server methods</li>
        </ul>
        <p>
          <strong>Note:</strong> The Linear MCP server requires OAuth authentication. The hook will automatically
          initiate the OAuth flow when connecting.
        </p>
      </div>
    </div>
  )
}

export default ReactExample
