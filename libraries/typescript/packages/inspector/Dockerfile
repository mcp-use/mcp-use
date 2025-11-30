FROM node:20-alpine

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

# Expose 8080 (standard alternative HTTP port for production)
# Note: The actual port is controlled by $PORT env var
EXPOSE 8080

# Start the inspector
CMD ["npx", "@mcp-use/inspector", "--port", "8080"]
