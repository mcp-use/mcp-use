import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readViewConfig } from "../../src/cli/view-config.js";
import { buildDevViewsManifest } from "../../src/cli/views.js";

const paths: string[] = [];
afterEach(() =>
  paths
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }))
);
function source(code: string): string {
  const directory = mkdtempSync(join(tmpdir(), "mcp-use-view-config-"));
  paths.push(directory);
  const path = join(directory, "view.tsx");
  writeFileSync(path, code);
  return path;
}
describe("static viewConfig extraction", () => {
  it("extracts literals and local constants without executing browser code", () => {
    const path = source(`import "./browser-only";
      const modes = ["inline", "fullscreen"] as const;
      const base = {autoResize: false};
      export const viewConfig = {...base, displayModes: modes, preferredDisplayMode: "fullscreen"} satisfies ViewConfig;
      document.body.innerHTML = "must not execute";
      export default () => <div/>;`);
    const config = {
      autoResize: false,
      displayModes: ["inline", "fullscreen"],
      preferredDisplayMode: "fullscreen",
    };
    expect(readViewConfig(path)).toEqual(config);
    expect(
      buildDevViewsManifest([{ name: "test", entryPath: path }])["test"]
        ?.viewConfig
    ).toEqual(config);
  });
  it("supports static array spreads from literals and local constants", () => {
    expect(
      readViewConfig(
        source(`const base = ["inline"] as const;
      export const viewConfig = {displayModes: [...base, ...["fullscreen"]], preferredDisplayMode: "fullscreen"};`)
      )
    ).toEqual({
      displayModes: ["inline", "fullscreen"],
      preferredDisplayMode: "fullscreen",
    });
  });
  it("ignores type-only named exports", () => {
    expect(
      readViewConfig(
        source(
          "export interface viewConfig {displayModes: string[]}; export default () => null;"
        )
      )
    ).toBeUndefined();
  });
  it("does not mistake a renamed destructured property for a config export", () => {
    expect(
      readViewConfig(
        source(
          'export const {viewConfig: other} = {viewConfig: {displayModes: ["inline"]}};'
        )
      )
    ).toBeUndefined();
  });
  it("ignores a type-only export specifier", () => {
    expect(
      readViewConfig(
        source(
          "interface viewConfig {displayModes: string[]}; export {type viewConfig};"
        )
      )
    ).toBeUndefined();
  });
  it("supports a separately named local export", () => {
    expect(
      readViewConfig(
        source(
          'const config = {displayModes: ["inline"]}; export {config as viewConfig};'
        )
      )
    ).toEqual({ displayModes: ["inline"] });
  });
  it("leaves the config absent when the module has no named export", () => {
    expect(
      readViewConfig(source("export default () => <div/>;"))
    ).toBeUndefined();
  });
  it.each([
    "export const viewConfig = makeConfig();",
    'export let viewConfig = {displayModes: ["inline"]};',
    'export var viewConfig = {displayModes: ["inline"]};',
    'export const {viewConfig} = {viewConfig: {displayModes: ["inline"]}};',
    'export const {nested: {viewConfig}} = {nested: {viewConfig: {displayModes: ["inline"]}}};',
    'export const [viewConfig] = [{displayModes: ["inline"]}];',
    "export const {viewConfig = {}} = {};",
    'export const {...viewConfig} = {displayModes: ["inline"]};',
    "export function viewConfig() {}",
    "export class viewConfig {}",
    'export const viewConfig = {displayModes: [..."inline"]};',
    "export const viewConfig = {displayModes: [...makeModes()]};",
    'let config = {displayModes: ["inline"]}; export {config as viewConfig};',
    'import {config} from "./config"; export const viewConfig = config;',
    'export {viewConfig} from "./config";',
    'export * as viewConfig from "./config";',
    "const a = b; const b = a; export const viewConfig = a;",
  ])("rejects unsupported config expressions: %s", (code) => {
    expect(() => readViewConfig(source(code))).toThrow(
      "Cannot statically extract viewConfig"
    );
  });
});
