# Development Guide

This document provides guidance for developers contributing to this project and details the release process.

## Setting Up Development Environment

1. Clone the repository:
   ```bash
   git clone https://github.com/zandko/mcp-use.git
   cd mcp-use
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
   > **Note**: This project requires Node.js version 22 or higher.
3. Build the project:
   ```bash
   pnpm build
   ```
4. Watch for changes during development:
   ```bash
   pnpm watch
   ```

## Contribution Guidelines

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) for our commit messages:

- `feat:` - A new feature
- `fix:` - A bug fix
- `docs:` - Documentation only changes
- `style:` - Changes that do not affect the meaning of the code
- `refactor:` - A code change that neither fixes a bug nor adds a feature
- `perf:` - A code change that improves performance
- `test:` - Adding missing tests or correcting existing tests
- `chore:` - Changes to the build process or auxiliary tools

### Pull Request Process

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Release Process

### Automated Release Workflow

We use GitHub Actions to automate our release process, connecting GitHub Releases with npm publishing.

#### For Maintainers

1. **Prepare for Release**:
   Update the version in `package.json` using one of these commands:
   ```bash
   # For patch releases (0.0.x) - Bug fixes
   pnpm run release
   # For minor releases (0.x.0) - New features
   pnpm run release:minor
   # For major releases (x.0.0) - Breaking changes
   pnpm run release:major
   ```
   This will:
   - Update the version in package.json
   - Create a git tag
   - Push the changes and tag to GitHub
2. **Create GitHub Release**:
   - Go to GitHub repository → "Releases" → "Draft a new release"
   - Choose the tag that was just created
   - Fill in release notes detailing what's new, fixes, and any breaking changes
   - Click "Publish release"
3. **Automated Publishing**:
   The GitHub Action will automatically:
   - Verify the package version matches the GitHub tag
   - Run linting and build checks
   - Generate a changelog from commits since the last release
   - Update the GitHub release with the changelog
   - Publish to npm with the version from package.json
   - Update the Contributors list in the README
   - Send a notification upon successful publish (if configured)

### Setting Up Automation (For Repository Owners)

To set up automated publishing:

1. Generate an NPM access token:
   - Go to npmjs.com → User Settings → Access Tokens
   - Create a new token with "Automation" type and publish permissions
2. Add the token to GitHub repository secrets:
   - Go to your GitHub repository → Settings → Secrets → Actions
   - Add a new secret named `NPM_TOKEN` with the value of your NPM token
3. (Optional) Discord notifications:
   - Create a Discord webhook in your server
   - Add the webhook URL as a GitHub repository secret named `DISCORD_WEBHOOK`

## Updating Contributors

Contributors are automatically updated in the README.md file whenever a push is made to the main branch, using the [BobAnkh/add-contributors](https://github.com/BobAnkh/add-contributors) GitHub Action.
