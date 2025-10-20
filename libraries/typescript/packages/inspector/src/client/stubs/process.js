// Browser polyfill for the process object
// This ensures compatibility with Node.js packages in browser environments

export const env = {}
export const platform = 'browser'
export const version = 'v18.0.0'
export const versions = { node: '18.0.0' }
export const cwd = () => '/'
export const nextTick = (fn, ...args) => queueMicrotask(() => fn(...args))
export const browser = true

export default {
  env,
  platform,
  version,
  versions,
  cwd,
  nextTick,
  browser,
}

