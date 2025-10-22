/* eslint-disable no-console */
export const logger = {
  debug: (...args: any[]) => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      console.debug('[MCP Inspector]', ...args)
    }
  },
  info: (...args: any[]) => {
    console.info('[MCP Inspector]', ...args)
  },
  warn: (...args: any[]) => {
    console.warn('[MCP Inspector]', ...args)
  },
  error: (...args: any[]) => {
    console.error('[MCP Inspector]', ...args)
  },
}
