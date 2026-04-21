import { describe, it, expect } from "vitest";
import { resolveOrgFromOption } from "../src/commands/auth.js";
import type { OrgInfo } from "../src/utils/api.js";

const orgs: OrgInfo[] = [
  {
    id: "default-profile-45e7bb29",
    name: "Personal",
    slug: "personal",
    role: "owner",
  },
  {
    id: "primary-3747c0f6",
    name: "Manufact Demo Org",
    slug: "manufact-demo",
    role: "admin",
  },
  {
    id: "profile-no-slug",
    name: "Legacy Org",
    slug: null,
    role: "member",
  },
];

describe("resolveOrgFromOption", () => {
  it("matches by slug", () => {
    expect(resolveOrgFromOption(orgs, "manufact-demo")).toBe(orgs[1]);
  });

  it("matches by id", () => {
    expect(resolveOrgFromOption(orgs, "primary-3747c0f6")).toBe(orgs[1]);
  });

  it("matches by name case-insensitively", () => {
    expect(resolveOrgFromOption(orgs, "manufact demo org")).toBe(orgs[1]);
    expect(resolveOrgFromOption(orgs, "MANUFACT DEMO ORG")).toBe(orgs[1]);
  });

  it("trims surrounding whitespace", () => {
    expect(resolveOrgFromOption(orgs, "  manufact-demo  ")).toBe(orgs[1]);
  });

  it("returns null when no org matches", () => {
    expect(resolveOrgFromOption(orgs, "does-not-exist")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveOrgFromOption(orgs, "")).toBeNull();
    expect(resolveOrgFromOption(orgs, "   ")).toBeNull();
  });

  it("returns null when the org list is empty", () => {
    expect(resolveOrgFromOption([], "anything")).toBeNull();
  });

  it("does not coerce the literal string 'null' to match a null slug", () => {
    expect(resolveOrgFromOption(orgs, "null")).toBeNull();
  });

  it("matches an org whose slug is null by id or name", () => {
    expect(resolveOrgFromOption(orgs, "profile-no-slug")).toBe(orgs[2]);
    expect(resolveOrgFromOption(orgs, "Legacy Org")).toBe(orgs[2]);
  });

  it("returns the first match when identifiers collide across orgs", () => {
    const collision: OrgInfo[] = [
      { id: "shared-key", name: "First", slug: "first-slug", role: "owner" },
      { id: "other", name: "Second", slug: "shared-key", role: "admin" },
    ];
    expect(resolveOrgFromOption(collision, "shared-key")).toBe(collision[0]);
  });
});
