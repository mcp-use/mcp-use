// @vitest-environment jsdom

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import {
  useMcpEvent,
  type UseMcpEventResult,
} from "../../../src/react/useMcpEvent.js";

type Poll = { name: string; arguments: Record<string, unknown> };

/** A ready `useMcp` result whose one session answers polls from `reply`. */
function fakeMcp(reply: (p: Poll) => unknown) {
  const session = {
    request: async (_method: string, params: Poll) => reply(params),
  };
  return {
    state: "ready" as const,
    client: { getAllActiveSessions: () => ({ s: session }) } as any,
  };
}

function Probe(props: {
  mcp: ReturnType<typeof fakeMcp>;
  name: string;
  channel: string;
  out: { current?: UseMcpEventResult<unknown> };
}) {
  props.out.current = useMcpEvent(props.mcp, props.name, {
    arguments: { channel: props.channel },
    minIntervalMs: 60_000,
  });
  return null;
}

const flush = () => act(async () => {});

describe("useMcpEvent", () => {
  it("clears events and truncated when the arguments change", async () => {
    const mcp = fakeMcp((p) => ({
      events: [
        {
          eventId: `e-${p.arguments.channel}`,
          name: p.name,
          timestamp: "2026-01-01T00:00:00Z",
          data: {},
        },
      ],
      cursor: "c1",
      truncated: p.arguments.channel === "a",
      hasMore: false,
      nextPollMs: 60_000,
    }));
    const out: { current?: UseMcpEventResult<unknown> } = {};
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<Probe mcp={mcp} name="m" channel="a" out={out} />);
    });
    await flush();
    expect(out.current?.events.map((e) => e.eventId)).toEqual(["e-a"]);
    expect(out.current?.truncated).toBe(true);

    await act(async () => {
      r.update(<Probe mcp={mcp} name="m" channel="b" out={out} />);
    });
    await flush();
    expect(out.current?.events.map((e) => e.eventId)).toEqual(["e-b"]);
    expect(out.current?.truncated).toBe(false);
    act(() => r.unmount());
  });

  it("reports polling as soon as the connection is ready", async () => {
    const mcp = fakeMcp(() => new Promise(() => {})); // first poll never returns
    const out: { current?: UseMcpEventResult<unknown> } = {};
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<Probe mcp={mcp} name="m" channel="a" out={out} />);
    });
    expect(out.current?.state).toBe("polling");
    act(() => r.unmount());
  });
});
