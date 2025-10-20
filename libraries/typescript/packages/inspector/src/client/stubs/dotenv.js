// Browser stub for dotenv - no-op implementation for browser environments
// In the browser, environment variables should come from build-time injection
// or runtime configuration, not from .env files

export function config(options) {
  // Return empty config - env vars don't work the same way in browser
  return { parsed: {}, error: null }
}

export function configDotenv(options) {
  // No-op in browser
  return { parsed: {}, error: null }
}

export function parse(src) {
  return {}
}

export default { 
  config, 
  configDotenv,
  parse
}

