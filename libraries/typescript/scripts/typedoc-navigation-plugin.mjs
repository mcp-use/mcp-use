import { DefaultTheme } from "typedoc";

// Only navigation text/order changes: reflection names, URLs and import paths stay stable.
const LABELS = {
  "mcp-use": "Server · mcp-use",
  "_mcp-use_client": "Client · @mcp-use/client",
  "_mcp-use_agent": "Agent · @mcp-use/agent",
  "_mcp-use_tunnel": "Tunnel · @mcp-use/tunnel",
  "mcp-use.index": "Server API",
  "mcp-use.react": "MCP Apps · React hooks & components",
  "mcp-use.oauth": "OAuth configuration",
  "mcp-use.landing": "Server landing page",
  "mcp-use.node-bridge": "Node.js bridge",
  "mcp-use.next": "Next.js integration",
  "_mcp-use_client.index": "Node.js client",
  "_mcp-use_client.index-browser": "Browser client",
  "_mcp-use_client.react": "React client hooks",
  "_mcp-use_client.sandbox": "Code execution sandbox",
  "_mcp-use_agent.index": "Agent API",
  "_mcp-use_agent.langchain": "LangChain integration",
};
const PRIORITY = [
  "mcp-use.index",
  "mcp-use.react",
  "mcp-use.next",
  "mcp-use.oauth",
];

function decorate(item) {
  const key = item.path?.replace(/^modules\//, "").replace(/\.html$/, "");
  const children = item.children?.map(decorate);
  if (key === "mcp-use.oauth" && children) {
    const providers = children.filter((child) =>
      child.path?.startsWith("modules/mcp-use.oauth_")
    );
    const rest = children.filter((child) => !providers.includes(child));
    if (providers.length)
      rest.push({ text: "OAuth providers", children: providers });
    return { ...item, text: LABELS[key], children: rest };
  }
  if (key === "mcp-use" && children) {
    const rest = [...children];
    rest.sort((a, b) => {
      const rank = (entry) => {
        const index = PRIORITY.indexOf(
          entry.path?.replace(/^modules\//, "").replace(/\.html$/, "")
        );
        return index < 0 ? PRIORITY.length : index;
      };
      return rank(a) - rank(b);
    });
    return { ...item, text: LABELS[key], children: rest };
  }
  return {
    ...item,
    text: LABELS[key] ?? item.text,
    ...(children ? { children } : {}),
  };
}

class McpUseTheme extends DefaultTheme {
  buildNavigation(project) {
    const navigation = super.buildNavigation(project);
    // Flatten TypeDoc's synthetic npm scope folder into the public package list.
    const items = navigation.flatMap((item) =>
      item.text === "@mcp-use" && !item.path && item.children
        ? item.children.map((child) =>
            decorate({ ...child, text: `@mcp-use/${child.text}` })
          )
        : [decorate(item)]
    );
    const order = [
      "modules/mcp-use.html",
      "modules/_mcp-use_client.html",
      "modules/_mcp-use_agent.html",
      "modules/_mcp-use_tunnel.html",
    ];
    return items.sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
  }
}

export function load(app) {
  app.renderer.defineTheme("mcp-use", McpUseTheme);
}
