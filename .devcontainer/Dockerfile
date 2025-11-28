FROM mcr.microsoft.com/devcontainers/typescript-node:1-20-bookworm

# Install Python 3.12
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    python3.12 \
    python3.12-venv \
    python3-pip \
    python3.12-dev \
    build-essential \
    git \
    curl \
    wget

# Set Python 3.12 as default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.12 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1

# Install UV (fast Python package installer)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.cargo/bin:${PATH}"

# Install global npm packages that might be useful
RUN npm install -g \
    typescript \
    ts-node \
    nodemon \
    prettier \
    eslint

# Install Python development tools
RUN pip install --no-cache-dir \
    black \
    ruff \
    mypy \
    pytest \
    ipython

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Set up environment variables
ENV NODE_ENV=development
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Expose common ports
EXPOSE 3000 8000 8080

# Switch to non-root user
USER node

CMD ["/bin/bash"]
