import { parseArgs } from "node:util";

type CliOptions = {
  template?: string;
  listTemplates?: boolean;
  install?: boolean;
  skills?: boolean;
  dev?: boolean;
  sdkVersion?: string;
  npm?: boolean;
  pnpm?: boolean;
  bun?: boolean;
};

export function parseCli(argv: string[]): {
  projectName?: string;
  options: CliOptions;
} {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      template: { type: "string", short: "t" },
      "list-templates": { type: "boolean" },
      install: { type: "boolean" },
      skills: { type: "boolean" },
      dev: { type: "boolean" },
      "sdk-version": { type: "string" },
      npm: { type: "boolean" },
      pnpm: { type: "boolean" },
      bun: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
    },
    allowPositionals: true,
    allowNegative: true,
    strict: true,
  });

  if (positionals.length > 1) {
    throw new Error(`Unexpected extra argument: ${positionals[1]}`);
  }

  return {
    projectName: positionals[0],
    options: {
      template: values.template as string | undefined,
      listTemplates: values["list-templates"] as boolean | undefined,
      install: values.install as boolean | undefined,
      skills: values.skills as boolean | undefined,
      dev: values.dev as boolean | undefined,
      sdkVersion: values["sdk-version"] as string | undefined,
      npm: values.npm as boolean | undefined,
      pnpm: values.pnpm as boolean | undefined,
      bun: values.bun as boolean | undefined,
    },
  };
}
