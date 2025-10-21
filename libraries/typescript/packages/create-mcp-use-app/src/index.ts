#!/usr/bin/env node

import chalk from 'chalk'
import { Command } from 'commander'
import inquirer from 'inquirer'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ora from 'ora'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Helper function to run package manager commands securely using spawn
function runPackageManager(packageManager: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(packageManager, args, {
      cwd,
      stdio: 'inherit',
      shell: false // Disable shell to prevent command injection
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Process exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}

// Detect which package manager was used to run this script
function detectPackageManager(): string | null {
  // Check npm_config_user_agent which contains info about the package manager
  const userAgent = process.env.npm_config_user_agent || ''

  if (userAgent.includes('yarn')) {
    return 'yarn'
  } else if (userAgent.includes('pnpm')) {
    return 'pnpm'
  } else if (userAgent.includes('npm')) {
    return 'npm'
  }

  return null
}

// Get the dev command for a specific package manager
function getDevCommand(packageManager: string): string {
  switch (packageManager) {
    case 'yarn':
      return 'yarn dev'
    case 'pnpm':
      return 'pnpm dev'
    case 'npm':
    default:
      return 'npm run dev'
  }
}

// Get the install command for a specific package manager
function getInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case 'yarn':
      return 'yarn'
    case 'pnpm':
      return 'pnpm install'
    case 'npm':
    default:
      return 'npm install'
  }
}

const program = new Command()

// Render logo as ASCII art
function renderLogo(): void {
  console.log(chalk.cyan('▛▛▌▛▘▛▌▄▖▌▌▛▘█▌'))
  console.log(chalk.cyan('▌▌▌▙▖▙▌  ▙▌▄▌▙▖'))
  console.log(chalk.cyan('     ▌         '))
}

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
)

// Read current package versions from workspace
function getCurrentPackageVersions(isDevelopment: boolean = false, useCanary: boolean = false) {
  const versions: Record<string, string> = {}

  try {
    if (isDevelopment) {
      // In development mode, use workspace dependencies for all packages
      versions['mcp-use'] = 'workspace:*'
      versions['@mcp-use/cli'] = 'workspace:*'
      versions['@mcp-use/inspector'] = 'workspace:*'
    } else if (useCanary) {
      // In canary mode, use canary versions for published packages
      versions['mcp-use'] = 'canary'
      // For unpublished packages, keep them as workspace dependencies
      // These packages are not available on npm registry yet
      versions['@mcp-use/cli'] = 'canary'
      versions['@mcp-use/inspector'] = 'canary'
    } else {
      // In production mode, use latest for published packages
      versions['mcp-use'] = 'latest'
      // For unpublished packages, keep them as workspace dependencies
      // These packages are not available on npm registry yet
      versions['@mcp-use/cli'] = 'latest'
      versions['@mcp-use/inspector'] = 'latest'
    }
  } catch (error) {
    // Use defaults when not in workspace (normal for published package)
    // Log error details in development mode for debugging
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️  Could not read workspace package versions, using defaults')
      console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`)
      if (error instanceof Error && error.stack) {
        console.warn(`   Stack: ${error.stack}`)
      }
    }
  }

  return versions
}

// Process template files to replace version placeholders
function processTemplateFile(filePath: string, versions: Record<string, string>, isDevelopment: boolean = false, useCanary: boolean = false) {
  const content = readFileSync(filePath, 'utf-8')
  let processedContent = content

  // Replace version placeholders with current versions
  for (const [packageName, version] of Object.entries(versions)) {
    const placeholder = `{{${packageName}_version}}`
    processedContent = processedContent.replace(new RegExp(placeholder, 'g'), version)
  }

  // Handle workspace dependencies based on mode
  if (isDevelopment) {
    // Keep workspace dependencies for development
    processedContent = processedContent.replace(/"mcp-use": "\^[^"]+"/, '"mcp-use": "workspace:*"')
    processedContent = processedContent.replace(/"@mcp-use\/cli": "\^[^"]+"/, '"@mcp-use/cli": "workspace:*"')
    processedContent = processedContent.replace(/"@mcp-use\/inspector": "\^[^"]+"/, '"@mcp-use/inspector": "workspace:*"')
  } else if (useCanary) {
    processedContent = processedContent.replace(/"mcp-use": "workspace:\*"/, `"mcp-use": "canary"`)
    processedContent = processedContent.replace(/"@mcp-use\/cli": "workspace:\*"/, `"@mcp-use/cli": "canary"`)
    processedContent = processedContent.replace(/"@mcp-use\/inspector": "workspace:\*"/, `"@mcp-use/inspector": "canary"`)
  } else {
    // Replace workspace dependencies with specific versions for production
    processedContent = processedContent.replace(/"mcp-use": "workspace:\*"/, `"mcp-use": "${versions['mcp-use'] || 'latest'}"`)
    processedContent = processedContent.replace(/"@mcp-use\/cli": "workspace:\*"/, `"@mcp-use/cli": "${versions['@mcp-use/cli'] || 'latest'}"`)
    processedContent = processedContent.replace(/"@mcp-use\/inspector": "workspace:\*"/, `"@mcp-use/inspector": "${versions['@mcp-use/inspector'] || 'latest'}"`)
  }

  return processedContent
}

program
  .name('create-mcp-use-app')
  .description('Create a new MCP server project')
  .version(packageJson.version)
  .argument('[project-name]', 'Name of the MCP server project')
  .option('-t, --template <template>', 'Template to use', 'simple')
  .option('--no-install', 'Skip installing dependencies')
  .option('--dev', 'Use workspace dependencies for development')
  .option('--canary', 'Use canary versions of packages')
  .option('--yarn', 'Use yarn as package manager')
  .option('--npm', 'Use npm as package manager')
  .option('--pnpm', 'Use pnpm as package manager')
  .action(async (projectName: string | undefined, options: { template: string, install: boolean, dev: boolean, canary: boolean, yarn?: boolean, npm?: boolean, pnpm?: boolean }) => {
    try {
      let selectedTemplate = options.template

      // If no project name provided, prompt for it
      if (!projectName) {
        console.log('')
        renderLogo()
        console.log('')
        console.log(chalk.bold('Welcome to create-mcp-use-app!'))
        console.log('')

        projectName = await promptForProjectName()
        console.log('')

        // Prompt for template selection in interactive mode
        selectedTemplate = await promptForTemplate()
      }

      // Validate project name
      const sanitizedProjectName = projectName!.trim()
      if (!sanitizedProjectName) {
        console.error(chalk.red('❌ Project name cannot be empty'))
        process.exit(1)
      }

      // Security: Validate project name doesn't contain path traversal
      if (sanitizedProjectName.includes('..') || sanitizedProjectName.includes('/') || sanitizedProjectName.includes('\\')) {
        console.error(chalk.red('❌ Project name cannot contain path separators or ".."'))
        console.error(chalk.yellow('   Use simple names like "my-mcp-server"'))
        process.exit(1)
      }

      // Validate against common protected directory names
      const protectedNames = ['node_modules', '.git', '.env', 'package.json', 'src', 'dist']
      if (protectedNames.includes(sanitizedProjectName.toLowerCase())) {
        console.error(chalk.red(`❌ Cannot use protected name "${sanitizedProjectName}"`))
        console.error(chalk.yellow('   Please choose a different project name'))
        process.exit(1)
      }

      console.log(chalk.cyan(`🚀 Creating MCP server "${sanitizedProjectName}"...`))

      const projectPath = resolve(process.cwd(), sanitizedProjectName)

      // Check if directory already exists
      if (existsSync(projectPath)) {
        console.error(chalk.red(`❌ Directory "${sanitizedProjectName}" already exists!`))
        console.error(chalk.yellow('   Please choose a different name or remove the existing directory'))
        process.exit(1)
      }

      // Create project directory
      mkdirSync(projectPath, { recursive: true })

      // Validate template name
      const validatedTemplate = validateTemplateName(selectedTemplate)

      // Get current package versions
      const versions = getCurrentPackageVersions(options.dev, options.canary)

      // Copy template files
      await copyTemplate(projectPath, validatedTemplate, versions, options.dev, options.canary)

      // Update package.json with project name
      updatePackageJson(projectPath, sanitizedProjectName)

      // Determine which package manager to use
      let usedPackageManager = 'npm'

      // Check if a specific package manager was requested via flags
      if (options.yarn) {
        usedPackageManager = 'yarn'
      } else if (options.npm) {
        usedPackageManager = 'npm'
      } else if (options.pnpm) {
        usedPackageManager = 'pnpm'
      } else {
        // Try to detect which package manager was used to run this script
        const detected = detectPackageManager()
        if (detected) {
          usedPackageManager = detected
        } else {
          // No flag and couldn't detect, try in order: yarn → npm → pnpm
          const defaultOrder = ['yarn', 'npm', 'pnpm']
          // We'll determine the working one during installation
          usedPackageManager = defaultOrder[0]
        }
      }

      // Install dependencies if requested
      if (options.install) {
        // Yarn and npm show their own progress, so we don't need a spinner for them
        const showSpinner = usedPackageManager !== 'yarn' && usedPackageManager !== 'npm'
        const spinner = showSpinner ? ora('Installing packages...').start() : null

        try {
          if (options.yarn || options.npm || options.pnpm || detectPackageManager()) {
            // Use the specific package manager
            if (!showSpinner) {
              console.log('')
            }
            await runPackageManager(usedPackageManager, ['install'], projectPath)
            if (spinner) {
              spinner.succeed(`Packages installed successfully with ${usedPackageManager}`)
            } else {
              console.log('')
            }
          } else {
            // Try in order: yarn → npm → pnpm
            if (spinner) spinner.text = 'Installing packages (trying yarn)...'
            try {
              if (!spinner) console.log('')
              await runPackageManager('yarn', ['install'], projectPath)
              usedPackageManager = 'yarn'
              if (spinner) {
                spinner.succeed('Packages installed successfully with yarn')
              } else {
                console.log('')
              }
            } catch {
              if (spinner) spinner.text = 'yarn not found, trying npm...'
              try {
                await runPackageManager('npm', ['install'], projectPath)
                usedPackageManager = 'npm'
                if (spinner) {
                  spinner.succeed('Packages installed successfully with npm')
                } else {
                  console.log('')
                }
              } catch {
                if (spinner) spinner.text = 'npm not found, trying pnpm...'
                await runPackageManager('pnpm', ['install'], projectPath)
                usedPackageManager = 'pnpm'
                if (spinner) {
                  spinner.succeed('Packages installed successfully with pnpm')
                } else {
                  console.log('')
                }
              }
            }
          }
        }
        catch (error) {
          if (spinner) {
            spinner.fail('Package installation failed')
          } else {
            console.log('❌ Package installation failed')
          }
          console.log('⚠️  Please run "npm install", "yarn install", or "pnpm install" manually')
        }
      }

      console.log('')
      console.log(chalk.green('✅ MCP server created successfully!'))
      if (options.dev) {
        console.log(chalk.yellow('🔧 Development mode: Using workspace dependencies'))
      } else if (options.canary) {
        console.log(chalk.blue('🚀 Canary mode: Using canary versions of packages'))
      }
      console.log('')
      console.log(chalk.bold('📁 Project structure:'))
      console.log(`   ${sanitizedProjectName}/`)
      console.log('   ├── src/')
      console.log('   │   └── server.ts')
      if (validatedTemplate === 'ui') {
        console.log('   ├── resources/')
        console.log('   │   ├── data-visualization.tsx')
        console.log('   │   ├── kanban-board.tsx')
        console.log('   │   └── todo-list.tsx')
      }
      console.log('   ├── index.ts')
      console.log('   ├── package.json')
      console.log('   ├── tsconfig.json')
      console.log('   └── README.md')
      console.log('')
      console.log(chalk.bold('🚀 To get started:'))
      console.log(chalk.cyan(`   cd ${sanitizedProjectName}`))
      if (!options.install) {
        console.log(chalk.cyan(`   ${getInstallCommand(usedPackageManager)}`))
      }
      console.log(chalk.cyan(`   ${getDevCommand(usedPackageManager)}`))
      console.log('')
      if (options.dev) {
        console.log(chalk.yellow('💡 Development mode: Your project uses workspace dependencies'))
        console.log(chalk.yellow('   Make sure you\'re in the mcp-use workspace root for development'))
        console.log('')
      }
      console.log(chalk.blue('📚 Learn more: https://docs.mcp-use.com'))
      console.log(chalk.gray('💬 For feedback and bug reporting visit:'))
      console.log(chalk.gray('   https://github.com/mcp-use/mcp-use or https://mcp-use.com'))
    }
    catch (error) {
      console.error('❌ Error creating MCP server:', error)
      process.exit(1)
    }
  })

// Validate and sanitize template name to prevent path traversal
function validateTemplateName(template: string): string {
  const sanitized = template.trim()

  // Security: Prevent path traversal attacks
  if (sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('\\')) {
    console.error(chalk.red('❌ Invalid template name'))
    console.error(chalk.yellow('   Template name cannot contain path separators'))
    process.exit(1)
  }

  // Only allow alphanumeric characters, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    console.error(chalk.red('❌ Invalid template name'))
    console.error(chalk.yellow('   Template name can only contain letters, numbers, hyphens, and underscores'))
    process.exit(1)
  }

  return sanitized
}

async function copyTemplate(projectPath: string, template: string, versions: Record<string, string>, isDevelopment: boolean = false, useCanary: boolean = false) {
  const templatePath = join(__dirname, 'templates', template)

  if (!existsSync(templatePath)) {
    console.error(chalk.red(`❌ Template "${template}" not found!`))

    // Dynamically list available templates
    const templatesDir = join(__dirname, 'templates')
    if (existsSync(templatesDir)) {
      const availableTemplates = readdirSync(templatesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .sort()

      console.log(`Available templates: ${availableTemplates.join(', ')}`)
    } else {
      console.log('No templates directory found')
    }

    console.log('💡 Tip: Use "starter" template for a comprehensive MCP server with all features')
    console.log('💡 Tip: Use "ui-resource" template for a MCP server with mcp-ui resources')
    console.log('💡 Tip: Use "apps-sdk-demo" template for a MCP server with OpenAI Apps SDK integration')
    process.exit(1)
  }

  copyDirectoryWithProcessing(templatePath, projectPath, versions, isDevelopment, useCanary)
}

function copyDirectoryWithProcessing(src: string, dest: string, versions: Record<string, string>, isDevelopment: boolean, useCanary: boolean = false) {
  const entries = readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true })
      copyDirectoryWithProcessing(srcPath, destPath, versions, isDevelopment, useCanary)
    }
    else {
      // Process files that might contain version placeholders
      if (entry.name === 'package.json' || entry.name.endsWith('.json')) {
        const processedContent = processTemplateFile(srcPath, versions, isDevelopment, useCanary)
        writeFileSync(destPath, processedContent)
      } else {
        copyFileSync(srcPath, destPath)
      }
    }
  }
}


function updatePackageJson(projectPath: string, projectName: string) {
  const packageJsonPath = join(projectPath, 'package.json')
  const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

  packageJsonContent.name = projectName
  packageJsonContent.description = `MCP server: ${projectName}`

  writeFileSync(packageJsonPath, JSON.stringify(packageJsonContent, null, 2))
}

async function promptForProjectName(): Promise<string> {
  const { projectName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'What is your project name?',
      validate: (input: string) => {
        const trimmed = input.trim()
        if (!trimmed) {
          return 'Project name is required'
        }
        if (!/^[a-zA-Z0-9-_]+$/.test(trimmed)) {
          return 'Project name can only contain letters, numbers, hyphens, and underscores'
        }
        if (existsSync(join(process.cwd(), trimmed))) {
          return `Directory "${trimmed}" already exists! Please choose a different name.`
        }
        return true
      }
    }
  ])
  return projectName
}

async function promptForTemplate(): Promise<string> {
  // Get available templates
  const templatesDir = join(__dirname, 'templates')
  const availableTemplates =  readdirSync(templatesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .sort()

  // Read template descriptions dynamically from package.json files
  const templateDescriptions: Record<string, string> = {}
  for (const template of availableTemplates) {
    const packageJsonPath = join(templatesDir, template, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
        templateDescriptions[template] = packageJson.description || 'MCP server template'
      } catch (error) {
        templateDescriptions[template] = 'MCP server template'
      }
    } else {
      templateDescriptions[template] = 'MCP server template'
    }
  }

  const { template } = await inquirer.prompt([
    {
      type: 'list',
      name: 'template',
      message: 'Select a template:',
      default: 'simple',
      choices: availableTemplates.map(template => ({
        name: `${template} - ${templateDescriptions[template] || 'MCP server template'}`,
        value: template
      }))
    }
  ])

  return template
}

program.parse()

