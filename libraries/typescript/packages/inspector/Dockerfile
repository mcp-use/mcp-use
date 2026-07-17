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
# The actual listen port is controlled by the $PORT env var (defaults to 8080),
# so PaaS platforms that inject PORT (Cloud Run, Railway, Heroku, Render, etc.)
# route to the correct port without extra port-mapping layers.
EXPOSE 8080

# Start the inspector — shell-form so $PORT expansion works.
CMD ["sh", "-c", "npx @mcp-use/inspector --port ${PORT:-8080}"]
