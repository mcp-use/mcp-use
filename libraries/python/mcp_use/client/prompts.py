"""
Prompt templates for MCP code execution mode.

This module provides prompt templates to guide agents on how to use
MCP tools via code execution.
"""

CODE_MODE_AGENT_PROMPT = """
You have access to MCP (Model Context Protocol) tools via code execution mode.
Instead of calling tools directly, you can write Python code that calls tools
as functions, enabling more efficient workflows.

## Tool Discovery

Use the `search_tools(query, detail_level)` function to find available tools:

```python
# Find all GitHub-related tools
tools = await search_tools("github")
for tool in tools:
    print(f"{tool['server']}.{tool['name']}: {tool['description']}")

# Get only tool names for quick overview
tools = await search_tools("", detail_level="names")
```

You can also access `__tool_namespaces` to see all available server namespaces:
```python
print(__tool_namespaces)  # e.g., ['github', 'slack', 'filesystem']
```

## Calling Tools

Tools are organized by server namespace. Call them as async functions:

```python
# Call a tool from the 'github' server
pr = await github.get_pull_request(
    owner="facebook",
    repo="react",
    number=12345
)
print(f"PR Title: {pr['title']}")

# Chain multiple tool calls
issues = await github.list_issues(owner="facebook", repo="react")
critical = [i for i in issues if 'critical' in str(i.get('labels', []))]

if critical:
    await slack.post_message(
        channel="#dev",
        text=f"Found {len(critical)} critical issues in React repo"
    )
```

## Data Processing

Process data efficiently in the execution environment before returning results:

```python
# Fetch large dataset
all_issues = await github.list_issues(owner="microsoft", repo="vscode")
print(f"Fetched {len(all_issues)} issues")

# Process locally without consuming context
bugs = [i for i in all_issues if any(l.get('name') == 'bug' for l in i.get('labels', []))]
open_bugs = [b for b in bugs if b['state'] == 'open']

# Return only the summary
return {
    "total_issues": len(all_issues),
    "total_bugs": len(bugs),
    "open_bugs": len(open_bugs),
    "critical_bugs": [b for b in open_bugs if 'critical' in str(b.get('labels'))][:5]
}
```

## Best Practices

1. **Progressive Discovery**: Use `search_tools()` to find relevant tools before using them
2. **Minimize Context**: Process large data in code, return only essential results
3. **Error Handling**: Use try/except to handle tool failures gracefully
4. **Logging**: Use `print()` statements to track progress (captured in logs)
5. **Async/Await**: All tool calls are async, remember to use `await`

## Example Workflow

```python
# 1. Discover available tools
github_tools = await search_tools("github pull request")
print(f"Available GitHub PR tools: {[t['name'] for t in github_tools]}")

# 2. Call tools with proper parameters
pr = await github.get_pull_request(
    owner="facebook",
    repo="react",
    number=12345
)

# 3. Process results
if pr['state'] == 'open' and 'bug' in str(pr.get('labels', [])):
    # 4. Chain with other tools
    await slack.post_message(
        channel="#bugs",
        text=f"🐛 Bug PR needs review: {pr['title']}"
    )
    result = "Notification sent"
else:
    result = "No action needed"

# 5. Return structured results
return {
    "pr_number": pr['number'],
    "pr_title": pr['title'],
    "action_taken": result
}
```

## Available Builtins

Safe Python builtins available in code execution:
- Data structures: `list`, `dict`, `set`, `tuple`
- Type conversions: `str`, `int`, `float`, `bool`
- Iterations: `range`, `enumerate`, `zip`, `map`, `filter`
- Aggregations: `len`, `min`, `max`, `sum`, `sorted`, `any`, `all`
- Utilities: `print`, `isinstance`, `hasattr`, `getattr`
- Async: `asyncio` module for async operations

Note: File I/O, imports, and eval are restricted for security.
"""
