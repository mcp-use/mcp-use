import { describe, expect, it, vi } from "vitest";

import {
  createFirebaseAdminIdentityAdapter,
  type FirebaseNativeToken,
  type FirebaseNativeUser,
} from "../src/oauth/native-identity.js";

function fixture() {
  const authTime = Math.floor(Date.now() / 1000) - 60;
  const token: FirebaseNativeToken = {
    aud: "firebase-test",
    iss: "https://securetoken.google.com/firebase-test",
    sub: "user-1",
    uid: "user-1",
    auth_time: authTime,
    firebase: { sign_in_provider: "google.com", tenant: "tenant-1" },
  };
  const user: FirebaseNativeUser = {
    uid: "user-1",
    disabled: false,
    email: "user@example.test",
    emailVerified: true,
    tokensValidAfterTime: new Date(authTime * 1000).toISOString(),
  };
  const auth = {
    verifyIdToken: vi.fn().mockResolvedValue(token),
    getUser: vi.fn().mockResolvedValue(user),
  };
  const adapter = createFirebaseAdminIdentityAdapter({
    projectId: "firebase-test",
    tenantId: "tenant-1",
    signInProvider: "google.com",
    requireVerifiedEmail: true,
    auth,
  });
  return {
    token,
    user,
    auth,
    adapter,
    binding: { uid: user.uid, authTime },
    login: () =>
      adapter.authenticate({
        request: new Request("https://mcp.example.test/login"),
        proof: { idToken: "fixture-token" },
      }),
  };
}

describe("Firebase Admin identity adapter", () => {
  it("checks revocation at login and retains the original authentication identity", async () => {
    const f = fixture();
    expect(await f.login()).toMatchObject({
      identity: { subject: "user-1", binding: f.binding },
    });
    expect(f.auth.verifyIdToken).toHaveBeenCalledWith("fixture-token", true);
    expect(
      await f.adapter.revalidate!(f.binding, new AbortController().signal)
    ).toMatchObject({
      status: "valid",
      identity: { binding: f.binding },
    });
    expect(
      await f.adapter.checkStatus!(f.binding, new AbortController().signal)
    ).toBe("valid");
    expect(f.auth.verifyIdToken).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["audience", { aud: "another-project" }],
    ["issuer", { iss: "https://issuer.example.test" }],
    ["subject", { sub: "another-user" }],
    ["empty UID", { uid: "", sub: "" }],
    [
      "tenant",
      { firebase: { sign_in_provider: "google.com", tenant: "other" } },
    ],
    [
      "provider",
      { firebase: { sign_in_provider: "password", tenant: "tenant-1" } },
    ],
    ["authentication age", { auth_time: Math.floor(Date.now() / 1000) - 301 }],
    [
      "future authentication",
      { auth_time: Math.floor(Date.now() / 1000) + 300 },
    ],
    ["invalid authentication time", { auth_time: 0 }],
  ])("rejects an invalid %s claim", async (_name, claims) => {
    const f = fixture();
    Object.assign(f.token, claims);
    await expect(f.login()).rejects.toMatchObject({ code: "invalid" });
    expect(f.auth.getUser).not.toHaveBeenCalled();
  });

  it.each(["revoked", "disabled", "unverified", "different UID"])(
    "rejects %s accounts on login and subsequent checks",
    async (state) => {
      const f = fixture();
      if (state === "revoked")
        f.user.tokensValidAfterTime = new Date(
          (f.binding.authTime + 1) * 1000
        ).toISOString();
      if (state === "disabled") f.user.disabled = true;
      if (state === "unverified") f.user.emailVerified = false;
      if (state === "different UID") f.user.uid = "other-user";
      await expect(f.login()).rejects.toMatchObject({ code: "invalid" });
      expect(
        await f.adapter.revalidate!(f.binding, new AbortController().signal)
      ).toEqual({ status: "invalid" });
      expect(
        await f.adapter.checkStatus!(f.binding, new AbortController().signal)
      ).toBe("invalid");
    }
  );

  it.each([
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/user-disabled",
    "auth/user-not-found",
    "auth/tenant-id-mismatch",
  ])("rejects authoritative Admin error %s", async (code) => {
    const f = fixture();
    f.auth.verifyIdToken.mockRejectedValue({ code });
    await expect(f.login()).rejects.toMatchObject({ code: "invalid" });
  });

  it.each([
    "auth/internal-error",
    "auth/network-request-failed",
    "auth/too-many-requests",
  ])("preserves the session on temporary Admin failure %s", async (code) => {
    const f = fixture();
    f.auth.getUser.mockRejectedValue({
      code,
      message: "private provider details",
    });
    await expect(f.login()).rejects.toMatchObject({ code: "unavailable" });
    expect(
      await f.adapter.revalidate!(f.binding, new AbortController().signal)
    ).toEqual({ status: "unavailable" });
    expect(
      await f.adapter.checkStatus!(f.binding, new AbortController().signal)
    ).toBe("unavailable");
  });

  it("treats malformed upstream data as inconclusive and skips cancelled calls", async () => {
    const f = fixture();
    f.user.tokensValidAfterTime = "not a date";
    expect(
      await f.adapter.revalidate!(f.binding, new AbortController().signal)
    ).toEqual({ status: "unavailable" });
    f.auth.getUser.mockClear();
    const signal = AbortSignal.abort();
    expect(await f.adapter.revalidate!(f.binding, signal)).toEqual({
      status: "unavailable",
    });
    expect(await f.adapter.checkStatus!(f.binding, signal)).toBe("unavailable");
    expect(f.auth.getUser).not.toHaveBeenCalled();
  });
});
