#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import * as ansi from "./ansi.js";
import {
  isInteractive,
  promptConfirm,
  promptSelect,
  promptText,
  spinner,
} from "./prompts.js";
import {
  deriveProjectInfo,
  findUnsafeEntries,
  updateIndexTs,
  updatePackageJson,
} from "./utils.js";
import {
  getDefaultDistTag,
  getSkillsCloneArgs,
  getSkillsManualInstallCommand,
  SKILLS_AGENT_DIRS,
  SKILLS_SPARSE_PATH,
} from "./skills-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

function parseCli(argv: string[]): {
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
    strict: false,
  });

  const install = argv.includes("--install")
    ? true
    : argv.includes("--no-install")
      ? false
      : (values.install as boolean | undefined);

  const skills = argv.includes("--skills")
    ? true
    : argv.includes("--no-skills")
      ? false
      : (values.skills as boolean | undefined);

  return {
    projectName: positionals[0],
    options: {
      template: values.template as string | undefined,
      listTemplates: values["list-templates"] as boolean | undefined,
      install,
      skills,
      dev: values.dev as boolean | undefined,
      sdkVersion: values["sdk-version"] as string | undefined,
      npm: values.npm as boolean | undefined,
      pnpm: values.pnpm as boolean | undefined,
      bun: values.bun as boolean | undefined,
    },
  };
}

function runPackageManager(
  packageManager: string,
  args: string[],
  cwd: string
): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(packageManager, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr });
      } else {
        reject(new Error(`${packageManager} install failed:\n${stderr}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

function detectPackageManager(): string | null {
  const userAgent = process.env.npm_config_user_agent || "";

  if (userAgent.includes("bun")) {
    return "bun";
  }
  if (userAgent.includes("pnpm")) {
    return "pnpm";
  }
  if (userAgent.includes("npm")) {
    return "npm";
  }

  return null;
}

function getDevCommand(packageManager: string): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm dev";
    case "bun":
      return "bun run dev";
    default:
      return "npm run dev";
  }
}

function getInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm install";
    case "bun":
      return "bun install";
    default:
      return "npm install";
  }
}

function getInstallArgs(packageManager: string): string[] {
  return ["install"];
}

interface InstallTelemetryData {
  event: "install";
  source: string;
  skills: string;
  agents: string;
  sourceType?: string;
}

function sendInstallTelemetryEvent(agents: string, skills: string): void {
  const TELEMETRY_URL = "https://add-skill.vercel.sh/t";
  const SOURCE_REPO = "mcp-use/mcp-use";
  const telemetryData: InstallTelemetryData = {
    event: "install",
    source: SOURCE_REPO,
    skills,
    agents,
    sourceType: "github",
  };

  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(telemetryData)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    fetch(`${TELEMETRY_URL}?${params.toString()}`).catch(() => {});
  } catch {
    // Silently fail - telemetry should never break the CLI
  }
}

function isGitAvailable(): boolean {
  const result = spawnSync("git", ["--version"], {
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0 && !result.error;
}

function warnSkillsInstallFailed(missingGit: boolean): void {
  const reason = missingGit
    ? "Failed to install skills: git is not installed or not in PATH."
    : "Failed to install skills.";
  console.log(ansi.yellow(`⚠️  ${reason}`));
  console.log(
    ansi.yellow(
      `   Run manually: ${getSkillsManualInstallCommand(packageJson.version)}`
    )
  );
}

async function installSkills(projectPath: string): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-use-skills-"));
  const repoDir = join(tempDir, "repo");

  try {
    const clone = spawnSync(
      "git",
      getSkillsCloneArgs(repoDir, packageJson.version),
      {
        stdio: "ignore",
        shell: false,
      }
    );
    if (clone.status !== 0 || clone.error) {
      throw new Error("git clone failed");
    }

    const checkout = spawnSync(
      "git",
      ["sparse-checkout", "set", SKILLS_SPARSE_PATH],
      { cwd: repoDir, stdio: "ignore", shell: false }
    );
    if (checkout.status !== 0 || checkout.error) {
      throw new Error("git sparse-checkout failed");
    }

    const skillSrc = join(repoDir, SKILLS_SPARSE_PATH);
    if (!existsSync(skillSrc)) {
      throw new Error("mcp-apps-builder skill not found in repository");
    }

    for (const agentDir of SKILLS_AGENT_DIRS) {
      const dest = join(projectPath, agentDir, "skills", "mcp-apps-builder");
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(skillSrc, dest, { recursive: true });
    }

    sendInstallTelemetryEvent("cursor,claude-code,codex", "mcp-apps-builder");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function renderLogo(): void {
  const lines = [
    " ███╗   ███╗   ██████╗  ██████╗         ██╗   ██╗  ███████╗  ███████╗",
    " ████╗ ████║  ██╔════╝  ██╔══██╗        ██║   ██║  ██╔════╝  ██╔════╝",
    " ██╔████╔██║  ██║       ██████╔╝  ━━━━  ██║   ██║  ███████╗  █████╗  ",
    " ██║╚██╔╝██║  ██║       ██╔═══╝   ━━━━  ██║   ██║  ╚════██║  ██╔══╝  ",
    " ██║ ╚═╝ ██║  ╚██████╗  ██║             ╚██████╔╝  ███████║  ███████╗",
    " ╚═╝     ╚═╝   ╚═════╝  ╚═╝              ╚═════╝   ╚══════╝  ╚══════╝",
  ];
  for (const line of lines) {
    console.log(ansi.whiteBold(line));
  }
  console.log("");
  console.log(ansi.gray(ansi.bold(" by Manufact")));
}

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
);

function processTemplateFile(
  filePath: string,
  versions: Record<string, string>,
  isDevelopment: boolean = false
) {
  const content = readFileSync(filePath, "utf-8");
  let processedContent = content;

  for (const [packageName, version] of Object.entries(versions)) {
    const placeholder = `{{${packageName}_version}}`;
    processedContent = processedContent.replace(
      new RegExp(placeholder, "g"),
      version
    );
  }

  const mcpUseVersion = isDevelopment ? "workspace:*" : versions["mcp-use"];

  if (isDevelopment) {
    processedContent = processedContent.replace(
      /"mcp-use": "\^[^"]+"/,
      '"mcp-use": "workspace:*"'
    );
  } else {
    processedContent = processedContent.replace(
      /"mcp-use": "workspace:\*"/,
      `"mcp-use": "${mcpUseVersion}"`
    );
    processedContent = processedContent.replace(
      /"mcp-use": "\^[^"]+"/,
      `"mcp-use": "${mcpUseVersion}"`
    );
  }

  return processedContent;
}

function getAvailableTemplates(): string[] {
  const templatesDir = join(__dirname, "templates");
  if (!existsSync(templatesDir)) {
    return [];
  }
  return readdirSync(templatesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();
}

function listTemplates(): void {
  console.log("");
  renderLogo();
  console.log("");
  console.log(ansi.bold("Available Templates:"));
  console.log("");

  const templatesDir = join(__dirname, "templates");
  const availableTemplates = getAvailableTemplates();

  if (availableTemplates.length === 0) {
    console.log(ansi.red("❌ No templates found!"));
    return;
  }

  for (const template of availableTemplates) {
    const packageJsonPath = join(templatesDir, template, "package.json");
    let description = "MCP server template";

    if (existsSync(packageJsonPath)) {
      try {
        const templatePackageJson = JSON.parse(
          readFileSync(packageJsonPath, "utf-8")
        );
        description = templatePackageJson.description || description;
      } catch {
        // Use default description
      }
    }

    console.log(ansi.cyan(`  ${template.padEnd(15)}`), ansi.gray(description));
  }

  console.log("");
  console.log(
    ansi.gray(
      "💡 Use with: npx create-mcp-use-app my-project --template <template>"
    )
  );
  console.log("");
}

interface GitHubRepoInfo {
  owner: string;
  repo: string;
  branch?: string;
}

function parseGitHubRepoUrl(url: string): GitHubRepoInfo | null {
  const trimmed = url.trim();

  let match = trimmed.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:#(.+))?$/
  );
  if (match) {
    const result = {
      owner: match[1],
      repo: match[2],
      branch: match[3] || match[4] || undefined,
    };
    return validateGitHubRepoInfo(result) ? result : null;
  }

  match = trimmed.match(
    /^(?:www\.)?github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?(?:#(.+))?$/
  );
  if (match) {
    const result = {
      owner: match[1],
      repo: match[2],
      branch: match[3] || undefined,
    };
    return validateGitHubRepoInfo(result) ? result : null;
  }

  match = trimmed.match(/^([^/#]+)\/([^/#]+?)(?:#(.+))?$/);
  if (match) {
    const result = {
      owner: match[1],
      repo: match[2],
      branch: match[3] || undefined,
    };
    return validateGitHubRepoInfo(result) ? result : null;
  }

  return null;
}

function validateGitHubRepoInfo(info: GitHubRepoInfo): boolean {
  const validIdentifier = /^[a-zA-Z0-9_-]+$/;
  const validBranch = /^[a-zA-Z0-9_./-]+$/;

  if (!validIdentifier.test(info.owner) || !validIdentifier.test(info.repo)) {
    return false;
  }

  if (info.branch && !validBranch.test(info.branch)) {
    return false;
  }

  return true;
}

function isGitHubRepoUrl(template: string): boolean {
  return parseGitHubRepoUrl(template) !== null;
}

async function cloneGitHubRepo(
  repoInfo: GitHubRepoInfo,
  tempDir: string
): Promise<string> {
  const versionCheck = spawnSync("git", ["--version"], {
    stdio: "ignore",
    shell: false,
  });
  if (versionCheck.status !== 0 || versionCheck.error) {
    console.error(ansi.red("❌ Git is not installed or not available in PATH"));
    console.error(
      ansi.yellow("   Please install Git to use GitHub repository templates")
    );
    process.exit(1);
  }

  const repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}.git`;
  const branch = repoInfo.branch || "main";
  const s = spinner();
  s.start("Cloning repository from GitHub...");

  const cloneWithBranch = (
    branchName: string
  ): { success: boolean; error?: Error } => {
    const result = spawnSync(
      "git",
      ["clone", "--depth", "1", "--branch", branchName, repoUrl, tempDir],
      {
        stdio: "pipe",
        shell: false,
      }
    );

    if (result.status !== 0) {
      const errorMessage =
        result.stderr?.toString() ||
        result.stdout?.toString() ||
        "Unknown error";
      return {
        success: false,
        error: new Error(errorMessage),
      };
    }

    return { success: true };
  };

  const cloneResult = cloneWithBranch(branch);
  if (cloneResult.success) {
    s.stop("Repository cloned successfully");
    return tempDir;
  }

  if (!repoInfo.branch) {
    s.message(`Branch "${branch}" not found, trying "main"...`);
    const mainResult = cloneWithBranch("main");
    if (mainResult.success) {
      s.stop("Repository cloned successfully (using main branch)");
      return tempDir;
    }

    s.message('Branch "main" not found, trying "master"...');
    const masterResult = cloneWithBranch("master");
    if (masterResult.success) {
      s.stop("Repository cloned successfully (using master branch)");
      return tempDir;
    }
  }

  s.error("Failed to clone repository");
  console.error(ansi.red(`❌ Error cloning repository: ${repoUrl}`));
  if (repoInfo.branch) {
    console.error(ansi.yellow(`   Branch "${repoInfo.branch}" may not exist`));
  }

  const errorMessage = cloneResult.error?.message || "Unknown error";
  if (errorMessage.includes("not found")) {
    console.error(ansi.yellow("   Repository may not exist or is private"));
  } else {
    console.error(ansi.yellow(`   ${errorMessage}`));
  }

  throw cloneResult.error || new Error("Failed to clone repository");
}

function validateTemplateName(template: string): string {
  const sanitized = template.trim();

  if (isGitHubRepoUrl(sanitized)) {
    return sanitized;
  }

  const aliases: Record<string, string> = {
    "apps-sdk": "mcp-apps",
    starter: "mcp-server",
  };

  const resolvedTemplate = aliases[sanitized] || sanitized;

  if (
    resolvedTemplate.includes("..") ||
    resolvedTemplate.includes("/") ||
    resolvedTemplate.includes("\\")
  ) {
    console.error(ansi.red("❌ Invalid template name"));
    console.error(
      ansi.yellow("   Template name cannot contain path separators")
    );
    process.exit(1);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(resolvedTemplate)) {
    console.error(ansi.red("❌ Invalid template name"));
    console.error(
      ansi.yellow(
        "   Template name can only contain letters, numbers, hyphens, and underscores"
      )
    );
    process.exit(1);
  }

  return resolvedTemplate;
}

async function copyTemplate(
  projectPath: string,
  template: string,
  versions: Record<string, string>,
  isDevelopment: boolean = false
) {
  const repoInfo = parseGitHubRepoUrl(template);
  if (repoInfo) {
    const tempDir = mkdtempSync(join(tmpdir(), "create-mcp-use-app-"));

    try {
      await cloneGitHubRepo(repoInfo, tempDir);
      copyDirectoryWithProcessing(
        tempDir,
        projectPath,
        versions,
        isDevelopment
      );
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `Warning: Failed to clean up temp directory: ${tempDir}`
          );
        }
      }
    }
    return;
  }

  const templatePath = join(__dirname, "templates", template);

  if (!existsSync(templatePath)) {
    console.error(ansi.red(`❌ Template "${template}" not found!`));

    const templatesDir = join(__dirname, "templates");
    if (existsSync(templatesDir)) {
      const availableTemplates = readdirSync(templatesDir, {
        withFileTypes: true,
      })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

      console.log(`Available templates: ${availableTemplates.join(", ")}`);
    } else {
      console.log("No templates directory found");
    }

    console.log(
      '💡 Tip: Use "mcp-server" template for an MCP server with an example tool and prompt'
    );
    console.log(
      '💡 Tip: Use "mcp-apps" template for a MCP server that displays Widgets on ChatGPT, Claude, and other mcp-apps compatible clients'
    );
    console.log(
      '💡 Tip: Use a GitHub repo URL like "owner/repo" or "https://github.com/owner/repo" to use a custom template'
    );
    process.exit(1);
  }

  copyDirectoryWithProcessing(
    templatePath,
    projectPath,
    versions,
    isDevelopment
  );
}

function copyDirectoryWithProcessing(
  src: string,
  dest: string,
  versions: Record<string, string>,
  isDevelopment: boolean
) {
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const srcPath = join(src, entry.name);
    const destName = entry.name === "gitignore" ? ".gitignore" : entry.name;
    const destPath = join(dest, destName);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirectoryWithProcessing(srcPath, destPath, versions, isDevelopment);
    } else if (entry.name === "package.json" || entry.name.endsWith(".json")) {
      const processedContent = processTemplateFile(
        srcPath,
        versions,
        isDevelopment
      );
      writeFileSync(destPath, processedContent);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function getTemplateItems(): { label: string; value: string }[] {
  const templatesDir = join(__dirname, "templates");
  const availableTemplates = getAvailableTemplates();

  return availableTemplates.map((template) => {
    const packageJsonPath = join(templatesDir, template, "package.json");
    let description = "MCP server template";

    if (existsSync(packageJsonPath)) {
      try {
        const templatePackageJson = JSON.parse(
          readFileSync(packageJsonPath, "utf-8")
        );
        description = templatePackageJson.description || description;
      } catch {
        // Use default description
      }
    }

    return {
      label: `${template} - ${description}`,
      value: template,
    };
  });
}

async function promptForProjectName(): Promise<string> {
  return promptText("What is your project name?", {
    validate: (value) => {
      if (!value) {
        return "Project name is required";
      }
      if (value === ".") {
        const unsafeEntries = findUnsafeEntries(process.cwd());
        if (unsafeEntries.length > 0) {
          const list = unsafeEntries.map((entry) => `   • ${entry}`).join("\n");
          return `Cannot initialize here — these entries would clash with the template:\n${list}\n\nRemove these files, or pick a project name to scaffold into a subdirectory.`;
        }
        return undefined;
      }
      if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
        return "Project name can only contain letters, numbers, hyphens, and underscores";
      }
      if (existsSync(join(process.cwd(), value))) {
        return `Directory "${value}" already exists! Please choose a different name.`;
      }
      return undefined;
    },
  });
}

async function promptForTemplate(): Promise<string> {
  const items = getTemplateItems();
  if (items.length === 0) {
    console.error(
      ansi.red(`❌ No templates found in: ${join(__dirname, "templates")}`)
    );
    process.exit(1);
  }

  const defaultIndex = Math.max(
    0,
    items.findIndex((item) => item.value === "mcp-apps")
  );

  return promptSelect("Select a template:", items, defaultIndex);
}

function printHelp(): void {
  console.log(`Usage: create-mcp-use-app [project-name] [options]

Create a new MCP server project.

Arguments:
  project-name              Name of the MCP server project

Options:
  -t, --template <template> Template to use or GitHub repo URL
  --list-templates          List all available templates
  --install                 Install dependencies after creating project
  --no-install              Skip installing dependencies
  --skills                  Install skills for all agents
  --no-skills               Skip installing skills
  --no-git                  Skip initializing a git repository
  --dev                     Use workspace dependencies for development
  --sdk-version <version>   Pin mcp-use to an npm version or dist-tag (e.g. canary, 1.34.0)
  --npm                     Use npm as package manager
  --pnpm                    Use pnpm as package manager
  --bun                     Use Bun as package manager
  -h, --help                Display help
  -V, --version             Display version`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { projectName: initialProjectName, options } = parseCli(argv);

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(packageJson.version);
    return;
  }

  if (options.listTemplates) {
    listTemplates();
    return;
  }

  if (options.dev && options.sdkVersion) {
    console.error(ansi.red("❌ Cannot use --dev and --sdk-version together"));
    console.error(ansi.yellow("   Please choose only one dependency mode"));
    process.exit(1);
  }

  if (options.sdkVersion !== undefined && !options.sdkVersion.trim()) {
    console.error(ansi.red("❌ --sdk-version requires a non-empty value"));
    process.exit(1);
  }

  let projectName = initialProjectName;
  let selectedTemplate = options.template;
  const interactive = isInteractive();

  console.log("");
  renderLogo();
  console.log("");

  if (!projectName) {
    if (!interactive) {
      console.error(
        ansi.red("❌ Project name is required in non-interactive mode")
      );
      process.exit(1);
    }
    projectName = await promptForProjectName();
    console.log("");
  }

  if (!selectedTemplate) {
    if (interactive) {
      selectedTemplate = await promptForTemplate();
    } else {
      selectedTemplate = "mcp-server";
    }
  }

  const trimmedProjectName = projectName.trim();
  if (!trimmedProjectName) {
    console.error(ansi.red("❌ Project name cannot be empty"));
    process.exit(1);
  }

  const { useCurrentDir, projectPath, displayName, packageName } =
    deriveProjectInfo(trimmedProjectName, process.cwd());

  if (useCurrentDir) {
    const unsafeEntries = findUnsafeEntries(projectPath);
    if (unsafeEntries.length > 0) {
      console.error(
        ansi.red(
          "❌ Cannot initialize here — these entries would clash with the template:"
        )
      );
      for (const entry of unsafeEntries) {
        console.error(ansi.red(`   • ${entry}`));
      }
      console.error("");
      console.error(
        ansi.yellow(
          "   Remove these files, or pass a project name to scaffold into a new subdirectory instead."
        )
      );
      process.exit(1);
    }
  } else {
    if (
      trimmedProjectName.includes("..") ||
      trimmedProjectName.includes("/") ||
      trimmedProjectName.includes("\\")
    ) {
      console.error(
        ansi.red('❌ Project name cannot contain path separators or ".."')
      );
      console.error(ansi.yellow('   Use simple names like "my-mcp-server"'));
      process.exit(1);
    }

    const protectedNames = [
      "node_modules",
      ".git",
      ".env",
      "package.json",
      "src",
      "dist",
    ];
    if (protectedNames.includes(trimmedProjectName.toLowerCase())) {
      console.error(
        ansi.red(`❌ Cannot use protected name "${trimmedProjectName}"`)
      );
      console.error(ansi.yellow("   Please choose a different project name"));
      process.exit(1);
    }

    if (existsSync(projectPath)) {
      console.error(
        ansi.red(`❌ Directory "${trimmedProjectName}" already exists!`)
      );
      console.error(
        ansi.yellow(
          "   Please choose a different name or remove the existing directory"
        )
      );
      process.exit(1);
    }
  }

  let mcpUseVersion: string;
  if (options.dev) {
    mcpUseVersion = "workspace:*";
  } else if (options.sdkVersion) {
    mcpUseVersion = options.sdkVersion;
  } else {
    const defaultDistTag = getDefaultDistTag(packageJson.version);
    const response = await fetch("https://registry.npmjs.org/mcp-use", {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to resolve the mcp-use ${defaultDistTag} dist-tag from npm (${response.status})`
      );
    }

    const metadata = (await response.json()) as {
      "dist-tags"?: Record<string, string>;
    };
    const defaultVersion = metadata["dist-tags"]?.[defaultDistTag];
    if (!defaultVersion) {
      throw new Error(
        `npm did not return a ${defaultDistTag} version for mcp-use`
      );
    }
    mcpUseVersion = defaultVersion;
  }
  const versions = { "mcp-use": mcpUseVersion };

  if (!useCurrentDir) {
    mkdirSync(projectPath, { recursive: true });
  }

  console.log(ansi.cyan(`🚀 Creating MCP server "${displayName}"...`));

  const validatedTemplate = validateTemplateName(selectedTemplate);

  await copyTemplate(projectPath, validatedTemplate, versions, options.dev);

  updatePackageJson(projectPath, packageName);
  updateIndexTs(projectPath, packageName);

  let install = options.install;
  let skills = options.skills;

  if (options.template !== undefined) {
    if (install === undefined) {
      install = false;
    }
    if (skills === undefined) {
      skills = true;
    }
  } else if (!interactive) {
    if (install === undefined) {
      install = false;
    }
    if (skills === undefined) {
      skills = false;
    }
  }

  console.log("");
  const shouldInstallSkills =
    skills !== undefined
      ? skills
      : interactive
        ? await promptConfirm(
            "Install AI coding skills for Cursor, Claude Code, and Codex? (Recommended)",
            true
          )
        : false;

  let skillsInstalled = false;
  if (shouldInstallSkills) {
    console.log("");
    const s = spinner();
    s.start("Installing skills...");
    if (!isGitAvailable()) {
      s.stop("Skills install skipped");
      warnSkillsInstallFailed(true);
    } else {
      try {
        await installSkills(projectPath);
        skillsInstalled = true;
        s.stop("Skills installed successfully!");
      } catch {
        s.stop("Skills install failed");
        warnSkillsInstallFailed(false);
      }
    }
  }

  let usedPackageManager = "npm";

  if (options.npm) {
    usedPackageManager = "npm";
  } else if (options.pnpm) {
    usedPackageManager = "pnpm";
  } else if (options.bun) {
    usedPackageManager = "bun";
  } else {
    const detected = detectPackageManager();
    if (detected) {
      usedPackageManager = detected;
    }
  }

  console.log("");
  const shouldInstall =
    install !== undefined
      ? install
      : interactive
        ? await promptConfirm(
            `Install dependencies with ${usedPackageManager}?`,
            true
          )
        : false;

  if (shouldInstall) {
    console.log("");
    console.log(ansi.cyan("📦 Installing dependencies..."));
    console.log("");

    const isKnownManager =
      options.npm || options.pnpm || options.bun || detectPackageManager();
    const managersToTry = isKnownManager
      ? [usedPackageManager]
      : ["npm", "pnpm", "bun"];

    let installed = false;
    for (const pm of managersToTry) {
      const s = spinner();
      s.start(`Installing packages with ${pm}...`);
      try {
        await runPackageManager(pm, getInstallArgs(pm), projectPath);
        usedPackageManager = pm;
        s.stop(`Packages installed successfully with ${pm}`);
        installed = true;
        break;
      } catch (err) {
        const remaining = managersToTry.slice(managersToTry.indexOf(pm) + 1);
        if (remaining.length > 0) {
          s.stop(`${pm} not available, trying ${remaining[0]}...`);
        } else {
          s.error("Package installation failed");
          if (err instanceof Error) {
            console.error(ansi.red(err.message));
          }
        }
      }
    }

    if (!installed) {
      console.log(
        '⚠️  Please run "npm install", "pnpm install", or "bun install" manually'
      );
    }
  }

  console.log("");
  console.log(ansi.green("✅ MCP server created successfully!"));
  if (options.dev) {
    console.log(
      ansi.yellow("🔧 Development mode: Using workspace dependencies")
    );
  } else if (options.sdkVersion) {
    console.log(ansi.cyan(`📌 Using mcp-use@${options.sdkVersion}`));
  }
  console.log("");
  console.log(ansi.bold("📁 Project structure:"));
  console.log(`   ${useCurrentDir ? "." : displayName}/`);
  if (skillsInstalled) {
    console.log("   ├── .agents/skills/");
    console.log("   ├── .claude/skills/");
    console.log("   ├── .cursor/skills/");
  }
  if (validatedTemplate === "blank") {
    console.log("   ├── public/");
    console.log("   ├── mcp-env.d.ts");
    console.log("   ├── index.ts (server entry point)");
    console.log("   ├── package.json");
    console.log("   ├── tsconfig.json");
    console.log("   └── README.md");
  } else if (validatedTemplate === "mcp-apps") {
    console.log("   ├── public/");
    console.log("   │   ├── icon.svg");
    console.log("   │   └── logo-mcp-use.svg");
    console.log("   ├── views/");
    console.log("   │   └── my-view/");
    console.log("   │       ├── view.tsx");
    console.log("   │       ├── view.css");
    console.log("   │       ├── icons.tsx");
    console.log("   │       ├── Tooltip.tsx");
    console.log("   │       └── MeshGradient.tsx");
    console.log("   ├── mcp-env.d.ts");
    console.log("   ├── index.ts (server entry point)");
    console.log("   ├── package.json");
    console.log("   ├── tsconfig.json");
    console.log("   └── README.md");
  } else if (validatedTemplate === "mcp-server") {
    console.log("   ├── mcp-env.d.ts");
    console.log("   ├── index.ts (server entry point)");
    console.log("   ├── package.json");
    console.log("   ├── tsconfig.json");
    console.log("   └── README.md");
  } else {
    console.log("   ├── index.ts (server entry point)");
    console.log("   ├── package.json");
    console.log("   ├── tsconfig.json");
    console.log("   └── README.md");
  }
  console.log("");
  console.log(ansi.bold("🚀 To get started:"));
  if (!useCurrentDir) {
    console.log(ansi.cyan(`   cd ${displayName}`));
  }
  if (!shouldInstall) {
    console.log(ansi.cyan(`   ${getInstallCommand(usedPackageManager)}`));
  }
  console.log(ansi.cyan(`   ${getDevCommand(usedPackageManager)}`));
  console.log("");
  console.log(ansi.bold("📤 To deploy:"));
  console.log(
    ansi.cyan(
      `   ${usedPackageManager === "pnpm" ? "pnpm" : usedPackageManager === "bun" ? "bun run" : "npm run"} deploy`
    )
  );
  console.log("");
  if (options.dev) {
    console.log(
      ansi.yellow(
        "💡 Development mode: Your project uses workspace dependencies"
      )
    );
    console.log(
      ansi.yellow(
        "   Make sure you're in the mcp-use workspace root for development"
      )
    );
    console.log("");
  }
  console.log(ansi.cyan("📚 Learn more: https://manufact.com/docs"));
  console.log(ansi.gray("💬 For feedback and bug reporting visit:"));
  console.log(
    ansi.gray("   https://github.com/mcp-use/mcp-use or https://manufact.com")
  );
}

main().catch((error) => {
  console.error("❌ Error creating MCP server:", error);
  process.exit(1);
});
