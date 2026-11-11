import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getInstallTargets } from "../src/landing.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function cursorConfig(deeplink: string): string {
  const config = new URL(deeplink).searchParams.get("config");
  expect(config).not.toBeNull();
  return config!;
}

describe("getInstallTargets", () => {
  it("builds every client's link or command for an ASCII server", () => {
    expect(
      getInstallTargets({ url: "https://example.com/mcp", name: "weather" })
    ).toEqual({
      claudeCode: {
        label: "Claude Code",
        command:
          "claude mcp add --transport http \"weather\" 'https://example.com/mcp'",
      },
      cursor: {
        label: "Cursor",
        deeplink:
          "cursor://anysphere.cursor-deeplink/mcp/install?config=eyJ1cmwiOiJodHRwczovL2V4YW1wbGUuY29tL21jcCJ9&name=weather",
      },
      vscode: {
        label: "VS Code",
        deeplink:
          "vscode:mcp/install?%7B%22url%22%3A%22https%3A%2F%2Fexample.com%2Fmcp%22%2C%22name%22%3A%22weather%22%2C%22type%22%3A%22http%22%7D",
      },
      vscodeInsiders: {
        label: "VS Code Insiders",
        deeplink:
          "vscode-insiders:mcp/install?%7B%22url%22%3A%22https%3A%2F%2Fexample.com%2Fmcp%22%2C%22name%22%3A%22weather%22%2C%22type%22%3A%22http%22%7D",
      },
      chatgpt: {
        label: "ChatGPT",
        steps: [
          "Open Plugins: In ChatGPT, go to Plugins and click Add",
          "Add this MCP server: Choose Add Custom MCP Server and enter https://example.com/mcp",
          "Use in conversations: Choose the MCP server from the Plus menu",
        ],
      },
      inspector: {
        label: "Manufact Inspector",
        url: "https://inspector.manufact.com/inspector?autoConnect=https%3A%2F%2Fexample.com%2Fmcp&tab=chat",
      },
    });
  });

  it("lists targets in display order", () => {
    const targets = getInstallTargets({
      url: "https://example.com/mcp",
      name: "weather",
    });
    expect(Object.values(targets).map((target) => target.label)).toEqual([
      "Claude Code",
      "Cursor",
      "VS Code",
      "VS Code Insiders",
      "ChatGPT",
      "Manufact Inspector",
    ]);
  });

  it("does not infer Inspector availability from a loopback hostname", () => {
    for (const url of [
      "http://localhost:3000/mcp",
      "http://127.0.0.1:3000/mcp",
      "http://127.0.0.2:3000/mcp",
      "http://[::1]:3000/mcp",
      "http://app.localhost:3000/mcp/",
    ]) {
      const target = new URL(
        getInstallTargets({ url, name: "local" }).inspector.url
      );
      expect(target.origin).toBe("https://inspector.manufact.com");
      expect(target.searchParams.get("autoConnect")).toBe(url);
    }
  });

  it("uses an explicit Inspector URL without changing the MCP install URLs", () => {
    const url = "http://localhost:3000/mcp?token=required";
    const inspectorUrl =
      "http://localhost:3000/custom-inspector?autoConnect=" +
      encodeURIComponent(url) +
      "&tab=chat";
    const targets = getInstallTargets({ url, name: "local", inspectorUrl });
    expect(targets.inspector.url).toBe(inspectorUrl);
    expect(targets.claudeCode.command).toContain(url);
    expect(
      JSON.parse(
        Buffer.from(cursorConfig(targets.cursor.deeplink), "base64").toString(
          "utf8"
        )
      )
    ).toEqual({ url });
  });

  it("keeps the hosted Inspector link for a non-loopback server", () => {
    expect(
      getInstallTargets({ url: "https://acme.com/mcp", name: "acme" }).inspector
        .url
    ).toBe(
      "https://inspector.manufact.com/inspector?autoConnect=https%3A%2F%2Facme.com%2Fmcp&tab=chat"
    );
  });

  it("sanitizes non-ASCII server names into the config key", () => {
    const targets = getInstallTargets({
      url: "https://example.com/mcp",
      name: "Café ☕-Bar_1",
    });
    expect(targets.claudeCode.command).toContain('"caf___-bar_1"');
    expect(new URL(targets.cursor.deeplink).searchParams.get("name")).toBe(
      "caf___-bar_1"
    );
    expect(
      JSON.parse(
        decodeURIComponent(targets.vscode.deeplink.split("?")[1] ?? "")
      )
    ).toEqual({
      url: "https://example.com/mcp",
      name: "caf___-bar_1",
      type: "http",
    });
  });

  it("base64-encodes the Cursor config as UTF-8 without Node's Buffer", () => {
    for (const url of [
      "https://example.com/mcp?q=a+b",
      "https://例え.test/mcp?x=🔥é",
    ]) {
      const expected = Buffer.from(JSON.stringify({ url })).toString("base64");
      vi.stubGlobal("Buffer", undefined);
      const { cursor } = getInstallTargets({ url, name: "weather" });
      vi.unstubAllGlobals();

      const config = cursorConfig(cursor.deeplink);
      expect(config).toBe(expected);
      expect(
        JSON.parse(Buffer.from(config, "base64").toString("utf8"))
      ).toEqual({ url });
    }
  });

  it("quotes the URL in the Claude Code command for a POSIX shell", () => {
    const url = `https://example.com/mcp?a='b'&c="d"&e=$(touch /tmp/pwned)`;
    const { command } = getInstallTargets({ url, name: "weather" }).claudeCode;
    expect(command).toBe(
      `claude mcp add --transport http "weather" 'https://example.com/mcp?a='\\''b'\\''&c="d"&e=$(touch /tmp/pwned)'`
    );

    // The shell must pass the name and URL through as two literal arguments.
    const args = command.replace("claude mcp add --transport http ", "");
    const parsed = execFileSync("sh", ["-c", `printf '%s\\n' ${args}`], {
      encoding: "utf8",
    });
    expect(parsed).toBe(`weather\n${url}\n`);
  });

  it("puts the URL in the ChatGPT steps and the inspector link", () => {
    const url = "https://example.com/mcp?token=a&b=c";
    const { chatgpt, inspector } = getInstallTargets({ url, name: "weather" });
    expect(chatgpt.steps[1]).toBe(
      `Add this MCP server: Choose Add Custom MCP Server and enter ${url}`
    );
    const params = new URL(inspector.url).searchParams;
    expect(params.get("autoConnect")).toBe(url);
    expect(params.get("tab")).toBe("chat");
  });
});
