#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import { Box, render, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
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
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import ora from "ora";
import React, { useState } from "react";
import { extract } from "tar";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to run package manager commands securely using spawn
function runPackageManager(
  packageManager: string,
  args: string[],
  cwd: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(packageManager, args, {
      cwd,
      stdio: "inherit",
      shell: false, // Disable shell to prevent command injection
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

// Detect which package manager was used to run this script
function detectPackageManager(): string | null {
  // Check npm_config_user_agent which contains info about the package manager
  const userAgent = process.env.npm_config_user_agent || "";

  if (userAgent.includes("yarn")) {
    return "yarn";
  } else if (userAgent.includes("pnpm")) {
    return "pnpm";
  } else if (userAgent.includes("npm")) {
    return "npm";
  }

  return null;
}

// Get the dev command for a specific package manager
function getDevCommand(packageManager: string): string {
  switch (packageManager) {
    case "yarn":
      return "yarn dev";
    case "pnpm":
      return "pnpm dev";
    case "npm":
    default:
      return "npm run dev";
  }
}

// Get the install command for a specific package manager
function getInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case "yarn":
      return "yarn";
    case "pnpm":
      return "pnpm install";
    case "npm":
    default:
      return "npm install";
  }
}

// Get optimized install arguments for faster installation
function getInstallArgs(packageManager: string): string[] {
  switch (packageManager) {
    case "yarn":
      // Yarn: prefer offline cache, skip audit (faster, but less secure)
      return ["install"];
    case "pnpm":
      // pnpm: prefer offline cache, skip audit
      return ["install"];
    case "npm":
    default:
      // npm: prefer offline cache, skip audit and funding messages
      return ["install"];
  }
}

// Send telemetry event for vercel skills.sh
// Necessary for ranking and discoverability of skills
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

    // Add event data
    for (const [key, value] of Object.entries(telemetryData)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }

    // Fire and forget - don't await, silently ignore errors
    fetch(`${TELEMETRY_URL}?${params.toString()}`).catch(() => {});
  } catch {
    // Silently fail - telemetry should never break the CLI
  }
}

// Type-safe enum for IDE presets
type AgentPreset = "cursor" | "claude-code" | "codex";

// Download and extract skills folder from GitHub repository
async function addSkillsToProject(projectPath: string): Promise<void> {
  const REPO_OWNER = "mcp-use";
  const REPO_NAME = "mcp-use";
  const REPO_COMMIT = "main";

  const tarballUrl = `https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${REPO_COMMIT}`;

  // Create temp directory for extraction
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-use-skills-"));

  try {
    // Download tarball
    const response = await fetch(tarballUrl);
    if (!response.ok) {
      throw new Error(`Failed to download tarball: ${response.statusText}`);
    }

    // Extract only the skills folder from the tarball
    // Tarball structure: mcp-use-{commit}/skills/...
    await pipeline(
      Readable.fromWeb(response.body as any),
      extract({
        cwd: tempDir,
        filter: (path) => path.includes("/skills/"),
        strip: 1, // Removes 'mcp-use-{commit}/' prefix
      })
    );

    const skillsPath = join(tempDir, "skills");

    if (!existsSync(skillsPath)) {
      throw new Error("Skills folder not found in tarball");
    }

    // Copy to each requested preset location
    const presets: AgentPreset[] = ["cursor", "claude-code", "codex"];
    const presetFolders: Record<AgentPreset, string> = {
      cursor: ".cursor",
      "claude-code": ".claude",
      codex: ".agent",
    };

    for (const preset of presets) {
      const folderName = presetFolders[preset];
      const outputPath = join(projectPath, folderName, "skills");

      // Use cpSync with recursive flag (Node 16.7+)
      cpSync(skillsPath, outputPath, { recursive: true });
    }

    // Get skill names from extracted directory
    const skillNames = readdirSync(skillsPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    sendInstallTelemetryEvent(presets.join(","), skillNames.join(","));
  } catch (error) {
    console.log(
      chalk.yellow(
        "⚠️  Failed to download skills from GitHub. Continuing without skills..."
      )
    );
    console.log(
      chalk.yellow(
        `   Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// Telemetry data defined in https://github.com/vercel-labs/skills/blob/main/src/telemetry.ts
interface InstallTelemetryData {
  event: "install";
  source: string;
  skills: string;
  agents: string;
  global?: "1";
  skillFiles?: string; // JSON stringified { skillName: relativePath }
  /**
   * Source type for different hosts:
   * - 'github': GitHub repository (default, uses raw.githubusercontent.com)
   * - 'raw': Direct URL to SKILL.md (generic raw URL)
   * - Provider IDs like 'mintlify', 'huggingface', etc.
   */
  sourceType?: string;
}

const program = new Command();

// Render logo as ASCII art
function renderLogo(): void {
  console.log(chalk.cyan("▛▛▌▛▘▛▌▄▖▌▌▛▘█▌"));
  console.log(chalk.cyan("▌▌▌▙▖▙▌  ▙▌▄▌▙▖"));
  console.log(chalk.cyan("     ▌         "));
}

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
);

// Read current package versions from workspace
function getCurrentPackageVersions(
  isDevelopment: boolean = false,
  useCanary: boolean = false
) {
  const versions: Record<string, string> = {};

  try {
    if (isDevelopment) {
      // In development mode, use workspace dependencies for all packages
      versions["mcp-use"] = "workspace:*";
      versions["@mcp-use/cli"] = "workspace:*";
      versions["@mcp-use/inspector"] = "workspace:*";
    } else if (useCanary) {
      // In canary mode, use canary versions for published packages
      versions["mcp-use"] = "canary";
      // For unpublished packages, keep them as workspace dependencies
      // These packages are not available on npm registry yet
      versions["@mcp-use/cli"] = "canary";
      versions["@mcp-use/inspector"] = "canary";
    } else {
      // In production mode, use latest for published packages
      versions["mcp-use"] = "latest";
      // For unpublished packages, keep them as workspace dependencies
      // These packages are not available on npm registry yet
      versions["@mcp-use/cli"] = "latest";
      versions["@mcp-use/inspector"] = "latest";
    }
  } catch (error) {
    // Use defaults when not in workspace (normal for published package)
    // Log error details in development mode for debugging
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "⚠️  Could not read workspace package versions, using defaults"
      );
      console.warn(
        `   Error: ${error instanceof Error ? error.message : String(error)}`
      );
      if (error instanceof Error && error.stack) {
        console.warn(`   Stack: ${error.stack}`);
      }
    }
  }

  return versions;
}

// Process template files to replace version placeholders
function processTemplateFile(
  filePath: string,
  versions: Record<string, string>,
  isDevelopment: boolean = false,
  useCanary: boolean = false
) {
  const content = readFileSync(filePath, "utf-8");
  let processedContent = content;

  // Replace version placeholders with current versions
  for (const [packageName, version] of Object.entries(versions)) {
    const placeholder = `{{${packageName}_version}}`;
    processedContent = processedContent.replace(
      new RegExp(placeholder, "g"),
      version
    );
  }

  // Handle workspace dependencies based on mode
  if (isDevelopment) {
    // Keep workspace dependencies for development
    processedContent = processedContent.replace(
      /"mcp-use": "\^[^"]+"/,
      '"mcp-use": "workspace:*"'
    );
    processedContent = processedContent.replace(
      /"@mcp-use\/cli": "\^[^"]+"/,
      '"@mcp-use/cli": "workspace:*"'
    );
    processedContent = processedContent.replace(
      /"@mcp-use\/inspector": "\^[^"]+"/,
      '"@mcp-use/inspector": "workspace:*"'
    );
  } else if (useCanary) {
    // Replace both workspace:* and any existing caret versions with canary
    processedContent = processedContent.replace(
      /"mcp-use": "workspace:\*"/,
      `"mcp-use": "canary"`
    );
    processedContent = processedContent.replace(
      /"mcp-use": "\^[^"]+"/,
      `"mcp-use": "canary"`
    );
    processedContent = processedContent.replace(
      /"@mcp-use\/cli": "workspace:\*"/,
      `"@mcp-use/cli": "canary"`
    );
    processedContent = processedContent.replace(
      /"@mcp-use\/cli": "\^[^"]+"/,
      `"@mcp-use/cli": "canary"`
    );
    processedContent = processedContent.replace(
      /"@mcp-use\/inspector": "workspace:\*"/,
      `"@mcp-use/inspector": "canary"`
    );
    processedContent = processedContent.replace(
      /"@mcp-use\/inspector": "\^[^"]+"/,
      `"@mcp-use/inspector": "canary"`
    );
  } else {
    // Replace workspace dependencies with specific versions for production
    processedContent = processedContent.replace(
      /"mcp-use": "workspace:\*"/,
      `"mcp-use": "${versions["mcp-use"] || "latest"}"`
    );
    processedContent = processedContent.replace(
      /"@mcp-use\/cli": "workspace:\*"/,
      `"@mcp-use/cli": "${versions["@mcp-use/cli"] || "latest"}"`
    );
    processedContent = processedContent.replace(
      /"@mcp-use\/inspector": "workspace:\*"/,
      `"@mcp-use/inspector": "${versions["@mcp-use/inspector"] || "latest"}"`
    );
  }

  return processedContent;
}

// Function to get available templates
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

// Function to list templates
function listTemplates(): void {
  console.log("");
  renderLogo();
  console.log("");
  console.log(chalk.bold("Available Templates:"));
  console.log("");

  const templatesDir = join(__dirname, "templates");
  const availableTemplates = getAvailableTemplates();

  if (availableTemplates.length === 0) {
    console.log(chalk.red("❌ No templates found!"));
    return;
  }

  for (const template of availableTemplates) {
    const packageJsonPath = join(templatesDir, template, "package.json");
    let description = "MCP server template";

    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        description = packageJson.description || description;
      } catch (error) {
        // Use default description
      }
    }

    console.log(
      chalk.cyan(`  ${template.padEnd(15)}`),
      chalk.gray(description)
    );
  }

  console.log("");
  console.log(
    chalk.gray(
      "💡 Use with: npx create-mcp-use-app my-project --template <template>"
    )
  );
  console.log("");
}

program
  .name("create-mcp-use-app")
  .description("Create a new MCP server project")
  .version(packageJson.version)
  .argument("[project-name]", "Name of the MCP server project")
  .option(
    "-t, --template <template>",
    "Template to use (starter, mcp-ui, mcp-apps, blank) or GitHub repo URL (owner/repo or https://github.com/owner/repo)"
  )
  .option("--list-templates", "List all available templates")
  .option("--install", "Install dependencies after creating project")
  .option("--no-install", "Skip installing dependencies")
  .option("--skills", "Install skills for all agents")
  .option("--no-skills", "Skip installing skills")
  .option("--no-git", "Skip initializing a git repository")
  .option("--dev", "Use workspace dependencies for development")
  .option("--canary", "Use canary versions of packages")
  .option("--yarn", "Use yarn as package manager")
  .option("--npm", "Use npm as package manager")
  .option("--pnpm", "Use pnpm as package manager")
  .action(
    async (
      projectName: string | undefined,
      options: {
        template?: string;
        listTemplates?: boolean;
        install?: boolean;
        skills?: boolean;
        git: boolean;
        dev: boolean;
        canary: boolean;
        yarn?: boolean;
        npm?: boolean;
        pnpm?: boolean;
      }
    ) => {
      try {
        // Handle --list-templates flag first
        if (options.listTemplates) {
          listTemplates();
          process.exit(0);
        }

        // Validate that --dev and --canary are mutually exclusive
        if (options.dev && options.canary) {
          console.error(chalk.red("❌ Cannot use --dev and --canary together"));
          console.error(
            chalk.yellow("   Please choose only one dependency mode")
          );
          process.exit(1);
        }

        let selectedTemplate = options.template;

        // If no project name provided, prompt for it
        if (!projectName) {
          console.log("");
          renderLogo();
          console.log("");
          console.log(chalk.bold("Welcome to create-mcp-use-app!"));
          console.log("");

          projectName = await promptForProjectName();
          console.log("");
        }

        // Prompt for template if one wasn't provided via --template flag
        if (!options.template && !selectedTemplate) {
          selectedTemplate = await promptForTemplate();
        }

        // Set default template if still not selected
        if (!selectedTemplate) {
          selectedTemplate = "starter";
        }

        // Validate project name
        const sanitizedProjectName = projectName!.trim();
        if (!sanitizedProjectName) {
          console.error(chalk.red("❌ Project name cannot be empty"));
          process.exit(1);
        }

        // Security: Validate project name doesn't contain path traversal
        if (
          sanitizedProjectName.includes("..") ||
          sanitizedProjectName.includes("/") ||
          sanitizedProjectName.includes("\\")
        ) {
          console.error(
            chalk.red('❌ Project name cannot contain path separators or ".."')
          );
          console.error(
            chalk.yellow('   Use simple names like "my-mcp-server"')
          );
          process.exit(1);
        }

        // Validate against common protected directory names
        const protectedNames = [
          "node_modules",
          ".git",
          ".env",
          "package.json",
          "src",
          "dist",
        ];
        if (protectedNames.includes(sanitizedProjectName.toLowerCase())) {
          console.error(
            chalk.red(`❌ Cannot use protected name "${sanitizedProjectName}"`)
          );
          console.error(
            chalk.yellow("   Please choose a different project name")
          );
          process.exit(1);
        }

        console.log(
          chalk.cyan(`🚀 Creating MCP server "${sanitizedProjectName}"...`)
        );

        const projectPath = resolve(process.cwd(), sanitizedProjectName);

        // Check if directory already exists
        if (existsSync(projectPath)) {
          console.error(
            chalk.red(`❌ Directory "${sanitizedProjectName}" already exists!`)
          );
          console.error(
            chalk.yellow(
              "   Please choose a different name or remove the existing directory"
            )
          );
          process.exit(1);
        }

        // Create project directory
        mkdirSync(projectPath, { recursive: true });

        // Validate template name
        const validatedTemplate = validateTemplateName(selectedTemplate);

        // Get current package versions
        const versions = getCurrentPackageVersions(options.dev, options.canary);

        // Copy template files
        await copyTemplate(
          projectPath,
          validatedTemplate,
          versions,
          options.dev,
          options.canary
        );

        // Update package.json with project name
        updatePackageJson(projectPath, sanitizedProjectName);

        // Update index.ts with project name
        updateIndexTs(projectPath, sanitizedProjectName);

        // Non-interactive defaults when template is specified via flag
        // Enables usage in CI/tests without blocking prompts
        if (options.template !== undefined) {
          // Default to not installing
          if (options.install === undefined) {
            options.install = false;
          }

          // Default to both agents
          if (options.skills === undefined) {
            options.skills = true;
          }
        }

        // Ask to install dependencies if not explicitly set
        console.log("");
        const shouldInstall =
          options.install !== undefined
            ? options.install
            : await promptForInstall();

        // Determine which package manager to use
        let usedPackageManager = "npm";

        // Check if a specific package manager was requested via flags
        if (options.yarn) {
          usedPackageManager = "yarn";
        } else if (options.npm) {
          usedPackageManager = "npm";
        } else if (options.pnpm) {
          usedPackageManager = "pnpm";
        } else {
          // Try to detect which package manager was used to run this script
          const detected = detectPackageManager();
          if (detected) {
            usedPackageManager = detected;
          } else {
            // No flag and couldn't detect, try in order: yarn → npm → pnpm
            const defaultOrder = ["yarn", "npm", "pnpm"];
            // We'll determine the working one during installation
            usedPackageManager = defaultOrder[0];
          }
        }

        // Install dependencies if requested or chosen via prompt
        if (shouldInstall) {
          // Always show a message before installing
          console.log("");
          console.log(chalk.cyan("📦 Installing dependencies..."));
          console.log("");

          // Yarn and npm show their own progress, so we don't need a spinner for them
          const showSpinner =
            usedPackageManager !== "yarn" && usedPackageManager !== "npm";
          const spinner = showSpinner
            ? ora("Installing packages...").start()
            : null;

          try {
            if (
              options.yarn ||
              options.npm ||
              options.pnpm ||
              detectPackageManager()
            ) {
              // Use the specific package manager with optimized flags
              await runPackageManager(
                usedPackageManager,
                getInstallArgs(usedPackageManager),
                projectPath
              );
              if (spinner) {
                spinner.succeed(
                  `Packages installed successfully with ${usedPackageManager}`
                );
              } else {
                console.log("");
                console.log(
                  chalk.green("✅ Dependencies installed successfully!")
                );
                console.log("");
              }
            } else {
              // Try in order: yarn → npm → pnpm
              if (spinner)
                spinner.text = "Installing packages (trying yarn)...";
              try {
                await runPackageManager(
                  "yarn",
                  getInstallArgs("yarn"),
                  projectPath
                );
                usedPackageManager = "yarn";
                if (spinner) {
                  spinner.succeed("Packages installed successfully with yarn");
                } else {
                  console.log("");
                  console.log(
                    chalk.green(
                      "✅ Dependencies installed successfully with yarn!"
                    )
                  );
                  console.log("");
                }
              } catch {
                if (spinner) spinner.text = "yarn not found, trying npm...";
                try {
                  await runPackageManager(
                    "npm",
                    getInstallArgs("npm"),
                    projectPath
                  );
                  usedPackageManager = "npm";
                  if (spinner) {
                    spinner.succeed("Packages installed successfully with npm");
                  } else {
                    console.log("");
                    console.log(
                      chalk.green(
                        "✅ Dependencies installed successfully with npm!"
                      )
                    );
                    console.log("");
                  }
                } catch {
                  if (spinner) spinner.text = "npm not found, trying pnpm...";
                  await runPackageManager(
                    "pnpm",
                    getInstallArgs("pnpm"),
                    projectPath
                  );
                  usedPackageManager = "pnpm";
                  if (spinner) {
                    spinner.succeed(
                      "Packages installed successfully with pnpm"
                    );
                  } else {
                    console.log("");
                    console.log(
                      chalk.green(
                        "✅ Dependencies installed successfully with pnpm!"
                      )
                    );
                    console.log("");
                  }
                }
              }
            }
          } catch (error) {
            if (spinner) {
              spinner.fail("Package installation failed");
            } else {
              console.log("❌ Package installation failed");
            }
            console.log(
              '⚠️  Please run "npm install", "yarn install", or "pnpm install" manually'
            );
          }
        }

        // Ask to install skills if not explicitly set
        console.log("");
        const shouldInstallSkills =
          options.skills !== undefined
            ? options.skills
            : await promptForSkillsPresets();
        if (shouldInstallSkills) {
          console.log("");
          console.log(chalk.cyan("📚 Installing skills..."));
          try {
            await addSkillsToProject(projectPath);
            console.log(chalk.green("✅ Skills installed successfully!"));
          } catch (err) {
            console.log(
              chalk.yellow(
                "⚠️  Skills install failed. Run `npx skills add mcp-use/mcp-use` manually in root directory."
              )
            );
          }
        }

        // Note: Git initialization is skipped to avoid delays when scanning node_modules.
        // Users can run `git init` themselves when ready.

        console.log("");
        console.log(chalk.green("✅ MCP server created successfully!"));
        if (options.dev) {
          console.log(
            chalk.yellow("🔧 Development mode: Using workspace dependencies")
          );
        } else if (options.canary) {
          console.log(
            chalk.blue("🚀 Canary mode: Using canary versions of packages")
          );
        }
        console.log("");
        console.log(chalk.bold("📁 Project structure:"));
        console.log(`   ${sanitizedProjectName}/`);
        if (validatedTemplate === "mcp-apps") {
          console.log("   ├── resources/");
          console.log("   │   └── display-weather.tsx");
        }
        if (validatedTemplate === "mcp-ui") {
          console.log("   ├── resources/");
          console.log("   │   └── kanban-board.tsx");
        }
        if (validatedTemplate === "starter") {
          console.log("   ├── resources/");
          console.log("   │   └── kanban-board.tsx (MCP-UI example)");
          console.log(
            "   │   └── display-weather.tsx (OpenAI Apps SDK example)"
          );
        }
        console.log("   ├── index.ts (server entry point)");
        console.log("   ├── package.json");
        console.log("   ├── tsconfig.json");
        console.log("   └── README.md");
        console.log("");
        console.log(chalk.bold("🚀 To get started:"));
        console.log(chalk.cyan(`   cd ${sanitizedProjectName}`));
        if (!shouldInstall) {
          console.log(
            chalk.cyan(`   ${getInstallCommand(usedPackageManager)}`)
          );
        }
        console.log(chalk.cyan(`   ${getDevCommand(usedPackageManager)}`));
        console.log("");
        console.log(chalk.bold("📤 To deploy:"));
        console.log(
          chalk.cyan(
            `   ${usedPackageManager === "yarn" ? "yarn" : usedPackageManager === "pnpm" ? "pnpm" : "npm run"} deploy`
          )
        );
        console.log("");
        if (options.dev) {
          console.log(
            chalk.yellow(
              "💡 Development mode: Your project uses workspace dependencies"
            )
          );
          console.log(
            chalk.yellow(
              "   Make sure you're in the mcp-use workspace root for development"
            )
          );
          console.log("");
        }
        console.log(chalk.blue("📚 Learn more: https://mcp-use.com/docs"));
        console.log(chalk.gray("💬 For feedback and bug reporting visit:"));
        console.log(
          chalk.gray(
            "   https://github.com/mcp-use/mcp-use or https://mcp-use.com"
          )
        );
      } catch (error) {
        console.error("❌ Error creating MCP server:", error);
        process.exit(1);
      }
    }
  );

// Parse GitHub repo URL to extract owner, repo, and branch
interface GitHubRepoInfo {
  owner: string;
  repo: string;
  branch?: string;
}

function parseGitHubRepoUrl(url: string): GitHubRepoInfo | null {
  const trimmed = url.trim();

  // Match patterns:
  // - https://github.com/owner/repo
  // - https://github.com/owner/repo.git
  // - https://github.com/owner/repo#branch
  // - https://github.com/owner/repo/tree/branch
  // - github.com/owner/repo
  // - owner/repo
  // - owner/repo#branch

  // Full URL with https://
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

  // github.com/owner/repo format
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

  // owner/repo format
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
  // GitHub usernames and repo names can contain alphanumeric characters and hyphens
  // Branch names can contain alphanumeric, hyphens, underscores, slashes, and dots
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

// Clone GitHub repo to a temporary directory
async function cloneGitHubRepo(
  repoInfo: GitHubRepoInfo,
  tempDir: string
): Promise<string> {
  // Check if git is available using spawnSync with array arguments
  const versionCheck = spawnSync("git", ["--version"], {
    stdio: "ignore",
    shell: false,
  });
  if (versionCheck.status !== 0 || versionCheck.error) {
    console.error(
      chalk.red("❌ Git is not installed or not available in PATH")
    );
    console.error(
      chalk.yellow("   Please install Git to use GitHub repository templates")
    );
    process.exit(1);
  }

  const repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}.git`;
  const branch = repoInfo.branch || "main";

  const spinner = ora(`Cloning repository from GitHub...`).start();

  // Helper function to clone with a specific branch
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

  // Try cloning with the specified branch
  const cloneResult = cloneWithBranch(branch);
  if (cloneResult.success) {
    spinner.succeed("Repository cloned successfully");
    return tempDir;
  }

  // If branch doesn't exist and no branch was specified, try main/master
  if (!repoInfo.branch) {
    spinner.text = `Branch "${branch}" not found, trying "main"...`;
    const mainResult = cloneWithBranch("main");
    if (mainResult.success) {
      spinner.succeed("Repository cloned successfully (using main branch)");
      return tempDir;
    }

    spinner.text = `Branch "main" not found, trying "master"...`;
    const masterResult = cloneWithBranch("master");
    if (masterResult.success) {
      spinner.succeed("Repository cloned successfully (using master branch)");
      return tempDir;
    }
  }

  // All attempts failed
  spinner.fail("Failed to clone repository");
  console.error(chalk.red(`❌ Error cloning repository: ${repoUrl}`));
  if (repoInfo.branch) {
    console.error(chalk.yellow(`   Branch "${repoInfo.branch}" may not exist`));
  }

  const errorMessage = cloneResult.error?.message || "Unknown error";
  if (errorMessage.includes("not found")) {
    console.error(chalk.yellow(`   Repository may not exist or is private`));
  } else {
    console.error(chalk.yellow(`   ${errorMessage}`));
  }

  throw cloneResult.error || new Error("Failed to clone repository");
}

// Validate and sanitize template name to prevent path traversal
function validateTemplateName(template: string): string {
  const sanitized = template.trim();

  // If it's a GitHub repo URL, skip validation (it will be handled separately)
  if (isGitHubRepoUrl(sanitized)) {
    return sanitized;
  }

  // Template aliases for backward compatibility
  const aliases: Record<string, string> = {
    "apps-sdk": "mcp-apps", // Silent redirect for backward compatibility
  };

  const resolvedTemplate = aliases[sanitized] || sanitized;

  // Security: Prevent path traversal attacks
  if (
    resolvedTemplate.includes("..") ||
    resolvedTemplate.includes("/") ||
    resolvedTemplate.includes("\\")
  ) {
    console.error(chalk.red("❌ Invalid template name"));
    console.error(
      chalk.yellow("   Template name cannot contain path separators")
    );
    process.exit(1);
  }

  // Only allow alphanumeric characters, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(resolvedTemplate)) {
    console.error(chalk.red("❌ Invalid template name"));
    console.error(
      chalk.yellow(
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
  isDevelopment: boolean = false,
  useCanary: boolean = false
) {
  // Check if template is a GitHub repo URL
  const repoInfo = parseGitHubRepoUrl(template);
  if (repoInfo) {
    const tempDir = mkdtempSync(join(tmpdir(), "create-mcp-use-app-"));

    try {
      // Clone the repository
      await cloneGitHubRepo(repoInfo, tempDir);

      // Copy the cloned repository contents to the project path
      copyDirectoryWithProcessing(
        tempDir,
        projectPath,
        versions,
        isDevelopment,
        useCanary
      );
    } finally {
      // Clean up temporary directory
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `Warning: Failed to clean up temp directory: ${tempDir}`
          );
        }
      }
    }
    return;
  }

  // Handle local templates
  const templatePath = join(__dirname, "templates", template);

  if (!existsSync(templatePath)) {
    console.error(chalk.red(`❌ Template "${template}" not found!`));

    // Dynamically list available templates
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
      '💡 Tip: Use "starter" template for a comprehensive MCP server with all features'
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
    isDevelopment,
    useCanary
  );
}

function copyDirectoryWithProcessing(
  src: string,
  dest: string,
  versions: Record<string, string>,
  isDevelopment: boolean,
  useCanary: boolean = false
) {
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip .git directories (user's project will have its own git repo initialized)
    if (entry.name === ".git") {
      continue;
    }

    const srcPath = join(src, entry.name);
    // Special handling: rename gitignore to .gitignore
    // This is necessary because npm excludes .gitignore files when publishing packages
    const destName = entry.name === "gitignore" ? ".gitignore" : entry.name;
    const destPath = join(dest, destName);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirectoryWithProcessing(
        srcPath,
        destPath,
        versions,
        isDevelopment,
        useCanary
      );
    } else {
      // Process files that might contain version placeholders
      if (entry.name === "package.json" || entry.name.endsWith(".json")) {
        const processedContent = processTemplateFile(
          srcPath,
          versions,
          isDevelopment,
          useCanary
        );
        writeFileSync(destPath, processedContent);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }
}

function updatePackageJson(projectPath: string, projectName: string) {
  const packageJsonPath = join(projectPath, "package.json");
  const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

  packageJsonContent.name = projectName;
  packageJsonContent.description = `MCP server: ${projectName}`;

  writeFileSync(packageJsonPath, JSON.stringify(packageJsonContent, null, 2));
}

function updateIndexTs(projectPath: string, projectName: string) {
  const indexPath = join(projectPath, "index.ts");

  if (!existsSync(indexPath)) {
    return; // index.ts doesn't exist, skip
  }

  let content = readFileSync(indexPath, "utf-8");

  // Replace {{PROJECT_NAME}} placeholders with actual project name
  content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);

  writeFileSync(indexPath, content);
}

// Ink component for install dependencies prompt (Y/n)
function InstallPrompt({ onSubmit }: { onSubmit: (install: boolean) => void }) {
  const [value, setValue] = useState("");

  const handleSubmit = (val: string) => {
    const trimmed = val.trim().toLowerCase();
    if (trimmed === "" || trimmed === "y" || trimmed === "yes") {
      onSubmit(true);
    } else if (trimmed === "n" || trimmed === "no") {
      onSubmit(false);
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Install dependencies now? (Y/n)</Text>
      </Box>
      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}

async function promptForInstall(): Promise<boolean> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <InstallPrompt
        onSubmit={(install) => {
          unmount();
          resolve(install);
        }}
      />
    );
  });
}

// Ink component for skills preset prompt (Y/n)
function SkillsPresetPrompt({
  onSubmit,
}: {
  onSubmit: (install: boolean) => void;
}) {
  const [value, setValue] = useState("");

  const handleSubmit = (val: string) => {
    const trimmed = val.trim().toLowerCase();
    if (trimmed === "" || trimmed === "y" || trimmed === "yes") {
      onSubmit(true); // Install all skills
    } else if (trimmed === "n" || trimmed === "no") {
      onSubmit(false); // No skills
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Install skills (Recommended)? (Y/n)</Text>
        <Text dimColor>
          The skills help the agent to assist you write mcp-use code.
        </Text>
      </Box>
      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}

async function promptForSkillsPresets(): Promise<boolean> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <SkillsPresetPrompt
        onSubmit={(presets) => {
          unmount();
          resolve(presets);
        }}
      />
    );
  });
}

// Ink component for project name input
function ProjectNameInput({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();

    if (!trimmed) {
      setError("Project name is required");
      return;
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(trimmed)) {
      setError(
        "Project name can only contain letters, numbers, hyphens, and underscores"
      );
      return;
    }
    if (existsSync(join(process.cwd(), trimmed))) {
      setError(
        `Directory "${trimmed}" already exists! Please choose a different name.`
      );
      return;
    }

    onSubmit(trimmed);
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>What is your project name?</Text>
      </Box>
      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color="red">✖ {error}</Text>
        </Box>
      )}
    </Box>
  );
}

async function promptForProjectName(): Promise<string> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ProjectNameInput
        onSubmit={(name) => {
          unmount();
          resolve(name);
        }}
      />
    );
  });
}

// Ink component for template selection
function TemplateSelector({
  onSelect,
}: {
  onSelect: (template: string) => void;
}) {
  const templatesDir = join(__dirname, "templates");

  if (!existsSync(templatesDir)) {
    return (
      <Box flexDirection="column">
        <Text color="red">
          ❌ Templates directory not found at: {templatesDir}
        </Text>
        <Text color="yellow"> __dirname: {__dirname}</Text>
      </Box>
    );
  }

  const availableTemplates = readdirSync(templatesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();

  if (availableTemplates.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="red">❌ No templates found in: {templatesDir}</Text>
      </Box>
    );
  }

  // Read template descriptions dynamically from package.json files
  const items = availableTemplates.map((template) => {
    const packageJsonPath = join(templatesDir, template, "package.json");
    let description = "MCP server template";

    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        description = packageJson.description || description;
      } catch (error) {
        // Use default description
      }
    }

    return {
      label: `${template} - ${description}`,
      value: template,
    };
  });

  // Set default to mcp-apps if available, otherwise first template
  const defaultIndex = items.findIndex((item) => item.value === "mcp-apps");
  const initialIndex = defaultIndex >= 0 ? defaultIndex : 0;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select a template:</Text>
      </Box>
      <SelectInput
        items={items}
        initialIndex={initialIndex}
        onSelect={(item) => onSelect(item.value)}
      />
    </Box>
  );
}

async function promptForTemplate(): Promise<string> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <TemplateSelector
        onSelect={(template) => {
          unmount();
          resolve(template);
        }}
      />
    );
  });
}

program.parse();
