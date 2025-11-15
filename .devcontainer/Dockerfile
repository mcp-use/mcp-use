FROM node:20-bullseye

# Install basic development tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /workspace

# Set the default user
USER node
