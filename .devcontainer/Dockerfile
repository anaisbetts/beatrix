FROM oven/bun:latest

# Install additional system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    vim \
    nano \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user (bun group already exists)
RUN useradd --uid 1000 --gid bun --shell /bin/bash --create-home bun

# Set up workspace
WORKDIR /workspace
RUN chown -R bun:bun /workspace

# Switch to non-root user
USER bun

# Set up bun environment
ENV BUN_INSTALL="/home/bun/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Create directories for persistent data
RUN mkdir -p /workspace/notebook

# Expose development ports
EXPOSE 8080 3000

# Default command
CMD ["sleep", "infinity"]