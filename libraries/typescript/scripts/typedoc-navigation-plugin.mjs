import { DefaultTheme } from "typedoc";

const SCOPE_FOLDER = "@mcp-use";
const TOP_LEVEL_PACKAGES = new Set(["agent", "client"]);

class McpUseTheme extends DefaultTheme {
  buildNavigation(project) {
    const navigation = super.buildNavigation(project);
    const scopeIndex = navigation.findIndex(
      (item) =>
        item.text === SCOPE_FOLDER &&
        item.path === undefined &&
        item.children?.length
    );

    if (scopeIndex === -1) {
      return navigation;
    }

    const scope = navigation[scopeIndex];
    const peers = [];
    const remaining = [];

    for (const child of scope.children) {
      if (child.path && TOP_LEVEL_PACKAGES.has(child.text)) {
        peers.push({ ...child, text: `${SCOPE_FOLDER}/${child.text}` });
      } else {
        remaining.push(child);
      }
    }

    if (peers.length === 0) {
      return navigation;
    }

    const replacement = [...peers];
    if (remaining.length > 0) {
      replacement.push({ ...scope, children: remaining });
    }

    return navigation.toSpliced(scopeIndex, 1, ...replacement);
  }
}

export function load(app) {
  app.renderer.defineTheme("mcp-use", McpUseTheme);
}
