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
function getCurrentPackageVersions() {
  const versions: Record<string, string> = {}
  
  try {
    // Try multiple possible workspace root locations
    const possibleRoots = [
      resolve(__dirname, '../../../..'), // From dist/templates
      resolve(__dirname, '../../../../..'), // From dist
      resolve(process.cwd(), '.'), // Current working directory
      resolve(process.cwd(), '..'), // Parent of current directory
    ]
    
    let workspaceRoot = null
    for (const root of possibleRoots) {
      if (existsSync(join(root, 'packages/mcp-use/package.json'))) {
        workspaceRoot = root
        break
      }
    }
    
    if (!workspaceRoot) {
      throw new Error('Workspace root not found')
    }
    
    // Read mcp-use version
    const mcpUsePackage = JSON.parse(
      readFileSync(join(workspaceRoot, 'packages/mcp-use/package.json'), 'utf-8')
    )
    versions['mcp-use'] = mcpUsePackage.version
    
    // Read cli version
    const cliPackage = JSON.parse(
      readFileSync(join(workspaceRoot, 'packages/cli/package.json'), 'utf-8')
    )
    versions['@mcp-use/cli'] = cliPackage.version
    
    // Read inspector version
    const inspectorPackage = JSON.parse(
      readFileSync(join(workspaceRoot, 'packages/inspector/package.json'), 'utf-8')
    )
    versions['@mcp-use/inspector'] = inspectorPackage.version
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
function processTemplateFile(filePath: string, versions: Record<string, string>, isDevelopment: boolean = false) {
  const content = readFileSync(filePath, 'utf-8')
  let processedContent = content
  
  // Replace version placeholders with current versions
  for (const [packageName, version] of Object.entries(versions)) {
    const placeholder = `{{${packageName}_version}}`
    const versionPrefix = isDevelopment ? 'workspace:*' : `^${version}`
    processedContent = processedContent.replace(new RegExp(placeholder, 'g'), versionPrefix)
  }
  
  // Handle workspace dependencies based on mode
  if (isDevelopment) {
    // Keep workspace dependencies for development
    processedContent = processedContent.replace(/"mcp-use": "\^[^"]+"/, '"mcp-use": "workspace:*"')
    processedContent = processedContent.replace(/"@mcp-use\/cli": "\^[^"]+"/, '"@mcp-use/cli": "workspace:*"')
    processedContent = processedContent.replace(/"@mcp-use\/inspector": "\^[^"]+"/, '"@mcp-use/inspector": "workspace:*"')
  } else {
    // Replace workspace dependencies with specific versions for production
    processedContent = processedContent.replace(/"mcp-use": "workspace:\*"/, `"mcp-use": "^${versions['mcp-use'] || '1.0.0'}"`)
    processedContent = processedContent.replace(/"@mcp-use\/cli": "workspace:\*"/, `"@mcp-use/cli": "^${versions['@mcp-use/cli'] || '2.0.0'}"`)
    processedContent = processedContent.replace(/"@mcp-use\/inspector": "workspace:\*"/, `"@mcp-use/inspector": "^${versions['@mcp-use/inspector'] || '0.3.0'}"`)
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
  .action(async (projectName: string | undefined, options: { template: string, install: boolean, dev: boolean }) => {
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
      const versions = getCurrentPackageVersions()
      
      // Copy template files
      await copyTemplate(projectPath, validatedTemplate, versions, options.dev)

      // Update package.json with project name
      updatePackageJson(projectPath, sanitizedProjectName)

      // Install dependencies if requested
      if (options.install) {
        const spinner = ora('Installing packages...').start()
        try {
          await runPackageManager('pnpm', ['install'], projectPath)
          spinner.succeed('Packages installed successfully')
        }
        catch {
          spinner.text = 'pnpm not found, trying npm...'
          try {
            await runPackageManager('npm', ['install'], projectPath)
            spinner.succeed('Packages installed successfully')
          }
          catch (error) {
            spinner.fail('Package installation failed')
            console.log('⚠️  Please run "npm install" or "pnpm install" manually')
          }
        }
      }

      console.log('')
      console.log(chalk.green('✅ MCP server created successfully!'))
      if (options.dev) {
        console.log(chalk.yellow('🔧 Development mode: Using workspace dependencies'))
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
        console.log(chalk.cyan('   npm install'))
      }
      console.log(chalk.cyan('   npm run dev'))
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

async function copyTemplate(projectPath: string, template: string, versions: Record<string, string>, isDevelopment: boolean = false) {
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
    
    console.log('💡 Tip: Use "ui" template for React components and modern UI features')
    console.log('💡 Tip: Use "uiresource" template for UI resources and advanced server examples')
    process.exit(1)
  }

  copyDirectoryWithProcessing(templatePath, projectPath, versions, isDevelopment)
}

function copyDirectoryWithProcessing(src: string, dest: string, versions: Record<string, string>, isDevelopment: boolean) {
  const entries = readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true })
      copyDirectoryWithProcessing(srcPath, destPath, versions, isDevelopment)
    }
    else {
      // Process files that might contain version placeholders
      if (entry.name === 'package.json' || entry.name.endsWith('.json')) {
        const processedContent = processTemplateFile(srcPath, versions, isDevelopment)
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
  const availableTemplates = existsSync(templatesDir) 
    ? readdirSync(templatesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .sort()
    : ['simple', 'ui', 'uiresource']

  const templateDescriptions: Record<string, string> = {
    'simple': 'Simple MCP server with a basic calculator tool (add numbers)',
    'ui': 'MCP Server with mcp-ui resources returned from tools',
    'uiresource': 'MCP Server with mcp-ui resources',
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

