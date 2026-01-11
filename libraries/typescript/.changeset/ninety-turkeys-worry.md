---
"@mcp-use/inspector": patch
"mcp-use": patch
---

fix: resolve OAuth flow looping issue by removing duplicate fallback logic

- Fixed OAuth authentication loop in inspector by removing duplicated fallback logic in useAutoConnect hook
- Simplified connection handling by consolidating state management and removing unnecessary complexity
- Enhanced OAuth authentication flow with improved connection settings and user-initiated actions
- Refactored connection handling to default to manual authentication, requiring explicit user action for OAuth
- Improved auto-connect functionality with better proxy handling and error management
- Enhanced theme toggling with dropdown menu for better UX and accessibility
- Updated OAuth flow management in browser provider and callback handling for better state management
- Streamlined proxy fallback configuration to use useMcp's built-in autoProxyFallback
