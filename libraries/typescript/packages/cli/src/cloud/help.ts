/** Help pages for Cloud command groups. Each operation owns its options. */
type Row = readonly [name: string, description: string];
interface Page {
  summary: string;
  args?: string;
  options?: readonly Row[];
  examples?: readonly string[];
  commands?: Record<string, Page>;
}

const org: Row = ["--org <id-or-slug>", "Organization override"];
const path: Row = [
  "--path <dir>",
  "Project directory (default: current directory)",
];
const server: Row = [
  "--server <id-or-slug>",
  "Server override; otherwise use the project link",
];
const project = [server, org, path];
const yes: Row = ["--yes", "Confirm without prompting"];
const skip: Row = ["--skip <n>", "Results to skip (default: 0)"];
const branch: Row = ["--branch <name>", "Branch override"];
const limit = (maximum: number, fallback: number): Row => [
  "--limit <n>",
  `Results per page, 1-${maximum} (default: ${fallback})`,
];
const environment: Row = [
  "--environment <name>",
  "production, preview, or development; --branch defaults to preview",
];
const phase: Row = [
  "--phase <phase>",
  "runtime, build, or both; preserves the existing setting",
];
const envScope = [...project, environment, branch, phase];

const pages: Record<string, Page> = {
  analytics: {
    summary:
      "Discover server analytics and run scoped read-only ClickHouse SQL.",
    examples: [
      "mcp-use analytics catalog --json",
      "mcp-use analytics query --help",
    ],
    commands: {
      catalog: {
        summary:
          "Get live relations, columns, SQL examples, retention, freshness, and query limits.",
        options: [
          ...project,
          ["--branch <name>", "Preview branch; omit for all environments"],
        ],
        examples: ["mcp-use analytics catalog --server my-server --json"],
      },
      query: {
        summary:
          "Run one read-only SELECT or UNION over catalog relations. Read the catalog first; include time predicates using {from:DateTime64(3)} and {to:DateTime64(3)}. Authorization, retention, and query budgets are enforced by Cloud.",
        args: '"<sql>"',
        options: [
          ...project,
          ["--time-range <preset>", "1h, 24h, 7d, 30d, or 90d (default: 7d)"],
          [
            "--from <timestamp>",
            "Inclusive ISO start with UTC offset; requires --to",
          ],
          [
            "--to <timestamp>",
            "Exclusive ISO end with UTC offset; replaces --time-range with --from",
          ],
          ["--branch <name>", "Preview branch; omit for all environments"],
          ["--max-rows <n>", "Maximum result rows, 1–500 (default: 100)"],
          [
            "--include-internal",
            "Include Manufact internal traffic (default: excluded)",
          ],
        ],
        examples: [
          "mcp-use analytics query \"SELECT sum(events) AS requests FROM clients_daily WHERE bucket >= {from:DateTime64(3)} AND bucket < {to:DateTime64(3)} AND traffic_class != 'non_mcp'\" --json",
          'mcp-use analytics query --json -- "-- comment\nSELECT …"',
        ],
      },
    },
  },
  org: {
    summary: "Manage organizations and choose the active organization.",
    examples: [
      "mcp-use org list",
      "mcp-use org use acme",
      "mcp-use org update --help",
    ],
    commands: {
      list: {
        summary: "List your organizations and mark the active one.",
        examples: ["mcp-use org list"],
      },
      current: {
        summary: "Show the active organization.",
        options: [org, path],
        examples: ["mcp-use org current"],
      },
      use: {
        summary: "Select the active organization by ID or URL slug.",
        args: "<id-or-slug>",
        examples: ["mcp-use org use acme"],
      },
      create: {
        summary: "Create an organization.",
        args: "<name>",
        options: [
          ["--slug <slug>", "URL slug (default: derived from the name)"],
        ],
        examples: ['mcp-use org create "Acme Corp" --slug acme'],
      },
      update: {
        summary: "Update the selected organization's name, URL slug, or logo.",
        options: [
          org,
          path,
          ["--name <name>", "New display name"],
          ["--slug <slug>", "New URL slug"],
          ["--logo <file>", "Upload a PNG, JPEG, SVG, or WebP logo"],
        ],
        examples: [
          'mcp-use org update --name "Acme Corp"',
          "mcp-use org update --org acme --logo ./logo.png",
        ],
      },
      members: {
        summary: "List organization members.",
        options: [org, limit(100, 30), skip],
        examples: ["mcp-use org members --org acme"],
      },
      invites: {
        summary: "Manage organization invitations.",
        examples: [
          "mcp-use org invites list",
          "mcp-use org invites send teammate@example.com",
        ],
        commands: {
          list: {
            summary: "List organization invitations.",
            options: [org],
            examples: ["mcp-use org invites list"],
          },
          send: {
            summary: "Invite a member to the organization.",
            args: "<email>",
            options: [
              org,
              ["--role <role>", "member or admin (default: member)"],
            ],
            examples: [
              "mcp-use org invites send teammate@example.com --role member",
            ],
          },
          cancel: {
            summary: "Cancel an invitation.",
            args: "<invite-id>",
            options: [org],
            examples: ["mcp-use org invites cancel inv_123"],
          },
        },
      },
    },
  },
  servers: {
    summary: "Manage Cloud servers and their deployment settings.",
    examples: ["mcp-use servers list", "mcp-use servers update --help"],
    commands: {
      list: {
        summary: "List servers in an organization.",
        options: [org, path, limit(100, 30), skip],
        examples: ["mcp-use servers list --org acme"],
      },
      get: {
        summary: "Show server details.",
        args: "[server]",
        options: project,
        examples: ["mcp-use servers get", "mcp-use servers get my-server"],
      },
      update: {
        summary: "Update explicitly supplied server settings.",
        args: "[server]",
        options: [
          ...project,
          ["--name <name>", "Display name"],
          ["--description <text>", "Server description"],
          ["--branch <name>", "Production branch"],
          ["--root-dir <path>", "Project root within the repository"],
          ["--build-command <cmd>", "Build command"],
          ["--start-command <cmd>", "Start command"],
          ["--watch-paths <glob>", "Auto-deploy path filter (repeatable)"],
          ["--deploy-branches <glob>", "Preview branch pattern (repeatable)"],
          ["--wait-for-ci", "Wait for other GitHub checks"],
          ["--no-wait-for-ci", "Disable waiting for GitHub checks"],
          ["--repo <owner/name>", "Connect a GitHub repository"],
          ["--installation <id>", "GitHub installation for --repo"],
          ["--disconnect-repo", "Disconnect the GitHub repository"],
          ["--allow-ip <cidr>", "Replace custom IP ranges (repeatable)"],
          ["--clear-allow-ip", "Clear custom IP ranges"],
        ],
        examples: [
          'mcp-use servers update --name "Acme API"',
          "mcp-use servers update my-server --branch main",
        ],
      },
      rm: {
        summary: "Remove a server (alias: remove).",
        args: "[server]",
        options: [...project, yes],
        examples: ["mcp-use servers rm my-server --yes"],
      },
    },
  },
  deployments: {
    summary: "Inspect and manage Cloud deployments.",
    examples: [
      "mcp-use deployments list",
      "mcp-use deployments restart --help",
    ],
    commands: {
      list: {
        summary: "List deployments in an organization.",
        options: [
          org,
          path,
          ["--server <id>", "Filter by server ID"],
          limit(200, 30),
          skip,
        ],
        examples: ["mcp-use deployments list --server srv_123"],
      },
      get: {
        summary: "Show deployment details.",
        args: "<id>",
        options: [org, path],
        examples: ["mcp-use deployments get dep_123"],
      },
      restart: {
        summary: "Create a deployment from an existing deployment's server.",
        args: "<id>",
        options: [org, path, branch],
        examples: ["mcp-use deployments restart dep_123 --branch main"],
      },
      promote: {
        summary: "Promote a deployment to production.",
        args: "<id>",
        options: [org, path, yes],
        examples: ["mcp-use deployments promote dep_123 --yes"],
      },
      stop: {
        summary: "Stop a deployment.",
        args: "<id>",
        options: [org, path, yes],
        examples: ["mcp-use deployments stop dep_123 --yes"],
      },
      rm: {
        summary: "Remove a deployment (alias: remove).",
        args: "<id>",
        options: [org, path, yes],
        examples: ["mcp-use deployments rm dep_123 --yes"],
      },
    },
  },
  env: {
    summary: "Manage server environment variables. Values are never printed.",
    examples: ["mcp-use env list", "mcp-use env set --help"],
    commands: {
      list: {
        summary: "List variable keys and metadata.",
        options: [...project, environment, branch],
        examples: ["mcp-use env list --environment preview --branch feature"],
      },
      set: {
        summary: "Create or update environment variables.",
        args: "<KEY=VALUE...>",
        options: [
          ...envScope,
          [
            "--sensitive",
            "Read one secret from stdin; pass its KEY without =VALUE",
          ],
        ],
        examples: [
          "mcp-use env set LOG_LEVEL=debug",
          "printf '%s' 'secret' | mcp-use env set API_KEY --sensitive",
        ],
      },
      push: {
        summary: "Set variables from a dotenv file.",
        args: "<file>",
        options: envScope,
        examples: ["mcp-use env push .env.production --environment production"],
      },
      rm: {
        summary: "Remove an environment variable (alias: remove).",
        args: "<KEY>",
        options: [...project, environment, branch, yes],
        examples: ["mcp-use env rm LOG_LEVEL --yes"],
      },
    },
  },
  domains: {
    summary: "Manage a server's managed subdomain and custom domain.",
    examples: ["mcp-use domains get", "mcp-use domains add --help"],
    commands: {
      get: {
        summary: "Show custom domain status.",
        options: [...project, ["--domain-id <id>", "Select a custom domain"]],
        examples: ["mcp-use domains get"],
      },
      "set-subdomain": {
        summary: "Change the server's managed subdomain.",
        args: "<name>",
        options: project,
        examples: ["mcp-use domains set-subdomain my-server"],
      },
      add: {
        summary: "Configure a custom domain and show its CNAME target.",
        args: "<hostname>",
        options: [...project, branch],
        examples: ["mcp-use domains add mcp.example.com"],
      },
      verify: {
        summary: "Verify custom domain DNS and certificate.",
        options: [...project, ["--domain-id <id>", "Select a custom domain"]],
        examples: ["mcp-use domains verify"],
      },
      rm: {
        summary: "Remove a custom domain (alias: remove).",
        options: [
          ...project,
          ["--domain-id <id>", "Select a custom domain"],
          yes,
        ],
        examples: ["mcp-use domains rm --yes"],
      },
    },
  },
  github: {
    summary: "Manage GitHub App access for an organization.",
    examples: ["mcp-use github connect", "mcp-use github repos --help"],
    commands: {
      connect: {
        summary: "Print the GitHub App installation URL.",
        options: [org],
        examples: ["mcp-use github connect --org acme"],
      },
      installations: {
        summary: "List connected GitHub installations.",
        options: [org],
        examples: ["mcp-use github installations"],
      },
      repos: {
        summary: "List accessible repositories.",
        options: [
          org,
          [
            "--installation <id>",
            "Installation ID; auto-selected when only one is connected",
          ],
          ["--page <n>", "Page number (default: 1)"],
          limit(100, 50),
        ],
        examples: ["mcp-use github repos --installation 123"],
      },
    },
  },
  checklist: {
    summary: "Run and inspect a server's publishing checklist.",
    examples: ["mcp-use checklist run", "mcp-use checklist get --help"],
    commands: {
      run: {
        summary: "Run publishing checks and wait for completion.",
        options: [
          ...project,
          branch,
          [
            "--url <url>",
            "External URL servers: check this MCP URL instead of the server's, such as a preview deployment; not with --branch",
          ],
          [
            "--profile <id>",
            "External URL servers: authenticate with this profile instead of the server's; not with --branch",
          ],
          ["--no-wait", "Return the run ID immediately"],
          [
            "--fail-on <level>",
            "none (default), failed (failed checks or unfinished run), warnings (also warning checks); not with --no-wait",
          ],
          [
            "--json-file <path>",
            "Also write the --json result to a file; the readable report still prints",
          ],
          [
            "--markdown-file <path>",
            "Also write a Markdown report, laid out like the dashboard",
          ],
          ["--verbose", "Show every check and full finding details"],
        ],
        examples: [
          "mcp-use checklist run --no-wait",
          "mcp-use checklist run --fail-on failed",
          "mcp-use checklist run --fail-on failed --json-file checklist.json",
          "mcp-use checklist run --url https://preview.example.com/mcp --profile <profile-id>",
        ],
      },
      list: {
        summary: "List checklist runs.",
        options: [...project, branch, limit(100, 30), skip],
        examples: ["mcp-use checklist list"],
      },
      get: {
        summary: "Show a checklist run.",
        args: "<run-id>",
        options: [
          ...project,
          ["--verbose", "Show every check and full finding details"],
          [
            "--markdown-file <path>",
            "Also write a Markdown report, laid out like the dashboard",
          ],
        ],
        examples: ["mcp-use checklist get run_123"],
      },
      cancel: {
        summary: "Cancel a checklist run.",
        args: "<run-id>",
        options: [
          ...project,
          ["--verbose", "Show every check and full finding details"],
        ],
        examples: ["mcp-use checklist cancel run_123"],
      },
    },
  },
  alerts: {
    summary: "Manage alert rules using the dashboard YAML format.",
    examples: ["mcp-use alerts list", "mcp-use alerts create --help"],
    commands: {
      list: {
        summary: "List alert rules.",
        options: [...project, limit(100, 25), skip],
        examples: ["mcp-use alerts list"],
      },
      get: {
        summary: "Show an alert rule.",
        args: "<id>",
        options: project,
        examples: ["mcp-use alerts get rule_123"],
      },
      create: {
        summary: "Create an alert from dashboard-compatible YAML.",
        options: [
          ...project,
          ["--file <rule.yaml>", "Required alert rule file"],
          ["--reason <text>", "Change description"],
        ],
        examples: [
          "mcp-use alerts create --file alert.yaml",
          "See https://docs.manufact.com/dashboard/alerts for the YAML format.",
        ],
      },
      update: {
        summary: "Update an alert from dashboard-compatible YAML.",
        args: "<id>",
        options: [
          ...project,
          ["--file <rule.yaml>", "Required alert rule file"],
          ["--reason <text>", "Change description"],
        ],
        examples: ["mcp-use alerts update rule_123 --file alert.yaml"],
      },
      rm: {
        summary: "Remove an alert rule (alias: remove).",
        args: "<id>",
        options: [...project, yes],
        examples: ["mcp-use alerts rm rule_123 --yes"],
      },
      options: {
        summary: "Show available alert metrics and notification options.",
        options: project,
        examples: ["mcp-use alerts options"],
      },
    },
  },
  evals: {
    summary:
      "Define eval suites as YAML files, run them against a server, and read results. A file is a suite's whole definition: name and flow are required; rubric, threshold (default 0.7), clients (default: Inspector with the default model), disallowedTools and enabled are optional, and omitted fields reset to their defaults. A <suite> is a suite ID, its name, or a suite file.",
    examples: [
      "mcp-use evals push evals/",
      "mcp-use evals run --all --wait",
      "mcp-use evals run evals/checkout.yaml --wait",
    ],
    commands: {
      push: {
        summary:
          "Create or replace one suite per file, matched by name. Directories contribute their .yaml, .yml and .json files (not subdirectories). Every file is attempted; exits 1 if any fails.",
        args: "<path...>",
        options: project,
        examples: [
          "mcp-use evals push evals/",
          "mcp-use evals push evals/checkout.yaml",
        ],
      },
      list: {
        summary: "List eval suites with their latest run.",
        options: project,
        examples: ["mcp-use evals list"],
      },
      get: {
        summary: "Show a suite as YAML with its latest run.",
        args: "<suite>",
        options: project,
        examples: ['mcp-use evals get "Rome weather"'],
      },
      export: {
        summary: "Print a suite as a suite file that push accepts.",
        args: "<suite>",
        options: [...project, ["--out <path>", "Write the file instead"]],
        examples: ['mcp-use evals export "Rome weather" --out evals/rome.yaml'],
      },
      create: {
        summary:
          "Create a suite from a file. Fails if a suite has the same name; use push or update to replace it.",
        options: [
          ...project,
          ["--file <suite.yaml>", "Required suite file (YAML or JSON)"],
        ],
        examples: ["mcp-use evals create --file evals/checkout.yaml"],
      },
      update: {
        summary:
          "Replace a suite with a file's definition, including its name.",
        args: "<suite>",
        options: [
          ...project,
          ["--file <suite.yaml>", "Required suite file (YAML or JSON)"],
        ],
        examples: [
          'mcp-use evals update "Old name" --file evals/checkout.yaml',
        ],
      },
      rm: {
        summary:
          "Delete a suite and all of its runs; cancels runs in progress (alias: remove).",
        args: "<suite>",
        options: [...project, yes],
        examples: ['mcp-use evals rm "Rome weather" --yes'],
      },
      run: {
        summary:
          "Start one run per suite against the production endpoint, or a branch environment with --branch. Runs continue on Cloud.",
        args: "[<suite...>]",
        options: [
          ...project,
          ["--all", "Run every enabled suite"],
          ["--branch <name>", "Target a branch environment"],
          [
            "--profile <id>",
            "Sign in with this profile instead of the server's own; not for native apps or plugin-lifecycle clients",
          ],
          [
            "--wait",
            "Wait for results; exit 1 unless every run passes. Ctrl+C cancels the runs still going",
          ],
          ["--timeout <seconds>", "Maximum wait with --wait (default: 1800)"],
          [
            "--json-file <path>",
            "Also write the --json result to a file; the readable report still prints",
          ],
          [
            "--markdown-file <path>",
            "With --wait, also write a Markdown report for pull request comments",
          ],
        ],
        examples: [
          "mcp-use evals run --all --wait",
          "mcp-use evals run evals/ --wait",
          'mcp-use evals run "Rome weather" --branch preview',
          "mcp-use evals run --all --wait --json-file evals.json --markdown-file evals.md",
          "mcp-use evals run --all --wait --profile <profile-id>",
        ],
      },
      runs: {
        summary: "List eval runs, newest first.",
        options: [
          ...project,
          ["--suite <suite>", "Only runs of this suite"],
          limit(100, 30),
          skip,
        ],
        examples: ['mcp-use evals runs --suite "Rome weather"'],
      },
      report: {
        summary:
          "Show each client's result and why each failed execution failed.",
        args: "<run-id...>",
        options: project,
        examples: ["mcp-use evals report <run-id>"],
      },
      cancel: {
        summary:
          "Cancel a run's remaining executions. Finished results are kept.",
        args: "<run-id>",
        options: [...project, yes],
        examples: ["mcp-use evals cancel <run-id> --yes"],
      },
      options: {
        summary:
          "Show the web apps and agent harnesses this organization can run, with the model IDs each accepts in clients. Each lists its first 10 models unless filtered.",
        options: [
          ...project,
          [
            "--harness <id>",
            "Only this harness: pi, codex, claude-code or cursor",
          ],
          [
            "--query <text>",
            "Only web-app and harness models whose ID or name contains this",
          ],
        ],
        examples: [
          "mcp-use evals options",
          "mcp-use evals options --harness pi --query claude",
        ],
      },
      models: {
        summary:
          "List model IDs for clients.inspector.models, most popular first.",
        options: [
          org,
          ["--query <text>", "Match the model ID or name"],
          ["--provider <name>", "Exact provider prefix, such as openai"],
          limit(100, 30),
          skip,
        ],
        examples: ["mcp-use evals models --provider anthropic"],
      },
    },
  },
  logs: {
    summary:
      "Read Cloud build or runtime logs. Follow until interrupted; build logs stop at completion.",
    args: "[deployment-id]",
    options: [
      ...project,
      ["--build", "Show build logs"],
      [
        "--since <duration>",
        "Look back by a duration such as 30s, 5m, or 2h (default: 1h)",
      ],
      limit(20000, 1000),
      ["--follow", "Poll for new logs until interrupted"],
    ],
    examples: [
      "mcp-use logs --since 5m",
      "mcp-use logs dep_123 --build --follow",
    ],
  },
};

/** Render the deepest recognized Cloud command's help, including remove aliases. */
export function cloudHelp(command: string, argv: readonly string[]): string {
  let page = pages[command]!;
  const selected = [command];
  for (const argument of argv) {
    const canonical = argument === "remove" ? "rm" : argument;
    const child = page.commands?.[canonical];
    if (!child) break;
    page = child;
    selected.push(canonical);
  }
  const invocation = `mcp-use ${selected.join(" ")}`;
  const usage = `${invocation}${page.commands ? " <command>" : page.args ? ` ${page.args}` : ""} [options]`;
  const sections = [`Usage: ${usage}`, page.summary];
  if (page.commands) {
    sections.push(
      `Commands:\n${rows(
        Object.entries(page.commands).map(([name, child]) => [
          `${name}${child.commands ? " <command>" : child.args ? ` ${child.args}` : ""}`,
          child.summary,
        ])
      )}`
    );
  }
  sections.push(
    `Options:\n${rows([
      ...(page.options ?? []),
      ["--json", "Emit one JSON result or error"],
      ["-h, --help", "Show this help"],
    ])}`
  );
  if (page.examples?.length)
    sections.push(
      `Examples:\n${page.examples.map((example) => `  ${example}`).join("\n")}`
    );
  if (page.commands)
    sections.push(
      `Run '${invocation} <command> --help' for command-specific options.`
    );
  return sections.join("\n\n") + "\n";
}

function rows(items: readonly Row[]): string {
  const width = Math.max(...items.map(([name]) => name.length)) + 2;
  return items
    .map(([name, description]) => `  ${name.padEnd(width)}${description}`)
    .join("\n");
}
