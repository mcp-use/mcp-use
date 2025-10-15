import type { Request, Response, NextFunction } from 'express'

/**
 * Request logging middleware with timestamp, colored status codes, and MCP method info
 * 
 * Logs all HTTP requests with:
 * - Timestamp in HH:MM:SS.mmm format
 * - HTTP method and endpoint in bold
 * - MCP method name in brackets for POST requests to /mcp
 * - Color-coded status codes (green 2xx, yellow 3xx, red 4xx, magenta 5xx)
 * 
 * @param req - Express request object
 * @param res - Express response object  
 * @param next - Express next function
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const timestamp = new Date().toISOString().substring(11, 23)
  const method = req.method
  const url = req.url
  
  // Override res.end to capture status code
  const originalEnd = res.end.bind(res)
  res.end = function(chunk?: any, encoding?: any, cb?: any) {
    const statusCode = res.statusCode
    let statusColor = ''
    
    if (statusCode >= 200 && statusCode < 300) {
      statusColor = '\x1b[32m' // Green for 2xx
    } else if (statusCode >= 300 && statusCode < 400) {
      statusColor = '\x1b[33m' // Yellow for 3xx
    } else if (statusCode >= 400 && statusCode < 500) {
      statusColor = '\x1b[31m' // Red for 4xx
    } else if (statusCode >= 500) {
      statusColor = '\x1b[35m' // Magenta for 5xx
    }
    
    // Add MCP method info for POST requests to /mcp
    let logMessage = `[${timestamp}] ${method} \x1b[1m${url}\x1b[0m`
    if (method === 'POST' && url === '/mcp' && req.body?.method) {
      logMessage += ` \x1b[1m[${req.body.method}]\x1b[0m`
    }
    logMessage += ` ${statusColor}${statusCode}\x1b[0m`
    
    console.log(logMessage)
    
    return originalEnd(chunk, encoding, cb)
  }
  
  next()
}
