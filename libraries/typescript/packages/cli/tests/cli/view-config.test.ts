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
  it("resolves a local constant named undefined before the global value", () => {
    expect(
      readViewConfig(
        source(`const undefined = "fullscreen";
      export const viewConfig = {preferredDisplayMode: undefined};`)
      )
    ).toEqual({ preferredDisplayMode: "fullscreen" });
  });
  it("still supports the unshadowed undefined value", () => {
    expect(
      readViewConfig(source("export const viewConfig = undefined;"))
    ).toBeUndefined();
  });
  it("ignores type-only wildcard exports", () => {
    expect(
      readViewConfig(source('export type * from "./types";'))
    ).toBeUndefined();
  });
  it("allows an explicit config to override a wildcard export", () => {
    expect(
      readViewConfig(
        source(`export * from "./other";
      export const viewConfig = {autoResize: false};`)
      )
    ).toEqual({ autoResize: false });
  });
  it("allows unrelated mutations and shadowed config names", () => {
    expect(
      readViewConfig(
        source(`const modes = ["inline"];
      export const viewConfig = {displayModes: modes};
      const unrelated = []; unrelated.push("fullscreen");
      function component(modes) { modes.push("fullscreen"); }
      function other() { const modes = []; modes.push("fullscreen"); }
      document.body.innerHTML = "browser only";`)
      )
    ).toEqual({ displayModes: ["inline"] });
  });
  it("allows primitive reads and independent shallow copies", () => {
    expect(
      readViewConfig(
        source(`const modes = ["inline"];
      export const viewConfig = {displayModes: modes, autoResize: true};
      console.log(viewConfig.autoResize, viewConfig.displayModes.length);
      const enabled = viewConfig.autoResize; console.log(enabled);
      const clone = [...modes]; clone.push("fullscreen");
      const flags = {...{autoResize: true}}; flags.autoResize = false;
      const {autoResize} = viewConfig; console.log(autoResize);
      function component() { return viewConfig.autoResize; }`)
      )
    ).toEqual({ displayModes: ["inline"], autoResize: true });
  });
  it("keeps switch block bindings separate from module constants", () => {
    expect(
      readViewConfig(
        source(`const modes = ["inline"];
      export const viewConfig = {displayModes: modes};
      switch (1) { case 1: const modes = []; modes.push("fullscreen"); }`)
      )
    ).toEqual({ displayModes: ["inline"] });
  });
  it("allows deferred components to consume config objects through calls", () => {
    expect(
      readViewConfig(
        source(`export const viewConfig = {displayModes: ["inline"]};
        function readModes() { return viewConfig.displayModes; }
        export default function View() {
          console.log(viewConfig);
          const [modes] = useState(viewConfig.displayModes);
          const selected = useMemo(() => viewConfig.displayModes, [viewConfig.displayModes]);
          let getter; getter = readModes;
          return renderModes(getter(), modes, selected);
        }`)
      )
    ).toEqual({ displayModes: ["inline"] });
  });
  it.each([
    "let init; init = helper; init();",
    "let init = () => {}; init = helper; init();",
    "let init; init = helper; init(); init = () => {};",
    "let init, alias; init = alias = helper; init();",
    "let init; [init] = [helper]; init();",
    "const actions = {}; actions.init = helper; actions.init();",
    "let init; function assign() { init = helper; } assign(); init();",
  ])("rejects assignment-created initialization aliases: %s", (code) => {
    expect(() =>
      readViewConfig(
        source(`
      export const viewConfig = {displayModes: ["inline"]};
      function helper() { viewConfig.displayModes.push("fullscreen"); }
      ${code}
    `)
      )
    ).toThrow("Cannot statically extract viewConfig");
  });
  it.each([
    "function init() { mutate(viewConfig); } init();",
    "const init = () => mutate(viewConfig); const alias = init; alias();",
    "const helpers = {init() { mutate(viewConfig); }}; helpers.init();",
    "function inner() { mutate(viewConfig); } function outer() { inner(); } outer();",
    "run(() => mutate(viewConfig));",
    "(() => mutate(viewConfig))();",
    "function getConfig() { return viewConfig; } mutate(getConfig());",
  ])("rejects config escapes through initialization helpers: %s", (code) => {
    expect(() =>
      readViewConfig(
        source(`export const viewConfig = {displayModes: ["inline"]}; ${code}`)
      )
    ).toThrow("Cannot statically extract viewConfig");
  });
  it.each([
    'export * from "./config";',
    "export const viewConfig = {autoResize: true}; for (viewConfig.autoResize of [false]) {}",
    `export const viewConfig = {autoResize: true}; mutate\`\${viewConfig}\`;`,
    "const options = {defaultSize: {height: 10}}; export const viewConfig = options; const copy = {...options}; copy.defaultSize.height = 20;",
    'let undefined = "fullscreen"; export const viewConfig = {preferredDisplayMode: undefined};',
    'import {undefined} from "./config"; export const viewConfig = {preferredDisplayMode: undefined};',
    "export const viewConfig = {preferredDisplayMode: /inline/};",
    "export const viewConfig = {defaultSize: {height: 10n}};",
    "export const viewConfig = {autoResize: true}; viewConfig.autoResize = false;",
    "export const viewConfig = {defaultSize: {height: 10}}; viewConfig.defaultSize.height++;",
    "export const viewConfig = {autoResize: true}; delete viewConfig.autoResize;",
    'const modes = ["inline"]; modes.push("fullscreen"); export const viewConfig = {displayModes: modes};',
    'const modes = ["inline"]; const alias = modes; alias[0] = "fullscreen"; export const viewConfig = {displayModes: modes};',
    'export const viewConfig = {displayModes: ["inline"]}; const {displayModes} = viewConfig; displayModes.push("fullscreen");',
    'const modes = ["inline"]; mutate(modes); export const viewConfig = {displayModes: modes};',
    "export const viewConfig = {autoResize: true}; function mutate() { viewConfig.autoResize = false; } mutate();",
  ])(
    "rejects config values that cannot be immutable static data: %s",
    (code) => {
      expect(() => readViewConfig(source(code))).toThrow(
        "Cannot statically extract viewConfig"
      );
    }
  );
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
