using System.Net;
using System.Text;
using System.Web;

namespace McpUse.Auth;

/// <summary>
/// Local HTTP server to handle OAuth callbacks.
/// </summary>
public class OAuthCallbackServer : IDisposable
{
    private readonly string _redirectUri;
    private readonly HttpListener _listener;
    private TaskCompletionSource<OAuthCallbackResult>? _callbackTcs;

    public OAuthCallbackServer(string redirectUri)
    {
        _redirectUri = redirectUri;

        var uri = new Uri(redirectUri);
        var prefix = $"http://{uri.Host}:{uri.Port}/";

        _listener = new HttpListener();
        _listener.Prefixes.Add(prefix);
    }

    /// <summary>
    /// Starts the callback server.
    /// </summary>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        _callbackTcs = new TaskCompletionSource<OAuthCallbackResult>();
        _listener.Start();

        // Start listening in the background
        _ = ListenAsync(cancellationToken);
    }

    /// <summary>
    /// Waits for the OAuth callback.
    /// </summary>
    public async Task<OAuthCallbackResult> WaitForCallbackAsync(CancellationToken cancellationToken = default)
    {
        if (_callbackTcs == null)
            throw new InvalidOperationException("Server not started");

        using var registration = cancellationToken.Register(() =>
            _callbackTcs.TrySetCanceled(cancellationToken));

        return await _callbackTcs.Task;
    }

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var context = await _listener.GetContextAsync();

                try
                {
                    var result = ProcessCallback(context.Request);

                    // Send response to browser
                    await SendResponseAsync(context.Response, result);

                    // Complete the callback
                    _callbackTcs?.TrySetResult(result);

                    // Only need one callback
                    break;
                }
                catch (Exception ex)
                {
                    _callbackTcs?.TrySetException(ex);
                    break;
                }
            }
        }
        catch (HttpListenerException) when (cancellationToken.IsCancellationRequested)
        {
            // Expected when stopping
        }
        catch (ObjectDisposedException)
        {
            // Expected when disposed
        }
        catch (Exception ex)
        {
            _callbackTcs?.TrySetException(ex);
        }
    }

    private OAuthCallbackResult ProcessCallback(HttpListenerRequest request)
    {
        var query = request.QueryString;

        return new OAuthCallbackResult
        {
            Code = query["code"],
            State = query["state"],
            Error = query["error"],
            ErrorDescription = query["error_description"]
        };
    }

    private async Task SendResponseAsync(HttpListenerResponse response, OAuthCallbackResult result)
    {
        var html = result.Error != null
            ? $"""
                <!DOCTYPE html>
                <html>
                <head><title>Authentication Failed</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
                    <p>{HttpUtility.HtmlEncode(result.Error)}: {HttpUtility.HtmlEncode(result.ErrorDescription)}</p>
                    <p>You can close this window.</p>
                </body>
                </html>
                """
            : """
                <!DOCTYPE html>
                <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1 style="color: #28a745;">✓ Authentication Successful</h1>
                    <p>You can close this window and return to the application.</p>
                    <script>setTimeout(() => window.close(), 2000);</script>
                </body>
                </html>
                """;

        var buffer = Encoding.UTF8.GetBytes(html);
        response.ContentType = "text/html; charset=utf-8";
        response.ContentLength64 = buffer.Length;
        response.StatusCode = 200;

        await response.OutputStream.WriteAsync(buffer);
        response.Close();
    }

    public void Dispose()
    {
        try
        {
            _listener.Stop();
            _listener.Close();
        }
        catch { }
    }
}

/// <summary>
/// OAuth callback result.
/// </summary>
public class OAuthCallbackResult
{
    /// <summary>
    /// Authorization code (on success).
    /// </summary>
    public string? Code { get; set; }

    /// <summary>
    /// State parameter for CSRF validation.
    /// </summary>
    public string? State { get; set; }

    /// <summary>
    /// Error code (on failure).
    /// </summary>
    public string? Error { get; set; }

    /// <summary>
    /// Error description (on failure).
    /// </summary>
    public string? ErrorDescription { get; set; }
}
