// @vitest-environment jsdom

/**
 * Regression: onSampling / onElicitation / onNotification must stay fresh across
 * reconnects via refs + stable proxies, without reconnecting when only callback
 * identities change.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import type { UseMcpOptions } from "../../../src/react/types.js";

function makeConnection() {
  return {
    tools: [],
    info: {
      protocolEra: "legacy",
      protocolVersion: "2025-06-18",
      server: { name: "test-server" },
      capabilities: {},
      extensions: {},
    },
    supports: vi.fn().mockReturnValue(false),
    callTool: vi.fn(),
    readResource: vi.fn(),
    listTools: vi.fn().mockResolvedValue([]),
    listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    listAllSkills: vi.fn().mockResolvedValue({ skills: [] }),
    listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
    getPrompt: vi.fn(),
    complete: vi.fn(),
  };
}

const mockAuthProvider = {
  serverUrl: "http://localhost/mcp",
  tokens: vi.fn().mockResolvedValue(undefined),
  clearStorage: vi.fn().mockReturnValue(0),
};

let activeConnection: ReturnType<typeof makeConnection> | null = null;

const sharedClient = {
  addServer: vi.fn().mockResolvedValue(undefined),
  removeServer: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockReturnValue([]),
  getSession: vi.fn(() => activeConnection),
  connect: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../src/core/browser.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BrowserMCPClient: vi.fn(function () {
    return sharedClient;
  }),
}));

vi.mock("../../../src/auth/browser.js", () => ({
  createBrowserOAuthProvider: vi.fn(() => ({
    provider: null,
    oauthProxyUrl: undefined,
  })),
}));

vi.mock("../../../src/telemetry/telemetry-browser.js", () => ({
  Tel: {
    getInstance: () => ({
      trackUseMcpConnection: vi.fn().mockResolvedValue(undefined),
      trackUseMcpToolCall: vi.fn().mockResolvedValue(undefined),
      trackUseMcpResourceRead: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../../src/utils/favicon.js", () => ({
  detectFavicon: vi.fn().mockResolvedValue(null),
}));

const samplingResult = {
  role: "assistant" as const,
  content: { type: "text" as const, text: "ok" },
  model: "test",
  stopReason: "endTurn" as const,
};

const elicitResult = { action: "accept" as const };

async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("useMcp callback freshness", () => {
  let useMcp: typeof import("../../../src/react/useMcp.js").useMcp;

  beforeEach(async () => {
    vi.clearAllMocks();
    activeConnection = null;
    mockAuthProvider.serverUrl = "http://localhost/mcp";
    sharedClient.connect.mockImplementation(async () => {
      activeConnection = makeConnection();
      return activeConnection;
    });

    vi.resetModules();
    const module = await import("../../../src/react/useMcp.js");
    useMcp = module.useMcp;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses latest callbacks after identity changes without reconnecting", async () => {
    const samplingV1 = vi.fn().mockResolvedValue(samplingResult);
    const samplingV2 = vi.fn().mockResolvedValue({
      ...samplingResult,
      content: { type: "text" as const, text: "v2" },
    });
    const elicitV1 = vi.fn().mockResolvedValue(elicitResult);
    const elicitV2 = vi.fn().mockResolvedValue({ action: "decline" as const });
    const notifV1 = vi.fn();
    const notifV2 = vi.fn();

    let latest: ReturnType<typeof useMcp> | undefined;
    let renderer: ReturnType<typeof create>;

    function TestComponent({
      url,
      onSampling,
      onElicitation,
      onNotification,
    }: {
      url: string;
      onSampling: typeof samplingV1;
      onElicitation: typeof elicitV1;
      onNotification: typeof notifV1;
    }) {
      latest = useMcp({
        url,
        enabled: true,
        authProvider: mockAuthProvider,
        autoProxyFallback: false,
        autoRetry: false,
        autoReconnect: false,
        logLevel: "silent",
        onSampling,
        onElicitation,
        onNotification,
      });
      return null;
    }

    await act(async () => {
      renderer = create(
        <TestComponent
          url="http://localhost/mcp"
          onSampling={samplingV1}
          onElicitation={elicitV1}
          onNotification={notifV1}
        />
      );
    });
    await flushMicrotasks();

    expect(latest?.state).toBe("ready");
    expect(sharedClient.addServer).toHaveBeenCalledTimes(1);
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);

    const addServerConfig = sharedClient.addServer.mock.calls[0][1];
    expect(typeof addServerConfig.onSampling).toBe("function");
    expect(typeof addServerConfig.onElicitation).toBe("function");
    const wiredSampling = addServerConfig.onSampling;
    const wiredElicitation = addServerConfig.onElicitation;

    const notificationHandler = addServerConfig.onNotification as (n: {
      method: string;
    }) => void;

    // Change only callback identities (same URL / connection options)
    await act(async () => {
      renderer!.update(
        <TestComponent
          url="http://localhost/mcp"
          onSampling={samplingV2}
          onElicitation={elicitV2}
          onNotification={notifV2}
        />
      );
    });
    await flushMicrotasks();

    // Callback identity churn must not force a reconnect
    expect(sharedClient.addServer).toHaveBeenCalledTimes(1);
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);
    expect(latest?.state).toBe("ready");

    // Proxies wired at connect time must dispatch to the *latest* handlers
    await wiredSampling({
      messages: [],
      maxTokens: 16,
    });
    await wiredElicitation({
      message: "pick",
      mode: "form",
      requestedSchema: { type: "object", properties: {} },
    });
    notificationHandler({ method: "notifications/message" });

    expect(samplingV1).not.toHaveBeenCalled();
    expect(elicitV1).not.toHaveBeenCalled();
    expect(notifV1).not.toHaveBeenCalled();
    expect(samplingV2).toHaveBeenCalledTimes(1);
    expect(elicitV2).toHaveBeenCalledTimes(1);
    expect(notifV2).toHaveBeenCalledTimes(1);

    // Re-invoke the connection path via URL change; reconnect wiring must
    // still reach the latest callbacks.
    mockAuthProvider.serverUrl = "http://localhost/mcp-b";
    await act(async () => {
      renderer!.update(
        <TestComponent
          url="http://localhost/mcp-b"
          onSampling={samplingV2}
          onElicitation={elicitV2}
          onNotification={notifV2}
        />
      );
    });
    await flushMicrotasks(5);

    expect(sharedClient.addServer.mock.calls.length).toBeGreaterThan(1);
    const reconnectedConfig =
      sharedClient.addServer.mock.calls[
        sharedClient.addServer.mock.calls.length - 1
      ][1];

    samplingV2.mockClear();
    elicitV2.mockClear();
    await reconnectedConfig.onSampling({ messages: [], maxTokens: 8 });
    await reconnectedConfig.onElicitation({
      message: "again",
      mode: "form",
      requestedSchema: { type: "object", properties: {} },
    });
    expect(samplingV2).toHaveBeenCalledTimes(1);
    expect(elicitV2).toHaveBeenCalledTimes(1);
  });

  it("refreshes skills on resource changes for clients that support the extension", async () => {
    let latest: ReturnType<typeof useMcp> | undefined;
    const skillsClientInfo = {
      name: "skills-host",
      version: "1.0.0",
      capabilities: {
        extensions: { "io.modelcontextprotocol/skills": {} },
      },
    };

    function TestComponent() {
      latest = useMcp({
        url: "http://localhost/mcp",
        enabled: true,
        authProvider: mockAuthProvider,
        autoProxyFallback: false,
        autoRetry: false,
        autoReconnect: false,
        logLevel: "silent",
        clientInfo: skillsClientInfo,
      });
      return null;
    }

    await act(async () => {
      create(<TestComponent />);
    });
    await flushMicrotasks();

    expect(latest?.skills).toEqual([]);
    expect(activeConnection?.listAllSkills).not.toHaveBeenCalled();

    const notificationHandler = sharedClient.addServer.mock.calls[0][1]
      .onNotification as (notification: { method: string }) => void;
    activeConnection?.listAllSkills.mockResolvedValue({
      skills: [
        {
          uri: "skill://shipping/SKILL.md",
          frontmatter: { name: "shipping", description: "Track shipments" },
          resources: [],
        },
      ],
    });
    notificationHandler({ method: "notifications/resources/list_changed" });
    await flushMicrotasks(5);
    expect(latest?.skills[0]?.frontmatter.description).toBe("Track shipments");

    activeConnection?.listAllSkills.mockResolvedValue({
      skills: [
        {
          uri: "skill://shipping/SKILL.md",
          frontmatter: {
            name: "shipping",
            description: "Updated shipment tracking",
          },
          resources: [],
        },
      ],
    });
    notificationHandler({ method: "notifications/resources/list_changed" });
    await flushMicrotasks(5);
    expect(latest?.skills[0]?.frontmatter.description).toBe(
      "Updated shipment tracking"
    );

    activeConnection?.listAllSkills.mockRejectedValue(
      Object.assign(new Error("Method not found"), { code: -32601 })
    );
    notificationHandler({ method: "notifications/resources/list_changed" });
    await flushMicrotasks(5);
    expect(latest?.skills).toEqual([]);
  });

  it("defers callback presence changes until a normal reconnect", async () => {
    const samplingV1 = vi.fn().mockResolvedValue(samplingResult);
    const samplingV2 = vi.fn().mockResolvedValue(samplingResult);
    const elicitV1 = vi.fn().mockResolvedValue(elicitResult);
    const elicitV2 = vi.fn().mockResolvedValue(elicitResult);

    let renderer: ReturnType<typeof create>;

    function TestComponent({
      url,
      onSampling,
      onElicitation,
    }: Pick<UseMcpOptions, "onSampling" | "onElicitation"> & { url: string }) {
      useMcp({
        url,
        enabled: true,
        authProvider: mockAuthProvider,
        autoProxyFallback: false,
        autoRetry: false,
        autoReconnect: false,
        logLevel: "silent",
        onSampling,
        onElicitation,
      });
      return null;
    }

    await act(async () => {
      renderer = create(
        <TestComponent
          url="http://localhost/mcp"
          onSampling={samplingV1}
          onElicitation={elicitV1}
        />
      );
    });
    await flushMicrotasks();

    expect(sharedClient.addServer).toHaveBeenCalledTimes(1);
    const liveConfig = sharedClient.addServer.mock.calls[0][1];

    // Removing callback props does not overlap the live connection with an
    // automatic disconnect/reconnect. Its already-advertised proxies retain
    // the last defined implementations until a normal reconnect.
    await act(async () => {
      renderer!.update(<TestComponent url="http://localhost/mcp" />);
    });
    await flushMicrotasks();
    expect(sharedClient.addServer).toHaveBeenCalledTimes(1);
    await liveConfig.onSampling({ messages: [], maxTokens: 4 });
    await liveConfig.onElicitation({
      message: "still live",
      mode: "form",
      requestedSchema: { type: "object", properties: {} },
    });
    expect(samplingV1).toHaveBeenCalledTimes(1);
    expect(elicitV1).toHaveBeenCalledTimes(1);

    // The next normal reconnect evaluates current presence and omits both.
    mockAuthProvider.serverUrl = "http://localhost/mcp-b";
    await act(async () => {
      renderer!.update(<TestComponent url="http://localhost/mcp-b" />);
    });
    await flushMicrotasks(5);
    expect(sharedClient.addServer).toHaveBeenCalledTimes(2);
    expect(sharedClient.addServer.mock.calls[1][1].onSampling).toBeUndefined();
    expect(
      sharedClient.addServer.mock.calls[1][1].onElicitation
    ).toBeUndefined();

    // Adding callbacks also waits for the next normal reconnect.
    await act(async () => {
      renderer!.update(
        <TestComponent
          url="http://localhost/mcp-b"
          onSampling={samplingV2}
          onElicitation={elicitV2}
        />
      );
    });
    await flushMicrotasks();
    expect(sharedClient.addServer).toHaveBeenCalledTimes(2);

    mockAuthProvider.serverUrl = "http://localhost/mcp-c";
    await act(async () => {
      renderer!.update(
        <TestComponent
          url="http://localhost/mcp-c"
          onSampling={samplingV2}
          onElicitation={elicitV2}
        />
      );
    });
    await flushMicrotasks(5);
    expect(sharedClient.addServer).toHaveBeenCalledTimes(3);
    const nextConfig = sharedClient.addServer.mock.calls[2][1];
    await nextConfig.onSampling({ messages: [], maxTokens: 4 });
    await nextConfig.onElicitation({
      message: "new live session",
      mode: "form",
      requestedSchema: { type: "object", properties: {} },
    });
    expect(samplingV2).toHaveBeenCalledTimes(1);
    expect(elicitV2).toHaveBeenCalledTimes(1);
  });

  it("omits sampling/elicitation proxies when no callbacks are provided", async () => {
    function TestComponent() {
      useMcp({
        url: "http://localhost/mcp",
        enabled: true,
        authProvider: mockAuthProvider,
        autoProxyFallback: false,
        autoRetry: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    await act(async () => {
      create(<TestComponent />);
    });
    await flushMicrotasks();

    const config = sharedClient.addServer.mock.calls[0][1];
    expect(config.onSampling).toBeUndefined();
    expect(config.onElicitation).toBeUndefined();
  });
});
