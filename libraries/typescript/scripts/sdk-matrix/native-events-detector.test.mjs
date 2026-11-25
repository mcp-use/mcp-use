import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVersions,
  exportsNativeEvents,
  newerPrerelease,
} from "./native-events-detector.mjs";
import { parseArgs } from "./continuity.mjs";

test("exportsNativeEvents reads the ./ext/events subpath", () => {
  assert.equal(
    exportsNativeEvents({ exports: { ".": "./a.js", "./ext/events": {} } }),
    true
  );
  assert.equal(exportsNativeEvents({ exports: { ".": "./a.js" } }), false);
  assert.equal(exportsNativeEvents({ exports: "./a.js" }), false);
  assert.equal(exportsNativeEvents({}), false);
});

test("compareVersions follows semver precedence", () => {
  const sorted = [
    "2.4.0",
    "2.4.0-alpha.1",
    "2.3.1",
    "2.4.0-beta.2",
    "2.4.0-alpha.10",
  ].sort(compareVersions);
  assert.deepEqual(sorted, [
    "2.3.1",
    "2.4.0-alpha.1",
    "2.4.0-alpha.10",
    "2.4.0-beta.2",
    "2.4.0",
  ]);
});

test("newerPrerelease returns the highest prerelease above latest, else null", () => {
  const versions = [
    "2.3.1",
    "2.4.0-beta.1",
    "2.4.0",
    "2.5.0-alpha.1",
    "2.5.0-alpha.2",
  ];
  assert.equal(newerPrerelease(versions, "2.4.0"), "2.5.0-alpha.2");
  assert.equal(
    newerPrerelease(["2.3.1", "2.4.0-beta.1", "2.4.0"], "2.4.0"),
    null
  );
});

test("continuity parseArgs requires --a, --b and --leg", () => {
  assert.deepEqual(parseArgs(["--a", "x", "--b", "y", "--leg", "latest"]), {
    a: "x",
    b: "y",
    leg: "latest",
  });
  assert.throws(() => parseArgs(["--a", "x", "--b", "y"]), {
    message: "missing --leg",
  });
  assert.throws(() => parseArgs(["--a", "--b", "y"]), {
    message: "--a needs a value",
  });
});
