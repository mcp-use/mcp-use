# Dockerfile for MCP Scale Test Server
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the project
RUN pnpm build

# Expose MCP port
EXPOSE 3000

# Run the test server
CMD ["node", "tests/scale/test-server.js"]
