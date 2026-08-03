import { describe, expect, it } from "vitest";
import { resolveBrowserCommand } from "../../src/cli/open-browser.js";

describe("resolveBrowserCommand", () => {
  it.each([
    [
      "darwin",
      {
        command: "open",
        args: ["https://example.com/path?value=%3Bopen+evil"],
      },
    ],
    [
      "win32",
      {
        command: "rundll32.exe",
        args: [
          "url.dll,FileProtocolHandler",
          "https://example.com/path?value=%3Bopen+evil",
        ],
      },
    ],
    [
      "linux",
      {
        command: "xdg-open",
        args: ["https://example.com/path?value=%3Bopen+evil"],
      },
    ],
  ] as const)("uses a shell-free %s launcher", (platform, expected) => {
    expect(
      resolveBrowserCommand(
        "https://example.com/path?value=%3Bopen+evil",
        platform
      )
    ).toEqual(expected);
  });

  it.each([
    "file:///tmp/index.html",
    "data:text/html,hello",
    ["java", "script:alert(1)"].join(""),
    "https://user:secret@example.com/",
    "not a URL",
    "/relative",
  ])("rejects unsafe browser target %s", (value) => {
    expect(resolveBrowserCommand(value, "linux")).toBeUndefined();
  });

  it("never invokes the Windows command shell", () => {
    expect(
      resolveBrowserCommand("http://localhost:3000/inspector", "win32")?.command
    ).not.toBe("cmd");
  });
});
