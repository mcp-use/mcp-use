FROM node:20-alpine

WORKDIR /app

# Install the inspector package from npm
RUN npm install -g @mcp-use/inspector

# Create a simple wrapper script that respects PORT env var
RUN echo '#!/bin/sh\nPORT=${PORT:-3001}\necho "Starting MCP Inspector on port $PORT"\nexec npx @mcp-use/inspector --port $PORT' > /app/start.sh && \
    chmod +x /app/start.sh

# Set production environment
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Start the inspector using the wrapper script
CMD ["/app/start.sh"]
