FROM node:22-alpine

# Docker Hub may select an explicit release; native Git builds use package.json.
ARG VERSION
ARG RAILWAY_GIT_BRANCH

WORKDIR /app

# Copying the manifest invalidates the install layer when the version changes.
# Never fall back to a dist-tag: an unpublished version must fail the build.
COPY package.json ./package.json
RUN INSPECTOR_VERSION="${VERSION:-$(node -p 'require("./package.json").version')}" \
    && node -e 'const [version, branch] = process.argv.slice(1); if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || (branch === "main" && version.includes("-"))) throw new Error("Expected an exact published version; main requires a stable release")' "$INSPECTOR_VERSION" "$RAILWAY_GIT_BRANCH" \
    && npm install -g "@mcp-use/inspector@${INSPECTOR_VERSION}"

# Set production environment
ENV NODE_ENV=production

# Expose 8080 (standard alternative HTTP port for production).
# The listen port honors the PORT environment variable (PaaS platforms like
# Cloud Run, Railway, and Heroku inject it) and defaults to 8080.
EXPOSE 8080

# Start the inspector. Shell form so ${PORT:-8080} expands; exec keeps the
# node process as PID 1 for signal handling.
CMD ["sh", "-c", "exec mcp-inspect --port \"${PORT:-8080}\" --no-open"]
