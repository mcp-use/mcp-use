import { describe, expect, it } from "vitest";
import {
  decodeEventsError,
  EVENTS_ERROR_CODES,
  EventsError,
  HEADER_MISMATCH_CODE,
  INTERNAL_ERROR_CODE,
  INVALID_REQUEST_CODE,
  NOT_OFFERED_CODE,
  type EventsErrorKind,
} from "../src/index.js";
import { readVector } from "./vectors.js";

interface ErrorVectors {
  numberings: Record<string, Record<string, number>>;
  fixed: Record<string, number>;
  encode: Array<{
    numbering: "sketch" | "sep" | "documented";
    kind: EventsErrorKind;
    data: Record<string, unknown>;
    code: number;
    wireData: Record<string, unknown>;
  }>;
  decode: Array<{
    error: { code: number; message?: string; data?: unknown };
    kind: string | null;
  }>;
}

const v = readVector<ErrorVectors>("error-codes.json");

describe("error codes (vectors/error-codes.json)", () => {
  it("the codes table equals the vector's three numberings", () => {
    expect(EVENTS_ERROR_CODES).toEqual(v.numberings);
  });

  it("the sep numbering is PR #3209's EVENTS_ERROR_CODES", () => {
    expect(EVENTS_ERROR_CODES.sep).toEqual({
      invalidParams: -32602,
      notFound: -32023,
      forbidden: -32024,
      resourceExhausted: -32025,
      unsupported: -32026,
      callbackEndpointError: -32027,
    });
  });

  it("the fixed codes are the same in every numbering", () => {
    expect({
      headerMismatch: HEADER_MISMATCH_CODE,
      notOffered: NOT_OFFERED_CODE,
      invalidRequest: INVALID_REQUEST_CODE,
      internal: INTERNAL_ERROR_CODE,
    }).toEqual(v.fixed);
  });

  for (const c of v.encode) {
    it(`encodes ${c.kind} under ${c.numbering} as ${c.code}`, () => {
      const wire = new EventsError(c.kind, "Some message", c.data).toJsonRpc({
        errorCodes: c.numbering,
      });
      expect(wire).toEqual({
        code: c.code,
        message: "Some message",
        data: c.wireData,
      });
    });
  }

  for (const c of v.decode) {
    it(`decodes ${c.error.code} ${JSON.stringify(c.error.data ?? null)} ${JSON.stringify(c.error.message)} → ${c.kind}`, () => {
      expect(decodeEventsError(c.error) ?? null).toBe(c.kind);
    });
  }

  it("every kind round-trips through encode and decode in all three numberings", () => {
    const dataFor: Record<EventsErrorKind, Record<string, unknown>> = {
      invalidParams: { field: "arguments" },
      notFound: { kind: "event" },
      forbidden: { reason: "not_authorized" },
      resourceExhausted: { limit: "streams", max: 20 },
      unsupported: { feature: "deliveryMode", value: "push" },
      callbackEndpointError: { reason: "http_5xx" },
    };
    for (const numbering of ["sketch", "sep", "documented"] as const) {
      for (const kind of Object.keys(dataFor) as EventsErrorKind[]) {
        const wire = new EventsError(kind, "", dataFor[kind]).toJsonRpc({
          errorCodes: numbering,
        });
        expect([numbering, kind, decodeEventsError(wire)]).toEqual([
          numbering,
          kind,
          kind,
        ]);
      }
    }
  });
});

describe("EventsError", () => {
  it("uses the kind's default message for an empty message and keeps kind and data", () => {
    const e = new EventsError("forbidden", "", { reason: "revoked" });
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("forbidden");
    expect(e.data).toEqual({ reason: "revoked" });
    expect(e.toJsonRpc({ errorCodes: "sep" })).toEqual({
      code: -32024,
      message: "Forbidden",
      data: { reason: "revoked" },
    });
  });

  it("omits data when none was given, and uses sep for an errorCodes value it does not know", () => {
    expect(
      new EventsError("unsupported", "No push here").toJsonRpc({
        errorCodes: "future",
      })
    ).toEqual({ code: -32026, message: "No push here" });
  });
});
