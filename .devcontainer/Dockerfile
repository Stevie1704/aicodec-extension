FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:22-bullseye

# Install python and minimal tools to run the CLI if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv git && \
    rm -rf /var/lib/apt/lists/*
