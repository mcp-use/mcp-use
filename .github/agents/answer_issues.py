import asyncio
import os
from mcp_use import MCPAgent
from mcp_use import set_debug

set_debug(1)


async def main():
    agent = MCPAgent(agent_id="33edf29a-52a6-41ba-9397-34b78a0ae4a4")

    issue_num = os.environ["ISSUE_NUMBER"]
    issue_title = os.environ["ISSUE_TITLE"]
    issue_body = os.environ["ISSUE_BODY"]

    result = await agent.run(
        query=f"Issue #{issue_num}: {issue_title}\n\n{issue_body}\n\nProvide a helpful response as a maintainer of the mcp-use library."
    )
    print(result)

    with open("/tmp/response.txt", "w") as f:
        f.write(str(result))


if __name__ == "__main__":
    asyncio.run(main())
