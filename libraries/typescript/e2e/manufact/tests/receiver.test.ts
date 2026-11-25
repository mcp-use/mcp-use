import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startReceiver } from "../receiver/receiver.mjs";

const TOKEN = "t0ken";
let r: { url: string; close: () => Promise<void> };
beforeAll(async () => {
  r = await startReceiver({ token: TOKEN });
});
afterAll(async () => r.close());

const auth = { authorization: `Bearer ${TOKEN}` };
const sign = (key: Buffer, id: string, ts: string, body: string) =>
  `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("R1 receiver", () => {
  it("answers /healthz without a token", async () => {
    const res = await fetch(`${r.url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("replays the configured status sequence, then 200, and records every attempt", async () => {
    await fetch(`${r.url}/b/seq/config`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ statuses: [500, 500] }),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++)
      statuses.push(
        (await fetch(`${r.url}/b/seq`, { method: "POST", body: `{"n":${i}}` }))
          .status
      );
    expect(statuses).toEqual([500, 500, 200]);
    const { records } = (await (
      await fetch(`${r.url}/b/seq?after=1`, { headers: auth })
    ).json()) as { records: { seq: number; rawBody: string }[] };
    expect(records.map((x) => [x.seq, x.rawBody])).toEqual([
      [2, '{"n":1}'],
      [3, '{"n":2}'],
    ]);
  });

  it("marks a Standard Webhooks signature valid only with the bucket secret", async () => {
    const secret = `whsec_${Buffer.from("k3y-bytes").toString("base64")}`;
    await fetch(`${r.url}/b/sig/config`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ secret }),
    });
    const body = '{"event":"note.created"}';
    const good = sign(Buffer.from("k3y-bytes"), "msg_1", "1700000000", body);
    const bad = sign(Buffer.from("other"), "msg_2", "1700000000", body);
    for (const [id, sig] of [
      ["msg_1", good],
      ["msg_2", bad],
    ])
      await fetch(`${r.url}/b/sig`, {
        method: "POST",
        headers: {
          "webhook-id": id,
          "webhook-timestamp": "1700000000",
          "webhook-signature": sig,
        },
        body,
      });
    const { records } = (await (
      await fetch(`${r.url}/b/sig`, { headers: auth })
    ).json()) as { records: { signatureValid: boolean }[] };
    expect(records.map((x) => x.signatureValid)).toEqual([true, false]);
  });

  it("echoes a verification challenge", async () => {
    const res = await fetch(`${r.url}/b/verify`, {
      method: "POST",
      body: JSON.stringify({ challenge: "c-123" }),
    });
    expect(await res.json()).toEqual({ challenge: "c-123" });
  });

  it("requires the bearer token to read, and deletes buckets", async () => {
    expect((await fetch(`${r.url}/b/seq`)).status).toBe(401);
    expect(
      (await fetch(`${r.url}/b/seq`, { method: "DELETE", headers: auth }))
        .status
    ).toBe(204);
    const { records } = (await (
      await fetch(`${r.url}/b/seq`, { headers: auth })
    ).json()) as { records: unknown[] };
    expect(records).toEqual([]);
  });
});
