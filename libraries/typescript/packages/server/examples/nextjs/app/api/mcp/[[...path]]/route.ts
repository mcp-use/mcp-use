import { createNextHandler } from "mcp-use/next";

import server from "../../../../mcp-server";

// The optional catch-all also forwards nested view and public-asset requests.
export const { GET, POST, DELETE, OPTIONS } = createNextHandler(server);
