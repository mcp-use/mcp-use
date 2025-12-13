# E2B Template Information

## Template Details

- **Template Name**: `mcp-use-mango-v2`
- **Template ID**: `tv7ab38815c8k6wdku78`
- **Build Date**: December 13, 2025
- **Status**: ✅ Successfully Built (Correct Account)

## Template Contents

The template includes:

1. **Pre-created MCP Project**
   - Located at: `/home/user/mcp-project`
   - Template: starter
   - Dependencies: Pre-installed
   - Ready to modify immediately

2. **Global Tools**
   - `tsx`: TypeScript execution
   - `@anthropic-ai/claude-agent-sdk@0.1.69`: Agent SDK v2

3. **Configuration**
   - CPU: 2 cores
   - Memory: 4096 MB
   - User: `user`
   - Working Directory: `/home/user`

## Usage

### With TypeScript SDK

```typescript
import { Sandbox } from '@e2b/code-interpreter';

// Create sandbox from template
const sandbox = await Sandbox.create('mcp-use-mango-v2', {
  apiKey: process.env.E2B_API_KEY,
  timeoutMs: 600000, // 10 minutes
});

// The project is ready at /home/user/mcp-project
```

### With Python SDK

```python
from e2b import Sandbox

# Create sandbox from template
sandbox = Sandbox("mcp-use-mango-v2", api_key=os.environ["E2B_API_KEY"])

# The project is ready at /home/user/mcp-project
```

## Environment Setup

Set the template ID in your environment:

```bash
export E2B_TEMPLATE_ID=tv7ab38815c8k6wdku78
```

Or add to `.env` file:

```env
E2B_TEMPLATE_ID=tv7ab38815c8k6wdku78
```

## Rebuilding the Template

If you need to rebuild the template:

```bash
cd /tmp/mango-e2b-template

# Build with Infisical (recommended)
infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- \
  e2b template build --name "mcp-use-mango-v2" \
  --dockerfile e2b.Dockerfile \
  --cpu-count 2 \
  --memory-mb 4096

# Or build with API key directly
E2B_API_KEY=your_key e2b template build \
  --name "mcp-use-mango-v2" \
  --dockerfile e2b.Dockerfile \
  --cpu-count 2 \
  --memory-mb 4096
```

## Verification

To verify the template works:

```typescript
import { Sandbox } from '@e2b/code-interpreter';

const sandbox = await Sandbox.create('mcp-use-mango-v2');

// Check project exists
const files = await sandbox.filesystem.list('/home/user/mcp-project');
console.log('Project files:', files);

// Check global tools
const tsxVersion = await sandbox.commands.run('tsx --version');
console.log('tsx version:', tsxVersion.stdout);

await sandbox.kill();
```

## Template Build Log

The complete build log is available at:
- `/tmp/e2b-build.log`

## Next Steps

1. Set `E2B_TEMPLATE_ID=tv7ab38815c8k6wdku78` in your environment
2. Run `pnpm dev` to start Mango
3. Open http://localhost:5175
4. Send a message to test the agent

## Support

If the template needs to be updated:
1. Modify the Dockerfile at `/tmp/mango-e2b-template/e2b.Dockerfile`
2. Rebuild using the command above
3. Update the template ID in this file and `.env.example`
