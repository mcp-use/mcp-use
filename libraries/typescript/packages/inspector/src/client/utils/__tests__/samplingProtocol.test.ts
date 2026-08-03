import type { JSONRPCMessage, Transport } from "@mcp-use/client/react";
import { describe, expect, it, vi } from "vitest";
import {
  isInspectorSamplingAvailable,
  STATELESS_SAMPLING_UNSUPPORTED_MESSAGE,
  stripModernSamplingCapability,
  wrapTransportForLegacySampling,
} from "../samplingProtocol";

const clientCapabilitiesKey = "io.modelcontextprotocol/clientCapabilities";

describe("Inspector sampling protocol behavior", () => {
  it("keeps sampling in a legacy initialize request", () => {
    const message = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { roots: {}, sampling: {} },
        clientInfo: { name: "Inspector", version: "1.0.0" },
      },
    };

    expect(stripModernSamplingCapability(message as JSONRPCMessage)).toBe(
      message
    );
    expect(message.params.capabilities).toEqual({
      roots: {},
      sampling: {},
    });
  });

  it("removes sampling from a modern capability envelope", () => {
    const message = {
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          [clientCapabilitiesKey]: {
            roots: { listChanged: true },
            sampling: {},
            extensions: { "io.modelcontextprotocol/ui": {} },
          },
        },
      },
    };

    const stripped = stripModernSamplingCapability(
      message as JSONRPCMessage
    ) as typeof message;

    expect(stripped.params._meta[clientCapabilitiesKey]).toEqual({
      roots: { listChanged: true },
      extensions: { "io.modelcontextprotocol/ui": {} },
    });
    expect(message.params._meta[clientCapabilitiesKey]).toHaveProperty(
      "sampling"
    );
  });

  it("strips modern sampling before forwarding through the transport", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const transport = {
      start: vi.fn(),
      send,
      close: vi.fn(),
    } as unknown as Transport;
    const wrapped = wrapTransportForLegacySampling(transport);

    await wrapped.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {
        _meta: {
          [clientCapabilitiesKey]: { sampling: {}, roots: {} },
        },
      },
    } as JSONRPCMessage);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          _meta: {
            [clientCapabilitiesKey]: { roots: {} },
          },
        },
      }),
      undefined
    );
  });

  it("shows sampling only when the connection is not modern", () => {
    expect(isInspectorSamplingAvailable({ protocolEra: "legacy" })).toBe(true);
    expect(isInspectorSamplingAvailable({ protocolEra: "modern" })).toBe(false);
    expect(STATELESS_SAMPLING_UNSUPPORTED_MESSAGE).toContain("2026-07-28");
  });
});
