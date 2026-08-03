FROM node:22-alpine

# Specify the version variable (defaults to latest)
ARG VERSION=latest

WORKDIR /app

# Cache bust by checking the latest version from npm
# This layer will be invalidated when a new version is published
RUN npm view @mcp-use/inspector version

# Install the inspector package from npm
RUN npm install -g @mcp-use/inspector@${VERSION}

# Set production environment
ENV NODE_ENV=production

# Expose 8080 (standard alternative HTTP port for production).
# The listen port honors the PORT environment variable (PaaS platforms like
# Cloud Run, Railway, and Heroku inject it) and defaults to 8080.
EXPOSE 8080

# Start the inspector. Shell form so ${PORT:-8080} expands; exec keeps the
# node process as PID 1 for signal handling.
CMD ["sh", "-c", "exec npx @mcp-use/inspector --port \"${PORT:-8080}\""]
