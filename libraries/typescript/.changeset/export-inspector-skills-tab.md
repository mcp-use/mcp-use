---
"@mcp-use/inspector": patch
---

Export the existing SkillsTab component and its props from the client entry point so applications can embed the Inspector skills browser.

Build the client entry for browsers so Skills frontmatter parsing does not require Node.js built-ins.

Keep the chat header height consistent when embedded with the title and actions hidden, so the conversation tabs stay vertically centered.

Expose optional controlled skill selection inside the shared chat composer, alongside the existing system prompt control.
