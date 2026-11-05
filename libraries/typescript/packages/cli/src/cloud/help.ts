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
          ["--no-wait", "Return the run ID immediately"],
          ["--verbose", "Show every check and full finding details"],
        ],
        examples: ["mcp-use checklist run --no-wait"],
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
